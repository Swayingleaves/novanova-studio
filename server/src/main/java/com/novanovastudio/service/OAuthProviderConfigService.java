package com.novanovastudio.service;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.common.SensitiveDataCrypto;
import com.novanovastudio.common.SystemMessage;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.dto.OAuthConfigDtos;
import com.novanovastudio.entity.PlatformOAuthProviderRecords;
import com.novanovastudio.repository.OAuthProviderConfigRepository;
import com.novanovastudio.security.oauth2.OAuth2ProviderCatalog;
import com.novanovastudio.security.oauth2.ThirdPartyOAuth2Configuration;
import java.net.URI;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

/**
 * 平台 OAuth2 第三方登录渠道配置服务。
 * <p>
 * 配置保存在数据库并缓存在内存中，管理后台保存后立即刷新缓存，登录流程按渠道标识读取最新配置。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-09 12:00
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class OAuthProviderConfigService {

    /** 渠道配置仓储 */
    private final OAuthProviderConfigRepository repository;

    /** 服务配置 */
    private final NovanovaProperties properties;

    /** 内存中的渠道运行时配置，键为渠道标识 */
    private volatile Map<String, ThirdPartyOAuth2Configuration> configurations = Map.of();

    /**
     * 应用启动后异步加载数据库中的登录渠道配置。
     *
     * @return void
     */
    @EventListener(ApplicationReadyEvent.class)
    public void loadOnStartup() {
        reload().doOnSuccess(ignored -> log.info("OAuth登录渠道配置加载完成: providers={}", configurations.keySet()))
                .doOnError(exception -> log.error("加载OAuth登录渠道配置失败", exception))
                .onErrorResume(exception -> Mono.empty())
                .subscribe();
    }

    /**
     * 查询渠道的运行时配置。
     *
     * @param providerId String 渠道标识
     * @return Optional<ThirdPartyOAuth2Configuration> 运行时配置，未加载或渠道不存在时为空
     */
    public Optional<ThirdPartyOAuth2Configuration> find(String providerId) {
        return Optional.ofNullable(configurations.get(providerId));
    }

    /**
     * 重新加载数据库中的全部渠道配置并刷新缓存。
     *
     * @return Mono<Void> 刷新完成信号
     */
    public Mono<Void> reload() {
        return repository.findAll()
                .concatMap(this::decryptConfiguration)
                .collectList()
                .doOnNext(list -> configurations = list.stream()
                        .collect(Collectors.toUnmodifiableMap(ThirdPartyOAuth2Configuration::providerId, configuration -> configuration)))
                .then();
    }

    /**
     * 查询管理后台展示用的全部渠道配置。
     *
     * @return Mono<ProviderListResponse> 渠道配置列表
     */
    public Mono<OAuthConfigDtos.ProviderListResponse> listProviders() {
        return reload().then(Mono.fromSupplier(() -> new OAuthConfigDtos.ProviderListResponse(
                OAuth2ProviderCatalog.ALL.stream().map(this::providerInfo).toList())));
    }

    /**
     * 更新指定渠道配置并刷新缓存。
     *
     * @param request UpdateProviderRequest 更新请求
     * @return Mono<ProviderInfo> 更新后的渠道配置
     */
    public Mono<OAuthConfigDtos.ProviderInfo> updateProvider(OAuthConfigDtos.UpdateProviderRequest request) {
        OAuth2ProviderCatalog.ProviderDefinition definition = OAuth2ProviderCatalog.find(request.provider())
                .orElseThrow(() -> new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.oAuthProviderNotSupported")));
        String clientId = normalized(request.clientId());
        String clientSecret = normalized(request.clientSecret());
        String redirectUri = normalized(request.redirectUri());
        if (request.enabled()) {
            requireText(clientId, "business.oAuthClientIdIsRequired");
            requireText(clientSecret, "business.oAuthClientSecretIsRequired");
            requireText(redirectUri, "business.oAuthRedirectUriIsRequired");
            validateRedirectUri(definition, redirectUri);
        }
        return repository.findByProvider(definition.providerId())
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, SystemMessage.of("business.oAuthProviderConfigNotFound"))))
                .flatMap(ignored -> {
                    // 保存请求即完整配置：密钥留空表示清空，避免后台无法移除已泄露的密钥。
                    Mono<String> encryptedSecret = StringUtils.hasText(clientSecret) ? encryptSecret(clientSecret) : Mono.just("");
                    return encryptedSecret.flatMap(encrypted -> {
                        PlatformOAuthProviderRecords.OAuthProviderRecord record = new PlatformOAuthProviderRecords.OAuthProviderRecord();
                        record.setProvider(definition.providerId());
                        record.setEnabled(request.enabled());
                        record.setClientId(clientId);
                        record.setClientSecretEncrypted(encrypted);
                        record.setRedirectUri(redirectUri);
                        return repository.update(record)
                                .flatMap(updated -> updated == 0
                                        ? Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, SystemMessage.of("business.oAuthProviderConfigNotFound")))
                                        : Mono.empty())
                                .then(reload());
                    });
                })
                .doOnSuccess(ignored -> log.info("OAuth登录渠道配置已更新: provider={}, enabled={}", definition.providerId(), request.enabled()))
                .then(Mono.fromSupplier(() -> providerInfo(definition)));
    }

    /**
     * 把数据库记录解密为运行时配置。
     *
     * @param record OAuthProviderRecord 数据库记录
     * @return Mono<ThirdPartyOAuth2Configuration> 运行时配置
     */
    private Mono<ThirdPartyOAuth2Configuration> decryptConfiguration(PlatformOAuthProviderRecords.OAuthProviderRecord record) {
        return decryptSecret(record.getClientSecretEncrypted())
                .map(secret -> new ThirdPartyOAuth2Configuration(record.getProvider(), Boolean.TRUE.equals(record.getEnabled()),
                        normalized(record.getClientId()), secret, normalized(record.getRedirectUri())));
    }

    /**
     * 把渠道运行时配置转换为后台展示信息。
     *
     * @param definition ProviderDefinition 内置渠道定义
     * @return ProviderInfo 渠道配置信息
     */
    private OAuthConfigDtos.ProviderInfo providerInfo(OAuth2ProviderCatalog.ProviderDefinition definition) {
        ThirdPartyOAuth2Configuration configuration = configurations.get(definition.providerId());
        if (configuration == null) {
            return new OAuthConfigDtos.ProviderInfo(definition.providerId(), definition.displayName(), false, "", "", "", definition.callbackPath());
        }
        return new OAuthConfigDtos.ProviderInfo(definition.providerId(), definition.displayName(), configuration.enabled(),
                configuration.clientId(), configuration.clientSecret(), configuration.redirectUri(), definition.callbackPath());
    }

    /**
     * 校验回调地址必须是绝对 HTTP(S) 地址且路径与内置回调路径一致。
     *
     * @param definition ProviderDefinition 内置渠道定义
     * @param value String 回调地址
     * @throws BusinessException 回调地址不合法时抛出
     */
    private void validateRedirectUri(OAuth2ProviderCatalog.ProviderDefinition definition, String value) {
        URI redirectUri;
        try {
            redirectUri = URI.create(value);
        } catch (IllegalArgumentException exception) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.oAuthRedirectUriInvalid", definition.callbackPath()));
        }
        boolean supportedScheme = "https".equalsIgnoreCase(redirectUri.getScheme()) || "http".equalsIgnoreCase(redirectUri.getScheme());
        if (!supportedScheme || !StringUtils.hasText(redirectUri.getHost()) || !definition.callbackPath().equals(redirectUri.getPath())
                || redirectUri.getQuery() != null || redirectUri.getFragment() != null) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.oAuthRedirectUriInvalid", definition.callbackPath()));
        }
    }

    /**
     * 校验文本配置必填。
     *
     * @param value String 配置值
     * @param messageKey String 消息键
     * @throws BusinessException 配置为空时抛出
     */
    private void requireText(String value, String messageKey) {
        if (!StringUtils.hasText(value)) {
            throw new BusinessException(ErrorCode.PARAM_MISSING, SystemMessage.of(messageKey));
        }
    }

    /**
     * 加密客户端密钥。
     *
     * @param data String 客户端密钥明文
     * @return Mono<String> 加密后的密钥
     */
    private Mono<String> encryptSecret(String data) {
        // AES-GCM加密属于CPU操作，放入boundedElastic执行。
        return Mono.fromCallable(() -> SensitiveDataCrypto.encrypt(data, properties.getApp().getSecretKey()))
                .subscribeOn(Schedulers.boundedElastic())
                .onErrorMap(exception -> exception instanceof BusinessException ? exception
                        : new BusinessException(ErrorCode.SYSTEM_ERROR, SystemMessage.of("business.failedToEncryptSensitiveConfiguration", exception.getMessage())));
    }

    /**
     * 解密客户端密钥。
     *
     * @param value String 加密后的密钥
     * @return Mono<String> 密钥明文
     */
    private Mono<String> decryptSecret(String value) {
        if (!StringUtils.hasText(value)) {
            return Mono.just("");
        }
        return Mono.fromCallable(() -> SensitiveDataCrypto.decrypt(value, properties.getApp().getSecretKey()))
                .subscribeOn(Schedulers.boundedElastic())
                .onErrorMap(exception -> exception instanceof BusinessException ? exception
                        : new BusinessException(ErrorCode.SYSTEM_ERROR, SystemMessage.of("business.failedToDecryptSensitiveData", exception.getMessage())));
    }

    /**
     * 规范化可空文本。
     *
     * @param value String 原始文本
     * @return String 去除首尾空白后的文本，空值时返回空字符串
     */
    private String normalized(String value) {
        return Objects.toString(value, "").trim();
    }
}
