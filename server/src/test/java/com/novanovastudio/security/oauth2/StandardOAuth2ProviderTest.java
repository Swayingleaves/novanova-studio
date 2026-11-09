package com.novanovastudio.security.oauth2;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.core.ClientAuthenticationMethod;
import org.springframework.security.oauth2.core.user.OAuth2User;

/**
 * 标准 OAuth2 认证渠道测试
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-09 14:30
 */
class StandardOAuth2ProviderTest {

    /**
     * 验证完整配置会生成标准 OAuth2 客户端注册信息。
     */
    @Test
    @DisplayName("完整标准 OAuth2 配置可以生成客户端注册信息")
    void shouldCreateClientRegistration() {
        StandardOAuth2Provider provider = new StandardOAuth2Provider(configuration());

        var registration = provider.clientRegistration();

        assertEquals("c1234567890abcdefghij", registration.getRegistrationId());
        assertEquals("client-id", registration.getClientId());
        assertEquals(ClientAuthenticationMethod.CLIENT_SECRET_POST, registration.getClientAuthenticationMethod());
        assertEquals("https://idp.example.com/authorize", registration.getProviderDetails().getAuthorizationUri());
        assertEquals("https://idp.example.com/token", registration.getProviderDetails().getTokenUri());
        assertEquals("https://idp.example.com/userinfo", registration.getProviderDetails().getUserInfoEndpoint().getUri());
        assertEquals("uid", registration.getProviderDetails().getUserInfoEndpoint().getUserNameAttributeName());
        assertTrue(registration.getScopes().containsAll(java.util.Set.of("profile", "email")));
        assertNull(registration.getProviderDetails().getIssuerUri());
    }

    /**
     * 验证按配置的字段名读取用户信息并标准化身份。
     */
    @Test
    @DisplayName("标准 OAuth2 渠道按配置字段解析用户身份")
    void shouldResolveIdentityFromConfiguredAttributes() {
        StandardOAuth2Provider provider = new StandardOAuth2Provider(configuration());

        ThirdPartyUserIdentity identity = provider.resolveIdentity(user(Map.of(
                "uid", "user-1",
                "mail", "USER@EXAMPLE.COM",
                "display_name", "标准用户",
                "avatar", "https://example.com/avatar.png"
        )));

        assertEquals("c1234567890abcdefghij", identity.providerId());
        assertEquals("user-1", identity.providerUserId());
        assertEquals("user@example.com", identity.email());
        assertEquals("标准用户", identity.nickname());
        assertEquals("https://example.com/avatar.png", identity.avatar());
    }

    /**
     * 验证昵称字段缺失时回退到 name、用户名或邮箱前缀。
     */
    @Test
    @DisplayName("标准 OAuth2 渠道昵称字段缺失时按回退规则生成昵称")
    void shouldFallbackNickname() {
        StandardOAuth2Provider provider = new StandardOAuth2Provider(configuration());

        ThirdPartyUserIdentity identity = provider.resolveIdentity(user(Map.of(
                "uid", "user-1",
                "mail", "user@example.com",
                "name", "备用昵称"
        )));

        assertEquals("备用昵称", identity.nickname());
    }

    /**
     * 验证数字类型的用户标识会转换为字符串。
     */
    @Test
    @DisplayName("标准 OAuth2 渠道支持数字用户标识")
    void shouldSupportNumericUserId() {
        StandardOAuth2Provider provider = new StandardOAuth2Provider(configuration());

        ThirdPartyUserIdentity identity = provider.resolveIdentity(user(Map.of(
                "uid", 12345,
                "mail", "user@example.com"
        )));

        assertEquals("12345", identity.providerUserId());
    }

