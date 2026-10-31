package com.novanovastudio.security;

import com.alibaba.fastjson2.JSON;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.controller.HealthController;
import com.novanovastudio.repository.UserRepository;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.http.HttpStatus;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;
import org.springframework.test.web.reactive.server.WebTestClient;
import reactor.core.publisher.Mono;

/**
 * 验证健康检查公开访问及业务接口的登录边界。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-31 19:00
 */
class TokenAuthenticationWebFilterTest {

    /**
     * 未登录的健康检查必须能够到达控制器，供部署探针检测服务状态。
     */
    @Test
    void shouldAllowHealthCheckWithoutToken() {
        UserRepository repository = Mockito.mock(UserRepository.class);
        TokenAuthenticationWebFilter filter = new TokenAuthenticationWebFilter(new TokenService(new NovanovaProperties()), repository);
        WebTestClient.bindToController(new HealthController()).webFilter(filter).build()
                .get().uri("/api/v1/health").exchange()
                .expectStatus().isOk()
                .expectBody().jsonPath("$.code").isEqualTo(0).jsonPath("$.data").isEqualTo("ok");
        Mockito.verifyNoInteractions(repository);
    }

    /**
     * 健康检查的子路径及普通业务接口仍须登录，不能因公开规则扩大而放行。
     */
    @Test
    void shouldRejectProtectedPathsWithoutToken() {
        UserRepository repository = Mockito.mock(UserRepository.class);
        TokenAuthenticationWebFilter filter = new TokenAuthenticationWebFilter(new TokenService(new NovanovaProperties()), repository);
        for (String path : java.util.List.of("/api/v1/health/private", "/api/v1/auth/userInfo")) {
            MockServerWebExchange exchange = MockServerWebExchange.from(MockServerHttpRequest.get(path));
            AtomicInteger calls = new AtomicInteger();
            filter.filter(exchange, request -> Mono.fromRunnable(calls::incrementAndGet)).block();
            Assertions.assertEquals(HttpStatus.UNAUTHORIZED, exchange.getResponse().getStatusCode());
            Assertions.assertEquals(ErrorCode.TOKEN_INVALID, JSON.parseObject(exchange.getResponse().getBodyAsString().block()).getIntValue("code"));
            Assertions.assertEquals(0, calls.get());
        }
        Mockito.verifyNoInteractions(repository);
    }
}
