package com.novanovastudio.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.SensitiveDataCrypto;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.dto.PaymentSettingsDtos.UpdateAlipaySettings;
import com.novanovastudio.dto.PaymentSettingsDtos.UpdateWechatSettings;
import com.novanovastudio.repository.PaymentSettingsRepository;
import com.novanovastudio.repository.PaymentSettingsRepository.PaymentSettingsRow;
import com.novanovastudio.repository.PaymentSettingsRepository.StoredPaymentSettings;
import com.novanovastudio.security.CurrentUser;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.security.TeamScope;
import java.time.OffsetDateTime;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

/**
 * 支付配置的密钥保留、加密和校验。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-10 10:50
 */
class PaymentSettingsServiceTest {

    /** 测试用应用密钥。 */
    private static final String SECRET = "payment-settings-test-secret";

    /** 仅用于测试的支付宝私钥。 */
    private static final String ALIPAY_PRIVATE = "alipay-application-private-key-0123456789";

    /** 仅用于测试的 APIv3 密钥。 */
    private static final String API_V3_KEY = "0123456789abcdef0123456789abcdef";

    /** 仅用于测试的微信私钥。 */
    private static final String WECHAT_PRIVATE = "-----BEGIN PRIVATE KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA\n-----END PRIVATE KEY-----";

    /** 仅用于测试的微信支付公钥。 */
    private static final String WECHAT_PUBLIC = "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA\n-----END PUBLIC KEY-----";

    /** 支付配置仓储。 */
    private PaymentSettingsRepository repository;

    /** 运行时配置。 */
    private NovanovaProperties properties;

    /** 待测试服务。 */
    private PaymentSettingsService service;

    /** 已保存的支付宝私钥密文。 */
    private String alipayCiphertext;

    /** 已保存的微信私钥密文。 */
    private String wechatCiphertext;

    /** 已保存的 APIv3 密钥密文。 */
    private String apiV3Ciphertext;

    /**
     * 每个场景从同一份已配置的支付参数开始。
     */
    @BeforeEach
    void setUp() {
        repository = mock(PaymentSettingsRepository.class);
        properties = new NovanovaProperties();
        properties.getApp().setSecretKey(SECRET);
        alipayCiphertext = SensitiveDataCrypto.encrypt(ALIPAY_PRIVATE, SECRET);
        wechatCiphertext = SensitiveDataCrypto.encrypt(WECHAT_PRIVATE, SECRET);
        apiV3Ciphertext = SensitiveDataCrypto.encrypt(API_V3_KEY, SECRET);
        when(repository.find()).thenReturn(Mono.just(row(stored())));
        when(repository.updateAlipay(any())).thenAnswer(invocation -> Mono.just(row(invocation.getArgument(0))));
        when(repository.updateWechat(any())).thenAnswer(invocation -> Mono.just(row(invocation.getArgument(0))));
        service = new PaymentSettingsService(repository, properties, new CurrentUserProvider());
    }

    /** 留空支付宝私钥时保留原密文，运行时仍使用原来的明文。 */
    @Test
    void shouldKeepAlipayPrivateKeyWhenUpdateOmitsIt() {
        StepVerifier.create(asAdmin(service.updateAlipay(alipay(false, ""))))
                .assertNext(settings -> {
                    assertTrue(settings.alipay().privateKeyConfigured());
                    assertEquals("2021000000000001", settings.alipay().appId());
                    assertFalse(settings.toString().contains(ALIPAY_PRIVATE));
                })
                .verifyComplete();

        StoredPaymentSettings saved = savedAlipay();
        assertEquals(alipayCiphertext, saved.alipayPrivateKey());
        assertEquals("alipay-public-key-0123456789abcdef", saved.alipayPublicKey());
        assertEquals(ALIPAY_PRIVATE, properties.getAlipay().getPrivateKey());
        verify(repository, never()).updateWechat(any());
    }

