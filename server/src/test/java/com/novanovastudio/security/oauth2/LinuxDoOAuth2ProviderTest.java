package com.novanovastudio.security.oauth2;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.novanovastudio.service.OAuthProviderConfigService;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.core.ClientAuthenticationMethod;
import org.springframework.security.oauth2.core.user.OAuth2User;

/**
 * linux.do认证渠道测试
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-15 00:00
 */
class LinuxDoOAuth2ProviderTest {

    /**
     * 验证正常账号不受信任等级限制。
     */
    @Test
    @DisplayName("正常linux.do账号可以解析且不限制信任等级")
    void shouldResolveActiveIdentityWithoutTrustLevelRestriction() {
        LinuxDoOAuth2Provider provider = provider("https://studio.example.com/api/v1/auth/oauth/callback/linuxDo");
        OAuth2User user = oauth2User(Map.of(
                "sub", "12345",
                "active", true,
                "trust_level", 0,
                "email", "USER@EXAMPLE.COM",
                "username", "tester",
                "avatar_url", "https://linux.do/avatar.png"
        ));

        ThirdPartyUserIdentity identity = provider.resolveIdentity(user);

        assertEquals("linuxDo", identity.providerId());
        assertEquals("12345", identity.providerUserId());
        assertEquals("user@example.com", identity.email());
        assertEquals("tester", identity.nickname());
    }

    /**
     * 验证非活动账号被拒绝。
     */
    @Test
    @DisplayName("非活动linux.do账号不能登录")
    void shouldRejectInactiveIdentity() {
        LinuxDoOAuth2Provider provider = provider("https://studio.example.com/api/v1/auth/oauth/callback/linuxDo");
        OAuth2User user = oauth2User(Map.of("sub", "12345", "active", false, "email", "user@example.com"));

        OAuth2LoginException exception = assertThrows(OAuth2LoginException.class, () -> provider.resolveIdentity(user));

        assertEquals("accountInactive", exception.getErrorCode());
    }

    /**
     * 验证缺少邮箱的账号被拒绝。
     */
    @Test
    @DisplayName("缺少邮箱的linux.do账号不能登录")
    void shouldRejectIdentityWithoutEmail() {
        LinuxDoOAuth2Provider provider = provider("https://studio.example.com/api/v1/auth/oauth/callback/linuxDo");
        OAuth2User user = oauth2User(Map.of("sub", "12345", "active", true));

        OAuth2LoginException exception = assertThrows(OAuth2LoginException.class, () -> provider.resolveIdentity(user));

        assertEquals("emailUnavailable", exception.getErrorCode());
    }

    /**
     * 验证正确配置会生成linux.do客户端注册信息。
     */
    @Test
    @DisplayName("正确linux.do配置可以生成客户端注册信息")
    void shouldCreateLinuxDoClientRegistration() {
        LinuxDoOAuth2Provider provider = provider("https://studio.example.com/api/v1/auth/oauth/callback/linuxDo");

        assertEquals("linuxDo", provider.clientRegistration().getRegistrationId());
        assertEquals(ClientAuthenticationMethod.CLIENT_SECRET_BASIC, provider.clientRegistration().getClientAuthenticationMethod());
    }

    /**
     * 验证回调地址必须使用固定路径且不能携带查询参数。
     */
    @Test
    @DisplayName("linux.do回调地址配置错误时拒绝启动")
    void shouldRejectInvalidRedirectUri() {
        LinuxDoOAuth2Provider provider = provider(
                "https://studio.example.com/api/v1/auth/oauth/callback/linuxDo?source=invalid");

        assertThrows(IllegalStateException.class, provider::clientRegistration);
    }

    /**
     * 创建启用且完整的linux.do认证渠道。
     *
     * @param redirectUri String OAuth2回调地址
     * @return LinuxDoOAuth2Provider linux.do认证渠道
     */
    private LinuxDoOAuth2Provider provider(String redirectUri) {
        OAuthProviderConfigService service = mock(OAuthProviderConfigService.class);
        when(service.find("linuxDo")).thenReturn(Optional.of(new ThirdPartyOAuth2Configuration(
                "linuxDo", true, "linuxdo-client-id", "linuxdo-client-secret", redirectUri)));
        return new LinuxDoOAuth2Provider(service);
    }

    /**
     * 创建携带指定属性的用户桩对象。
     *
     * @param attributes Map<String, Object> 用户属性
     * @return OAuth2User 用户桩对象
     */
    private OAuth2User oauth2User(Map<String, Object> attributes) {
        OAuth2User user = mock(OAuth2User.class);
        when(user.getAttributes()).thenReturn(attributes);
        return user;
    }
}
