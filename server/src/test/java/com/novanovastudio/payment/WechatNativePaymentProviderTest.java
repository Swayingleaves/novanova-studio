package com.novanovastudio.payment;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockConstruction;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.withSettings;

import com.alibaba.fastjson2.JSON;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.config.NovanovaProperties;
import com.wechat.pay.java.core.cipher.AeadAesCipher;
import com.wechat.pay.java.core.cipher.RSAVerifier;
import com.wechat.pay.java.core.exception.ServiceException;
import com.wechat.pay.java.core.notification.NotificationParser;
import com.wechat.pay.java.service.payments.model.Transaction;
import com.wechat.pay.java.service.payments.model.TransactionAmount;
import com.wechat.pay.java.service.payments.nativepay.NativePayService;
import com.wechat.pay.java.service.payments.nativepay.model.PrepayRequest;
import com.wechat.pay.java.service.payments.nativepay.model.PrepayResponse;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.Signature;
import java.time.OffsetDateTime;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.Answers;
import org.mockito.MockedConstruction;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Protocol;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import reactor.test.StepVerifier;

/**
 * 微信 Native 渠道契约及真实 SDK 回调验签解密的离线测试。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-05 14:00
 */
class WechatNativePaymentProviderTest {
    /** 测试 APIv3 密钥，仅用于离线生成测试密文。 */
    private static final String TEST_API_KEY = "0123456789abcdef0123456789abcdef";
    /** 仅用于测试的微信支付公钥 ID。 */
    private static final String TEST_PUBLIC_KEY_ID = "PUB_KEY_ID_TEST0000000001";
    /** 应用配置。 */
    private NovanovaProperties properties;
    /** 被测渠道。 */
    private WechatNativePaymentProvider provider;
    /** 仅模拟对微信的业务请求边界。 */
    private NativePayService service;
    /** 本地生成的微信支付测试密钥。 */
    private KeyPair platformKeyPair;

    /**
     * 初始化模拟渠道和真实 SDK 密码组件。
     * @throws Exception 测试密钥生成或临时文件写入失败时抛出
     */
    @BeforeEach
    void setUp() throws Exception {
        properties = new NovanovaProperties();
        NovanovaProperties.Wechat configuration = properties.getWechat();
        configuration.setEnabled(true);
        configuration.setAppId("test-app");
        configuration.setMerchantId("test-merchant");
        configuration.setMerchantSerialNumber("test-merchant-serial");
        configuration.setApiV3Key(TEST_API_KEY);
        configuration.setNotifyUrl("https://example.com/api/v1/payment/wechat/notify");
        provider = new WechatNativePaymentProvider(properties);
        service = mock(NativePayService.class);
        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(2048);
        platformKeyPair = generator.generateKeyPair();
        configuration.setPrivateKey(pem("PRIVATE KEY", generator.generateKeyPair().getPrivate().getEncoded()));
        configuration.setPublicKey(pem("PUBLIC KEY", platformKeyPair.getPublic().getEncoded()));
        configuration.setPublicKeyId(TEST_PUBLIC_KEY_ID);
        NotificationParser parser = new NotificationParser(
                Map.of("WECHATPAY2-SHA256-RSA2048", new RSAVerifier(platformKeyPair.getPublic(), TEST_PUBLIC_KEY_ID)),
                Map.of("AEAD_AES_256_GCM", new AeadAesCipher(TEST_API_KEY.getBytes(StandardCharsets.UTF_8))));
        ReflectionTestUtils.setField(provider, "client", new WechatNativePaymentProvider.Client(service, parser));
    }

    /** 同一平台订单再次支付时必须保留订单号、整数分金额及全部原始参数。 */
    @Test
    void shouldReuseOriginalOrderParametersAndReturnUnchangedCodeUrl() {
        PrepayResponse response = new PrepayResponse();
        response.setCodeUrl("weixin://wxpay/bizpayurl?pr=test-code");
        when(service.prepay(any())).thenReturn(response);
        PaymentProvider.PaymentOrder order = new PaymentProvider.PaymentOrder("order_123", "购买积分", new BigDecimal("12.34"), OffsetDateTime.now().plusMinutes(15));

        StepVerifier.create(provider.createPayment(order)).expectNext(response.getCodeUrl()).verifyComplete();
        StepVerifier.create(provider.createPayment(order)).expectNext(response.getCodeUrl()).verifyComplete();

        ArgumentCaptor<PrepayRequest> requests = ArgumentCaptor.forClass(PrepayRequest.class);
        verify(service, org.mockito.Mockito.times(2)).prepay(requests.capture());
        assertEquals(1234, requests.getValue().getAmount().getTotal());
        assertEquals("CNY", requests.getValue().getAmount().getCurrency());
        assertEquals("order_123", requests.getValue().getOutTradeNo());
        assertEquals(JSON.toJSONString(requests.getAllValues().getFirst()), JSON.toJSONString(requests.getAllValues().getLast()));
    }

