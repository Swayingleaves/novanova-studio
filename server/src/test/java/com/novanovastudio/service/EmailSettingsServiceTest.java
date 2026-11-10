package com.novanovastudio.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.SensitiveDataCrypto;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.dto.EmailSettingsDtos;
import com.novanovastudio.repository.EmailSettingsRepository;
import com.novanovastudio.repository.EmailSettingsRepository.EmailSettingsRow;
import com.novanovastudio.repository.EmailSettingsRepository.StoredEmailSettings;
import com.novanovastudio.security.CurrentUser;
import com.novanovastudio.security.CurrentUserProvider;
import java.time.OffsetDateTime;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

/**
 * 邮件服务配置的授权码保留、加密和校验。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-10 10:20
 */
class EmailSettingsServiceTest {

    /** 测试用应用密钥。 */
    private static final String SECRET = "email-settings-test-secret";

    /** 邮件配置仓储。 */
    private EmailSettingsRepository repository;

    /** 运行时配置。 */
    private NovanovaProperties properties;

    /** 待测试服务。 */
    private EmailSettingsService service;

    /** 已保存授权码的密文。 */
    private String existingCiphertext;

    /**
     * 每个场景从同一份已配置的邮件服务开始。
     */
    @BeforeEach
    void setUp() {
        repository = mock(EmailSettingsRepository.class);
        properties = new NovanovaProperties();
        properties.getApp().setSecretKey(SECRET);
        existingCiphertext = SensitiveDataCrypto.encrypt("secret-auth", SECRET);
        StoredEmailSettings stored = new StoredEmailSettings("smtp.qq.com", 465, "user@qq.com", existingCiphertext, "user@qq.com", "qq.com");
        when(repository.find()).thenReturn(Mono.just(new EmailSettingsRow(stored, OffsetDateTime.parse("2026-11-10T10:00:00Z"))));
        when(repository.update(org.mockito.ArgumentMatchers.any())).thenAnswer(invocation -> Mono.just(
                new EmailSettingsRow(invocation.getArgument(0), OffsetDateTime.parse("2026-11-10T10:00:01Z"))));
        service = new EmailSettingsService(repository, properties, new CurrentUserProvider());
    }

    /** 留空授权码时保留原密文，运行时仍能用原来的明文发信。 */
    @Test
    void shouldKeepExistingPasswordWhenUpdateOmitsIt() {
        StepVerifier.create(asAdmin(service.updateSettings(request("", "qq.com，gmail.com\n163.com"))))
                .assertNext(settings -> {
                    assertTrue(settings.passwordConfigured());
                    assertEquals("qq.com,gmail.com,163.com", settings.allowedSuffixes());
                    assertFalse(settings.toString().contains("secret-auth"));
                })
                .verifyComplete();

        StoredEmailSettings saved = savedSettings();
        assertEquals(existingCiphertext, saved.smtpPassword());
        assertEquals("qq.com,gmail.com,163.com", saved.allowedSuffixes());
        assertEquals("secret-auth", properties.emailSettings().smtpPassword());
        assertFalse(properties.emailSettings().toString().contains("secret-auth"));
    }

    /** 新授权码只以密文落库，当前进程立即使用明文。 */
    @Test
    void shouldEncryptReplacementPassword() {
        StepVerifier.create(asAdmin(service.updateSettings(request("new-auth", "qq.com"))))
                .assertNext(settings -> assertTrue(settings.passwordConfigured()))
                .verifyComplete();

        StoredEmailSettings saved = savedSettings();
        assertTrue(saved.smtpPassword().startsWith("v1:"));
        assertFalse(saved.smtpPassword().contains("new-auth"));
        assertEquals("new-auth", SensitiveDataCrypto.decrypt(saved.smtpPassword(), SECRET));
        assertEquals("new-auth", properties.emailSettings().smtpPassword());
    }

    /** 发件人不是邮箱时拒绝保存，不改数据库。 */
    @Test
    void shouldRejectInvalidSender() {
        EmailSettingsDtos.UpdateEmailServiceSettings request = new EmailSettingsDtos.UpdateEmailServiceSettings(
                "smtp.qq.com", 465, "user@qq.com", "", "not-an-email", "qq.com");
        StepVerifier.create(asAdmin(service.updateSettings(request)))
                .expectErrorMatches(error -> error instanceof BusinessException business
                        && "business.emailFromInvalid".equals(business.getSystemMessage().key()))
                .verify();
        verify(repository, never()).update(org.mockito.ArgumentMatchers.any());
    }

    /** 普通用户和团队空间不能修改全站邮件配置。 */
    @Test
    void shouldRejectNonPlatformAdministrator() {
        StepVerifier.create(service.updateSettings(request("", "qq.com"))
                        .contextWrite(context -> context.put(CurrentUserProvider.CURRENT_USER_CONTEXT_KEY, new CurrentUser(2L, "user@example.com", "user", 1))))
                .expectErrorMatches(error -> error instanceof BusinessException business
                        && "business.onlyPlatformAdministratorCanManageEmailSettings".equals(business.getSystemMessage().key()))
                .verify();
        verify(repository, never()).find();
        verify(repository, never()).update(org.mockito.ArgumentMatchers.any());
    }

    /**
     * 读取本次保存交给数据库的配置。
     *
     * @return StoredEmailSettings 落库配置
     */
    private StoredEmailSettings savedSettings() {
        ArgumentCaptor<StoredEmailSettings> captor = ArgumentCaptor.forClass(StoredEmailSettings.class);
        verify(repository).update(captor.capture());
        return captor.getValue();
    }

    /**
     * 构造一份只改变授权码和后缀的保存请求。
     *
     * @param password String 授权码，空字符串表示不修改
     * @param suffixes String 注册邮箱后缀
     * @return UpdateEmailServiceSettings 保存请求
     */
    private static EmailSettingsDtos.UpdateEmailServiceSettings request(String password, String suffixes) {
        return new EmailSettingsDtos.UpdateEmailServiceSettings("smtp.qq.com", 465, "user@qq.com", password, "user@qq.com", suffixes);
    }

    /**
     * 以平台管理员身份执行。
     *
     * @param mono Mono<T> 待执行操作
     * @return Mono<T> 带管理员身份的操作
     */
    private static <T> Mono<T> asAdmin(Mono<T> mono) {
        return mono.contextWrite(context -> context.put(CurrentUserProvider.CURRENT_USER_CONTEXT_KEY, new CurrentUser(1L, "admin@example.com", "admin", 1)));
    }
}