    /** 新支付宝私钥只以密文落库，当前进程立即使用明文。 */
    @Test
    void shouldEncryptReplacementAlipayPrivateKey() {
        String replacement = "replacement-alipay-private-key-0123456789";
        StepVerifier.create(asAdmin(service.updateAlipay(alipay(false, replacement))))
                .assertNext(settings -> assertTrue(settings.alipay().privateKeyConfigured()))
                .verifyComplete();

        StoredPaymentSettings saved = savedAlipay();
        assertTrue(saved.alipayPrivateKey().startsWith("v1:"));
        assertFalse(saved.alipayPrivateKey().contains(replacement));
        assertEquals(replacement, SensitiveDataCrypto.decrypt(saved.alipayPrivateKey(), SECRET));
        assertEquals(replacement, properties.getAlipay().getPrivateKey());
    }

    /** 启用支付宝但缺少密钥时拒绝保存。 */
    @Test
    void shouldRejectEnablingIncompleteAlipay() {
        when(repository.find()).thenReturn(Mono.just(row(empty())));
        StepVerifier.create(asAdmin(service.updateAlipay(alipay(true, ""))))
                .expectErrorMatches(error -> error instanceof BusinessException business
                        && "business.alipaySettingsIncomplete".equals(business.getSystemMessage().key()))
                .verify();
        verify(repository, never()).updateAlipay(any());
    }

    /** 留空微信密钥时保留原密文，并拒绝带查询参数的通知地址。 */
    @Test
    void shouldKeepWechatSecretsAndRejectInvalidNotifyUrl() {
        UpdateWechatSettings invalid = wechat("");
        invalid = new UpdateWechatSettings(false, "wx-app", "1234567890", "AABBCC", "", "", "", "PUB_KEY_ID_TEST", "https://example.com/notify?type=pay");
        StepVerifier.create(asAdmin(service.updateWechat(invalid)))
                .expectErrorMatches(error -> error instanceof BusinessException business
                        && "business.wechatNotifyUrlInvalid".equals(business.getSystemMessage().key()))
                .verify();
        verify(repository, never()).updateWechat(any());

        StepVerifier.create(asAdmin(service.updateWechat(wechat(""))))
                .assertNext(settings -> {
                    assertTrue(settings.wechat().privateKeyConfigured());
                    assertTrue(settings.wechat().apiV3KeyConfigured());
                    assertFalse(settings.toString().contains(API_V3_KEY));
                    assertFalse(settings.toString().contains("BEGIN PRIVATE KEY"));
                })
                .verifyComplete();
        StoredPaymentSettings saved = savedWechat();
        assertEquals(wechatCiphertext, saved.wechatPrivateKey());
        assertEquals(apiV3Ciphertext, saved.wechatApiV3Key());
        assertEquals(API_V3_KEY, properties.getWechat().getApiV3Key());
        assertEquals(WECHAT_PRIVATE, properties.getWechat().getPrivateKey());
    }

    /** 普通用户和团队空间不能修改全站支付配置。 */
    @Test
    void shouldRejectNonPlatformAdministrator() {
        StepVerifier.create(service.updateAlipay(alipay(false, ""))
                        .contextWrite(context -> context.put(CurrentUserProvider.CURRENT_USER_CONTEXT_KEY, new CurrentUser(2L, "user@example.com", "user", 1))))
                .expectErrorMatches(error -> error instanceof BusinessException business
                        && "business.onlyPlatformAdministratorCanManagePaymentSettings".equals(business.getSystemMessage().key()))
                .verify();
        StepVerifier.create(service.updateWechat(wechat(""))
                        .contextWrite(context -> new TeamScope(8, "administrator").apply(context)
                                .put(CurrentUserProvider.CURRENT_USER_CONTEXT_KEY, new CurrentUser(1L, "admin@example.com", "admin", 1))))
                .expectError(BusinessException.class)
                .verify();
        verify(repository, never()).find();
        verify(repository, never()).updateAlipay(any());
        verify(repository, never()).updateWechat(any());
    }

