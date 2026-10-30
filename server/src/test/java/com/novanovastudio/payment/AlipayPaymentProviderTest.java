package com.novanovastudio.payment;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.alipay.api.internal.util.AlipaySignature;
import com.novanovastudio.config.NovanovaProperties;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import reactor.test.StepVerifier;

/**
 * 支付宝支付提供方签名和通知解析测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-10-27 20:30
 */
class AlipayPaymentProviderTest {

    /** 支付宝提供方。 */
    private AlipayPaymentProvider provider;
    /** 应用配置。 */
    private NovanovaProperties properties;
    /** 测试私钥。 */
    private String privateKey;
    /** 测试公钥。 */
    private String publicKey;

    /** 初始化一对仅用于测试的 RSA2 密钥。 */
    @BeforeEach
    void setUp() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(2048);
        KeyPair keyPair = generator.generateKeyPair();
        privateKey = Base64.getEncoder().encodeToString(keyPair.getPrivate().getEncoded());
        publicKey = Base64.getEncoder().encodeToString(keyPair.getPublic().getEncoded());
        properties = new NovanovaProperties();
        NovanovaProperties.Alipay alipay = properties.getAlipay();
        alipay.setEnabled(true);
        alipay.setAppId("app-id");
        alipay.setPrivateKey(privateKey);
        alipay.setPublicKey(publicKey);
        alipay.setNotifyUrl("https://example.com/api/v1/payment/alipay/notify");
        alipay.setReturnUrl("https://example.com/api/v1/payment/alipay/return");
        provider = new AlipayPaymentProvider(properties);
    }

    /** 有效 RSA2 签名应通过校验并解析出通知字段。 */
    @Test
    void shouldVerifyValidRsa2Notification() throws Exception {
        Map<String, String> parameters = parameters();
        parameters.put("sign", AlipaySignature.sign(parameters, privateKey, StandardCharsets.UTF_8.name(), "RSA2"));

        StepVerifier.create(provider.verifyNotification(parameters))
                .assertNext(notification -> {
                    assertEquals("app-id", notification.appId());
                    assertEquals("order-1", notification.orderNo());
                    assertEquals(0, new BigDecimal("2.00").compareTo(notification.amount()));
                    assertEquals("TRADE_SUCCESS", notification.tradeStatus());
                })
                .verifyComplete();
    }

    /** 篡改金额后签名必须失效，不能进入订单结算。 */
    @Test
    void shouldRejectTamperedNotification() throws Exception {
        Map<String, String> parameters = parameters();
        parameters.put("sign", AlipaySignature.sign(parameters, privateKey, StandardCharsets.UTF_8.name(), "RSA2"));
        parameters.put("total_amount", "3.00");

        StepVerifier.create(provider.verifyNotification(parameters))
                .expectErrorMessage("支付宝异步通知签名校验失败")
                .verify();
    }

    /** 构造待签名通知参数。 */
    private Map<String, String> parameters() {
        Map<String, String> parameters = new HashMap<>();
        parameters.put("app_id", "app-id");
        parameters.put("out_trade_no", "order-1");
        parameters.put("total_amount", "2.00");
        parameters.put("trade_no", "trade-1");
        parameters.put("trade_status", "TRADE_SUCCESS");
        parameters.put("gmt_payment", "2026-10-27 20:30:00");
        return parameters;
    }
}
