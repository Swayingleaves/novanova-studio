package com.novanovastudio.controller;

import com.novanovastudio.service.CreditPurchaseService;
import java.time.Duration;
import java.util.Map;
import java.util.TreeMap;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

/**
 * 微信支付原始报文回调入口，按渠道规范返回 HTTP 状态。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-05 14:00
 */
@RestController
@RequestMapping("/api/v1/payment/wechat")
@RequiredArgsConstructor
@Slf4j
public class WechatPaymentController {
    /** 统一订单结算服务。 */
    private final CreditPurchaseService purchaseService;

    /**
     * 传递原始正文和签名头，完成持久化后应答；超时返回失败供微信重试。
     * @param headers 微信签名请求头
     * @param body 未经重新序列化的原始正文
     * @return 成功返回 204，验签或入账失败返回 500
     */
    @PostMapping("/notify")
    public Mono<ResponseEntity<Map<String, String>>> notify(@RequestHeader HttpHeaders headers, @RequestBody String body) {
        Map<String, String> parameters = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);
        parameters.putAll(headers.toSingleValueMap());
        parameters.put("body", body);
        return purchaseService.handleWechatNotification(parameters).timeout(Duration.ofSeconds(4))
                .thenReturn(ResponseEntity.noContent().<Map<String, String>>build())
                .onErrorResume(error -> {
                    log.error("微信支付回调验签或结算失败", error);
                    return Mono.just(ResponseEntity.internalServerError().body(Map.of("code", "FAIL", "message", "支付通知处理失败")));
                });
    }
}