    /**
     * 验证缺少用户标识或邮箱时拒绝登录。
     */
    @Test
    @DisplayName("标准 OAuth2 渠道缺少用户标识或邮箱时拒绝登录")
    void shouldRejectMissingIdentityOrEmail() {
        StandardOAuth2Provider provider = new StandardOAuth2Provider(configuration());

        OAuth2LoginException missingId = assertThrows(OAuth2LoginException.class,
                () -> provider.resolveIdentity(user(Map.of("mail", "user@example.com"))));
        OAuth2LoginException missingEmail = assertThrows(OAuth2LoginException.class,
                () -> provider.resolveIdentity(user(Map.of("uid", "user-1"))));

        assertEquals("providerIdentityUnavailable", missingId.getErrorCode());
        assertEquals("emailUnavailable", missingEmail.getErrorCode());
    }

    /**
     * 验证非法邮箱和超长资料字段会被拒绝。
     */
    @Test
    @DisplayName("标准 OAuth2 渠道拒绝非法邮箱和超长资料")
    void shouldRejectInvalidEmailAndOversizedProfile() {
        StandardOAuth2Provider provider = new StandardOAuth2Provider(configuration());

        OAuth2LoginException invalidEmail = assertThrows(OAuth2LoginException.class,
                () -> provider.resolveIdentity(user(Map.of("uid", "user-1", "mail", "invalid-email"))));
        OAuth2LoginException oversizedAvatar = assertThrows(OAuth2LoginException.class,
                () -> provider.resolveIdentity(user(Map.of("uid", "user-1", "mail", "user@example.com",
                        "avatar", "a".repeat(256)))));

        assertEquals("emailUnavailable", invalidEmail.getErrorCode());
        assertEquals("providerProfileInvalid", oversizedAvatar.getErrorCode());
    }

    /**
     * 验证包含 openid 作用域或错误回调路径时拒绝构建客户端注册信息。
     */
    @Test
    @DisplayName("标准 OAuth2 渠道拒绝 openid 作用域与错误回调路径")
    void shouldRejectOpenIdScopeAndInvalidRedirectUri() {
        StandardOAuth2Configuration openIdConfiguration = configuration("openid profile email",
                "https://studio.example.com/api/v1/auth/oauth/callback/c1234567890abcdefghij");
        StandardOAuth2Configuration invalidRedirectConfiguration = configuration("profile email",
                "https://studio.example.com/api/v1/auth/oauth/callback/other");

        StandardOAuth2Provider openIdProvider = new StandardOAuth2Provider(openIdConfiguration);
        StandardOAuth2Provider invalidRedirectProvider = new StandardOAuth2Provider(invalidRedirectConfiguration);

        assertThrows(IllegalStateException.class, openIdProvider::clientRegistration);
        assertThrows(IllegalStateException.class, invalidRedirectProvider::clientRegistration);
    }

    /**
     * 创建标准 OAuth2 渠道配置。
     *
     * @return StandardOAuth2Configuration 渠道配置
     */
    private StandardOAuth2Configuration configuration() {
        return configuration("profile email",
                "https://studio.example.com/api/v1/auth/oauth/callback/c1234567890abcdefghij");
    }

    /**
     * 创建指定作用域和回调地址的标准 OAuth2 渠道配置。
     *
     * @param scopes String 授权范围
     * @param redirectUri String 回调地址
     * @return StandardOAuth2Configuration 渠道配置
     */
    private StandardOAuth2Configuration configuration(String scopes, String redirectUri) {
        return new StandardOAuth2Configuration("c1234567890abcdefghij", "标准 OAuth2", true, "client-id",
                "client-secret", redirectUri, "https://idp.example.com/authorize", "https://idp.example.com/token",
                "https://idp.example.com/userinfo", scopes, "client_secret_post", "uid", "mail",
                "display_name", "avatar");
    }

    /**
     * 创建携带指定属性的用户桩对象。
     *
     * @param attributes Map<String, Object> 用户属性
     * @return OAuth2User 用户桩对象
     */
    private OAuth2User user(Map<String, Object> attributes) {
        OAuth2User user = mock(OAuth2User.class);
        when(user.getAttributes()).thenReturn(attributes);
        return user;
    }
}
