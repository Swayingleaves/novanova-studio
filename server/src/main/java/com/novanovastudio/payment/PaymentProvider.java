package com.novanovastudio.payment;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.Map;
import reactor.core.publisher.Mono;

/**
 * 支付提供方统一扩展接口。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-10-27 14:30
 */
public interface PaymentProvider {

    /**
     * 返回支付方式标识。
     *
     * @return String 支付方式标识
     */
    String method();

    /**
     * 创建支付渠道扫码支付页面地址。
     *
     * @param order PaymentOrder 平台订单快照
     * @return Mono<String> 可直接加载的支付页面地址
     */
    Mono<String> createPayment(PaymentOrder order);

    /**
     * 验证支付渠道异步通知并解析关键字段。
     *
     * @param parameters Map<String, String> 支付渠道通知参数
     * @return Mono<PaymentNotification> 验证后的支付通知
     */
    Mono<PaymentNotification> verifyNotification(Map<String, String> parameters);

    /**
     * 查询渠道订单状态。
     *
     * @param orderNo String 平台订单号
     * @return Mono<PaymentNotification> 查询到的订单状态，渠道暂无订单时为空
     */
    Mono<PaymentNotification> queryOrder(String orderNo);

    /**
     * 关闭渠道上尚未支付的交易，使用户取消后二维码立即失效。
     *
     * <p>实现必须容忍交易不存在、已支付等无法关闭的情形：本地取消不依赖渠道关单成功。</p>
     *
     * @param orderNo String 平台订单号
     * @return Mono<Void> 关闭完成信号
     */
    Mono<Void> closePayment(String orderNo);

    /**
     * 平台订单支付快照。
     *
     * @param orderNo String 平台订单号
     * @param subject String 支付页面标题
     * @param amount BigDecimal 人民币金额
     * @param expiresAt OffsetDateTime 平台订单支付截止时间
     */
    record PaymentOrder(String orderNo, String subject, BigDecimal amount, OffsetDateTime expiresAt) {
    }

    /**
     * 已验签的支付渠道订单结果。
     *
     * @param appId String 支付应用标识
     * @param orderNo String 平台订单号
     * @param amount BigDecimal 渠道返回金额
     * @param providerTradeNo String 渠道交易号
     * @param tradeStatus String 渠道交易状态
     * @param paidAt OffsetDateTime 渠道支付时间
     */
    record PaymentNotification(String appId, String orderNo, BigDecimal amount, String providerTradeNo,
                               String tradeStatus, OffsetDateTime paidAt) {
    }
}
