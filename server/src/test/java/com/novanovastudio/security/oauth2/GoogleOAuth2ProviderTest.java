package com.novanovastudio.security.oauth2;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.novanovastudio.config.NovanovaProperties;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.core.ClientAuthenticationMethod;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;

/**
 * Google认证渠道测试
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-16 00:00
 */
class GoogleOAuth2ProviderTest {

    /**
     * 验证已认证Google账号可以解析为标准身份。
     */
    @Test
    @DisplayName("已验证邮箱的Google账号可以解析")
    void shouldResolveVerifiedGoogleIdentity() {
        GoogleOAuth2Provider provider = new GoogleOAuth2Provider(new NovanovaProperties());
        OidcUser user = oidcUser(Map.of(
                "sub", "google-user-123",
                "email", "USER@EXAMPLE.COM",
                "email_verified", true,
                "name", "Google用户",
                "picture", "https://example.com/avatar.png"
        ));

        ThirdPartyUserIdentity identity = provider.resolveIdentity(user);

        assertEquals("google", identity.providerId());
        assertEquals("google-user-123", identity.providerUserId());
        assertEquals("user@example.com", identity.email());
        assertEquals("Google用户", identity.nickname());
        assertEquals("https://example.com/avatar.png", identity.avatar());
    }

    /**
     * 验证未认证邮箱不能登录。
     */
    @Test
    @DisplayName("未验证邮箱的Google账号不能登录")
    void shouldRejectUnverifiedEmail() {
        GoogleOAuth2Provider provider = new GoogleOAuth2Provider(new NovanovaProperties());

        OAuth2LoginException exception = assertThrows(OAuth2LoginException.class,
                () -> provider.resolveIdentity(oidcUser(Map.of("sub", "google-user-123", "email", "user@example.com", "email_verified", false))));

        assertEquals("emailUnverified", exception.getErrorCode());
    }

    /**
     * 验证缺少或格式不正确的邮箱不能登录。
     */
    @Test
    @DisplayName("Google账号缺少或返回无效邮箱时不能登录")
    void shouldRejectMissingOrInvalidEmail() {
        GoogleOAuth2Provider provider = new GoogleOAuth2Provider(new NovanovaProperties());

        OAuth2LoginException missingEmailException = assertThrows(OAuth2LoginException.class,
                () -> provider.resolveIdentity(oidcUser(Map.of("sub", "google-user-123", "email_verified", true))));
        OAuth2LoginException invalidEmailException = assertThrows(OAuth2LoginException.class,
                () -> provider.resolveIdentity(oidcUser(Map.of("sub", "google-user-123", "email", "invalid-email", "email_verified", true))));

        assertEquals("emailUnavailable", missingEmailException.getErrorCode());
        assertEquals("emailUnavailable", invalidEmailException.getErrorCode());
    }

    /**
     * 验证缺少第三方用户标识不能登录。
     */
    @Test
    @DisplayName("Google账号缺少用户标识时不能登录")
    void shouldRejectMissingProviderUserId() {
        GoogleOAuth2Provider provider = new GoogleOAuth2Provider(new NovanovaProperties());

        OAuth2LoginException exception = assertThrows(OAuth2LoginException.class,
                () -> provider.resolveIdentity(oidcUser(Map.of("email", "user@example.com", "email_verified", true))));

        assertEquals("providerIdentityUnavailable", exception.getErrorCode());
    }

    /**
     * 验证超过字段长度限制的第三方资料不能登录。
     */
    @Test
    @DisplayName("Google头像地址过长时不能登录")
    void shouldRejectOversizedProfile() {
        GoogleOAuth2Provider provider = new GoogleOAuth2Provider(new NovanovaProperties());
        OidcUser user = oidcUser(Map.of(
                "sub", "google-user-123",
                "email", "user@example.com",
                "email_verified", true,
                "picture", "a".repeat(256)
        ));

        OAuth2LoginException exception = assertThrows(OAuth2LoginException.class, () -> provider.resolveIdentity(user));

        assertEquals("providerProfileInvalid", exception.getErrorCode());
    }

    /**
     * 验证正确配置会生成Google客户端注册信息。
     */
    @Test
    @DisplayName("正确Google配置可以生成客户端注册信息")
    void shouldCreateGoogleClientRegistration() {
        NovanovaProperties properties = configuredProperties("https://studio.example.com/api/v1/auth/oauth/callback/google");
        GoogleOAuth2Provider provider = new GoogleOAuth2Provider(properties);

        assertEquals("google", provider.clientRegistration().getRegistrationId());
        assertEquals(ClientAuthenticationMethod.CLIENT_SECRET_POST, provider.clientRegistration().getClientAuthenticationMethod());
    }

    /**
     * 验证错误回调地址和缺失客户端配置都会拒绝启动。
     */
    @Test
    @DisplayName("Google回调地址或客户端配置错误时拒绝启动")
    void shouldRejectInvalidRedirectUriOrMissingConfiguration() {
        GoogleOAuth2Provider invalidRedirectProvider = new GoogleOAuth2Provider(configuredProperties(
                "https://studio.example.com/api/v1/auth/oauth/callback/google?source=invalid"));
        NovanovaProperties missingClientIdProperties = configuredProperties("https://studio.example.com/api/v1/auth/oauth/callback/google");
        missingClientIdProperties.getOauth2().getGoogle().setClientId("");
        GoogleOAuth2Provider missingClientIdProvider = new GoogleOAuth2Provider(missingClientIdProperties);

        assertThrows(IllegalStateException.class, invalidRedirectProvider::clientRegistration);
        assertThrows(IllegalStateException.class, missingClientIdProvider::clientRegistration);
    }

    /**
     * 创建启用且完整的Google认证配置。
     *
     * @param redirectUri String OAuth2回调地址
     * @return NovanovaProperties 服务配置
     */
    private NovanovaProperties configuredProperties(String redirectUri) {
        NovanovaProperties properties = new NovanovaProperties();
        NovanovaProperties.OAuth2.Google configuration = properties.getOauth2().getGoogle();
        configuration.setEnabled(true);
        configuration.setClientId("google-client-id");
        configuration.setClientSecret("google-client-secret");
        configuration.setRedirectUri(redirectUri);
        return properties;
    }

    /**
     * 创建携带指定声明的OpenID Connect用户桩对象。
     *
     * @param claims Map<String, Object> 用户声明
     * @return OidcUser OpenID Connect用户桩对象
     */
    private OidcUser oidcUser(Map<String, Object> claims) {
        OidcUser user = mock(OidcUser.class);
        when(user.getClaims()).thenReturn(claims);
        return user;
    }
}
