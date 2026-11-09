package com.novanovastudio.config;

import com.novanovastudio.security.oauth2.ThirdPartyOAuth2Provider;
import com.novanovastudio.security.oauth2.ThirdPartyOAuth2ProviderRegistry;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.oauth2.client.registration.ReactiveClientRegistrationRepository;
import reactor.core.publisher.Mono;

/**
 * OAuth2客户端注册配置
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-15 00:00
 */
@Configuration
@Slf4j
public class OAuth2ClientConfiguration {

    /**
     * 创建响应式客户端注册仓储。
     * <p>
     * 渠道启用状态与凭据均来自管理后台保存的数据库配置，这里按 registrationId 实时构建注册信息，保存配置后无需重启服务。
     *
     * @param providerRegistry ThirdPartyOAuth2ProviderRegistry 第三方认证渠道注册表
     * @return ReactiveClientRegistrationRepository 响应式客户端注册仓储
     */
    @Bean
    public ReactiveClientRegistrationRepository reactiveClientRegistrationRepository(ThirdPartyOAuth2ProviderRegistry providerRegistry) {
        return registrationId -> Mono.defer(() -> {
            ThirdPartyOAuth2Provider provider = providerRegistry.find(registrationId).orElse(null);
            if (provider == null || !provider.enabled()) {
                return Mono.empty();
            }
            return Mono.fromCallable(provider::clientRegistration)
                    .onErrorResume(IllegalStateException.class, exception -> {
                        log.warn("OAuth登录渠道配置不完整，跳过客户端注册: provider={}, message={}", registrationId, exception.getMessage());
                        return Mono.empty();
                    });
        });
    }
}
