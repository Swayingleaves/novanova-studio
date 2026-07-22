package com.novanovastudio.security.oauth2;

import java.net.URI;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.WebSession;
import org.springframework.security.web.server.WebFilterExchange;
import reactor.core.publisher.Mono;

/**
 * OAuth2回调前端重定向器
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-15 00:00
 */
@Component
public class OAuth2CallbackRedirector {

    /** 前端OAuth2回调页面 */
    private static final String FRONTEND_CALLBACK_PATH = "/auth/oauthCallback";

    /**
     * 清理临时会话并重定向到成功回调页面。
     *
     * @param exchange WebFilterExchange 当前过滤器交换对象
     * @param loginCode String 一次性登录码
     * @return Mono<Void> 重定向完成信号
     */
    public Mono<Void> redirectSuccess(WebFilterExchange exchange, String loginCode) {
        return invalidateSession(exchange)
                .then(redirect(exchange, FRONTEND_CALLBACK_PATH + "?loginCode=" + loginCode));
    }

    /**
     * 清理临时会话并重定向到失败回调页面。
     *
     * @param exchange WebFilterExchange 当前过滤器交换对象
     * @param errorCode String 固定错误码
     * @return Mono<Void> 重定向完成信号
     */
    public Mono<Void> redirectFailure(WebFilterExchange exchange, String errorCode) {
        return invalidateSession(exchange)
                .then(redirect(exchange, FRONTEND_CALLBACK_PATH + "?error=" + errorCode));
    }

    /**
     * 使OAuth2握手使用的临时WebSession失效。
     *
     * @param exchange WebFilterExchange 当前过滤器交换对象
     * @return Mono<Void> 会话失效完成信号
     */
    private Mono<Void> invalidateSession(WebFilterExchange exchange) {
        return exchange.getExchange().getSession().flatMap(WebSession::invalidate);
    }

    /**
     * 写入同域相对重定向响应。
     *
     * @param exchange WebFilterExchange 当前过滤器交换对象
     * @param location String 同域相对路径
     * @return Mono<Void> 响应完成信号
     */
    private Mono<Void> redirect(WebFilterExchange exchange, String location) {
        exchange.getExchange().getResponse().setStatusCode(HttpStatus.FOUND);
        exchange.getExchange().getResponse().getHeaders().setLocation(URI.create(location));
        return exchange.getExchange().getResponse().setComplete();
    }
}
