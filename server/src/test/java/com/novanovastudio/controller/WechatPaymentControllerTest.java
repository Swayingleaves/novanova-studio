package com.novanovastudio.controller;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.novanovastudio.service.CreditPurchaseService;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.repository.UserRepository;
import com.novanovastudio.security.TokenAuthenticationWebFilter;
import com.novanovastudio.security.TokenService;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.MediaType;
import org.springframework.test.web.reactive.server.WebTestClient;
import reactor.core.publisher.Mono;

/**
 * 微信回调原始报文传递及 HTTP 应答契约测试。
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-05 14:00
 */
class WechatPaymentControllerTest {
    /** 原始 JSON 的空白必须保留，请求头名称大小写不影响渠道验签。 */
    @Test
    void shouldPreserveRawBodyAndReturnNoContentAfterSettlement() {
        CreditPurchaseService service = mock(CreditPurchaseService.class);
        when(service.handleWechatNotification(any())).thenReturn(Mono.empty());
        String body = " {\n \"event_type\" : \"TRANSACTION.SUCCESS\"\n } ";
        TokenAuthenticationWebFilter authentication = new TokenAuthenticationWebFilter(new TokenService(new NovanovaProperties()), mock(UserRepository.class));
        WebTestClient.bindToController(new WechatPaymentController(service)).webFilter(authentication).build().post()
                .uri("/api/v1/payment/wechat/notify").contentType(MediaType.APPLICATION_JSON)
                .header("wechatpay-signature", "test-signature").bodyValue(body).exchange()
                .expectStatus().isNoContent().expectBody().isEmpty();
        ArgumentCaptor<Map<String, String>> parameters = ArgumentCaptor.forClass(Map.class);
        org.mockito.Mockito.verify(service).handleWechatNotification(parameters.capture());
        assertEquals(body, parameters.getValue().get("body"));
        assertEquals("test-signature", parameters.getValue().get("Wechatpay-Signature"));
    }

    /** 验签失败或结算失败必须返回非成功状态，让微信重试通知。 */
    @Test
    void shouldReturnFailureWhenNotificationCannotBeSettled() {
        CreditPurchaseService service = mock(CreditPurchaseService.class);
        when(service.handleWechatNotification(any())).thenReturn(Mono.error(new IllegalStateException("模拟验签失败")));
        WebTestClient.bindToController(new WechatPaymentController(service)).build().post()
                .uri("/api/v1/payment/wechat/notify").contentType(MediaType.APPLICATION_JSON).bodyValue("{}")
                .exchange().expectStatus().is5xxServerError().expectBody().jsonPath("$.code").isEqualTo("FAIL");
    }
}
