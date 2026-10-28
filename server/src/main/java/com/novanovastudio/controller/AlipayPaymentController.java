package com.novanovastudio.controller;

import com.novanovastudio.service.CreditPurchaseService;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.codec.FormHttpMessageReader;
import org.springframework.http.codec.HttpMessageReader;
import org.springframework.http.server.reactive.ServerHttpResponse;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.reactive.function.BodyExtractors;
import org.springframework.web.reactive.function.server.ServerRequest;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

/**
 * 支付宝异步通知和同步返回接口。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-10-27 14:40
 */
@RestController
@RequestMapping("/api/v1/payment/alipay")
@RequiredArgsConstructor
@Slf4j
public class AlipayPaymentController {

    /** 积分购买服务。 */
    private final CreditPurchaseService purchaseService;

    /** 支付宝通知只需按表单解析请求体；显式指定读取器，不依赖请求头的内容协商。 */
    private static final List<HttpMessageReader<?>> FORM_READERS = List.<HttpMessageReader<?>>of(new FormHttpMessageReader());

    /**
     * 接收支付宝异步通知。
     *
     * <p>不走 {@code @RequestBody} + {@code consumes} 的内容协商：支付宝通知的 Content-Type
     * 只要与声明的媒体类型有一点点差异就会得到 415，通知等于永远收不到。这里直接按表单解析请求体。</p>
     *
     * @param exchange ServerWebExchange 当前请求
     * @return Mono<String> 支付宝要求的处理结果
     */
    @PostMapping("/notify")
    public Mono<String> notify(ServerWebExchange exchange) {
        return ServerRequest.create(exchange, FORM_READERS).body(BodyExtractors.toFormData())
                .flatMap(formData -> {
                    Map<String, String> parameters = formData.toSingleValueMap();
                    if (parameters.isEmpty()) {
                        log.error("支付宝异步通知内容为空: contentType={}", exchange.getRequest().getHeaders().getContentType());
                        return Mono.just("fail");
                    }
                    return purchaseService.handleAlipayNotification(parameters).thenReturn("success");
                })
                .onErrorResume(error -> {
                    log.error("支付宝异步通知处理失败: contentType={}", exchange.getRequest().getHeaders().getContentType(), error);
                    return Mono.just("fail");
                });
    }

    /**
     * 接收支付宝同步跳转并回到前端购买页。
     *
     * @param orderNo String 支付宝回传的平台订单号
     * @param response ServerHttpResponse HTTP响应
     * @return Mono<Void> 重定向完成信号
     */
    @GetMapping("/return")
    public Mono<Void> returnToFrontend(@RequestParam(required = false, name = "out_trade_no") String orderNo,
                                       ServerHttpResponse response) {
        response.setStatusCode(HttpStatus.FOUND);
        response.getHeaders().set(HttpHeaders.LOCATION, purchaseService.frontendReturnUrl(orderNo));
        return response.setComplete();
    }
}