    /** 非整数分、金额溢出及超长订单号在请求微信前被拒绝。 */
    @Test
    void shouldRejectInvalidAmountAndOrderNumber() {
        for (BigDecimal amount : new BigDecimal[]{new BigDecimal("0.001"), new BigDecimal("21474836.48"), BigDecimal.ZERO}) {
            StepVerifier.create(provider.createPayment(new PaymentProvider.PaymentOrder("order_123", "积分", amount, OffsetDateTime.now().plusMinutes(15))))
                    .expectError(BusinessException.class).verify();
        }
        StepVerifier.create(provider.createPayment(new PaymentProvider.PaymentOrder("x".repeat(33), "积分", BigDecimal.ONE, OffsetDateTime.now().plusMinutes(15))))
                .expectError(BusinessException.class).verify();
        StepVerifier.create(provider.createPayment(new PaymentProvider.PaymentOrder("order_123", "积分", BigDecimal.ONE, OffsetDateTime.now().plusSeconds(30))))
                .expectError(BusinessException.class).verify();
        verify(service, never()).prepay(any());
    }

    /** 未配置、被关闭或非法回调地址时不能调用微信。 */
    @Test
    void shouldRejectIncompleteConfiguration() {
        properties.getWechat().setEnabled(false);
        StepVerifier.create(provider.queryOrder("order_123")).expectError(BusinessException.class).verify();
        properties.getWechat().setEnabled(true);
        properties.getWechat().setNotifyUrl("https://example.com/notify?type=payment");
        StepVerifier.create(provider.queryOrder("order_123")).expectError(BusinessException.class).verify();
        verify(service, never()).queryOrderByOutTradeNo(any());
    }

    /** 公钥 ID 缺失、误填商户证书序列号或公钥文件无效时，不能请求微信。 */
    @Test
    void shouldRejectMissingPublicKeyConfiguration() {
        for (String publicKeyId : new String[]{"", "test-merchant-serial"}) {
            properties.getWechat().setPublicKeyId(publicKeyId);
            StepVerifier.create(provider.queryOrder("order_123"))
                    .expectErrorMatches(error -> error instanceof BusinessException && error.getMessage().contains("公钥"))
                    .verify();
        }
        properties.getWechat().setPublicKeyId(TEST_PUBLIC_KEY_ID);
        for (String publicKey : new String[]{"", "not-a-key", "-----BEGIN PUBLIC KEY-----\n"}) {
            properties.getWechat().setPublicKey(publicKey);
            StepVerifier.create(provider.queryOrder("order_123")).expectError(BusinessException.class).verify();
        }
        verify(service, never()).queryOrderByOutTradeNo(any());
    }

    /** 实际客户端从 PEM 文件初始化后必须直接验签解密，不依赖平台证书下载。 */
    @Test
    void shouldInitializePublicKeyClientAndVerifyNotificationWithoutNetwork() throws Exception {
        OkHttpClient offlineTransport = new OkHttpClient.Builder().addInterceptor(chain -> {
            throw new AssertionError("离线回调验签不应发起网络请求");
        }).build();
        try (MockedConstruction<OkHttpClient.Builder> ignored = mockConstruction(OkHttpClient.Builder.class,
                withSettings().defaultAnswer(Answers.RETURNS_SELF), (builder, context) -> when(builder.build()).thenReturn(offlineTransport))) {
            ReflectionTestUtils.setField(provider, "client", null);
            ReflectionTestUtils.invokeMethod(provider, "client");
            StepVerifier.create(provider.verifyNotification(signedNotification()))
                    .assertNext(notification -> assertEquals("order_123", notification.orderNo())).verifyComplete();
        }
    }

