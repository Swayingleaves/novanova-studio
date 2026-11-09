package com.novanovastudio.service;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.common.SensitiveDataCrypto;
import com.novanovastudio.common.SystemMessage;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.dto.StandardOAuthConfigDtos;
import com.novanovastudio.entity.PlatformStandardOAuthProviderRecords;
import com.novanovastudio.repository.StandardOAuthProviderRepository;
import com.novanovastudio.security.oauth2.OAuth2ProviderCatalog;
import com.novanovastudio.security.oauth2.StandardOAuth2Configuration;
import com.novanovastudio.security.oauth2.StandardOAuth2Provider;
import com.novanovastudio.security.oauth2.ThirdPartyOAuth2Provider;
import java.net.URI;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.Optional;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

/**
 * 平台标准 OAuth2 登录渠道配置服务。
 * <p>
 * 支持维护多个标准 OAuth2 渠道，配置保存在数据库并缓存在内存中；管理后台保存后立即刷新缓存，登录流程按渠道标识读取最新配置。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-09 14:30
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class StandardOAuthProviderService {

    /** 渠道标识格式：c 开头，后续为小写字母或数字 */
    private static final Pattern PROVIDER_ID_PATTERN = Pattern.compile("^c[a-z0-9]{10,29}$");

    /** 用户信息字段名格式 */
    private static final Pattern ATTRIBUTE_PATTERN = Pattern.compile("^[A-Za-z0-9_.-]+$");

    /** 默认客户端认证方式 */
    private static final String DEFAULT_CLIENT_AUTHENTICATION_METHOD = "client_secret_basic";

    /** 请求体客户端认证方式 */
    private static final String CLIENT_SECRET_POST = "client_secret_post";

    /** 默认用户标识字段 */
    private static final String DEFAULT_USER_NAME_ATTRIBUTE = "sub";

    /** 默认邮箱字段 */
    private static final String DEFAULT_EMAIL_ATTRIBUTE = "email";

    /** 默认昵称字段 */
    private static final String DEFAULT_NICKNAME_ATTRIBUTE = "name";

    /** 默认头像字段 */
    private static final String DEFAULT_AVATAR_ATTRIBUTE = "picture";

    /** 渠道配置仓储 */
    private final StandardOAuthProviderRepository repository;

    /** 服务配置 */
    private final NovanovaProperties properties;

    /** 内存中的渠道运行时配置，顺序与创建时间一致 */
    private volatile List<StandardOAuth2Configuration> configurations = List.of();

    /**
     * 应用启动后异步加载数据库中的标准 OAuth2 渠道配置。
     *
     * @return void
     */
    @EventListener(ApplicationReadyEvent.class)
    public void loadOnStartup() {
        reload().doOnSuccess(ignored -> log.info("标准OAuth2渠道配置加载完成: providers={}", configurations.size()))
                .doOnError(exception -> log.error("加载标准OAuth2渠道配置失败", exception))
                .onErrorResume(exception -> Mono.empty())
                .subscribe();
    }

    /**
     * 查询渠道的运行时配置。
     *
     * @param providerId String 渠道标识
     * @return Optional<StandardOAuth2Configuration> 运行时配置，未加载或渠道不存在时为空
     */
    public Optional<StandardOAuth2Configuration> find(String providerId) {
        return configurations.stream().filter(configuration -> configuration.providerId().equals(providerId)).findFirst();
    }

    /**
     * 查询指定渠道的认证渠道实现。
     *
     * @param providerId String 渠道标识
     * @return Optional<ThirdPartyOAuth2Provider> 认证渠道实现，不存在时为空
     */
    public Optional<ThirdPartyOAuth2Provider> findProvider(String providerId) {
        return find(providerId).map(configuration -> (ThirdPartyOAuth2Provider) new StandardOAuth2Provider(configuration));
    }

    /**
     * 返回全部标准 OAuth2 认证渠道实现，包含未启用渠道。
     *
     * @return List<ThirdPartyOAuth2Provider> 认证渠道实现
     */
    public List<ThirdPartyOAuth2Provider> allProviders() {
        return configurations.stream().<ThirdPartyOAuth2Provider>map(StandardOAuth2Provider::new).toList();
    }

    /**
     * 查询管理后台展示用的全部渠道配置。
     *
     * @return Mono<ProviderListResponse> 渠道配置列表
     */
    public Mono<StandardOAuthConfigDtos.ProviderListResponse> listProviders() {
        return reload().then(Mono.fromSupplier(() -> new StandardOAuthConfigDtos.ProviderListResponse(
                configurations.stream().map(this::providerInfo).toList())));
    }

    /**
     * 新增渠道配置并刷新缓存。
     *
     * @param request ProviderRequest 新增请求
     * @return Mono<ProviderInfo> 新增后的渠道配置
     */
    public Mono<StandardOAuthConfigDtos.ProviderInfo> createProvider(StandardOAuthConfigDtos.ProviderRequest request) {
        return Mono.defer(() -> {
            ProviderValues values = normalizedValues(request);
            return repository.findByProvider(values.provider())
                    .flatMap(existing -> Mono.<Void>error(providerAlreadyExists()))
                    .switchIfEmpty(Mono.defer(() -> encryptSecret(values.clientSecret())
                            .flatMap(encryptedSecret -> repository.insert(toRecord(values, encryptedSecret)).then())))
                    .then(reload())
                    .then(Mono.fromSupplier(() -> providerInfo(values.provider())))
                    .onErrorMap(DuplicateKeyException.class, exception -> providerAlreadyExists());
        });
    }

    /**
     * 更新渠道配置并刷新缓存。
     *
     * @param request ProviderRequest 更新请求
     * @return Mono<ProviderInfo> 更新后的渠道配置
     */
    public Mono<StandardOAuthConfigDtos.ProviderInfo> updateProvider(StandardOAuthConfigDtos.ProviderRequest request) {
        return Mono.defer(() -> {
            ProviderValues values = normalizedValues(request);
            return repository.findByProvider(values.provider())
                    .switchIfEmpty(Mono.error(providerNotFound()))
                    .flatMap(existing -> encryptSecret(values.clientSecret())
                            .flatMap(encryptedSecret -> repository.update(toRecord(values, encryptedSecret)))
                            .flatMap(rowsUpdated -> rowsUpdated == 0 ? Mono.error(providerNotFound()) : Mono.<Long>empty()))
                    .then(reload())
                    .then(Mono.fromSupplier(() -> providerInfo(values.provider())));
        });
    }

    /**
     * 删除渠道配置并刷新缓存。
     *
     * @param providerId String 渠道标识
     * @return Mono<Void> 删除完成信号
     */
    public Mono<Void> deleteProvider(String providerId) {
        return repository.findByProvider(providerId)
                .switchIfEmpty(Mono.error(providerNotFound()))
                .flatMap(existing -> repository.countBindings(providerId)
                        .flatMap(bindingCount -> bindingCount > 0
                                ? Mono.<Long>error(providerHasBindings())
                                : repository.delete(providerId)))
                .flatMap(rowsUpdated -> rowsUpdated == 0 ? Mono.<Void>error(providerNotFound()) : Mono.<Void>empty())
                .then(reload());
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
                .doOnNext(list -> configurations = List.copyOf(list))
                .then();
    }

    /**
     * 把数据库记录解密为运行时配置。
     *
     * @param record StandardOAuthProviderRecord 数据库记录
     * @return Mono<StandardOAuth2Configuration> 运行时配置
     */
    private Mono<StandardOAuth2Configuration> decryptConfiguration(PlatformStandardOAuthProviderRecords.StandardOAuthProviderRecord record) {
        return decryptSecret(record.getClientSecretEncrypted())
                .map(secret -> new StandardOAuth2Configuration(record.getProvider(), normalized(record.getDisplayName()),
                        Boolean.TRUE.equals(record.getEnabled()), normalized(record.getClientId()), secret,
                        normalized(record.getRedirectUri()), normalized(record.getAuthorizationUri()),
                        normalized(record.getTokenUri()), normalized(record.getUserInfoUri()), normalized(record.getScopes()),
                        defaultIfBlank(record.getClientAuthenticationMethod(), DEFAULT_CLIENT_AUTHENTICATION_METHOD),
                        defaultIfBlank(record.getUserNameAttribute(), DEFAULT_USER_NAME_ATTRIBUTE),
                        defaultIfBlank(record.getEmailAttribute(), DEFAULT_EMAIL_ATTRIBUTE),
                        defaultIfBlank(record.getNicknameAttribute(), DEFAULT_NICKNAME_ATTRIBUTE),
                        defaultIfBlank(record.getAvatarAttribute(), DEFAULT_AVATAR_ATTRIBUTE)));
    }

    /**
     * 把渠道运行时配置转换为后台展示信息。
     *
     * @param configuration StandardOAuth2Configuration 渠道运行时配置
     * @return ProviderInfo 渠道配置信息
     */
    private StandardOAuthConfigDtos.ProviderInfo providerInfo(StandardOAuth2Configuration configuration) {
        return new StandardOAuthConfigDtos.ProviderInfo(configuration.providerId(), configuration.displayName(),
                configuration.enabled(), configuration.clientId(), configuration.clientSecret(),
                configuration.redirectUri(), OAuth2ProviderCatalog.callbackPath(configuration.providerId()),
                configuration.authorizationUri(), configuration.tokenUri(), configuration.userInfoUri(),
                configuration.scopes(), configuration.clientAuthenticationMethod(), configuration.userNameAttribute(),
                configuration.emailAttribute(), configuration.nicknameAttribute(), configuration.avatarAttribute());
    }

    /**
     * 按渠道标识读取缓存中的配置并转换为后台展示信息。
     *
     * @param providerId String 渠道标识
     * @return ProviderInfo 渠道配置信息
     * @throws BusinessException 渠道不存在时抛出
     */
    private StandardOAuthConfigDtos.ProviderInfo providerInfo(String providerId) {
        StandardOAuth2Configuration configuration = find(providerId).orElseThrow(this::providerNotFound);
        return providerInfo(configuration);
    }

    /**
     * 规范化并校验请求中的渠道配置。
     *
     * @param request ProviderRequest 渠道配置请求
     * @return ProviderValues 规范化后的配置
     * @throws BusinessException 配置不合法时抛出
     */
    private ProviderValues normalizedValues(StandardOAuthConfigDtos.ProviderRequest request) {
        String providerId = normalized(request.provider());
        if (!PROVIDER_ID_PATTERN.matcher(providerId).matches() || OAuth2ProviderCatalog.find(providerId).isPresent()) {
            throw businessError(ErrorCode.PARAM_INVALID, "business.standardOAuthProviderIdIsInvalid");
        }
        String displayName = normalized(request.displayName());
        if (!StringUtils.hasText(displayName)) {
            throw businessError(ErrorCode.PARAM_MISSING, "business.standardOAuthDisplayNameIsRequired");
        }
        requireMaximumLength(displayName, 50, "business.standardOAuthDisplayNameIsTooLong");
        String clientId = normalized(request.clientId());
        String clientSecret = normalized(request.clientSecret());
        String redirectUri = normalized(request.redirectUri());
        String authorizationUri = normalized(request.authorizationUri());
        String tokenUri = normalized(request.tokenUri());
        String userInfoUri = normalized(request.userInfoUri());
        String scopes = normalizedScopes(request.scopes());
        String clientAuthenticationMethod = normalizedClientAuthenticationMethod(request.clientAuthenticationMethod());
        String userNameAttribute = defaultIfBlank(request.userNameAttribute(), DEFAULT_USER_NAME_ATTRIBUTE);
        String emailAttribute = defaultIfBlank(request.emailAttribute(), DEFAULT_EMAIL_ATTRIBUTE);
        String nicknameAttribute = defaultIfBlank(request.nicknameAttribute(), DEFAULT_NICKNAME_ATTRIBUTE);
        String avatarAttribute = defaultIfBlank(request.avatarAttribute(), DEFAULT_AVATAR_ATTRIBUTE);
        requireMaximumLength(clientId, 255, "business.oAuthClientIdIsTooLong");
        requireMaximumLength(clientSecret, 512, "business.oAuthClientSecretIsTooLong");
        requireMaximumLength(redirectUri, 512, "business.oAuthRedirectUriIsTooLong");
        requireMaximumLength(authorizationUri, 512, "business.standardOAuthEndpointIsTooLong");
        requireMaximumLength(tokenUri, 512, "business.standardOAuthEndpointIsTooLong");
        requireMaximumLength(userInfoUri, 512, "business.standardOAuthEndpointIsTooLong");
        requireMaximumLength(scopes, 255, "business.standardOAuthScopesAreTooLong");
        if (request.enabled()) {
            requireText(clientId, "business.oAuthClientIdIsRequired");
            requireText(clientSecret, "business.oAuthClientSecretIsRequired");
            requireText(redirectUri, "business.oAuthRedirectUriIsRequired");
            requireText(authorizationUri, "business.standardOAuthAuthorizationUriIsRequired");
            requireText(tokenUri, "business.standardOAuthTokenUriIsRequired");
            requireText(userInfoUri, "business.standardOAuthUserInfoUriIsRequired");
            requireText(scopes, "business.standardOAuthScopesIsRequired");
            requireText(userNameAttribute, "business.standardOAuthUserNameAttributeIsRequired");
            requireText(emailAttribute, "business.standardOAuthEmailAttributeIsRequired");
        }
        validateRedirectUri(providerId, redirectUri);
        validateEndpointUri(authorizationUri, "business.standardOAuthAuthorizationUriIsInvalid");
        validateEndpointUri(tokenUri, "business.standardOAuthTokenUriIsInvalid");
        validateEndpointUri(userInfoUri, "business.standardOAuthUserInfoUriIsInvalid");
        validateScopes(scopes);
        validateAttribute(userNameAttribute);
        validateAttribute(emailAttribute);
        validateAttribute(nicknameAttribute);
        validateAttribute(avatarAttribute);
        return new ProviderValues(providerId, displayName, request.enabled(), clientId, clientSecret, redirectUri,
                authorizationUri, tokenUri, userInfoUri, scopes, clientAuthenticationMethod, userNameAttribute,
                emailAttribute, nicknameAttribute, avatarAttribute);
    }

    /**
     * 校验回调地址必须是绝对 HTTP(S) 地址且路径与渠道回调路径一致。
     *
     * @param providerId String 渠道标识
     * @param value String 回调地址
     * @throws BusinessException 回调地址不合法时抛出
     */
    private void validateRedirectUri(String providerId, String value) {
        if (!StringUtils.hasText(value)) {
            return;
        }
        URI redirectUri;
        try {
            redirectUri = URI.create(value);
        } catch (IllegalArgumentException exception) {
            throw redirectUriInvalid(providerId);
        }
        String callbackPath = OAuth2ProviderCatalog.callbackPath(providerId);
        boolean supportedScheme = "https".equalsIgnoreCase(redirectUri.getScheme()) || "http".equalsIgnoreCase(redirectUri.getScheme());
        if (!supportedScheme || !StringUtils.hasText(redirectUri.getHost()) || !callbackPath.equals(redirectUri.getPath())
                || redirectUri.getQuery() != null || redirectUri.getFragment() != null) {
            throw redirectUriInvalid(providerId);
        }
    }

    /**
     * 校验端点地址必须是绝对 HTTP(S) 地址。
     *
     * @param value String 端点地址
     * @param messageKey String 错误消息键
     * @throws BusinessException 端点地址不合法时抛出
     */
    private void validateEndpointUri(String value, String messageKey) {
        if (!StringUtils.hasText(value)) {
            return;
        }
        URI uri;
        try {
            uri = URI.create(value);
        } catch (IllegalArgumentException exception) {
            throw businessError(ErrorCode.PARAM_INVALID, messageKey);
        }
        boolean supportedScheme = "https".equalsIgnoreCase(uri.getScheme()) || "http".equalsIgnoreCase(uri.getScheme());
        if (!supportedScheme || !StringUtils.hasText(uri.getHost())) {
            throw businessError(ErrorCode.PARAM_INVALID, messageKey);
        }
    }

    /**
     * 校验授权范围。
     *
     * @param scopes String 规范化后的授权范围
     * @throws BusinessException 包含 openid 时抛出
     */
    private void validateScopes(String scopes) {
        if (!StringUtils.hasText(scopes)) {
            return;
        }
        if (Arrays.stream(scopes.split("\\s+")).anyMatch("openid"::equalsIgnoreCase)) {
            throw businessError(ErrorCode.PARAM_INVALID, "business.standardOAuthScopesMustNotContainOpenid");
        }
    }

    /**
     * 校验用户信息字段名。
     *
     * @param attribute String 字段名
     * @throws BusinessException 字段名不合法时抛出
     */
    private void validateAttribute(String attribute) {
        if (!StringUtils.hasText(attribute)) {
            return;
        }
        if (!ATTRIBUTE_PATTERN.matcher(attribute).matches()) {
            throw businessError(ErrorCode.PARAM_INVALID, "business.standardOAuthAttributeIsInvalid");
        }
    }

    /**
     * 规范化授权范围，去重并使用空格连接。
     *
     * @param value String 原始授权范围
     * @return String 规范化后的授权范围
     */
    private String normalizedScopes(String value) {
        String normalized = normalized(value);
        if (!StringUtils.hasText(normalized)) {
            return "";
        }
        return Arrays.stream(normalized.split("[\\s,]+"))
                .filter(StringUtils::hasText)
                .distinct()
                .collect(Collectors.joining(" "));
    }

    /**
     * 规范化客户端认证方式。
     *
     * @param value String 原始认证方式
     * @return String 规范化后的认证方式
     * @throws BusinessException 不支持的方式时抛出
     */
    private String normalizedClientAuthenticationMethod(String value) {
        String normalized = normalized(value).toLowerCase(Locale.ROOT);
        if (!StringUtils.hasText(normalized)) {
            return DEFAULT_CLIENT_AUTHENTICATION_METHOD;
        }
        if (!DEFAULT_CLIENT_AUTHENTICATION_METHOD.equals(normalized) && !CLIENT_SECRET_POST.equals(normalized)) {
            throw businessError(ErrorCode.PARAM_INVALID, "business.standardOAuthClientAuthenticationMethodIsInvalid");
        }
        return normalized;
    }

    /**
     * 把规范化配置转换为持久化记录。
     *
     * @param values ProviderValues 规范化配置
     * @param encryptedSecret String 加密后的客户端密钥
     * @return StandardOAuthProviderRecord 持久化记录
     */
    private PlatformStandardOAuthProviderRecords.StandardOAuthProviderRecord toRecord(ProviderValues values, String encryptedSecret) {
        PlatformStandardOAuthProviderRecords.StandardOAuthProviderRecord record = new PlatformStandardOAuthProviderRecords.StandardOAuthProviderRecord();
        record.setProvider(values.provider());
        record.setDisplayName(values.displayName());
        record.setEnabled(values.enabled());
        record.setClientId(values.clientId());
        record.setClientSecretEncrypted(encryptedSecret);
        record.setRedirectUri(values.redirectUri());
        record.setAuthorizationUri(values.authorizationUri());
        record.setTokenUri(values.tokenUri());
        record.setUserInfoUri(values.userInfoUri());
        record.setScopes(values.scopes());
        record.setClientAuthenticationMethod(values.clientAuthenticationMethod());
        record.setUserNameAttribute(values.userNameAttribute());
        record.setEmailAttribute(values.emailAttribute());
        record.setNicknameAttribute(values.nicknameAttribute());
        record.setAvatarAttribute(values.avatarAttribute());
        return record;
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
            throw businessError(ErrorCode.PARAM_MISSING, messageKey);
        }
    }

    /**
     * 校验文本长度。
     *
     * @param value String 配置值
     * @param maximumLength int 最大长度
     * @param messageKey String 消息键
     * @throws BusinessException 超过长度时抛出
     */
    private void requireMaximumLength(String value, int maximumLength, String messageKey) {
        if (value != null && value.length() > maximumLength) {
            throw businessError(ErrorCode.PARAM_INVALID, messageKey);
        }
    }

    /**
     * 创建回调地址错误。
     *
     * @param providerId String 渠道标识
     * @return BusinessException 回调地址错误
     */
    private BusinessException redirectUriInvalid(String providerId) {
        return new BusinessException(ErrorCode.PARAM_INVALID,
                SystemMessage.of("business.oAuthRedirectUriInvalid", OAuth2ProviderCatalog.callbackPath(providerId)));
    }

    /**
     * 创建渠道不存在错误。
     *
     * @return BusinessException 渠道不存在错误
     */
    private BusinessException providerNotFound() {
        return businessError(ErrorCode.RESOURCE_NOT_FOUND, "business.standardOAuthProviderNotFound");
    }

    /**
     * 创建渠道已存在错误。
     *
     * @return BusinessException 渠道已存在错误
     */
    private BusinessException providerAlreadyExists() {
        return businessError(ErrorCode.PARAM_INVALID, "business.standardOAuthProviderAlreadyExists");
    }

    /**
     * 创建渠道存在绑定错误。
     *
     * @return BusinessException 渠道存在绑定错误
     */
    private BusinessException providerHasBindings() {
        return businessError(ErrorCode.PARAM_INVALID, "business.standardOAuthProviderHasBindings");
    }

    /**
     * 创建业务异常。
     *
     * @param errorCode int 错误码
     * @param messageKey String 消息键
     * @return BusinessException 业务异常
     */
    private BusinessException businessError(int errorCode, String messageKey) {
        return new BusinessException(errorCode, SystemMessage.of(messageKey));
    }

    /**
     * 加密客户端密钥。
     *
     * @param data String 客户端密钥明文
     * @return Mono<String> 加密后的密钥
     */
    private Mono<String> encryptSecret(String data) {
        if (!StringUtils.hasText(data)) {
            return Mono.just("");
        }
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

    /**
     * 返回非空文本或默认值。
     *
     * @param value String 原始文本
     * @param defaultValue String 默认值
     * @return String 非空文本或默认值
     */
    private String defaultIfBlank(String value, String defaultValue) {
        String normalized = normalized(value);
        return StringUtils.hasText(normalized) ? normalized : defaultValue;
    }

    /**
     * 校验并保存的渠道配置字段。
     *
     * @param provider 渠道标识
     * @param displayName 渠道名称
     * @param enabled 是否启用
     * @param clientId 客户端 ID
     * @param clientSecret 客户端密钥
     * @param redirectUri 回调地址
     * @param authorizationUri 授权端点
     * @param tokenUri 令牌端点
     * @param userInfoUri 用户信息端点
     * @param scopes 授权范围
     * @param clientAuthenticationMethod 客户端认证方式
     * @param userNameAttribute 用户标识字段名
     * @param emailAttribute 邮箱字段名
     * @param nicknameAttribute 昵称字段名
     * @param avatarAttribute 头像字段名
     */
    private record ProviderValues(String provider, String displayName, boolean enabled, String clientId,
                                  String clientSecret, String redirectUri, String authorizationUri, String tokenUri,
                                  String userInfoUri, String scopes, String clientAuthenticationMethod,
                                  String userNameAttribute, String emailAttribute, String nicknameAttribute,
                                  String avatarAttribute) {
    }
}
