package com.novanovastudio.controller;

import com.alibaba.fastjson2.JSON;
import com.novanovastudio.common.ApiResponse;
import com.novanovastudio.common.WebsiteLanguage;
import com.novanovastudio.dto.OAuthServerDtos;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.security.oauthserver.OAuthProtocolException;
import com.novanovastudio.service.OAuthAuthorizationServerService;
import jakarta.validation.Valid;
import java.net.URI;
import java.util.LinkedHashMap;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

/**
 * 对外 OAuth2 授权码、令牌和用户信息接口。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-09 18:40
 */
@RestController
@RequestMapping("/api/v1/oauth")
@RequiredArgsConstructor
@Slf4j
public class OAuthAuthorizationServerController {

    /** 对外授权服务 */
    private final OAuthAuthorizationServerService authorizationServerService;

    /** 当前登录用户 */
    private final CurrentUserProvider currentUserProvider;

    /**
     * 浏览器授权入口。校验通过后跳到本站确认页。
     *
     * @param clientId String 客户端标识
     * @param redirectUri String 回调地址
     * @param responseType String 响应类型
     * @param scope String 授权范围
     * @param state String 授权状态
     * @param exchange ServerWebExchange 当前请求
     * @return Mono<ResponseEntity<String>> 重定向或错误页
     */
    @GetMapping("/authorize")
    public Mono<ResponseEntity<String>> authorize(@RequestParam(name = "client_id", required = false) String clientId,
                                                  @RequestParam(name = "redirect_uri", required = false) String redirectUri,
                                                  @RequestParam(name = "response_type", required = false) String responseType,
                                                  @RequestParam(name = "scope", required = false) String scope,
                                                  @RequestParam(name = "state", required = false) String state,
                                                  ServerWebExchange exchange) {
        var locale = WebsiteLanguage.resolve(exchange);
        return authorizationServerService.beginAuthorization(clientId, redirectUri, responseType, scope, state, locale)
                .map(outcome -> {
                    if (StringUtils.hasText(outcome.redirectLocation())) {
                        return ResponseEntity.status(HttpStatus.FOUND)
                                .location(URI.create(outcome.redirectLocation()))
                                .cacheControl(CacheControl.noStore())
                                .body("");
                    }
                    String message = outcome.errorMessage().render(locale);
                    return ResponseEntity.badRequest()
                            .contentType(MediaType.TEXT_HTML)
                            .cacheControl(CacheControl.noStore())
                            .body(errorPage(message));
                });
    }

    /**
     * 查询确认页要展示的应用。
     *
     * @param requestId String 授权请求标识
     * @return Mono<ApiResponse<AuthorizationRequestView>> 应用信息
     */
    @GetMapping("/getAuthorizationRequest")
    public Mono<ApiResponse<OAuthServerDtos.AuthorizationRequestView>> getAuthorizationRequest(@RequestParam String requestId) {
        return authorizationServerService.authorizationRequest(requestId).map(ApiResponse::ok);
    }

    /**
     * 当前用户同意授权。
     *
     * @param request AuthorizationActionRequest 授权请求标识
     * @return Mono<ApiResponse<AuthorizationDecision>> 外部回调地址
     */
    @PostMapping("/approveAuthorization")
    public Mono<ApiResponse<OAuthServerDtos.AuthorizationDecision>> approveAuthorization(
            @Valid @RequestBody OAuthServerDtos.AuthorizationActionRequest request) {
        return currentUserProvider.currentUser()
                .flatMap(user -> authorizationServerService.approve(request.requestId(), user.id()))
                .map(ApiResponse::ok);
    }

    /**
     * 当前用户拒绝授权。
     *
     * @param request AuthorizationActionRequest 授权请求标识
     * @param exchange ServerWebExchange 当前请求
     * @return Mono<ApiResponse<AuthorizationDecision>> 外部回调地址
     */
    @PostMapping("/denyAuthorization")
    public Mono<ApiResponse<OAuthServerDtos.AuthorizationDecision>> denyAuthorization(
            @Valid @RequestBody OAuthServerDtos.AuthorizationActionRequest request, ServerWebExchange exchange) {
        return currentUserProvider.currentUser()
                .flatMap(user -> authorizationServerService.deny(request.requestId(), user.id(), WebsiteLanguage.resolve(exchange)))
                .map(ApiResponse::ok);
    }

    /**
     * 用授权码换取访问令牌。响应是 OAuth 原文。
     *
     * @param exchange ServerWebExchange 当前请求
     * @return Mono<ResponseEntity<String>> 令牌或协议错误
     */
    @PostMapping(value = "/token", consumes = MediaType.APPLICATION_FORM_URLENCODED_VALUE)
    public Mono<ResponseEntity<String>> token(ServerWebExchange exchange) {
        return exchange.getFormData()
                .flatMap(form -> authorizationServerService.exchangeToken(
                        exchange.getRequest().getHeaders().getFirst(HttpHeaders.AUTHORIZATION),
                        form.getFirst("grant_type"),
                        form.getFirst("code"),
                        form.getFirst("redirect_uri"),
                        form.getFirst("client_id"),
                        form.getFirst("client_secret")))
                .map(this::json)
                .onErrorResume(OAuthProtocolException.class, exception -> {
                    log.warn("对外授权令牌请求被拒绝: error={}", exception.oauthError());
                    return Mono.just(protocolError(exception));
                });
    }

    /**
     * 用访问令牌读取用户资料。响应是 OAuth 原文。
     *
     * @param exchange ServerWebExchange 当前请求
     * @return Mono<ResponseEntity<String>> 用户资料或协议错误
     */
    @GetMapping("/userinfo")
    public Mono<ResponseEntity<String>> userInfo(ServerWebExchange exchange) {
        return authorizationServerService.userInfo(exchange.getRequest().getHeaders().getFirst(HttpHeaders.AUTHORIZATION))
                .map(this::json)
                .onErrorResume(OAuthProtocolException.class, exception -> {
                    log.warn("对外授权用户信息请求被拒绝: error={}", exception.oauthError());
                    return Mono.just(protocolError(exception));
                });
    }

    /**
     * 写出 JSON 响应。
     *
     * @param body Object 响应内容
     * @return ResponseEntity<String> JSON 响应
     */
    private ResponseEntity<String> json(Object body) {
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_JSON)
                .cacheControl(CacheControl.noStore())
                .body(JSON.toJSONString(body));
    }

    /**
     * 写出 OAuth 协议错误。
     *
     * @param exception OAuthProtocolException 协议错误
     * @return ResponseEntity<String> 协议错误响应
     */
    private ResponseEntity<String> protocolError(OAuthProtocolException exception) {
        Map<String, String> body = new LinkedHashMap<>();
        body.put("error", exception.oauthError());
        body.put("error_description", exception.getMessage());
        return ResponseEntity.status(exception.status())
                .contentType(MediaType.APPLICATION_JSON)
                .cacheControl(CacheControl.noStore())
                .body(JSON.toJSONString(body));
    }

    /**
     * 生成给浏览器看的简单错误页。
     *
     * @param message String 已按请求语言渲染的说明
     * @return String HTML
     */
    private String errorPage(String message) {
        return "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>授权失败</title></head><body><p>"
                + htmlEscape(message) + "</p></body></html>";
    }

    /**
     * 转义 HTML 文本。
     *
     * @param value String 原始文本
     * @return String 可放入 HTML 的文本
     */
    private String htmlEscape(String value) {
        return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
    }
}
