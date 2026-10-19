package com.novanovastudio.security;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.entity.User;
import com.novanovastudio.repository.UserRepository;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

/**
 * 验证无邮箱账号重置后的旧令牌拒绝与新令牌身份恢复。
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-18 17:00
 */
class PasswordAccountAuthenticationTest {
    /** 重置后所有空间的后续请求都校验版本，身份不依赖邮箱。 */
    @Test
    void shouldInvalidateOldTokenAndAuthenticatePasswordAccountWithNewToken() {
        NovanovaProperties properties = new NovanovaProperties();
        properties.getApp().setSecretKey("a".repeat(32));
        TokenService tokens = new TokenService(properties);
        UserRepository users = mock(UserRepository.class);
        User account = new User(); account.setId(8L); account.setRole("user"); account.setStatus(1); account.setTokenVersion(1);
        when(users.findById(8L)).thenReturn(Mono.just(account));
        var filter = new TokenAuthenticationWebFilter(tokens, users);
        for (String teamId : new String[] {"0", "101", "102"}) {
            var exchange = MockServerWebExchange.from(MockServerHttpRequest.get("/api/v1/auth/userInfo")
                    .header("Authorization", "Bearer " + tokens.sign(8L, "user", 0).token()).header("X-Team-Id", teamId));
            StepVerifier.create(filter.filter(exchange, request -> Mono.error(new AssertionError("旧令牌不能进入业务链路")))).verifyComplete();
            assertEquals(HttpStatus.UNAUTHORIZED, exchange.getResponse().getStatusCode());
        }
        var exchange = MockServerWebExchange.from(MockServerHttpRequest.get("/api/v1/auth/userInfo")
                .header("Authorization", "Bearer " + tokens.sign(8L, "user", 1).token()));
        StepVerifier.create(filter.filter(exchange, request -> new CurrentUserProvider().currentUser().doOnNext(user -> {
            assertEquals(8L, user.id()); assertNull(user.email());
        }).then())).verifyComplete();
    }
}
