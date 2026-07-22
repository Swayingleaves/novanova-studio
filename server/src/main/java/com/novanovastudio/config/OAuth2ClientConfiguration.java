package com.novanovastudio.config;

import com.novanovastudio.security.oauth2.ThirdPartyOAuth2Provider;
import com.novanovastudio.security.oauth2.ThirdPartyOAuth2ProviderRegistry;
import java.util.Map;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.client.registration.ReactiveClientRegistrationRepository;
import reactor.core.publisher.Mono;

/**
 * OAuth2客户端注册配置
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-15 00:00
 */
@Configuration
public class OAuth2ClientConfiguration {

    /**
     * 创建已启用第三方渠道的响应式客户端注册仓储。
     *
     * @param providerRegistry ThirdPartyOAuth2ProviderRegistry 第三方认证渠道注册表
     * @return ReactiveClientRegistrationRepository 响应式客户端注册仓储
     */
    @Bean
    public ReactiveClientRegistrationRepository reactiveClientRegistrationRepository(ThirdPartyOAuth2ProviderRegistry providerRegistry) {
        // 仅为已启用渠道创建注册信息，调用clientRegistration会在启动时校验其必要配置。
        Map<String, ClientRegistration> registrations = providerRegistry.enabledProviders().stream()
                .collect(java.util.stream.Collectors.toUnmodifiableMap(
                        ThirdPartyOAuth2Provider::providerId,
                        ThirdPartyOAuth2Provider::clientRegistration
                ));
        return registrationId -> Mono.justOrEmpty(registrations.get(registrationId));
    }
}
