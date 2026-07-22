package com.novanovastudio.logging;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;

/**
 * HTTP日志敏感字段脱敏测试
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-15 00:00
 */
class HttpLoggingWebFilterTest {

    /**
     * 验证OAuth2查询参数不会写入日志。
     */
    @Test
    @DisplayName("OAuth2授权码和state查询参数会被脱敏")
    void shouldSanitizeOAuth2QueryParameters() {
        HttpLoggingWebFilter filter = new HttpLoggingWebFilter();
        MockServerWebExchange exchange = MockServerWebExchange.from(
                MockServerHttpRequest.get("/api/v1/auth/oauth/callback/linuxDo?code=secret-code&state=secret-state&source=linuxDo").build()
        );

        String sanitizedUrl = filter.sanitizedUrl(exchange);

        assertFalse(sanitizedUrl.contains("secret-code"));
        assertFalse(sanitizedUrl.contains("secret-state"));
        assertTrue(sanitizedUrl.contains("source=linuxDo"));
    }

    /**
     * 验证登录请求中的密码和验证码不会写入日志。
     */
    @Test
    @DisplayName("JSON请求中的认证敏感字段会被脱敏")
    void shouldSanitizeAuthenticationBody() {
        HttpLoggingWebFilter filter = new HttpLoggingWebFilter();

        String sanitizedBody = filter.sanitizeBody(
                "{\"email\":\"user@example.com\",\"password\":\"secret-password\",\"loginCode\":\"secret-code\"}",
                MediaType.APPLICATION_JSON
        );

        assertFalse(sanitizedBody.contains("secret-password"));
        assertFalse(sanitizedBody.contains("secret-code"));
        assertTrue(sanitizedBody.contains("user@example.com"));
    }

    /**
     * 验证非法JSON不会回退记录原始敏感正文。
     */
    @Test
    @DisplayName("非法JSON正文会被整体省略")
    void shouldOmitMalformedJsonBody() {
        HttpLoggingWebFilter filter = new HttpLoggingWebFilter();

        String sanitizedBody = filter.sanitizeBody("{password:secret-password", MediaType.APPLICATION_JSON);

        assertFalse(sanitizedBody.contains("secret-password"));
        assertTrue(sanitizedBody.contains("内容已省略"));
    }
}
