package com.novanovastudio.payment;

import com.alipay.api.AlipayClient;
import com.alipay.api.DefaultAlipayClient;
import com.alipay.api.request.AlipayTradeCloseRequest;
import com.alipay.api.request.AlipayTradePagePayRequest;
import com.alipay.api.request.AlipayTradeQueryRequest;
import com.alipay.api.response.AlipayTradeCloseResponse;
import com.alipay.api.response.AlipayTradePagePayResponse;
import com.alipay.api.response.AlipayTradeQueryResponse;
import com.alipay.api.internal.util.AlipaySignature;
import com.alibaba.fastjson2.JSON;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.config.NovanovaProperties;
import java.math.BigDecimal;
import java.net.URI;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.HashMap;
import java.util.Map;
import java.util.Date;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

/**
 * 支付宝电脑网站支付提供方。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-10-27 14:30
 */
@Component
@Slf4j
public class AlipayPaymentProvider implements PaymentProvider {

    /** 支付宝支付方式标识。 */
    public static final String METHOD = "alipay";
    /** 支付宝成功交易状态。 */
    public static final String TRADE_SUCCESS = "TRADE_SUCCESS";
    /** 支付宝完成交易状态。 */
    public static final String TRADE_FINISHED = "TRADE_FINISHED";
    /** 支付宝二维码展示方式：可定义宽度的嵌入式二维码。 */
    private static final String QR_PAY_MODE = "4";
    /** 支付宝二维码宽度像素，前端 iframe 必须与二维码等大，改动要同步 purchase/page.tsx。 */
    private static final int QRCODE_WIDTH = 200;
    /** 上海时区。 */
    private static final ZoneId SHANGHAI = ZoneId.of("Asia/Shanghai");
    /** 支付宝回调时间格式。 */
    private static final DateTimeFormatter ALIPAY_TIME_FORMAT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    /** 应用配置。 */
    private final NovanovaProperties properties;

    /**
     * 创建支付宝支付提供方。
     *
     * @param properties NovanovaProperties 应用配置
     */
    public AlipayPaymentProvider(NovanovaProperties properties) {
        this.properties = properties;
    }

    /**
     * @return String 支付方式标识
     */
    @Override
    public String method() {
        return METHOD;
    }

    /**
     * 创建支付宝扫码支付页面地址。
     *
     * @param order PaymentOrder 平台订单快照
     * @return Mono<String> 支付宝扫码支付页面地址
     */
    @Override
    public Mono<String> createPayment(PaymentOrder order) {
        return Mono.fromCallable(() -> {
            requireConfigured();
            AlipayTradePagePayRequest request = new AlipayTradePagePayRequest();
            request.setNotifyUrl(properties.getAlipay().getNotifyUrl());
            request.setReturnUrl(properties.getAlipay().getReturnUrl());
            request.setBizContent(JSON.toJSONString(bizContent(order)));
            // 必须按 GET 方式取地址：POST 方式返回的是自动提交表单，需要页面执行跨域表单提交，
            // 会被前端页面的 form-action 策略拦截，iframe 里只剩一片空白。
            return requireQrPageUrl(client().pageExecute(request, "GET"));
        }).subscribeOn(Schedulers.boundedElastic())
                .doOnError(error -> log.error("创建支付宝扫码支付地址失败: orderNo={}", order.orderNo(), error));
    }

    /**
     * 构造支付宝业务参数。
     *
     * @param order PaymentOrder 平台订单快照
     * @return Map<String, Object> 支付宝业务参数
     */
    private Map<String, Object> bizContent(PaymentOrder order) {
        Map<String, Object> content = new HashMap<>();
        content.put("out_trade_no", order.orderNo());
        content.put("total_amount", order.amount().setScale(2).toPlainString());
        content.put("subject", order.subject());
        content.put("product_code", "FAST_INSTANT_TRADE_PAY");
        content.put("qr_pay_mode", QR_PAY_MODE);
        content.put("qrcode_width", QRCODE_WIDTH);
        if (order.expiresAt() != null) {
            // 让支付宝交易与平台订单同时过期，避免平台已关单后仍能被扫码付款。
            content.put("time_expire", order.expiresAt().atZoneSameInstant(SHANGHAI).format(ALIPAY_TIME_FORMAT));
        }
        return content;
    }

