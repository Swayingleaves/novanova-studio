package com.novanovastudio.service;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.common.SensitiveDataCrypto;
import com.novanovastudio.common.SystemMessage;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.dto.EmailSettingsDtos;
import com.novanovastudio.repository.EmailSettingsRepository;
import com.novanovastudio.repository.EmailSettingsRepository.EmailSettingsRow;
import com.novanovastudio.repository.EmailSettingsRepository.StoredEmailSettings;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.security.TeamScope;
import java.time.OffsetDateTime;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

/**
 * 读取并应用平台邮件服务配置。各实例定期从数据库刷新，保存后当前实例立即生效。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-10 10:10
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class EmailSettingsService {

    /** 发件人邮箱，只接受纯邮箱地址。 */
    private static final String EMAIL_PATTERN = "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$";

    /** 邮件服务配置仓储。 */
    private final EmailSettingsRepository repository;

    /** 运行时配置，保存当前生效的邮件快照。 */
    private final NovanovaProperties properties;

    /** 当前用户。 */
    private final CurrentUserProvider currentUserProvider;

    /** 已应用到本进程的设置更新时间，避免较旧的刷新覆盖较新的保存。 */
    private OffsetDateTime appliedAt;

    /**
     * 应用启动后立即加载邮件服务配置。
     */
    @EventListener(ApplicationReadyEvent.class)
    public void loadOnStartup() {
        refresh().subscribe();
    }

    /**
     * 定期刷新，让其他实例看到管理后台的修改。
     *
     * @return Mono<Void> 刷新完成
     */
    @Scheduled(fixedDelay = 5000, initialDelay = 5000)
    public Mono<Void> refresh() {
        return repository.find()
                .flatMap(this::decryptRow)
                .doOnNext(row -> apply(row.settings(), row.updatedAt()))
                .switchIfEmpty(Mono.defer(() -> {
                    log.error("邮件服务配置不存在");
                    return Mono.empty();
                }))
                .then()
                .onErrorResume(error -> {
                    log.error("读取邮件服务配置失败", error);
                    return Mono.empty();
                });
    }

    /**
     * 查询当前邮件服务配置。响应不包含授权码明文。
     *
     * @return Mono<EmailServiceSettings> 邮件服务配置
     */
    public Mono<EmailSettingsDtos.EmailServiceSettings> getSettings() {
        return requirePlatformAdministrator().then(Mono.defer(repository::find))
                .switchIfEmpty(Mono.error(missing()))
                .map(row -> toView(row.settings().smtpHost(), row.settings().smtpPort(), row.settings().smtpUsername(),
                        StringUtils.hasText(row.settings().smtpPassword()), row.settings().fromEmail(), row.settings().allowedSuffixes()));
    }

    /**
     * 保存邮件服务配置并立即应用到当前进程。
     *
     * @param request UpdateEmailServiceSettings 邮件服务配置
     * @return Mono<EmailServiceSettings> 保存后的配置
     */
    public Mono<EmailSettingsDtos.EmailServiceSettings> updateSettings(EmailSettingsDtos.UpdateEmailServiceSettings request) {
        return requirePlatformAdministrator().then(Mono.defer(repository::find))
                .switchIfEmpty(Mono.error(missing()))
                .flatMap(existing -> store(normalize(request), existing.settings().smtpPassword()))
                .flatMap(repository::update)
                .flatMap(this::decryptRow)
                .doOnNext(row -> {
                    apply(row.settings(), row.updatedAt());
                    log.info("保存邮件服务配置: host={}, port={}, username={}, from={}, passwordConfigured={}",
                            row.settings().smtpHost(), row.settings().smtpPort(), row.settings().smtpUsername(),
                            row.settings().fromEmail(), StringUtils.hasText(row.settings().smtpPassword()));
                })
                .map(row -> toView(row.settings()));
    }

    /**
     * 限定平台管理员在平台空间修改全站邮件服务。
     *
     * @return Mono<Void> 校验通过
     */
    private Mono<Void> requirePlatformAdministrator() {
        return currentUserProvider.currentUser().flatMap(user -> TeamScope.current()
                .filter(scope -> scope.teamId() == 0 && "admin".equals(user.role()))
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.PERMISSION_DENIED,
                        SystemMessage.of("business.onlyPlatformAdministratorCanManageEmailSettings"))))
                .then());
    }

    /**
     * 把数据库中的明文配置写入运行时快照。
     *
     * @param settings RuntimeEmailSettings 明文邮件配置
     * @param updatedAt OffsetDateTime 更新时间
     */
    private void apply(NovanovaProperties.RuntimeEmailSettings settings, OffsetDateTime updatedAt) {
        synchronized (this) {
            if (appliedAt != null && updatedAt != null && updatedAt.isBefore(appliedAt)) {
                return;
            }
            NovanovaProperties.RuntimeEmailSettings previous = properties.emailSettings();
            properties.replaceEmailSettings(settings);
            if (updatedAt != null) {
                appliedAt = updatedAt;
            }
            if (!settings.equals(previous)) {
                log.info("已应用邮件服务配置: host={}, port={}, username={}, from={}, passwordConfigured={}",
                        settings.smtpHost(), settings.smtpPort(), settings.smtpUsername(), settings.fromEmail(),
                        StringUtils.hasText(settings.smtpPassword()));
            }
        }
    }

    /**
     * 校验并整理管理员提交的配置。密码留空表示稍后沿用已保存的授权码。
     *
     * @param request UpdateEmailServiceSettings 原始请求
     * @return RuntimeEmailSettings 整理后的明文配置
     */
    private NovanovaProperties.RuntimeEmailSettings normalize(EmailSettingsDtos.UpdateEmailServiceSettings request) {
        String host = text(request.smtpHost());
        String username = text(request.smtpUsername());
        String from = text(request.fromEmail());
        String suffixes = normalizeSuffixes(request.allowedSuffixes());
        String password = text(request.smtpPassword());
        if (request.smtpPort() == null || request.smtpPort() < 1 || request.smtpPort() > 65535) {
            throw invalid("business.emailSmtpPortOutOfRange");
        }
        if (host.length() > 255 || hasWhitespace(host) || host.contains("://")) {
            throw invalid("business.emailSmtpHostInvalid");
        }
        if (username.length() > 320 || hasWhitespace(username)) {
            throw invalid("business.emailSmtpUsernameInvalid");
        }
        if (password.length() > 512) {
            throw invalid("business.emailSmtpPasswordTooLong");
        }
        if (!from.isEmpty() && (from.length() > 320 || !from.matches(EMAIL_PATTERN))) {
            throw invalid("business.emailFromInvalid");
        }
        if (suffixes.length() > 4000) {
            throw invalid("business.emailAllowedSuffixesTooLong");
        }
        return new NovanovaProperties.RuntimeEmailSettings(host, request.smtpPort(), username, password, from, suffixes);
    }

    /**
     * 新授权码加密后写入；留空时保留原密文，避免每次修改其他字段都要重填授权码。
     *
     * @param plain RuntimeEmailSettings 明文配置，密码为空表示不修改
     * @param existingCiphertext String 已保存的密文
     * @return Mono<StoredEmailSettings> 可落库的配置
     */
    private Mono<StoredEmailSettings> store(NovanovaProperties.RuntimeEmailSettings plain, String existingCiphertext) {
        if (!StringUtils.hasText(plain.smtpPassword())) {
            return Mono.just(stored(plain, text(existingCiphertext)));
        }
        return Mono.fromCallable(() -> SensitiveDataCrypto.encrypt(plain.smtpPassword(), properties.getApp().getSecretKey()))
                .subscribeOn(Schedulers.boundedElastic())
                .map(ciphertext -> stored(plain, ciphertext));
    }

    /**
     * 把落库行解密成运行时明文。未设置授权码时不访问应用密钥。
     *
     * @param row EmailSettingsRow 数据库配置
     * @return Mono<RuntimeEmailSettingsRow> 明文配置和更新时间
     */
    private Mono<RuntimeEmailSettingsRow> decryptRow(EmailSettingsRow row) {
        String ciphertext = row.settings().smtpPassword();
        if (!StringUtils.hasText(ciphertext)) {
            return Mono.just(new RuntimeEmailSettingsRow(runtime(row.settings(), ""), row.updatedAt()));
        }
        return Mono.fromCallable(() -> SensitiveDataCrypto.decrypt(ciphertext, properties.getApp().getSecretKey()))
                .subscribeOn(Schedulers.boundedElastic())
                .map(plain -> new RuntimeEmailSettingsRow(runtime(row.settings(), plain), row.updatedAt()));
    }

    /**
     * 组装不含明文授权码的响应。
     *
     * @param settings RuntimeEmailSettings 明文配置
     * @return EmailServiceSettings 管理后台响应
     */
    private static EmailSettingsDtos.EmailServiceSettings toView(NovanovaProperties.RuntimeEmailSettings settings) {
        return toView(settings.smtpHost(), settings.smtpPort(), settings.smtpUsername(),
                StringUtils.hasText(settings.smtpPassword()), settings.fromEmail(), settings.allowedSuffixes());
    }

    /**
     * 组装不含明文授权码的响应。
     *
     * @param smtpHost String SMTP 服务地址
     * @param smtpPort int SMTP 端口
     * @param smtpUsername String SMTP 登录用户名
     * @param passwordConfigured boolean 是否已保存授权码
     * @param fromEmail String 发件人邮箱
     * @param allowedSuffixes String 注册邮箱后缀
     * @return EmailServiceSettings 管理后台响应
     */
    private static EmailSettingsDtos.EmailServiceSettings toView(String smtpHost, int smtpPort, String smtpUsername,
            boolean passwordConfigured, String fromEmail, String allowedSuffixes) {
        return new EmailSettingsDtos.EmailServiceSettings(smtpHost, smtpPort, smtpUsername, passwordConfigured, fromEmail, allowedSuffixes);
    }

    /**
     * 用密文替换明文密码，得到可落库的配置。
     *
     * @param plain RuntimeEmailSettings 明文配置
     * @param ciphertext String 密文或空字符串
     * @return StoredEmailSettings 落库配置
     */
    private static StoredEmailSettings stored(NovanovaProperties.RuntimeEmailSettings plain, String ciphertext) {
        return new StoredEmailSettings(plain.smtpHost(), plain.smtpPort(), plain.smtpUsername(), ciphertext, plain.fromEmail(), plain.allowedSuffixes());
    }

    /**
     * 用明文授权码替换密文，得到运行时配置。
     *
     * @param stored StoredEmailSettings 落库配置
     * @param plainPassword String 明文授权码
     * @return RuntimeEmailSettings 运行时配置
     */
    private static NovanovaProperties.RuntimeEmailSettings runtime(StoredEmailSettings stored, String plainPassword) {
        return new NovanovaProperties.RuntimeEmailSettings(stored.smtpHost(), stored.smtpPort(), stored.smtpUsername(),
                plainPassword, stored.fromEmail(), stored.allowedSuffixes());
    }

    /**
     * 去掉首尾空白，并把换行和中文逗号整理成英文逗号。
     *
     * @param value String 原始后缀列表
     * @return String 逗号分隔的后缀列表
     */
    private static String normalizeSuffixes(String value) {
        return text(value).replace('，', ',').replace('\r', '\n').replace('\n', ',');
    }

    /**
     * 把空值整理成去掉首尾空白的字符串。
     *
     * @param value String 原始文本
     * @return String 整理后的文本
     */
    private static String text(String value) {
        return value == null ? "" : value.trim();
    }

    /**
     * 判断文本是否包含空白字符。
     *
     * @param value String 待检查文本
     * @return boolean 是否包含空白
     */
    private static boolean hasWhitespace(String value) {
        return value.chars().anyMatch(Character::isWhitespace);
    }

    /**
     * 创建邮件配置缺失错误。
     *
     * @return BusinessException 配置缺失
     */
    private static BusinessException missing() {
        return new BusinessException(ErrorCode.BUSINESS_ERROR, SystemMessage.of("business.emailSettingsMissing"));
    }

    /**
     * 创建参数错误。
     *
     * @param key String 消息键
     * @return BusinessException 参数错误
     */
    private static BusinessException invalid(String key) {
        return new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of(key));
    }

    /**
     * 解密后的邮件配置和它的更新时间。
     *
     * @param settings RuntimeEmailSettings 明文配置
     * @param updatedAt OffsetDateTime 更新时间
     */
    private record RuntimeEmailSettingsRow(NovanovaProperties.RuntimeEmailSettings settings, OffsetDateTime updatedAt) {
    }
}