    /** 用真实 SDK 请求链验证公钥 ID 请求头及响应验签，篡改响应必须被拒绝。 */
    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void shouldSendPublicKeyIdAndVerifyResponse(boolean tampered) throws Exception {
        String codeUrl = "weixin://wxpay/bizpayurl?pr=test-code";
        String body = JSON.toJSONString(Map.of("code_url", codeUrl));
        Map<String, String> response = signBody(body);
        AtomicReference<Request> capturedRequest = new AtomicReference<>();
        OkHttpClient offlineTransport = new OkHttpClient.Builder().addInterceptor(chain -> {
            capturedRequest.set(chain.request());
            assertEquals("/v3/pay/transactions/native", chain.request().url().encodedPath());
            return new Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(200).message("OK")
                    .header("Wechatpay-Serial", response.get("Wechatpay-Serial"))
                    .header("Wechatpay-Timestamp", response.get("Wechatpay-Timestamp"))
                    .header("Wechatpay-Nonce", response.get("Wechatpay-Nonce"))
                    .header("Wechatpay-Signature", response.get("Wechatpay-Signature"))
                    .body(ResponseBody.create(tampered ? body + " " : body, MediaType.get("application/json"))).build();
        }).build();
        try (MockedConstruction<OkHttpClient.Builder> ignored = mockConstruction(OkHttpClient.Builder.class,
                withSettings().defaultAnswer(Answers.RETURNS_SELF), (builder, context) -> when(builder.build()).thenReturn(offlineTransport))) {
            ReflectionTestUtils.setField(provider, "client", null);
            ReflectionTestUtils.invokeMethod(provider, "client");
            var verification = StepVerifier.create(provider.createPayment(new PaymentProvider.PaymentOrder(
                    "order_123", "购买积分", BigDecimal.ONE, OffsetDateTime.now().plusMinutes(15))));
            if (tampered) verification.expectError(BusinessException.class).verify();
            else verification.expectNext(codeUrl).verifyComplete();
        }
        assertEquals(TEST_PUBLIC_KEY_ID, capturedRequest.get().header("Wechatpay-Serial"));
        assertTrue(capturedRequest.get().header("Authorization").contains("serial_no=\"test-merchant-serial\""));
    }

    /** 真实 SDK 必须能验证签名并解密通知，解密后金额按整数分转换。 */
    @Test
    void shouldVerifyAndDecryptSignedNotification() throws Exception {
        StepVerifier.create(provider.verifyNotification(signedNotification()))
                .assertNext(notification -> {
                    assertEquals("wechat", notification.paymentMethod());
                    assertEquals("order_123", notification.orderNo());
                    assertEquals(new BigDecimal("2.00"), notification.amount());
                    assertEquals("SUCCESS", notification.tradeStatus());
                }).verifyComplete();
    }

    /** 修改正文、探测签名、错误证书和错误 APIv3 密钥均不得通过验签解密。 */
    @Test
    void shouldRejectTamperingProbeUnknownSerialAndWrongDecryptionKey() throws Exception {
        Map<String, String> parameters = signedNotification();
        parameters.put("body", parameters.get("body") + " ");
        StepVerifier.create(provider.verifyNotification(parameters)).expectError(BusinessException.class).verify();
        parameters = signedNotification();
        parameters.put("Wechatpay-Signature", "WECHATPAY/SIGNTEST/invalid");
        StepVerifier.create(provider.verifyNotification(parameters)).expectError(BusinessException.class).verify();
        parameters = signedNotification();
        parameters.put("Wechatpay-Serial", "unknown-platform-serial");
        StepVerifier.create(provider.verifyNotification(parameters)).expectError(BusinessException.class).verify();
        parameters = signedNotification();
        NotificationParser wrongKeyParser = new NotificationParser(
                Map.of("WECHATPAY2-SHA256-RSA2048", new RSAVerifier(platformKeyPair.getPublic(), TEST_PUBLIC_KEY_ID)),
                Map.of("AEAD_AES_256_GCM", new AeadAesCipher("abcdef0123456789abcdef0123456789".getBytes(StandardCharsets.UTF_8))));
        ReflectionTestUtils.setField(provider, "client", new WechatNativePaymentProvider.Client(service, wrongKeyParser));
        StepVerifier.create(provider.verifyNotification(parameters)).expectError(BusinessException.class).verify();
    }

    /** 商户、应用、币种、订单号及交易类型必须匹配，不能把验签等同于归属校验。 */
    @Test
    void shouldRejectMismatchedTransactionIdentity() {
        for (String field : new String[]{"merchant", "application", "currency", "order", "type", "paidAt"}) {
            Transaction transaction = transaction();
            switch (field) {
                case "merchant" -> transaction.setMchid("another-merchant");
                case "application" -> transaction.setAppid("another-application");
                case "currency" -> transaction.getAmount().setCurrency("USD");
                case "order" -> transaction.setOutTradeNo("another-order");
                case "type" -> transaction.setTradeType(Transaction.TradeTypeEnum.JSAPI);
                case "paidAt" -> transaction.setSuccessTime(null);
                default -> throw new IllegalArgumentException("未知测试字段");
            }
            when(service.queryOrderByOutTradeNo(any())).thenReturn(transaction);
            StepVerifier.create(provider.queryOrder("order_123")).expectError(BusinessException.class).verify();
        }
    }

    /** 未付款结果可以没有渠道交易号和支付时间，不能被误判为付款成功。 */
    @Test
    void shouldKeepUnpaidTransactionPending() {
        Transaction transaction = transaction();
        transaction.setTradeState(Transaction.TradeStateEnum.NOTPAY);
        transaction.setTransactionId(null);
        transaction.setSuccessTime(null);
        when(service.queryOrderByOutTradeNo(any())).thenReturn(transaction);
        StepVerifier.create(provider.queryOrder("order_123"))
                .assertNext(notification -> assertEquals("NOTPAY", notification.tradeStatus())).verifyComplete();
    }