    /**
     * 构造已保存密钥的支付配置。
     *
     * @return StoredPaymentSettings 落库配置
     */
    private StoredPaymentSettings stored() {
        return new StoredPaymentSettings(false, "2021000000000000", alipayCiphertext, "alipay-public-key-0123456789abcdef",
                "https://openapi.alipay.com/gateway.do", "https://example.com/api/v1/payment/alipay/notify",
                "https://example.com/api/v1/payment/alipay/return", false, "wx-app", "1234567890", "AABBCC",
                wechatCiphertext, apiV3Ciphertext, WECHAT_PUBLIC, "PUB_KEY_ID_TEST", "https://example.com/api/v1/payment/wechat/notify");
    }

    /**
     * 构造尚未填写密钥的支付配置。
     *
     * @return StoredPaymentSettings 空配置
     */
    private static StoredPaymentSettings empty() {
        return new StoredPaymentSettings(false, "", "", "", "https://openapi.alipay.com/gateway.do", "", "",
                false, "", "", "", "", "", "", "", "");
    }

    /**
     * 给配置补上更新时间。
     *
     * @param settings StoredPaymentSettings 支付配置
     * @return PaymentSettingsRow 带更新时间的配置
     */
    private static PaymentSettingsRow row(StoredPaymentSettings settings) {
        return new PaymentSettingsRow(settings, OffsetDateTime.parse("2026-11-10T10:00:01Z"));
    }

    /**
     * 构造支付宝保存请求。应用标识固定改为新值，便于确认非密钥字段会更新。
     *
     * @param enabled boolean 是否启用
     * @param privateKey String 私钥，空字符串表示不修改
     * @return UpdateAlipaySettings 保存请求
     */
    private static UpdateAlipaySettings alipay(boolean enabled, String privateKey) {
        return new UpdateAlipaySettings(enabled, "2021000000000001", privateKey, "", "https://openapi.alipay.com/gateway.do",
                "https://example.com/api/v1/payment/alipay/notify", "https://example.com/api/v1/payment/alipay/return");
    }

    /**
     * 构造微信支付保存请求。密钥留空表示不修改。
     *
     * @param apiV3Key String APIv3 密钥
     * @return UpdateWechatSettings 保存请求
     */
    private static UpdateWechatSettings wechat(String apiV3Key) {
        return new UpdateWechatSettings(false, "wx-app", "1234567890", "AABBCC", "", apiV3Key, "", "PUB_KEY_ID_TEST",
                "https://example.com/api/v1/payment/wechat/notify");
    }

    /**
     * 读取本次支付宝保存交给数据库的配置。
     *
     * @return StoredPaymentSettings 落库配置
     */
    private StoredPaymentSettings savedAlipay() {
        ArgumentCaptor<StoredPaymentSettings> captor = ArgumentCaptor.forClass(StoredPaymentSettings.class);
        verify(repository).updateAlipay(captor.capture());
        return captor.getValue();
    }

    /**
     * 读取本次微信支付保存交给数据库的配置。
     *
     * @return StoredPaymentSettings 落库配置
     */
    private StoredPaymentSettings savedWechat() {
        ArgumentCaptor<StoredPaymentSettings> captor = ArgumentCaptor.forClass(StoredPaymentSettings.class);
        verify(repository).updateWechat(captor.capture());
        return captor.getValue();
    }

    /**
     * 以平台管理员身份执行。
     *
     * @param mono Mono<T> 待执行操作
     * @param <T> 结果类型
     * @return Mono<T> 带管理员身份的操作
     */
    private static <T> Mono<T> asAdmin(Mono<T> mono) {
        return mono.contextWrite(context -> context.put(CurrentUserProvider.CURRENT_USER_CONTEXT_KEY, new CurrentUser(1L, "admin@example.com", "admin", 1)));
    }
}
