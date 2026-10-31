package com.novanovastudio.controller;

import com.novanovastudio.common.ApiResponse;
import com.novanovastudio.dto.PaymentDtos;
import com.novanovastudio.service.CreditPurchaseService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

/**
 * 平台积分购买接口。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-10-27 14:40
 */
@RestController
@RequestMapping("/api/v1/payment/credit")
@RequiredArgsConstructor
public class CreditPaymentController {

    /** 积分购买服务。 */
    private final CreditPurchaseService purchaseService;

    /**
     * 查询启用的积分商品。
     *
     * @return Mono<ApiResponse<CreditProductListResponse>> 商品列表
     */
    @GetMapping("/listProducts")
    public Mono<ApiResponse<PaymentDtos.CreditProductListResponse>> listProducts() {
        return purchaseService.listProducts().map(ApiResponse::ok);
    }

    /**
     * 创建积分购买订单。
     *
     * @param request CreateCreditOrderRequest 商品和支付方式
     * @return Mono<ApiResponse<CreateCreditOrderResponse>> 支付表单
     */
    @PostMapping("/createOrder")
    public Mono<ApiResponse<PaymentDtos.CreateCreditOrderResponse>> createOrder(@Valid @RequestBody PaymentDtos.CreateCreditOrderRequest request) {
        return purchaseService.createOrder(request).map(ApiResponse::ok);
    }

    /**
     * 查询当前用户积分购买订单状态。
     *
     * @param orderNo String 平台订单号
     * @return Mono<ApiResponse<CreditOrderStatusResponse>> 订单状态
     */
    @GetMapping("/getOrderStatus")
    public Mono<ApiResponse<PaymentDtos.CreditOrderStatusResponse>> getOrderStatus(@RequestParam String orderNo) {
        return purchaseService.getOrderStatus(orderNo).map(ApiResponse::ok);
    }

    /**
     * 为待支付订单重新获取扫码支付页面地址。
     *
     * @param orderNo String 平台订单号
     * @return Mono<ApiResponse<CreateCreditOrderResponse>> 订单和支付页面地址
     */
    @GetMapping("/getOrderPayment")
    public Mono<ApiResponse<PaymentDtos.CreateCreditOrderResponse>> getOrderPayment(@RequestParam String orderNo) {
        return purchaseService.getOrderPayment(orderNo).map(ApiResponse::ok);
    }

    /**
     * 取消待支付订单。
     *
     * @param request CancelCreditOrderRequest 订单号
     * @return Mono<ApiResponse<CreditOrderStatusResponse>> 取消后的订单状态
     */
    @PostMapping("/cancelOrder")
    public Mono<ApiResponse<PaymentDtos.CreditOrderStatusResponse>> cancelOrder(@Valid @RequestBody PaymentDtos.CancelCreditOrderRequest request) {
        return purchaseService.cancelOrder(request.orderNo()).map(ApiResponse::ok);
    }

    /**
     * 查询当前用户最近的积分购买订单。
     *
     * @param limit int 返回条数
     * @return Mono<ApiResponse<CreditOrderListResponse>> 订单列表
     */
    @GetMapping("/listOrders")
    public Mono<ApiResponse<PaymentDtos.CreditOrderListResponse>> listOrders(@RequestParam(defaultValue = "30") int limit) {
        return purchaseService.listOrders(limit).map(ApiResponse::ok);
    }
}