    /** 仅明确不存在的订单可返回空，系统错误不能伪装成不存在。 */
    @Test
    void shouldDistinguishMissingOrderFromChannelFailure() {
        ServiceException missing = new ServiceException(null, 404, "{\"code\":\"ORDER_NOT_EXIST\",\"message\":\"订单不存在\"}");
        when(service.queryOrderByOutTradeNo(any())).thenThrow(missing);
        StepVerifier.create(provider.queryOrder("order_123")).verifyComplete();
        org.mockito.Mockito.doThrow(new IllegalStateException("模拟渠道失败")).when(service).queryOrderByOutTradeNo(any());
        StepVerifier.create(provider.queryOrder("order_123")).expectError(BusinessException.class).verify();
        org.mockito.Mockito.doThrow(new IllegalStateException("模拟关单失败")).when(service).closeOrder(any());
        StepVerifier.create(provider.closePayment("order_123")).expectError(BusinessException.class).verify();
    }

    /**
     * 构造完整微信成功交易。
     * @return 仅含测试身份的交易
     */
    private Transaction transaction() {
        Transaction transaction = new Transaction();
        transaction.setAppid("test-app");
        transaction.setMchid("test-merchant");
        transaction.setOutTradeNo("order_123");
        transaction.setTransactionId("test-transaction");
        transaction.setTradeState(Transaction.TradeStateEnum.SUCCESS);
        transaction.setTradeType(Transaction.TradeTypeEnum.NATIVE);
        transaction.setSuccessTime(OffsetDateTime.now().toString());
        TransactionAmount amount = new TransactionAmount();
        amount.setCurrency("CNY");
        amount.setTotal(200);
        transaction.setAmount(amount);
        return transaction;
    }

    /**
     * 使用本地临时密钥构造符合微信格式的加密签名通知。
     * @return 签名头及保留空白格式的原始正文
     * @throws Exception 测试加密或签名失败时抛出
     */
    private Map<String, String> signedNotification() throws Exception {
        String nonce = "0123456789ab";
        String associatedData = "transaction";
        String transaction = JSON.toJSONString(Map.of("appid", "test-app", "mchid", "test-merchant", "out_trade_no", "order_123",
                "transaction_id", "test-transaction", "trade_state", "SUCCESS", "trade_type", "NATIVE", "success_time", OffsetDateTime.now().toString(),
                "amount", Map.of("total", 200, "currency", "CNY")));
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(TEST_API_KEY.getBytes(StandardCharsets.UTF_8), "AES"),
                new GCMParameterSpec(128, nonce.getBytes(StandardCharsets.UTF_8)));
        cipher.updateAAD(associatedData.getBytes(StandardCharsets.UTF_8));
        String ciphertext = Base64.getEncoder().encodeToString(cipher.doFinal(transaction.getBytes(StandardCharsets.UTF_8)));
        String body = " {\n\"event_type\":\"TRANSACTION.SUCCESS\", \"resource\":" + JSON.toJSONString(Map.of(
                "algorithm", "AEAD_AES_256_GCM", "ciphertext", ciphertext, "nonce", nonce, "associated_data", associatedData)) + "\n}";
        return signBody(body);
    }

    /**
     * 为原始通知或响应正文生成测试签名。
     * @param body 保留原始格式的正文
     * @return 原始正文和对应的微信支付签名头
     * @throws Exception 测试签名失败时抛出
     */
    private Map<String, String> signBody(String body) throws Exception {
        String timestamp = Long.toString(java.time.Instant.now().getEpochSecond());
        Signature signature = Signature.getInstance("SHA256withRSA");
        signature.initSign(platformKeyPair.getPrivate());
        signature.update((timestamp + "\n" + "test-nonce" + "\n" + body + "\n").getBytes(StandardCharsets.UTF_8));
        return new HashMap<>(Map.of("Wechatpay-Serial", TEST_PUBLIC_KEY_ID, "Wechatpay-Timestamp", timestamp,
                "Wechatpay-Nonce", "test-nonce", "Wechatpay-Signature", Base64.getEncoder().encodeToString(signature.sign()), "body", body));
    }

    /**
     * 把本地生成的测试密钥编码为 PEM，不使用任何真实商户凭据。
     * @param type PEM 密钥类型
     * @param encoded 测试密钥的标准编码
     * @return PEM 文本
     */
    private String pem(String type, byte[] encoded) {
        return "-----BEGIN " + type + "-----\n"
                + Base64.getMimeEncoder(64, new byte[]{'\n'}).encodeToString(encoded)
                + "\n-----END " + type + "-----\n";
    }
}
