package com.novanovastudio.controller;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.novanovastudio.security.AdminGuard;
import com.novanovastudio.service.GenerationStyleService;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.reactive.server.WebTestClient;
import reactor.core.publisher.Mono;

/**
 * 验证风格缩略图的浏览器缓存响应。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-26 20:55
 */
class GenerationStyleControllerTest {

    /** 构建缓存响应时应隔离登录身份与团队，旧版本查询返回未找到。 */
    @Test
    void shouldCacheVersionedThumbnailsPrivately() {
        GenerationStyleService service = mock(GenerationStyleService.class);
        byte[] thumbnail = {1, 2, 3};
        when(service.readThumbnail(8, "current", true)).thenReturn(Mono.just(thumbnail));
        when(service.readThumbnail(8, "previous", true)).thenReturn(Mono.empty());
        WebTestClient client = WebTestClient.bindToController(new GenerationStyleController(service, mock(AdminGuard.class))).build();

        client.get().uri("/api/v1/style/getCoverThumbnail?styleId=8&version=current").exchange()
                .expectStatus().isOk()
                .expectHeader().contentType("image/webp")
                .expectHeader().valueMatches("Cache-Control", "(?=.*max-age=604800)(?=.*private)(?=.*immutable).*")
                .expectHeader().values("Vary", values -> {
                    String headers = String.join(",", values);
                    org.junit.jupiter.api.Assertions.assertTrue(headers.contains("Authorization"));
                    org.junit.jupiter.api.Assertions.assertTrue(headers.contains("Cookie"));
                    org.junit.jupiter.api.Assertions.assertTrue(headers.contains("X-Team-Id"));
                })
                .expectBody(byte[].class).isEqualTo(thumbnail);

        client.get().uri("/api/v1/style/getCoverThumbnail?styleId=8&version=previous").exchange()
                .expectStatus().isNotFound();
    }
}
