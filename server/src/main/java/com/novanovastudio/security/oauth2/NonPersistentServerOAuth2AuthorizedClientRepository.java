package com.novanovastudio.security.oauth2;

import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClient;
import org.springframework.security.oauth2.client.web.server.ServerOAuth2AuthorizedClientRepository;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

/**
 * 不持久化第三方令牌的OAuth2授权客户端仓储
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-15 00:00
 */
@Component
public class NonPersistentServerOAuth2AuthorizedClientRepository implements ServerOAuth2AuthorizedClientRepository {

    /**
     * 不从跨请求存储加载第三方授权客户端。
     *
     * @param clientRegistrationId String 客户端注册标识
     * @param principal Authentication 当前认证主体
     * @param exchange ServerWebExchange 当前请求交换对象
     * @param <T> OAuth2AuthorizedClient 授权客户端类型
     * @return Mono<T> 始终为空
     */
    @Override
    public <T extends OAuth2AuthorizedClient> Mono<T> loadAuthorizedClient(String clientRegistrationId, Authentication principal, ServerWebExchange exchange) {
        return Mono.empty();
    }

    /**
     * 忽略第三方授权客户端保存请求。
     *
     * @param authorizedClient OAuth2AuthorizedClient 第三方授权客户端
     * @param principal Authentication 当前认证主体
     * @param exchange ServerWebExchange 当前请求交换对象
     * @return Mono<Void> 完成信号
     */
    @Override
    public Mono<Void> saveAuthorizedClient(OAuth2AuthorizedClient authorizedClient, Authentication principal, ServerWebExchange exchange) {
        return Mono.empty();
    }

    /**
     * 忽略第三方授权客户端删除请求。
     *
     * @param clientRegistrationId String 客户端注册标识
     * @param principal Authentication 当前认证主体
     * @param exchange ServerWebExchange 当前请求交换对象
     * @return Mono<Void> 完成信号
     */
    @Override
    public Mono<Void> removeAuthorizedClient(String clientRegistrationId, Authentication principal, ServerWebExchange exchange) {
        return Mono.empty();
    }
}
