package com.novanovastudio.security;

import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.config.SecurityConfiguration;
import org.junit.jupiter.api.Test;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;
import org.springframework.web.cors.reactive.CorsWebFilter;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;
import static org.junit.jupiter.api.Assertions.*;

/**
 * 团队显式请求头在前后端分离部署时能够通过跨域预检。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-18 12:00
 */
class TeamCorsTest {
    /** 浏览器跨域预检必须允许认证和团队头，仍限制准确来源。 */
    @Test
    void shouldAllowTeamHeaderFromConfiguredOrigin() {
        var filter = new CorsWebFilter(new SecurityConfiguration().corsConfigurationSource(new NovanovaProperties()));
        var exchange = MockServerWebExchange.from(MockServerHttpRequest.options("http://localhost:8080/api/v1/team/listMembers")
                .header("Origin", "http://localhost:5555")
                .header("Access-Control-Request-Method", "GET")
                .header("Access-Control-Request-Headers", "Authorization,X-Team-Id"));
        StepVerifier.create(filter.filter(exchange, request -> Mono.error(new AssertionError("预检不应执行业务接口")))).verifyComplete();
        assertTrue(exchange.getResponse().getHeaders().getAccessControlAllowHeaders().contains("X-Team-Id"));
        assertEquals("http://localhost:5555", exchange.getResponse().getHeaders().getAccessControlAllowOrigin());
    }
}
