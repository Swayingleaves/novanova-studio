package com.novanovastudio.logging;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.concurrent.atomic.AtomicReference;
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
     * 验证请求标识会写入响应头和Reactor上下文。
     */
    @Test
    @DisplayName("请求标识会贯穿HTTP响应式链路")
    void shouldPropagateRequestId() {
        HttpLoggingWebFilter filter = new HttpLoggingWebFilter();
        MockServerWebExchange exchange = MockServerWebExchange.from(
                MockServerHttpRequest.get("/api/v1/health")
                        .header(HttpLoggingWebFilter.REQUEST_ID_HEADER, "request-123")
                        .build()
        );
        AtomicReference<String> contextRequestId = new AtomicReference<>();

        filter.filter(exchange, ignored -> reactor.core.publisher.Mono.deferContextual(context -> {
            contextRequestId.set(MappedDiagnosticContext.values(context).get(MappedDiagnosticContext.REQUEST_ID));
            return reactor.core.publisher.Mono.empty();
        })).block();

        assertEquals("request-123", exchange.getResponse().getHeaders().getFirst(HttpLoggingWebFilter.REQUEST_ID_HEADER));
        assertEquals("request-123", contextRequestId.get());
    }

    /**
     * 验证非法请求标识不会原样进入日志上下文。
     */
    @Test
    @DisplayName("非法请求标识会被替换")
    void shouldReplaceInvalidRequestId() {
        HttpLoggingWebFilter filter = new HttpLoggingWebFilter();
        MockServerWebExchange exchange = MockServerWebExchange.from(
                MockServerHttpRequest.get("/api/v1/health")
                        .header(HttpLoggingWebFilter.REQUEST_ID_HEADER, "invalid/request")
                        .build()
        );

        filter.filter(exchange, ignored -> reactor.core.publisher.Mono.empty()).block();

        String responseRequestId = exchange.getResponse().getHeaders().getFirst(HttpLoggingWebFilter.REQUEST_ID_HEADER);
        assertFalse("invalid/request".equals(responseRequestId));
        assertTrue(responseRequestId != null && !responseRequestId.isBlank());
    }

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
     * 验证修改密码请求中的原密码和新密码不会写入日志。
     */
    @Test
    @DisplayName("修改密码请求中的敏感字段会被脱敏")
    void shouldSanitizePasswordChangeBody() {
        HttpLoggingWebFilter filter = new HttpLoggingWebFilter();

        String sanitizedBody = filter.sanitizeBody(
                "{\"currentPassword\":\"current-secret\",\"newPassword\":\"new-secret\"}",
                MediaType.APPLICATION_JSON
        );

        assertFalse(sanitizedBody.contains("current-secret"));
        assertFalse(sanitizedBody.contains("new-secret"));
        assertTrue(sanitizedBody.contains("[已脱敏]"));
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