    /**
     * 校验支付宝异步通知签名并提取订单字段。
     *
     * @param parameters Map<String, String> 支付宝通知参数
     * @return Mono<PaymentNotification> 验证后的通知
     */
    @Override
    public Mono<PaymentNotification> verifyNotification(Map<String, String> parameters) {
        return Mono.<PaymentNotification>fromCallable(() -> {
            requireConfigured();
            Map<String, String> copied = new HashMap<>(parameters);
            boolean verified = AlipaySignature.rsaCheckV1(copied, properties.getAlipay().getPublicKey(), "UTF-8", "RSA2");
            if (!verified) throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "支付宝异步通知签名校验失败");
            return notification(copied.get("app_id"), copied.get("out_trade_no"), copied.get("total_amount"),
                    copied.get("trade_no"), copied.get("trade_status"), copied.get("gmt_payment"));
        }).subscribeOn(Schedulers.boundedElastic())
                .doOnError(error -> log.error("校验支付宝异步通知失败", error));
    }

    /**
     * 查询支付宝订单状态。
     *
     * @param orderNo String 平台订单号
     * @return Mono<PaymentNotification> 查询到的状态，支付宝暂无订单时为空
     */
    @Override
    public Mono<PaymentNotification> queryOrder(String orderNo) {
        return Mono.<PaymentNotification>fromCallable(() -> {
            requireConfigured();
            AlipayTradeQueryRequest request = new AlipayTradeQueryRequest();
            request.setBizContent(JSON.toJSONString(Map.of("out_trade_no", orderNo)));
            AlipayTradeQueryResponse response = client().execute(request);
            // 交易不存在或查询失败时只返回空结果，避免把渠道错误响应当成已支付订单处理。
            if (response == null || !response.isSuccess() || response.getTradeStatus() == null
                    || isBlank(response.getOutTradeNo()) || !orderNo.equals(response.getOutTradeNo())) return null;
            return notification(properties.getAlipay().getAppId(), response.getOutTradeNo(), response.getTotalAmount(),
                    response.getTradeNo(), response.getTradeStatus(), formatDate(response.getSendPayDate()));
        }).subscribeOn(Schedulers.boundedElastic())
                .doOnError(error -> log.error("查询支付宝订单失败: orderNo={}", orderNo, error));
    }

    /**
     * 关闭支付宝上尚未支付的交易，使用户取消后二维码立即失效。
     *
     * @param orderNo String 平台订单号
     * @return Mono<Void> 关闭完成信号
     */
    @Override
    public Mono<Void> closePayment(String orderNo) {
        return Mono.fromCallable(() -> {
            requireConfigured();
            AlipayTradeCloseRequest request = new AlipayTradeCloseRequest();
            request.setBizContent(JSON.toJSONString(Map.of("out_trade_no", orderNo)));
            AlipayTradeCloseResponse response = client().execute(request);
            if (response == null || !response.isSuccess()) {
                // 交易不存在、已支付或已关闭时支付宝会拒绝关闭，本地取消不依赖这一步成功。
                log.info("支付宝交易未关闭: orderNo={}, code={}, subCode={}", orderNo,
                        response == null ? null : response.getCode(), response == null ? null : response.getSubCode());
            }
            return true;
        }).subscribeOn(Schedulers.boundedElastic())
                .onErrorResume(error -> {
                    log.warn("关闭支付宝交易失败，继续本地取消: orderNo={}", orderNo, error);
                    return Mono.empty();
                })
                .then();
    }

    /**
     * 构造支付宝客户端。
     *
     * @return AlipayClient 支付宝客户端
     */
    private AlipayClient client() {
        NovanovaProperties.Alipay alipay = properties.getAlipay();
        return new DefaultAlipayClient(alipay.getGatewayUrl(), alipay.getAppId(), alipay.getPrivateKey(), "json", "UTF-8", alipay.getPublicKey(), "RSA2");
    }

    /**
     * 检查支付宝必要配置。
     */
    private void requireConfigured() {
        NovanovaProperties.Alipay alipay = properties.getAlipay();
        if (!alipay.isEnabled() || isBlank(alipay.getAppId()) || isBlank(alipay.getPrivateKey()) || isBlank(alipay.getPublicKey())
                || isBlank(alipay.getNotifyUrl()) || isBlank(alipay.getReturnUrl())) {
            throw new BusinessException(ErrorCode.BUSINESS_ERROR, "支付宝支付尚未完成配置");
        }
    }

    /**
     * 校验支付宝返回的扫码支付页面地址。
     *
     * @param response AlipayTradePagePayResponse 支付宝响应
     * @return String 支付宝扫码支付页面地址
     */
    private String requireQrPageUrl(AlipayTradePagePayResponse response) {
        if (response == null || !response.isSuccess() || isBlank(response.getBody())) {
            throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "支付宝扫码支付地址创建失败");
        }
        String pageUrl = response.getBody().trim();
        String expectedHost = gatewayHost();
        try {
            URI uri = URI.create(pageUrl);
            String scheme = uri.getScheme();
            if (!("https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme))
                    || uri.getUserInfo() != null || !expectedHost.equals(uri.getHost())) {
                throw new IllegalArgumentException();
            }
        } catch (IllegalArgumentException exception) {
            log.error("支付宝返回的扫码支付地址无效: pageUrl={}", pageUrl);
            throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "支付宝返回的扫码支付地址无效");
        }
        return pageUrl;
    }

    /**
     * 读取配置的支付宝网关主机名。
     *
     * @return String 支付宝网关主机名
     */
    private String gatewayHost() {
        String gatewayUrl = properties.getAlipay().getGatewayUrl();
        if (isBlank(gatewayUrl)) throw new BusinessException(ErrorCode.BUSINESS_ERROR, "支付宝网关地址配置无效");
        try {
            String host = URI.create(gatewayUrl.trim()).getHost();
            if (isBlank(host)) throw new IllegalArgumentException();
            return host;
        } catch (IllegalArgumentException exception) {
            throw new BusinessException(ErrorCode.BUSINESS_ERROR, "支付宝网关地址配置无效");
        }
    }

    /**
     * 解析支付宝订单通知字段。
     *
     * @param appId String 支付应用标识
     * @param orderNo String 平台订单号
     * @param amount String 支付金额
     * @param tradeNo String 支付宝交易号
     * @param tradeStatus String 支付宝交易状态
     * @param paidAt String 支付时间
     * @return PaymentNotification 支付通知
     */
    private PaymentNotification notification(String appId, String orderNo, String amount, String tradeNo,
                                             String tradeStatus, String paidAt) {
        if (isBlank(orderNo) || isBlank(amount) || isBlank(tradeNo) || isBlank(tradeStatus)) {
            throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "支付宝通知缺少订单关键字段");
        }
        final BigDecimal parsedAmount;
        try {
            parsedAmount = new BigDecimal(amount);
        } catch (NumberFormatException exception) {
            throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "支付宝通知金额无效");
        }
        return new PaymentNotification(appId, orderNo, parsedAmount, tradeNo, tradeStatus, parseTime(paidAt));
    }

    /**
     * 解析支付宝时间文本。
     *
     * @param value String 支付宝时间文本
     * @return OffsetDateTime 支付时间
     */
    private OffsetDateTime parseTime(String value) {
        if (isBlank(value)) return OffsetDateTime.now(SHANGHAI);
        try {
            return LocalDateTime.parse(value, ALIPAY_TIME_FORMAT).atZone(SHANGHAI).toOffsetDateTime();
        } catch (DateTimeParseException exception) {
            log.warn("支付宝支付时间格式异常，使用当前时间: value={}", value);
            return OffsetDateTime.now(SHANGHAI);
        }
    }

    /**
     * 将支付宝查询返回的时间转换为通知格式。
     *
     * @param value Date 支付宝时间
     * @return String 支付宝时间文本
     */
    private String formatDate(Date value) {
        return value == null ? null : value.toInstant().atZone(SHANGHAI).toLocalDateTime().format(ALIPAY_TIME_FORMAT);
    }

    /**
     * 判断文本是否为空。
     *
     * @param value String 待判断文本
     * @return boolean 是否为空
     */
    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
