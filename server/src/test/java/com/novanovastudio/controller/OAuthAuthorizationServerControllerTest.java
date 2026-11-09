package com.novanovastudio.controller;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.novanovastudio.logging.HttpLoggingWebFilter;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.service.OAuthAuthorizationServerService;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.http.MediaType;
import org.springframework.test.web.reactive.server.WebTestClient;
import reactor.core.publisher.Mono;

/**
 * 令牌接口要在访问日志读过正文后仍能解析表单。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-09 21:40
 */
class OAuthAuthorizationServerControllerTest {

    /**
     * 日志过滤器会读完原始正文再重放。令牌接口必须从重放后的请求解析客户端密钥。
     */
    @Test
    @DisplayName("访问日志读完正文后仍能解析令牌表单")
    void shouldReadTokenFormAfterRequestBodyIsLogged() {
        OAuthAuthorizationServerService service = Mockito.mock(OAuthAuthorizationServerService.class);
        when(service.exchangeToken(isNull(), eq("authorization_code"), eq("abc"), eq("http://localhost/cb"), eq("nv1"), eq("sec+ret")))
                .thenReturn(Mono.just(Map.of("access_token", "token", "token_type", "Bearer")));
        WebTestClient client = WebTestClient.bindToController(
                        new OAuthAuthorizationServerController(service, Mockito.mock(CurrentUserProvider.class)))
                .webFilter(new HttpLoggingWebFilter())
                .build();

        client.post().uri("/api/v1/oauth/token")
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .bodyValue("grant_type=authorization_code&code=abc&redirect_uri=http%3A%2F%2Flocalhost%2Fcb&client_id=nv1&client_secret=sec%2Bret")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.access_token").isEqualTo("token");

        verify(service).exchangeToken(isNull(), eq("authorization_code"), eq("abc"), eq("http://localhost/cb"), eq("nv1"), eq("sec+ret"));
    }
}
