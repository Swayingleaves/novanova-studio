package com.novanovastudio.security.oauthserver;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.alibaba.fastjson2.JSON;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.service.OAuthAuthorizationCredentialService;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

/**
 * 对外 OAuth2 协议规则测试。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-09 18:40
 */
class OAuthServerProtocolTest {

    /** 空范围使用默认值，NewAPI 默认范围保留 openid 且去掉重复项。 */
    @Test
    @DisplayName("授权范围接受 openid、profile 和 email")
    void shouldGrantSupportedScopes() {
        assertEquals("profile email", OAuthServerProtocol.grantedScope(" "));
        assertEquals("openid profile email", OAuthServerProtocol.grantedScope("openid profile email profile"));
        OAuthProtocolException exception = assertThrows(OAuthProtocolException.class, () -> OAuthServerProtocol.grantedScope("profile groups"));
        assertEquals("invalid_scope", exception.oauthError());
        assertEquals(HttpStatus.BAD_REQUEST, exception.status());
    }

    /** 回调地址必须是绝对 HTTP(S) 地址，成功回调保留原查询参数。 */
    @Test
    @DisplayName("回调地址校验并拼接授权码")
    void shouldValidateRedirectUriAndAppendCode() {
        assertEquals(List.of("https://example.com/oauth/app"), OAuthServerProtocol.normalizeRedirectUris(List.of(" https://example.com/oauth/app ")));
        assertThrows(BusinessException.class, () -> OAuthServerProtocol.normalizeRedirectUris(List.of("javascript:alert(1)")));
        assertThrows(BusinessException.class, () -> OAuthServerProtocol.normalizeRedirectUris(List.of("https://user:secret@example.com/oauth/app")));
        assertThrows(BusinessException.class, () -> OAuthServerProtocol.normalizeRedirectUris(List.of("https://example.com/oauth/app#token")));
        String callback = OAuthServerProtocol.successCallback("https://example.com/oauth/app?from=test", "abc", "xyz");
        assertTrue(callback.contains("from=test"));
        assertTrue(callback.contains("code=abc"));
        assertTrue(callback.contains("state=xyz"));
        assertFalse(callback.contains("#"));
    }

    /** NewAPI 会把客户端密钥放在请求体或 Basic 请求头中。 */
    @Test
    @DisplayName("客户端凭据同时接受请求体和 Basic 认证")
    void shouldReadClientCredentials() {
        String[] body = OAuthServerProtocol.clientCredentials(null, "nv-client", "secret-value");
        assertEquals("nv-client", body[0]);
        assertEquals("secret-value", body[1]);
        String header = "Basic " + Base64.getEncoder().encodeToString("nv-client:secret-value".getBytes(StandardCharsets.UTF_8));
        String[] basic = OAuthServerProtocol.clientCredentials(header, "", "");
        assertEquals("nv-client", basic[0]);
        assertEquals("secret-value", basic[1]);
        OAuthProtocolException exception = assertThrows(OAuthProtocolException.class,
                () -> OAuthServerProtocol.clientCredentials(header, "other-client", "secret-value"));
        assertEquals(HttpStatus.UNAUTHORIZED, exception.status());
    }

    /** Redis 中的授权请求按记录序列化，读回后字段不能错位。 */
    @Test
    @DisplayName("授权请求可以序列化后读回")
    void shouldRoundTripAuthorizationRequest() {
        var request = new OAuthAuthorizationCredentialService.PendingAuthorization("nv0123456789abcdef0123456789abcdef", "https://example.com/oauth/app", "state", "openid profile email", "NewAPI");
        var parsed = JSON.parseObject(JSON.toJSONString(request), OAuthAuthorizationCredentialService.PendingAuthorization.class);
        assertEquals(request, parsed);
    }
}
