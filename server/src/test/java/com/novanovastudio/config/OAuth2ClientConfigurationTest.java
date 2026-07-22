package com.novanovastudio.config;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.novanovastudio.security.oauth2.ThirdPartyOAuth2Provider;
import com.novanovastudio.security.oauth2.ThirdPartyOAuth2ProviderRegistry;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.client.registration.ReactiveClientRegistrationRepository;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

/**
 * OAuth2客户端注册配置测试
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-16 00:00
 */
class OAuth2ClientConfigurationTest {

    /**
     * 验证已启用的多个第三方渠道都可被解析。
     */
    @Test
    @DisplayName("同时启用linux.do和Google时可解析两个客户端注册")
    void shouldResolveAllEnabledProviderRegistrations() {
        ThirdPartyOAuth2Provider linuxDoProvider = provider("linuxDo");
        ThirdPartyOAuth2Provider googleProvider = provider("google");
        ThirdPartyOAuth2ProviderRegistry registry = mock(ThirdPartyOAuth2ProviderRegistry.class);
        when(registry.enabledProviders()).thenReturn(List.of(linuxDoProvider, googleProvider));

        ReactiveClientRegistrationRepository repository = new OAuth2ClientConfiguration().reactiveClientRegistrationRepository(registry);

        StepVerifier.create(Mono.zip(repository.findByRegistrationId("linuxDo"), repository.findByRegistrationId("google")))
                .assertNext(registrations -> {
                    assertEquals("linuxDo", registrations.getT1().getRegistrationId());
                    assertEquals("google", registrations.getT2().getRegistrationId());
                })
                .verifyComplete();
    }

    /**
     * 验证没有启用渠道时不返回客户端注册。
     */
    @Test
    @DisplayName("没有启用第三方渠道时不返回客户端注册")
    void shouldReturnEmptyForNoEnabledProviders() {
        ThirdPartyOAuth2ProviderRegistry registry = mock(ThirdPartyOAuth2ProviderRegistry.class);
        when(registry.enabledProviders()).thenReturn(List.of());

        ReactiveClientRegistrationRepository repository = new OAuth2ClientConfiguration().reactiveClientRegistrationRepository(registry);

        StepVerifier.create(repository.findByRegistrationId("google")).verifyComplete();
    }

    /**
     * 创建指定渠道的测试实现。
     *
     * @param providerId String 渠道标识
     * @return ThirdPartyOAuth2Provider 测试渠道实现
     */
    private ThirdPartyOAuth2Provider provider(String providerId) {
        ThirdPartyOAuth2Provider provider = mock(ThirdPartyOAuth2Provider.class);
        when(provider.providerId()).thenReturn(providerId);
        when(provider.clientRegistration()).thenReturn(ClientRegistration.withRegistrationId(providerId)
                .clientId(providerId + "-client-id")
                .clientSecret("client-secret")
                .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
                .redirectUri("https://studio.example.com/api/v1/auth/oauth/callback/" + providerId)
                .authorizationUri("https://example.com/authorize")
                .tokenUri("https://example.com/token")
                .build());
        return provider;
    }
}
