package com.novanovastudio.service;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.common.SensitiveDataCrypto;
import com.novanovastudio.common.SystemMessage;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.dto.PaymentSettingsDtos;
import com.novanovastudio.repository.PaymentSettingsRepository;
import com.novanovastudio.repository.PaymentSettingsRepository.PaymentSettingsRow;
import com.novanovastudio.repository.PaymentSettingsRepository.StoredPaymentSettings;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.security.TeamScope;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.util.Objects;
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
 * 读取并应用平台支付宝和微信支付配置。各实例定期从数据库刷新，保存后当前实例立即生效。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-10 10:40
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class PaymentSettingsService {

    /** 支付配置仓储。 */
    private final PaymentSettingsRepository repository;

    /** 运行时配置，保存当前生效的支付快照。 */
    private final NovanovaProperties properties;

    /** 当前用户。 */
    private final CurrentUserProvider currentUserProvider;

    /** 已应用到本进程的设置更新时间，避免较旧的刷新覆盖较新的保存。 */
    private OffsetDateTime appliedAt;

    /**
     * 应用启动后立即加载支付配置。
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
                .doOnNext(row -> apply(row.plain(), row.updatedAt()))
                .switchIfEmpty(Mono.defer(() -> {
                    log.error("支付配置不存在");
                    return Mono.empty();
                }))
                .then()
                .onErrorResume(error -> {
                    log.error("读取支付配置失败", error);
                    return Mono.empty();
                });
    }

    /**
     * 查询当前支付配置。响应不包含密钥明文。
     *
     * @return Mono<PaymentSettings> 支付配置
     */
    public Mono<PaymentSettingsDtos.PaymentSettings> getSettings() {
        return requirePlatformAdministrator().then(Mono.defer(repository::find))
                .switchIfEmpty(Mono.error(missing()))
                .map(row -> toView(row.settings()));
    }

    /**
     * 保存支付宝配置并立即应用到当前进程。
     *
     * @param request UpdateAlipaySettings 支付宝配置
     * @return Mono<PaymentSettings> 保存后的支付配置
     */
    public Mono<PaymentSettingsDtos.PaymentSettings> updateAlipay(PaymentSettingsDtos.UpdateAlipaySettings request) {
        return requirePlatformAdministrator().then(Mono.defer(repository::find))
                .switchIfEmpty(Mono.error(missing()))
                .flatMap(existing -> decryptRow(existing).map(row -> new ResolvedAlipay(existing,
                        normalizeAlipay(request, existing.settings(), row.plain()), StringUtils.hasText(text(request.privateKey())))))
                .flatMap(this::encryptAlipay)
                .flatMap(repository::updateAlipay)
                .flatMap(this::decryptRow)
                .doOnNext(row -> {
                    apply(row.plain(), row.updatedAt());
                    log.info("保存支付宝配置: enabled={}, appId={}, gateway={}, privateKeyConfigured={}, publicKeyConfigured={}",
                            row.plain().alipayEnabled(), row.plain().alipayAppId(), row.plain().alipayGatewayUrl(),
                            StringUtils.hasText(row.plain().alipayPrivateKey()), StringUtils.hasText(row.plain().alipayPublicKey()));
                })
                .map(row -> toView(row.stored()));
    }

    /**
     * 保存微信支付配置并立即应用到当前进程。
     *
     * @param request UpdateWechatSettings 微信支付配置
     * @return Mono<PaymentSettings> 保存后的支付配置
     */
    public Mono<PaymentSettingsDtos.PaymentSettings> updateWechat(PaymentSettingsDtos.UpdateWechatSettings request) {
        return requirePlatformAdministrator().then(Mono.defer(repository::find))
                .switchIfEmpty(Mono.error(missing()))
                .flatMap(existing -> decryptRow(existing).map(row -> new ResolvedWechat(existing, normalizeWechat(request, existing.settings(), row.plain()),
                        StringUtils.hasText(text(request.privateKey())), StringUtils.hasText(text(request.apiV3Key())))))
                .flatMap(this::encryptWechat)
                .flatMap(repository::updateWechat)
                .flatMap(this::decryptRow)
                .doOnNext(row -> {
                    apply(row.plain(), row.updatedAt());
                    log.info("保存微信支付配置: enabled={}, appId={}, merchantId={}, publicKeyId={}, privateKeyConfigured={}, apiV3KeyConfigured={}, publicKeyConfigured={}",
                            row.plain().wechatEnabled(), row.plain().wechatAppId(), row.plain().wechatMerchantId(), row.plain().wechatPublicKeyId(),
                            StringUtils.hasText(row.plain().wechatPrivateKey()), StringUtils.hasText(row.plain().wechatApiV3Key()),
                            StringUtils.hasText(row.plain().wechatPublicKey()));
                })
                .map(row -> toView(row.stored()));
    }

    /**
     * 限定平台管理员在平台空间修改全站支付配置。
     *
     * @return Mono<Void> 校验通过
     */
    private Mono<Void> requirePlatformAdministrator() {
        return currentUserProvider.currentUser().flatMap(user -> TeamScope.current()
                .filter(scope -> scope.teamId() == 0 && "admin".equals(user.role()))
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.PERMISSION_DENIED,
                        SystemMessage.of("business.onlyPlatformAdministratorCanManagePaymentSettings"))))
                .then());
    }

    /**
     * 把明文配置写入进程内的支付宝和微信支付对象。
     *
     * @param plain PlainPaymentSettings 明文配置
     * @param updatedAt OffsetDateTime 更新时间
     */
    private void apply(PlainPaymentSettings plain, OffsetDateTime updatedAt) {
        synchronized (this) {
            if (appliedAt != null && updatedAt != null && updatedAt.isBefore(appliedAt)) {
                return;
            }
            NovanovaProperties.Alipay alipay = properties.getAlipay();
            NovanovaProperties.Wechat wechat = properties.getWechat();
            boolean changed = alipay.isEnabled() != plain.alipayEnabled()
                    || !Objects.equals(alipay.getAppId(), plain.alipayAppId())
                    || !Objects.equals(alipay.getPrivateKey(), plain.alipayPrivateKey())
                    || !Objects.equals(alipay.getPublicKey(), plain.alipayPublicKey())
                    || !Objects.equals(alipay.getGatewayUrl(), plain.alipayGatewayUrl())
                    || !Objects.equals(alipay.getNotifyUrl(), plain.alipayNotifyUrl())
                    || !Objects.equals(alipay.getReturnUrl(), plain.alipayReturnUrl())
                    || wechat.isEnabled() != plain.wechatEnabled()
                    || !Objects.equals(wechat.getAppId(), plain.wechatAppId())
                    || !Objects.equals(wechat.getMerchantId(), plain.wechatMerchantId())
                    || !Objects.equals(wechat.getMerchantSerialNumber(), plain.wechatMerchantSerialNumber())
                    || !Objects.equals(wechat.getPrivateKey(), plain.wechatPrivateKey())
                    || !Objects.equals(wechat.getApiV3Key(), plain.wechatApiV3Key())
                    || !Objects.equals(wechat.getPublicKey(), plain.wechatPublicKey())
                    || !Objects.equals(wechat.getPublicKeyId(), plain.wechatPublicKeyId())
                    || !Objects.equals(wechat.getNotifyUrl(), plain.wechatNotifyUrl());
            alipay.setEnabled(plain.alipayEnabled());
            alipay.setAppId(plain.alipayAppId());
            alipay.setPrivateKey(plain.alipayPrivateKey());
            alipay.setPublicKey(plain.alipayPublicKey());
            alipay.setGatewayUrl(plain.alipayGatewayUrl());
            alipay.setNotifyUrl(plain.alipayNotifyUrl());
            alipay.setReturnUrl(plain.alipayReturnUrl());
            wechat.setEnabled(plain.wechatEnabled());
            wechat.setAppId(plain.wechatAppId());
            wechat.setMerchantId(plain.wechatMerchantId());
            wechat.setMerchantSerialNumber(plain.wechatMerchantSerialNumber());
            wechat.setPrivateKey(plain.wechatPrivateKey());
            wechat.setApiV3Key(plain.wechatApiV3Key());
            wechat.setPublicKey(plain.wechatPublicKey());
            wechat.setPublicKeyId(plain.wechatPublicKeyId());
            wechat.setNotifyUrl(plain.wechatNotifyUrl());
            if (updatedAt != null) {
                appliedAt = updatedAt;
            }
            if (changed) {
                log.info("已应用支付配置: alipayEnabled={}, alipayAppId={}, wechatEnabled={}, wechatMerchantId={}, wechatPublicKeyId={}",
                        plain.alipayEnabled(), plain.alipayAppId(), plain.wechatEnabled(), plain.wechatMerchantId(), plain.wechatPublicKeyId());
            }
        }
    }

    /**
     * 合并留空保留的支付宝密钥，并校验格式。启用时要求配置完整。
     *
     * @param request UpdateAlipaySettings 原始请求
     * @param existing StoredPaymentSettings 已保存配置
     * @param current PlainPaymentSettings 已解密的当前配置
     * @return PlainPaymentSettings 待保存的明文配置
     */
    private PlainPaymentSettings normalizeAlipay(PaymentSettingsDtos.UpdateAlipaySettings request, StoredPaymentSettings existing, PlainPaymentSettings current) {
        String privateKey = firstText(request.privateKey(), current.alipayPrivateKey());
        String publicKey = firstText(request.publicKey(), existing.alipayPublicKey());
        PlainPaymentSettings plain = current.withAlipay(Boolean.TRUE.equals(request.enabled()), text(request.appId()), privateKey, publicKey,
                text(request.gatewayUrl()), text(request.notifyUrl()), text(request.returnUrl()));
        if (plain.alipayAppId().length() > 64 || hasWhitespace(plain.alipayAppId())) {
            throw invalid("business.alipayAppIdInvalid");
        }
        if (!validKeyMaterial(plain.alipayPrivateKey(), "")) {
            throw invalid("business.alipayPrivateKeyInvalid");
        }
        if (!validKeyMaterial(plain.alipayPublicKey(), "")) {
            throw invalid("business.alipayPublicKeyInvalid");
        }
        if (!validUrl(plain.alipayGatewayUrl(), 255)) {
            throw invalid("business.alipayGatewayInvalid");
        }
        if (!validUrl(plain.alipayNotifyUrl(), 500)) {
            throw invalid("business.alipayNotifyUrlInvalid");
        }
        if (!validUrl(plain.alipayReturnUrl(), 500)) {
            throw invalid("business.alipayReturnUrlInvalid");
        }
        if (plain.alipayEnabled() && (!StringUtils.hasText(plain.alipayAppId()) || !StringUtils.hasText(plain.alipayPrivateKey())
                || !StringUtils.hasText(plain.alipayPublicKey()) || !StringUtils.hasText(plain.alipayGatewayUrl())
                || !StringUtils.hasText(plain.alipayNotifyUrl()) || !StringUtils.hasText(plain.alipayReturnUrl()))) {
            throw invalid("business.alipaySettingsIncomplete");
        }
        return plain;
    }

    /**
     * 合并留空保留的微信密钥，并校验格式。启用时要求配置完整。
     *
     * @param request UpdateWechatSettings 原始请求
     * @param existing StoredPaymentSettings 已保存配置
     * @param current PlainPaymentSettings 已解密的当前配置
     * @return PlainPaymentSettings 待保存的明文配置
     */
    private PlainPaymentSettings normalizeWechat(PaymentSettingsDtos.UpdateWechatSettings request, StoredPaymentSettings existing, PlainPaymentSettings current) {
        String privateKey = firstText(request.privateKey(), current.wechatPrivateKey());
        String apiV3Key = firstText(request.apiV3Key(), current.wechatApiV3Key());
        String publicKey = firstText(request.publicKey(), existing.wechatPublicKey());
        PlainPaymentSettings plain = current.withWechat(Boolean.TRUE.equals(request.enabled()), text(request.appId()), text(request.merchantId()),
                text(request.merchantSerialNumber()), privateKey, apiV3Key, publicKey, text(request.publicKeyId()), text(request.notifyUrl()));
        if (plain.wechatAppId().length() > 64 || hasWhitespace(plain.wechatAppId())) {
            throw invalid("business.wechatAppIdInvalid");
        }
        if (!plain.wechatMerchantId().isEmpty() && !plain.wechatMerchantId().matches("[0-9A-Za-z]{1,32}")) {
            throw invalid("business.wechatMerchantIdInvalid");
        }
        if (plain.wechatMerchantSerialNumber().length() > 64 || hasWhitespace(plain.wechatMerchantSerialNumber())
                || (!plain.wechatMerchantSerialNumber().isEmpty() && !plain.wechatMerchantSerialNumber().matches("[0-9A-Fa-f]+"))) {
            throw invalid("business.wechatSerialNumberInvalid");
        }
        if (!validKeyMaterial(plain.wechatPrivateKey(), "PRIVATE KEY")) {
            throw invalid("business.wechatPrivateKeyInvalid");
        }
        if (StringUtils.hasText(plain.wechatApiV3Key()) && plain.wechatApiV3Key().getBytes(StandardCharsets.UTF_8).length != 32) {
            throw invalid("business.wechatApiV3KeyInvalid");
        }
        if (!validKeyMaterial(plain.wechatPublicKey(), "PUBLIC KEY")) {
            throw invalid("business.wechatPublicKeyInvalid");
        }
        if (plain.wechatPublicKeyId().length() > 64 || hasWhitespace(plain.wechatPublicKeyId())
                || (!plain.wechatPublicKeyId().isEmpty() && !plain.wechatPublicKeyId().startsWith("PUB_KEY_ID_"))) {
            throw invalid("business.wechatPublicKeyIdInvalid");
        }
        if (!validUrl(plain.wechatNotifyUrl(), 500)) {
            throw invalid("business.wechatNotifyUrlInvalid");
        }
        if (plain.wechatEnabled() && (!StringUtils.hasText(plain.wechatAppId()) || !StringUtils.hasText(plain.wechatMerchantId())
                || !StringUtils.hasText(plain.wechatMerchantSerialNumber()) || !StringUtils.hasText(plain.wechatPrivateKey())
                || !StringUtils.hasText(plain.wechatApiV3Key()) || !StringUtils.hasText(plain.wechatPublicKey())
                || !StringUtils.hasText(plain.wechatPublicKeyId()) || !StringUtils.hasText(plain.wechatNotifyUrl()))) {
            throw invalid("business.wechatSettingsIncomplete");
        }
        return plain;
    }

    /**
     * 本次提交了新私钥时加密，留空则保留原密文。
     *
     * @param resolved ResolvedAlipay 原行、明文和是否更换私钥
     * @return Mono<StoredPaymentSettings> 可落库的整行
     */
    private Mono<StoredPaymentSettings> encryptAlipay(ResolvedAlipay resolved) {
        PlainPaymentSettings plain = resolved.plain();
        StoredPaymentSettings existing = resolved.existing().settings();
        if (!resolved.replacePrivateKey()) {
            return Mono.just(plain.toStored(text(existing.alipayPrivateKey()), text(existing.wechatPrivateKey()), text(existing.wechatApiV3Key())));
        }
        return encrypt(plain.alipayPrivateKey())
                .map(ciphertext -> plain.toStored(ciphertext, text(existing.wechatPrivateKey()), text(existing.wechatApiV3Key())));
    }

    /**
     * 本次提交了新的微信私钥或 APIv3 密钥时分别加密，留空则保留原密文。
     *
     * @param resolved ResolvedWechat 原行、明文和是否更换密钥
     * @return Mono<StoredPaymentSettings> 可落库的整行
     */
    private Mono<StoredPaymentSettings> encryptWechat(ResolvedWechat resolved) {
        PlainPaymentSettings plain = resolved.plain();
        StoredPaymentSettings existing = resolved.existing().settings();
        Mono<String> privateKey = resolved.replacePrivateKey() ? encrypt(plain.wechatPrivateKey()) : Mono.just(text(existing.wechatPrivateKey()));
        Mono<String> apiV3Key = resolved.replaceApiV3Key() ? encrypt(plain.wechatApiV3Key()) : Mono.just(text(existing.wechatApiV3Key()));
        return privateKey.zipWith(apiV3Key)
                .map(secrets -> plain.toStored(text(existing.alipayPrivateKey()), secrets.getT1(), secrets.getT2()));
    }

    /**
     * 使用应用密钥加密一段密钥材料。
     *
     * @param plain String 明文
     * @return Mono<String> 密文
     */
    private Mono<String> encrypt(String plain) {
        return Mono.fromCallable(() -> SensitiveDataCrypto.encrypt(plain, properties.getApp().getSecretKey()))
                .subscribeOn(Schedulers.boundedElastic());
    }

    /**
     * 把数据库行解密成运行时明文。未设置密钥时不访问应用密钥。
     *
     * @param row PaymentSettingsRow 数据库配置
     * @return Mono<DecryptedPaymentSettings> 明文配置和更新时间
     */
    private Mono<DecryptedPaymentSettings> decryptRow(PaymentSettingsRow row) {
        return Mono.fromCallable(() -> {
            String secret = properties.getApp().getSecretKey();
            StoredPaymentSettings stored = row.settings();
            return new DecryptedPaymentSettings(new PlainPaymentSettings(
                    stored.alipayEnabled(), text(stored.alipayAppId()), decrypt(stored.alipayPrivateKey(), secret), text(stored.alipayPublicKey()),
                    text(stored.alipayGatewayUrl()), text(stored.alipayNotifyUrl()), text(stored.alipayReturnUrl()),
                    stored.wechatEnabled(), text(stored.wechatAppId()), text(stored.wechatMerchantId()), text(stored.wechatMerchantSerialNumber()),
                    decrypt(stored.wechatPrivateKey(), secret), decrypt(stored.wechatApiV3Key(), secret), text(stored.wechatPublicKey()),
                    text(stored.wechatPublicKeyId()), text(stored.wechatNotifyUrl())), stored, row.updatedAt());
        }).subscribeOn(Schedulers.boundedElastic());
    }

    /**
     * 解密一段密文。空密文返回空字符串。
     *
     * @param ciphertext String 密文
     * @param secret String 应用密钥
     * @return String 明文
     */
    private static String decrypt(String ciphertext, String secret) {
        if (!StringUtils.hasText(ciphertext)) {
            return "";
        }
        return SensitiveDataCrypto.decrypt(ciphertext, secret);
    }

    /**
     * 组装不含密钥明文的响应。
     *
     * @param stored StoredPaymentSettings 落库配置
     * @return PaymentSettings 管理后台响应
     */
    private static PaymentSettingsDtos.PaymentSettings toView(StoredPaymentSettings stored) {
        return new PaymentSettingsDtos.PaymentSettings(
                new PaymentSettingsDtos.AlipaySettings(stored.alipayEnabled(), text(stored.alipayAppId()),
                        StringUtils.hasText(stored.alipayPrivateKey()), StringUtils.hasText(stored.alipayPublicKey()),
                        text(stored.alipayGatewayUrl()), text(stored.alipayNotifyUrl()), text(stored.alipayReturnUrl())),
                new PaymentSettingsDtos.WechatSettings(stored.wechatEnabled(), text(stored.wechatAppId()), text(stored.wechatMerchantId()),
                        text(stored.wechatMerchantSerialNumber()), StringUtils.hasText(stored.wechatPrivateKey()),
                        StringUtils.hasText(stored.wechatApiV3Key()), StringUtils.hasText(stored.wechatPublicKey()),
                        text(stored.wechatPublicKeyId()), text(stored.wechatNotifyUrl())));
    }

    /**
     * 请求字段优先，留空时使用已保存的密钥。
     *
     * @param requested String 本次提交的值
     * @param existing String 已保存的值
     * @return String 最终值
     */
    private static String firstText(String requested, String existing) {
        String value = text(requested);
        return StringUtils.hasText(value) ? value : text(existing);
    }

    /**
     * 校验可选密钥。微信传入 PEM 标记，支付宝传空字符串。
     *
     * @param value String 密钥
     * @param pemMarker String PEM 标记，空字符串表示不要求 PEM
     * @return boolean 空值或格式正确时为 true
     */
    private static boolean validKeyMaterial(String value, String pemMarker) {
        if (!StringUtils.hasText(value)) {
            return true;
        }
        if (value.length() > 8000 || value.length() < 32) {
            return false;
        }
        if (!StringUtils.hasText(pemMarker)) {
            return true;
        }
        String normalized = value.trim();
        return normalized.contains("-----BEGIN") && normalized.contains("-----END") && normalized.contains(pemMarker);
    }

    /**
     * 校验可选 HTTPS 地址，不允许用户信息、查询参数和片段。
     *
     * @param value String 地址
     * @param maxLength int 最大长度
     * @return boolean 空值或地址合法时为 true
     */
    private static boolean validUrl(String value, int maxLength) {
        if (!StringUtils.hasText(value)) {
            return true;
        }
        if (value.length() > maxLength || hasWhitespace(value)) {
            return false;
        }
        try {
            URI uri = URI.create(value);
            return "https".equalsIgnoreCase(uri.getScheme()) && StringUtils.hasText(uri.getHost())
                    && uri.getUserInfo() == null && uri.getQuery() == null && uri.getFragment() == null;
        } catch (IllegalArgumentException exception) {
            return false;
        }
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
     * 创建支付配置缺失错误。
     *
     * @return BusinessException 配置缺失
     */
    private static BusinessException missing() {
        return new BusinessException(ErrorCode.BUSINESS_ERROR, SystemMessage.of("business.paymentSettingsMissing"));
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
     * 解密后的支付配置，同时保留落库行供响应判断密文是否存在。
     *
     * @param plain PlainPaymentSettings 明文配置
     * @param stored StoredPaymentSettings 落库配置
     * @param updatedAt OffsetDateTime 更新时间
     */
    private record DecryptedPaymentSettings(PlainPaymentSettings plain, StoredPaymentSettings stored, OffsetDateTime updatedAt) {
    }

    /**
     * 支付宝保存前的原行、合并后的明文，以及本次是否更换私钥。
     *
     * @param existing PaymentSettingsRow 原配置
     * @param plain PlainPaymentSettings 合并后的明文
     * @param replacePrivateKey boolean 本次是否提交了新私钥
     */
    private record ResolvedAlipay(PaymentSettingsRow existing, PlainPaymentSettings plain, boolean replacePrivateKey) {
    }

    /**
     * 微信支付保存前的原行、合并后的明文，以及本次是否更换私钥和 APIv3 密钥。
     *
     * @param existing PaymentSettingsRow 原配置
     * @param plain PlainPaymentSettings 合并后的明文
     * @param replacePrivateKey boolean 本次是否提交了新私钥
     * @param replaceApiV3Key boolean 本次是否提交了新 APIv3 密钥
     */
    private record ResolvedWechat(PaymentSettingsRow existing, PlainPaymentSettings plain, boolean replacePrivateKey, boolean replaceApiV3Key) {
    }

    /**
     * 进程内使用的支付明文。密钥字段不能写入日志。
     *
     * @param alipayEnabled 是否启用支付宝
     * @param alipayAppId 支付宝应用标识
     * @param alipayPrivateKey 支付宝应用私钥
     * @param alipayPublicKey 支付宝公钥
     * @param alipayGatewayUrl 支付宝网关
     * @param alipayNotifyUrl 支付宝通知地址
     * @param alipayReturnUrl 支付宝回跳地址
     * @param wechatEnabled 是否启用微信支付
     * @param wechatAppId 微信应用标识
     * @param wechatMerchantId 微信商户号
     * @param wechatMerchantSerialNumber 商户证书序列号
     * @param wechatPrivateKey 商户私钥
     * @param wechatApiV3Key APIv3 密钥
     * @param wechatPublicKey 微信支付公钥
     * @param wechatPublicKeyId 微信支付公钥 ID
     * @param wechatNotifyUrl 微信支付通知地址
     */
    private record PlainPaymentSettings(boolean alipayEnabled, String alipayAppId, String alipayPrivateKey, String alipayPublicKey,
                                         String alipayGatewayUrl, String alipayNotifyUrl, String alipayReturnUrl,
                                         boolean wechatEnabled, String wechatAppId, String wechatMerchantId, String wechatMerchantSerialNumber,
                                         String wechatPrivateKey, String wechatApiV3Key, String wechatPublicKey, String wechatPublicKeyId,
                                         String wechatNotifyUrl) {

        /**
         * 替换支付宝字段并保留微信支付明文。
         *
         * @param enabled boolean 是否启用
         * @param appId String 应用标识
         * @param privateKey String 应用私钥
         * @param publicKey String 支付宝公钥
         * @param gatewayUrl String 网关地址
         * @param notifyUrl String 通知地址
         * @param returnUrl String 回跳地址
         * @return PlainPaymentSettings 新明文
         */
        private PlainPaymentSettings withAlipay(boolean enabled, String appId, String privateKey, String publicKey,
                                                 String gatewayUrl, String notifyUrl, String returnUrl) {
            return new PlainPaymentSettings(enabled, appId, privateKey, publicKey, gatewayUrl, notifyUrl, returnUrl,
                    wechatEnabled, wechatAppId, wechatMerchantId, wechatMerchantSerialNumber, wechatPrivateKey, wechatApiV3Key,
                    wechatPublicKey, wechatPublicKeyId, wechatNotifyUrl);
        }

        /**
         * 替换微信支付字段并保留支付宝明文。
         *
         * @param enabled boolean 是否启用
         * @param appId String 应用标识
         * @param merchantId String 商户号
         * @param serialNumber String 证书序列号
         * @param privateKey String 商户私钥
         * @param apiV3Key String APIv3 密钥
         * @param publicKey String 微信支付公钥
         * @param publicKeyId String 公钥 ID
         * @param notifyUrl String 通知地址
         * @return PlainPaymentSettings 新明文
         */
        private PlainPaymentSettings withWechat(boolean enabled, String appId, String merchantId, String serialNumber, String privateKey,
                                                 String apiV3Key, String publicKey, String publicKeyId, String notifyUrl) {
            return new PlainPaymentSettings(alipayEnabled, alipayAppId, alipayPrivateKey, alipayPublicKey, alipayGatewayUrl,
                    alipayNotifyUrl, alipayReturnUrl, enabled, appId, merchantId, serialNumber, privateKey, apiV3Key, publicKey, publicKeyId, notifyUrl);
        }

        /**
         * 用指定密文替换明私钥，得到可落库的整行。
         *
         * @param alipayPrivateCiphertext String 支付宝私钥密文
         * @param wechatPrivateCiphertext String 微信私钥密文
         * @param wechatApiV3Ciphertext String APIv3 密钥密文
         * @return StoredPaymentSettings 落库配置
         */
        private StoredPaymentSettings toStored(String alipayPrivateCiphertext, String wechatPrivateCiphertext, String wechatApiV3Ciphertext) {
            return new StoredPaymentSettings(alipayEnabled, alipayAppId, alipayPrivateCiphertext, alipayPublicKey, alipayGatewayUrl,
                    alipayNotifyUrl, alipayReturnUrl, wechatEnabled, wechatAppId, wechatMerchantId, wechatMerchantSerialNumber,
                    wechatPrivateCiphertext, wechatApiV3Ciphertext, wechatPublicKey, wechatPublicKeyId, wechatNotifyUrl);
        }
    }
}
