package com.novanovastudio.security;

import com.alibaba.fastjson2.JSON;
import com.novanovastudio.common.ApiResponse;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.entity.User;
import com.novanovastudio.logging.MappedDiagnosticContext;
import com.novanovastudio.repository.UserRepository;
import java.nio.charset.StandardCharsets;
import java.util.List;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.core.io.buffer.DataBuffer;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.server.PathContainer;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.server.ServerWebExchange;
import org.springframework.web.server.WebFilter;
import org.springframework.web.server.WebFilterChain;
import org.springframework.web.util.pattern.PathPattern;
import org.springframework.web.util.pattern.PathPatternParser;
import reactor.core.publisher.Mono;

/**
 * @title        TokenAuthenticationWebFilter.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  响应式Token认证过滤器
 * @createTime   2026-06-24 18:20:00
 */
@Component
@RequiredArgsConstructor
@Slf4j
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
public class TokenAuthenticationWebFilter implements WebFilter {

    /** 公开路径模式（无需登录即可访问） */
    private static final List<PathPattern> PUBLIC_PATTERNS = List.of(
            PathPatternParser.defaultInstance.parse("/api/v1/auth/sendEmailCode"),
            PathPatternParser.defaultInstance.parse("/api/v1/auth/register"),
            PathPatternParser.defaultInstance.parse("/api/v1/auth/login"),
            PathPatternParser.defaultInstance.parse("/api/v1/auth/oauth/**"),
            PathPatternParser.defaultInstance.parse("/api/v1/ai/model/listModels"),
            PathPatternParser.defaultInstance.parse("/api/v1/config/getRuntimeConfig"),
            PathPatternParser.defaultInstance.parse("/api/v1/homepage/listShowcases")
    );

    /** Token服务 */
    private final TokenService tokenService;

    /** 用户仓储 */
    private final UserRepository userRepository;

    /**
     * 执行Token认证
     *
     * @param exchange ServerWebExchange 当前请求交换对象
     * @param chain WebFilterChain 过滤器链
     * @return Mono<Void> 过滤执行结果
     */
    @Override
    public Mono<Void> filter(ServerWebExchange exchange, WebFilterChain chain) {
        // 优先从Authorization头读取Bearer Token，SSE场景兼容query token。
        String token = tokenService.bearerToken(exchange.getRequest().getHeaders().getFirst(HttpHeaders.AUTHORIZATION));
        if (!StringUtils.hasText(token)) {
            token = exchange.getRequest().getQueryParams().getFirst("token");
        }
        if (!StringUtils.hasText(token)) {
            // OPTIONS 预检请求不做登录校验
            if (exchange.getRequest().getMethod() == HttpMethod.OPTIONS) {
                return chain.filter(exchange);
            }
            // 非 API 路径（静态资源等）不需要登录
            String path = exchange.getRequest().getPath().value();
            if (path.startsWith("/api/") && !isPublicPath(path)) {
                return writeUnauthenticatedError(exchange);
            }
            return chain.filter(exchange);
        }
        try {
            TokenService.TokenClaims claims = tokenService.parse(token);
            return userRepository.findById(claims.userId())
                    .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.TOKEN_INVALID, "用户不存在")))
                    .flatMap(user -> authenticateUser(exchange, chain, user))
                    .onErrorResume(BusinessException.class, exception -> writeAuthError(exchange, exception));
        } catch (BusinessException exception) {
            return writeAuthError(exchange, exception);
        }
    }

    /**
     * 认证用户并写入上下文
     *
     * @param exchange ServerWebExchange 当前请求交换对象
     * @param chain WebFilterChain 过滤器链
     * @param user User 用户实体
     * @return Mono<Void> 过滤执行结果
     */
    private Mono<Void> authenticateUser(ServerWebExchange exchange, WebFilterChain chain, User user) {
        // 确认账号仍处于启用状态，再把当前用户写入Reactor上下文。
        if (user.getStatus() == null || user.getStatus() != 1) {
            return Mono.error(new BusinessException(ErrorCode.TOKEN_INVALID, "账号已被禁用"));
        }
        CurrentUser currentUser = new CurrentUser(user.getId(), user.getEmail(), user.getRole(), user.getStatus());
        return chain.filter(exchange).contextWrite(context -> MappedDiagnosticContext.put(
                context.put(CurrentUserProvider.CURRENT_USER_CONTEXT_KEY, currentUser),
                MappedDiagnosticContext.USER_ID, user.getId()));
    }

    /**
     * 判断请求路径是否为公开路径（无需登录）。
     *
     * @param path String 请求路径
     * @return boolean 是否为公开路径
     */
    private boolean isPublicPath(String path) {
        PathContainer pathContainer = PathContainer.parsePath(path);
        return PUBLIC_PATTERNS.stream().anyMatch(pattern -> pattern.matches(pathContainer));
    }

    /**
     * 写出未登录响应（用于未携带 Token 访问需登录接口，debug 级别避免日志刷屏）。
     *
     * @param exchange ServerWebExchange 当前请求交换对象
     * @return Mono<Void> 写出结果
     */
    private Mono<Void> writeUnauthenticatedError(ServerWebExchange exchange) {
        log.debug("未登录请求受保护接口: uri={}", exchange.getRequest().getURI().getPath());
        exchange.getResponse().setStatusCode(HttpStatus.UNAUTHORIZED);
        exchange.getResponse().getHeaders().setContentType(MediaType.APPLICATION_JSON);
        byte[] bytes = JSON.toJSONString(ApiResponse.fail(ErrorCode.TOKEN_INVALID, "请先登录")).getBytes(StandardCharsets.UTF_8);
        DataBuffer buffer = exchange.getResponse().bufferFactory().wrap(bytes);
        return exchange.getResponse().writeWith(Mono.just(buffer));
    }

    /**
     * 写出认证失败响应（Token 无效或过期等异常，ERROR 级别记录）。
     *
     * @param exchange ServerWebExchange 当前请求交换对象
     * @param exception BusinessException 业务异常
     * @return Mono<Void> 写出结果
     */
    private Mono<Void> writeAuthError(ServerWebExchange exchange, BusinessException exception) {
        // 认证失败时直接写出统一响应结构。
        log.error("Token认证失败: uri={}, code={}, message={}", exchange.getRequest().getURI().getPath(), exception.getCode(), exception.getMessage(), exception);
        exchange.getResponse().setStatusCode(HttpStatus.UNAUTHORIZED);
        exchange.getResponse().getHeaders().setContentType(MediaType.APPLICATION_JSON);
        byte[] bytes = JSON.toJSONString(ApiResponse.fail(exception.getCode(), exception.getMessage())).getBytes(StandardCharsets.UTF_8);
        DataBuffer buffer = exchange.getResponse().bufferFactory().wrap(bytes);
        return exchange.getResponse().writeWith(Mono.just(buffer));
    }
}
