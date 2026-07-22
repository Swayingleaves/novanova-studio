package com.novanovastudio.security.oauth2;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.novanovastudio.config.NovanovaProperties;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;

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
        LinuxDoOAuth2Provider provider = new LinuxDoOAuth2Provider(new NovanovaProperties());
        OidcUser user = oidcUser(Map.of(
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
        LinuxDoOAuth2Provider provider = new LinuxDoOAuth2Provider(new NovanovaProperties());
        OidcUser user = oidcUser(Map.of("sub", "12345", "active", false, "email", "user@example.com"));

        OAuth2LoginException exception = assertThrows(OAuth2LoginException.class, () -> provider.resolveIdentity(user));

        assertEquals("accountInactive", exception.getErrorCode());
    }

    /**
     * 验证缺少邮箱的账号被拒绝。
     */
    @Test
    @DisplayName("缺少邮箱的linux.do账号不能登录")
    void shouldRejectIdentityWithoutEmail() {
        LinuxDoOAuth2Provider provider = new LinuxDoOAuth2Provider(new NovanovaProperties());
        OidcUser user = oidcUser(Map.of("sub", "12345", "active", true));

        OAuth2LoginException exception = assertThrows(OAuth2LoginException.class, () -> provider.resolveIdentity(user));

        assertEquals("emailUnavailable", exception.getErrorCode());
    }

    /**
     * 验证回调地址必须使用固定路径且不能携带查询参数。
     */
    @Test
    @DisplayName("linux.do回调地址配置错误时拒绝启动")
    void shouldRejectInvalidRedirectUri() {
        NovanovaProperties properties = new NovanovaProperties();
        NovanovaProperties.OAuth2.LinuxDo configuration = properties.getOauth2().getLinuxDo();
        configuration.setClientId("client-id");
        configuration.setClientSecret("client-secret");
        configuration.setRedirectUri("https://studio.example.com/api/v1/auth/oauth/callback/linuxDo?source=invalid");
        LinuxDoOAuth2Provider provider = new LinuxDoOAuth2Provider(properties);

        assertThrows(IllegalStateException.class, provider::clientRegistration);
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
        when(user.getClaim("active")).thenReturn(claims.get("active"));
        return user;
    }
}
