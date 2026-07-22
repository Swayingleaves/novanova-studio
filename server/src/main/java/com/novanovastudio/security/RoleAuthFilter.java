package com.novanovastudio.security;

import com.alibaba.fastjson2.JSON;
import com.novanovastudio.common.ApiResponse;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import java.lang.reflect.Method;
import java.util.Optional;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.AnnotationUtils;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.reactive.result.method.annotation.RequestMappingHandlerMapping;
import org.springframework.web.server.ServerWebExchange;
import org.springframework.web.server.WebFilter;
import org.springframework.web.server.WebFilterChain;
import reactor.core.publisher.Mono;

/**
 * @title        RoleAuthFilter.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  角色权限注解过滤器，拦截标注了 @RequireRole 的 Controller 方法进行角色校验
 * @createTime   2026-06-26 14:00:00
 */
@Slf4j
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 15)
public class RoleAuthFilter implements WebFilter {

    /** 未匹配到处理器的标记对象 */
    private static final Object NO_HANDLER = new Object();

    private final RequestMappingHandlerMapping handlerMapping;
    private final CurrentUserProvider currentUserProvider;

    /**
     * 构造角色权限过滤器。
     *
     * @param handlerMapping RequestMappingHandlerMapping 请求处理器映射
     * @param currentUserProvider CurrentUserProvider 当前用户提供器
     */
    public RoleAuthFilter(@Qualifier("requestMappingHandlerMapping") RequestMappingHandlerMapping handlerMapping, CurrentUserProvider currentUserProvider) {
        this.handlerMapping = handlerMapping;
        this.currentUserProvider = currentUserProvider;
    }

    /**
     * 执行角色权限过滤。
     *
     * @param exchange ServerWebExchange 当前请求交换对象
     * @param chain WebFilterChain 过滤器链
     * @return Mono<Void> 过滤执行结果
     */
    @Override
    public Mono<Void> filter(ServerWebExchange exchange, WebFilterChain chain) {
        return handlerMapping.getHandler(exchange)
                .defaultIfEmpty(NO_HANDLER)
                .flatMap(handler -> {
                    if (handler == NO_HANDLER) {
                        return chain.filter(exchange);
                    }
                    if (handler instanceof HandlerMethod handlerMethod) {
                        RequireRole annotation = findAnnotation(handlerMethod);
                        if (annotation != null) {
                            String requiredRole = annotation.value();
                            return currentUserProvider.currentUser()
                                    .map(Optional::of)
                                    .onErrorResume(BusinessException.class, exception -> Mono.just(Optional.empty()))
                                    .flatMap(currentUser -> {
                                        if (currentUser.isEmpty()) {
                                            return writeErrorResponse(exchange, "未登录或Token无效");
                                        }
                                        CurrentUser authenticatedUser = currentUser.get();
                                        if (!requiredRole.equals(authenticatedUser.role())) {
                                            log.warn("角色权限不足: userId={}, role={}, required={}", authenticatedUser.id(), authenticatedUser.role(), requiredRole);
                                            return writeErrorResponse(exchange, "权限不足，需要 " + requiredRole + " 角色");
                                        }
                                        return chain.filter(exchange);
                                    });
                        }
                    }
                    return chain.filter(exchange);
                });
    }

    /**
     * 写入权限不足的 JSON 错误响应
     *
     * @param exchange ServerWebExchange 当前请求交换对象
     * @param message String 错误提示
     * @return Mono<Void> 写出结果
     */
    private Mono<Void> writeErrorResponse(ServerWebExchange exchange, String message) {
        exchange.getResponse().setStatusCode(HttpStatus.FORBIDDEN);
        exchange.getResponse().getHeaders().setContentType(MediaType.APPLICATION_JSON);
        byte[] body = JSON.toJSONBytes(ApiResponse.fail(ErrorCode.PERMISSION_DENIED, message));
        return exchange.getResponse().writeWith(Mono.just(exchange.getResponse().bufferFactory().wrap(body)));
    }

    /**
     * 获取方法或类上的 @RequireRole 注解
     *
     * @param handlerMethod HandlerMethod 控制器处理方法
     * @return RequireRole 角色权限注解，不存在时返回null
     */
    private RequireRole findAnnotation(HandlerMethod handlerMethod) {
        Method method = handlerMethod.getMethod();
        RequireRole annotation = AnnotationUtils.findAnnotation(method, RequireRole.class);
        if (annotation != null) return annotation;
        return AnnotationUtils.findAnnotation(handlerMethod.getBeanType(), RequireRole.class);
    }
}
