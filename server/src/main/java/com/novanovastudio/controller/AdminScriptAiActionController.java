package com.novanovastudio.controller;

import com.novanovastudio.common.ApiResponse;
import com.novanovastudio.dto.ScriptAiActionPricingDtos;
import com.novanovastudio.security.AdminGuard;
import com.novanovastudio.security.RequireRole;
import com.novanovastudio.service.ScriptAiActionPricingService;
import jakarta.validation.Valid;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

/**
 * 管理员维护剧本 AI 助手动作价格接口。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-29 10:30
 */
@Slf4j
@RestController
@RequestMapping("/api/v1/admin/scriptAiAction")
@RequiredArgsConstructor
@RequireRole("admin")
public class AdminScriptAiActionController {

    /** 请求日志中必须脱敏的敏感请求头。 */
    private static final Set<String> SENSITIVE_HEADER_NAMES = Set.of(
            "authorization", "proxy-authorization", "cookie", "set-cookie",
            "x-api-key", "api-key", "x-auth-token", "x-access-token", "x-refresh-token");

    /** 动作定价服务。 */
    private final ScriptAiActionPricingService pricingService;

    /** 管理员校验。 */
    private final AdminGuard adminGuard;

    /**
     * 查询全部文本模型的剧本AI动作价格。
     *
     * @param httpRequest ServerHttpRequest 当前HTTP请求
     * @return Mono&lt;ApiResponse&lt;List&lt;ModelPricing&gt;&gt;&gt; 价格配置
     */
    @GetMapping("/getPricing")
    public Mono<ApiResponse<List<ScriptAiActionPricingDtos.ModelPricing>>> getPricing(ServerHttpRequest httpRequest) {
        log.debug("查询剧本AI动作价格请求: url={}, headers={}", httpRequest.getURI(), sanitizedHeaders(httpRequest));
        return adminGuard.requireAdmin()
                .then(Mono.defer(pricingService::getPricing))
                .map(ApiResponse::ok)
                .doOnNext(response -> log.debug("查询剧本AI动作价格响应: response={}", response));
    }

    /**
     * 保存单个文本模型的整份动作价格。
     *
     * @param request SavePricingRequest 保存请求
     * @param httpRequest ServerHttpRequest 当前HTTP请求
     * @return Mono&lt;ApiResponse&lt;ModelPricing&gt;&gt; 保存后的价格配置
     */
    @PostMapping("/savePricing")
    public Mono<ApiResponse<ScriptAiActionPricingDtos.ModelPricing>> savePricing(
            @Valid @RequestBody ScriptAiActionPricingDtos.SavePricingRequest request,
            ServerHttpRequest httpRequest) {
        log.debug("保存剧本AI动作价格请求: url={}, headers={}, request={}", httpRequest.getURI(),
                sanitizedHeaders(httpRequest), request);
        return adminGuard.requireAdmin()
                .then(Mono.defer(() -> pricingService.savePricing(request)))
                .map(ApiResponse::ok)
                .doOnNext(response -> log.debug("保存剧本AI动作价格响应: response={}", response));
    }

    /**
     * 复制请求头并隐藏鉴权令牌与Cookie。
     *
     * @param httpRequest ServerHttpRequest 当前HTTP请求
     * @return Map&lt;String, List&lt;String&gt;&gt; 可安全写入日志的请求头副本
     */
    private Map<String, List<String>> sanitizedHeaders(ServerHttpRequest httpRequest) {
        Map<String, List<String>> headers = new LinkedHashMap<>();
        httpRequest.getHeaders().forEach((name, values) -> headers.put(name,
                SENSITIVE_HEADER_NAMES.contains(name.toLowerCase(Locale.ROOT)) ? List.of("[已脱敏]") : List.copyOf(values)));
        return headers;
    }
}
