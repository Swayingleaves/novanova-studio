package com.novanovastudio.security.oauth2;

import org.springframework.security.oauth2.client.oidc.authentication.logout.OidcLogoutToken;
import org.springframework.security.oauth2.client.oidc.server.session.ReactiveOidcSessionRegistry;
import org.springframework.security.oauth2.client.oidc.session.OidcSessionInformation;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 不持久化OpenID Connect会话信息的注册表
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-15 00:00
 */
@Component
public class NonPersistentReactiveOidcSessionRegistry implements ReactiveOidcSessionRegistry {

    /**
     * 忽略OpenID Connect会话保存请求。
     *
     * @param info OidcSessionInformation OpenID Connect会话信息
     * @return Mono<Void> 完成信号
     */
    @Override
    public Mono<Void> saveSessionInformation(OidcSessionInformation info) {
        return Mono.empty();
    }

    /**
     * 不按客户端会话返回OpenID Connect会话信息。
     *
     * @param clientSessionId String 客户端会话标识
     * @return Mono<OidcSessionInformation> 始终为空
     */
    @Override
    public Mono<OidcSessionInformation> removeSessionInformation(String clientSessionId) {
        return Mono.empty();
    }

    /**
     * 不按注销令牌返回OpenID Connect会话信息。
     *
     * @param logoutToken OidcLogoutToken OpenID Connect注销令牌
     * @return Flux<OidcSessionInformation> 始终为空
     */
    @Override
    public Flux<OidcSessionInformation> removeSessionInformation(OidcLogoutToken logoutToken) {
        return Flux.empty();
    }
}
