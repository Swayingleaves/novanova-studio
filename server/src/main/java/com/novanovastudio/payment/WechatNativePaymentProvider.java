package com.novanovastudio.payment;

import com.alibaba.fastjson2.JSON;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.config.NovanovaProperties;
import com.wechat.pay.java.core.RSAAutoCertificateConfig;
import com.wechat.pay.java.core.exception.ServiceException;
import com.wechat.pay.java.core.http.DefaultHttpClientBuilder;
import com.wechat.pay.java.core.notification.NotificationParser;
import com.wechat.pay.java.core.notification.RequestParam;
import com.wechat.pay.java.service.payments.model.Transaction;
import com.wechat.pay.java.service.payments.nativepay.NativePayService;
import com.wechat.pay.java.service.payments.nativepay.model.Amount;
import com.wechat.pay.java.service.payments.nativepay.model.CloseOrderRequest;
import com.wechat.pay.java.service.payments.nativepay.model.PrepayRequest;
import com.wechat.pay.java.service.payments.nativepay.model.QueryOrderByOutTradeNoRequest;
import java.io.IOException;
import java.math.BigDecimal;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import okhttp3.Interceptor;
import okhttp3.OkHttpClient;
import okhttp3.Response;
import okio.Buffer;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

/**
 * 微信普通商户 Native 扫码支付，统一通过官方 SDK 签名、验签和解密。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-05 14:00
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class WechatNativePaymentProvider implements PaymentProvider {
    /** 微信支付渠道标识。 */
    public static final String METHOD = "wechat";
    /** 服务端支付配置。 */
    private final NovanovaProperties properties;
    /** 延迟初始化并复用客户端，关闭微信支付时不下载平台证书。 */
    private volatile Client client;

    /**
     * 获取支付渠道标识。
     * @return 微信支付标识
     */
    @Override
    public String method() {
        return METHOD;
    }

    /**
     * 获取绑定商户号的应用标识。
     * @return 微信公众账号标识
     */
    @Override
    public String applicationId() {
        return properties.getWechat().getAppId();
    }

    /**
     * 使用服务端订单快照创建微信支付二维码链接。
     * @param order 平台订单及固定金额、有效期
     * @return 未经改写的微信二维码链接
     */
    @Override
    public Mono<String> createPayment(PaymentOrder order) {
        return execute("下单", order.orderNo(), () -> {
            int total = order.amount().movePointRight(2).intValueExact();
            if (total <= 0 || !order.orderNo().matches("[A-Za-z0-9_\\-|*]{6,32}")) {
                throw new BusinessException(ErrorCode.PARAM_INVALID, "微信支付金额或订单号无效");
            }
            // 微信会把不足一分钟的有效期延长，禁止重签临期订单以保持平台截止时间一致。
            if (!order.expiresAt().isAfter(OffsetDateTime.now().plusMinutes(1))) {
                throw new BusinessException(ErrorCode.BUSINESS_ERROR, "订单即将过期，请等待关闭后重新下单");
            }
            PrepayRequest request = new PrepayRequest();
            request.setAppid(applicationId());
            request.setMchid(properties.getWechat().getMerchantId());
            request.setDescription(order.subject());
            request.setOutTradeNo(order.orderNo());
            request.setNotifyUrl(properties.getWechat().getNotifyUrl());
            request.setTimeExpire(order.expiresAt().truncatedTo(ChronoUnit.SECONDS).toString());
            Amount amount = new Amount();
            amount.setTotal(total);
            amount.setCurrency("CNY");
            request.setAmount(amount);
            String codeUrl = client().service().prepay(request).getCodeUrl();
            URI uri = URI.create(codeUrl);
            if (!"weixin".equals(uri.getScheme()) || !"wxpay".equals(uri.getHost())
                    || !"/bizpayurl".equals(uri.getPath()) || uri.getUserInfo() != null || uri.getFragment() != null) {
                throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "微信返回的支付二维码链接无效");
            }
            return codeUrl;
        });
    }

    /**
     * 使用原始回调正文和签名头完成验签、解密及商户身份校验。
     * @param parameters 签名头与原始正文，正文存放在 body 字段
     * @return 已验证的支付成功通知
     */
    @Override
    public Mono<PaymentNotification> verifyNotification(Map<String, String> parameters) {
        return execute("回调验签", null, () -> {
            RequestParam request = new RequestParam.Builder()
                    .serialNumber(required(parameters, "Wechatpay-Serial"))
                    .timestamp(required(parameters, "Wechatpay-Timestamp"))
                    .nonce(required(parameters, "Wechatpay-Nonce"))
                    .signature(required(parameters, "Wechatpay-Signature"))
                    .body(required(parameters, "body")).build();
            // 原始正文直接交给 SDK；验签通过后才读取通知类型和解密后的交易。
            Transaction transaction = client().parser().parse(request, Transaction.class);
            if (!"TRANSACTION.SUCCESS".equals(JSON.parseObject(parameters.get("body")).getString("event_type"))
                    || transaction.getTradeState() != Transaction.TradeStateEnum.SUCCESS) {
                throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "微信支付回调类型或交易状态无效");
            }
            return notification(transaction);
        });
    }

    /**
     * 按平台原订单号查询微信支付结果。
     * @param orderNo 平台订单号
     * @return 已验签结果，微信尚无此单时为空
     */
    @Override
    public Mono<PaymentNotification> queryOrder(String orderNo) {
        return execute("查单", orderNo, () -> {
            QueryOrderByOutTradeNoRequest request = new QueryOrderByOutTradeNoRequest();
            request.setMchid(properties.getWechat().getMerchantId());
            request.setOutTradeNo(orderNo);
            try {
                Transaction transaction = client().service().queryOrderByOutTradeNo(request);
                if (!orderNo.equals(transaction.getOutTradeNo())) {
                    throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "微信支付订单号不匹配");
                }
                return notification(transaction);
            } catch (ServiceException exception) {
                if (exception.getHttpStatusCode() == 404 && "ORDER_NOT_EXIST".equals(exception.getErrorCode())) return null;
                throw exception;
            }
        });
    }

    /**
     * 关闭微信未支付订单；结果不明或已经付款时阻止本地取消。
     * @param orderNo 平台原订单号
     * @return 关单完成信号
     */
    @Override
    public Mono<Void> closePayment(String orderNo) {
        return execute("关单", orderNo, () -> {
            CloseOrderRequest request = new CloseOrderRequest();
            request.setMchid(properties.getWechat().getMerchantId());
            request.setOutTradeNo(orderNo);
            try {
                client().service().closeOrder(request);
            } catch (ServiceException exception) {
                if (exception.getHttpStatusCode() != 404 || !"ORDER_NOT_EXIST".equals(exception.getErrorCode())) throw exception;
            }
            return true;
        }).then();
    }

    /**
     * 校验微信交易的商户、应用、交易类型和人民币金额。
     * @param transaction SDK 已验签的交易
     * @return 可交给统一积分结算流程的交易结果
     * @throws BusinessException 关键字段不匹配或成功交易不完整时抛出
     */
    private PaymentNotification notification(Transaction transaction) {
        if (!properties.getWechat().getMerchantId().equals(transaction.getMchid())
                || !applicationId().equals(transaction.getAppid()) || transaction.getTradeState() == null
                || transaction.getOutTradeNo() == null
                || (transaction.getTradeType() != null && transaction.getTradeType() != Transaction.TradeTypeEnum.NATIVE)) {
            throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "微信支付商户、应用或交易信息不匹配");
        }
        BigDecimal amount = null;
        if (transaction.getAmount() != null) {
            if (!"CNY".equals(transaction.getAmount().getCurrency()) || transaction.getAmount().getTotal() == null
                    || transaction.getAmount().getTotal() <= 0) {
                throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "微信支付币种或金额无效");
            }
            amount = BigDecimal.valueOf(transaction.getAmount().getTotal(), 2);
        }
        OffsetDateTime paidAt = null;
        if (transaction.getTradeState() == Transaction.TradeStateEnum.SUCCESS) {
            if (amount == null || transaction.getTransactionId() == null || transaction.getTransactionId().isBlank()
                    || transaction.getSuccessTime() == null || transaction.getTradeType() != Transaction.TradeTypeEnum.NATIVE) {
                throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "微信支付成功结果缺少关键字段");
            }
            paidAt = OffsetDateTime.parse(transaction.getSuccessTime());
        }
        return new PaymentNotification(METHOD, transaction.getAppid(), transaction.getOutTradeNo(), amount,
                transaction.getTransactionId(), transaction.getTradeState().name(), paidAt);
    }

    /**
     * 在弹性线程池执行 SDK 调用，避免阻塞 WebFlux 事件线程。
     * @param operation 操作名称
     * @param orderNo 关联订单号
     * @param action 官方 SDK 调用
     * @param <T> 调用结果类型
     * @return 渠道结果，异常不向客户端暴露密钥或底层请求
     */
    private <T> Mono<T> execute(String operation, String orderNo, Supplier<T> action) {
        return Mono.fromCallable(() -> {
            requireConfigured();
            return action.get();
        }).subscribeOn(Schedulers.boundedElastic()).onErrorMap(error -> {
            log.error("微信支付操作失败: operation={}, orderNo={}, errorType={}, channelCode={}", operation, orderNo,
                    error.getClass().getSimpleName(), error instanceof ServiceException exception ? exception.getErrorCode() : null);
            return error instanceof BusinessException ? error
                    : new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "微信支付" + operation + "失败，请稍后查询订单状态");
        });
    }

    /**
     * 创建并复用自动更新平台证书的官方客户端。
     * @return 支付客户端和通知解析器
     */
    private synchronized Client client() {
        if (client == null) {
            NovanovaProperties.Wechat configuration = properties.getWechat();
            OkHttpClient transport = new OkHttpClient.Builder().connectTimeout(5, TimeUnit.SECONDS)
                    .readTimeout(10, TimeUnit.SECONDS).writeTimeout(10, TimeUnit.SECONDS).callTimeout(15, TimeUnit.SECONDS)
                    .addNetworkInterceptor(this::logExchange).build();
            DefaultHttpClientBuilder builder = new DefaultHttpClientBuilder().okHttpClient(transport).enableRetryMultiDomain();
            RSAAutoCertificateConfig configurationWithCertificates = new RSAAutoCertificateConfig.Builder()
                    .merchantId(configuration.getMerchantId()).privateKeyFromPath(configuration.getPrivateKeyPath())
                    .merchantSerialNumber(configuration.getMerchantSerialNumber()).apiV3Key(configuration.getApiV3Key())
                    .httpClientBuilder(builder).build();
            client = new Client(new NativePayService.Builder().httpClient(builder.config(configurationWithCertificates).build()).build(),
                    new NotificationParser(configurationWithCertificates));
        }
        return client;
    }

    /**
     * 记录渠道请求、脱敏响应及 Request-ID，保留原始响应供 SDK 验签。
     * @param chain 官方客户端的网络拦截链
     * @return 未被修改的渠道响应
     * @throws IOException 网络通信失败时抛出
     */
    private Response logExchange(Interceptor.Chain chain) throws IOException {
        Buffer requestBody = new Buffer();
        if (chain.request().body() != null) chain.request().body().writeTo(requestBody);
        log.info("微信支付请求: url={}, headers={}, body={}", chain.request().url(),
                chain.request().headers().newBuilder().removeAll("Authorization").build(), requestBody.readUtf8());
        Response response = chain.proceed(chain.request());
        String body = response.peekBody(16384).string().replaceAll("(\"openid\"\\s*:\\s*\")[^\"]*\"", "$1[已脱敏]\"");
        log.info("微信支付响应: url={}, status={}, requestId={}, headers={}, body={}", chain.request().url(),
                response.code(), response.header("Request-ID"), response.headers(), body);
        return response;
    }

    /**
     * 检查启用状态和运行所需的安全配置。
     * @throws BusinessException 配置不完整或回调地址不合法时抛出
     */
    private void requireConfigured() {
        NovanovaProperties.Wechat configuration = properties.getWechat();
        if (!configuration.isEnabled() || configuration.getAppId().isBlank() || configuration.getMerchantId().isBlank()
                || configuration.getPrivateKeyPath().isBlank() || configuration.getMerchantSerialNumber().isBlank()
                || configuration.getApiV3Key().getBytes(StandardCharsets.UTF_8).length != 32 || configuration.getNotifyUrl().isBlank()
                || !Files.isReadable(Path.of(configuration.getPrivateKeyPath()))) {
            throw new BusinessException(ErrorCode.BUSINESS_ERROR, "微信支付尚未完成配置");
        }
        URI uri = URI.create(configuration.getNotifyUrl());
        if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null || uri.getUserInfo() != null
                || uri.getQuery() != null || uri.getFragment() != null) {
            throw new BusinessException(ErrorCode.BUSINESS_ERROR, "微信支付通知地址必须为不含查询参数的 HTTPS 地址");
        }
    }

    /**
     * 读取必须存在的签名头或原始回调正文。
     * @param parameters 回调参数
     * @param name 参数名称
     * @return 非空参数值
     * @throws BusinessException 参数缺失时抛出
     */
    private String required(Map<String, String> parameters, String name) {
        String value = parameters.get(name);
        if (value == null || value.isBlank()) throw new BusinessException(ErrorCode.PARAM_MISSING, "微信支付回调缺少必要参数");
        return value;
    }

    /**
     * 共享同一份平台证书配置的 SDK 客户端。
     * @param service Native 支付服务
     * @param parser 回调验签解密器
     */
    record Client(NativePayService service, NotificationParser parser) { }
}
