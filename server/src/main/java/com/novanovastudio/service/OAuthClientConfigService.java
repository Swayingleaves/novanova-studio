package com.novanovastudio.service;

import com.alibaba.fastjson2.JSON;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.common.SensitiveDataCrypto;
import com.novanovastudio.common.SystemMessage;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.dto.OAuthClientConfigDtos;
import com.novanovastudio.entity.PersistenceRecords;
import com.novanovastudio.entity.PlatformOAuthClientRecords;
import com.novanovastudio.repository.PersistenceRepository;
import com.novanovastudio.repository.PlatformOAuthClientRepository;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.security.oauthserver.OAuthServerProtocol;
import com.novanovastudio.storage.MediaAccessService;
import java.security.SecureRandom;
import java.util.List;
import java.util.Locale;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

/**
 * 管理后台对外 OAuth2 授权客户端配置。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-09 18:40
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class OAuthClientConfigService {

    /** 生成客户端标识时的最大重试次数 */
    private static final int CLIENT_ID_ATTEMPTS = 3;

    /** 安全随机数生成器 */
    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    /** 授权客户端仓储 */
    private final PlatformOAuthClientRepository repository;

    /** 媒体记录，用于确认上传的图标属于当前管理员 */
    private final PersistenceRepository persistenceRepository;

    /** 图标读地址签发 */
    private final MediaAccessService mediaAccessService;

    /** 当前登录用户 */
    private final CurrentUserProvider currentUserProvider;

    /** 服务配置 */
    private final NovanovaProperties properties;

    /**
     * 查询全部授权客户端。
     *
     * @return Mono<ClientListResponse> 客户端列表
     */
    public Mono<OAuthClientConfigDtos.ClientListResponse> listClients() {
        return repository.findAll()
                .concatMap(this::toInfo)
                .collectList()
                .map(OAuthClientConfigDtos.ClientListResponse::new);
    }

    /**
     * 创建授权客户端并生成标识和密钥。
     *
     * @param request CreateClientRequest 创建请求
     * @return Mono<ClientInfo> 创建后的客户端
     */
    public Mono<OAuthClientConfigDtos.ClientInfo> createClient(OAuthClientConfigDtos.CreateClientRequest request) {
        List<String> redirectUris = OAuthServerProtocol.normalizeRedirectUris(request.redirectUris());
        String displayName = request.displayName().trim();
        String content = displayContent(request.displayContent());
        return currentUserProvider.currentUserId()
                .flatMap(userId -> resolveLogo(userId, null, request.logoStorageKey()))
                .flatMap(logo -> insertClient(displayName, request.enabled(), redirectUris, logo, content, 1))
                .doOnSuccess(client -> log.info("创建对外授权客户端: clientId={}", client.clientId()));
    }

    /**
     * 更新名称、启用状态、回调地址和授权页展示。
     *
     * @param request UpdateClientRequest 更新请求
     * @return Mono<ClientInfo> 更新后的客户端
     */
    public Mono<OAuthClientConfigDtos.ClientInfo> updateClient(OAuthClientConfigDtos.UpdateClientRequest request) {
        OAuthServerProtocol.requireClientId(request.clientId());
        List<String> redirectUris = OAuthServerProtocol.normalizeRedirectUris(request.redirectUris());
        return repository.findByClientId(request.clientId())
                .switchIfEmpty(Mono.error(clientNotFound()))
                .flatMap(existing -> currentUserProvider.currentUserId()
                        .flatMap(userId -> resolveLogo(userId, existing, request.logoStorageKey()))
                        .flatMap(logo -> {
                            existing.setDisplayName(request.displayName().trim());
                            existing.setEnabled(request.enabled());
                            existing.setRedirectUris(JSON.toJSONString(redirectUris));
                            existing.setLogoStorageKey(logo.storageKey());
                            existing.setLogoStorageId(logo.storageId());
                            existing.setLogoObjectKey(logo.objectKey());
                            existing.setLogoMimeType(logo.mimeType());
                            existing.setDisplayContent(displayContent(request.displayContent()));
                            return repository.update(existing);
                        }))
                .flatMap(rowsUpdated -> rowsUpdated == 0 ? Mono.error(clientNotFound()) : Mono.empty())
                .then(requireClient(request.clientId()))
                .doOnSuccess(client -> log.info("更新对外授权客户端: clientId={}", client.clientId()));
    }

    /**
     * 重新生成客户端密钥。
     *
     * @param clientId String 客户端标识
     * @return Mono<ClientInfo> 更新后的客户端
     */
    public Mono<OAuthClientConfigDtos.ClientInfo> resetSecret(String clientId) {
        OAuthServerProtocol.requireClientId(clientId);
        return repository.findByClientId(clientId)
                .switchIfEmpty(Mono.error(clientNotFound()))
                .then(encryptSecret(newSecret()))
                .flatMap(encrypted -> repository.updateSecret(clientId, encrypted))
                .flatMap(rowsUpdated -> rowsUpdated == 0 ? Mono.error(clientNotFound()) : Mono.empty())
                .then(requireClient(clientId))
                .doOnSuccess(client -> log.info("重置对外授权客户端密钥: clientId={}", client.clientId()));
    }

    /**
     * 删除授权客户端。
     *
     * @param clientId String 客户端标识
     * @return Mono<Void> 删除完成信号
     */
    public Mono<Void> deleteClient(String clientId) {
        OAuthServerProtocol.requireClientId(clientId);
        return repository.delete(clientId)
                .flatMap(rowsUpdated -> rowsUpdated == 0 ? Mono.error(clientNotFound()) : Mono.empty())
                .doOnSuccess(ignored -> log.info("删除对外授权客户端: clientId={}", clientId))
                .then();
    }

    /**
     * 按主键插入，标识冲突时换一个新标识重试。
     *
     * @param displayName String 应用名称
     * @param enabled boolean 是否启用
     * @param redirectUris List<String> 回调地址
     * @param logo Logo 应用图标
     * @param displayContent String 授权页展示文字
     * @param attempt int 当前尝试次数
     * @return Mono<ClientInfo> 创建后的客户端
     */
    private Mono<OAuthClientConfigDtos.ClientInfo> insertClient(String displayName, boolean enabled, List<String> redirectUris,
                                                                Logo logo, String displayContent, int attempt) {
        String clientId = newClientId();
        return encryptSecret(newSecret())
                .flatMap(encryptedSecret -> {
                    PlatformOAuthClientRecords.OAuthClientRecord record = new PlatformOAuthClientRecords.OAuthClientRecord();
                    record.setClientId(clientId);
                    record.setDisplayName(displayName);
                    record.setEnabled(enabled);
                    record.setClientSecretEncrypted(encryptedSecret);
                    record.setRedirectUris(JSON.toJSONString(redirectUris));
                    record.setLogoStorageKey(logo.storageKey());
                    record.setLogoStorageId(logo.storageId());
                    record.setLogoObjectKey(logo.objectKey());
                    record.setLogoMimeType(logo.mimeType());
                    record.setDisplayContent(displayContent);
                    return repository.insert(record);
                })
                .then(requireClient(clientId))
                .onErrorResume(DuplicateKeyException.class, exception -> attempt >= CLIENT_ID_ATTEMPTS
                        ? Mono.error(new BusinessException(ErrorCode.SYSTEM_ERROR, SystemMessage.of("business.oauthCredentialSaveFailed")))
                        : insertClient(displayName, enabled, redirectUris, logo, displayContent, attempt + 1));
    }

    /**
     * 读取并解密一个客户端。
     *
     * @param clientId String 客户端标识
     * @return Mono<ClientInfo> 客户端信息
     */
    private Mono<OAuthClientConfigDtos.ClientInfo> requireClient(String clientId) {
        return repository.findByClientId(clientId)
                .switchIfEmpty(Mono.error(clientNotFound()))
                .flatMap(this::toInfo);
    }

    /**
     * 解密密钥并组装管理端展示对象。
     *
     * @param record OAuthClientRecord 数据库记录
     * @return Mono<ClientInfo> 客户端信息
     */
    private Mono<OAuthClientConfigDtos.ClientInfo> toInfo(PlatformOAuthClientRecords.OAuthClientRecord record) {
        return decryptSecret(record.getClientSecretEncrypted())
                .flatMap(secret -> signedLogoUrl(record)
                        .map(logoUrl -> new OAuthClientConfigDtos.ClientInfo(
                                record.getClientId(),
                                record.getDisplayName(),
                                Boolean.TRUE.equals(record.getEnabled()),
                                secret,
                                readRedirectUris(record.getRedirectUris()),
                                logoUrl,
                                text(record.getLogoStorageKey()),
                                text(record.getDisplayContent()))));
    }

    /**
     * 签发应用图标读地址。没有图标或媒体已删除时返回空字符串。
     *
     * @param record OAuthClientRecord 授权客户端
     * @return Mono<String> 图标读地址
     */
    public Mono<String> signedLogoUrl(PlatformOAuthClientRecords.OAuthClientRecord record) {
        if (!StringUtils.hasText(record.getLogoStorageId()) || !StringUtils.hasText(record.getLogoObjectKey())) {
            return Mono.just("");
        }
        String fileName = record.getLogoObjectKey().substring(record.getLogoObjectKey().lastIndexOf('/') + 1);
        return mediaAccessService.signObject(record.getLogoStorageId(), record.getLogoObjectKey(), fileName, record.getLogoMimeType(), MediaAccessService.Purpose.PREVIEW, false)
                .map(access -> text(access.url()))
                .defaultIfEmpty("")
                .onErrorResume(error -> {
                    log.error("签发对外授权应用图标失败: clientId={}", record.getClientId(), error);
                    return Mono.just("");
                });
    }

    /**
     * 确认图标属于当前管理员且是图片。沿用原图标时不要求当前管理员是上传者。
     *
     * @param userId Long 当前管理员
     * @param existing OAuthClientRecord 更新前的客户端，新建时为空
     * @param storageKey String 媒体存储键
     * @return Mono<Logo> 要保存的图标
     */
    private Mono<Logo> resolveLogo(Long userId, PlatformOAuthClientRecords.OAuthClientRecord existing, String storageKey) {
        String key = storageKey == null ? "" : storageKey.trim();
        if (!StringUtils.hasText(key)) {
            return Mono.just(Logo.empty());
        }
        if (existing != null && key.equals(existing.getLogoStorageKey()) && StringUtils.hasText(existing.getLogoObjectKey())) {
            return Mono.just(new Logo(key, existing.getLogoStorageId(), existing.getLogoObjectKey(), existing.getLogoMimeType()));
        }
        return persistenceRepository.getMedia(userId, key)
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.oauthClientLogoNotFound"))))
                .flatMap(this::requireImage)
                .map(media -> new Logo(key, media.getObjectStorageConfigId(), media.getObjectStorageKey(), media.getMimeType()));
    }

    /**
     * 拒绝非图片媒体作为应用图标。
     *
     * @param media MediaFileRecord 媒体记录
     * @return Mono<MediaFileRecord> 图片媒体
     */
    private Mono<PersistenceRecords.MediaFileRecord> requireImage(PersistenceRecords.MediaFileRecord media) {
        boolean image = "image".equals(media.getKind())
                && (!StringUtils.hasText(media.getMimeType()) || media.getMimeType().toLowerCase(Locale.ROOT).startsWith("image/"));
        if (!image) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.oauthClientLogoMustBeImage")));
        }
        if (!StringUtils.hasText(media.getObjectStorageConfigId()) || !StringUtils.hasText(media.getObjectStorageKey())) {
            return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, SystemMessage.of("business.oauthClientLogoNotStored")));
        }
        return Mono.just(media);
    }

    /**
     * 去掉展示文字两端空白，未填写时保存为空。
     *
     * @param value String 原始展示文字
     * @return String 可保存的展示文字
     */
    private String displayContent(String value) {
        if (!StringUtils.hasText(value)) {
            return null;
        }
        return value.trim();
    }

    /**
     * 把空值转成接口里的空字符串。
     *
     * @param value String 原始文本
     * @return String 非空文本
     */
    private String text(String value) {
        return value == null ? "" : value;
    }

    /**
     * 解析回调地址 JSON。损坏时返回空列表，授权匹配会失败。
     *
     * @param redirectUris String JSON 数组
     * @return List<String> 回调地址
     */
    private List<String> readRedirectUris(String redirectUris) {
        if (!StringUtils.hasText(redirectUris)) {
            return List.of();
        }
        try {
            List<String> values = JSON.parseArray(redirectUris, String.class);
            return values == null ? List.of() : List.copyOf(values);
        } catch (RuntimeException exception) {
            log.error("对外授权客户端回调地址无法解析");
            return List.of();
        }
    }

    /**
     * 生成客户端标识。
     *
     * @return String 客户端标识
     */
    private String newClientId() {
        byte[] bytes = new byte[16];
        SECURE_RANDOM.nextBytes(bytes);
        return "nv" + java.util.HexFormat.of().formatHex(bytes);
    }

    /**
     * 生成客户端密钥。
     *
     * @return String 客户端密钥
     */
    private String newSecret() {
        byte[] bytes = new byte[32];
        SECURE_RANDOM.nextBytes(bytes);
        return java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    /**
     * 加密客户端密钥。
     *
     * @param secret String 密钥明文
     * @return Mono<String> 密文
     */
    private Mono<String> encryptSecret(String secret) {
        return Mono.fromCallable(() -> SensitiveDataCrypto.encrypt(secret, properties.getApp().getSecretKey()))
                .subscribeOn(Schedulers.boundedElastic())
                .onErrorMap(exception -> exception instanceof BusinessException businessException ? businessException
                        : new BusinessException(ErrorCode.SYSTEM_ERROR, SystemMessage.of("business.failedToEncryptSensitiveConfiguration", exception.getMessage())));
    }

    /**
     * 解密客户端密钥。
     *
     * @param encrypted String 密文
     * @return Mono<String> 密钥明文
     */
    private Mono<String> decryptSecret(String encrypted) {
        if (!StringUtils.hasText(encrypted)) {
            return Mono.just("");
        }
        return Mono.fromCallable(() -> SensitiveDataCrypto.decrypt(encrypted, properties.getApp().getSecretKey()))
                .subscribeOn(Schedulers.boundedElastic())
                .onErrorMap(exception -> exception instanceof BusinessException businessException ? businessException
                        : new BusinessException(ErrorCode.SYSTEM_ERROR, SystemMessage.of("business.failedToDecryptSensitiveData", exception.getMessage())));
    }

    /**
     * 创建客户端不存在错误。
     *
     * @return BusinessException 客户端不存在
     */
    private BusinessException clientNotFound() {
        return new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, SystemMessage.of("business.oauthClientNotFound"));
    }

    /**
     * 要写入客户端的应用图标。
     *
     * @param storageKey 媒体存储键，未配置时为空
     * @param storageId 对象存储配置标识，未配置时为空
     * @param objectKey 对象键，未配置时为空
     * @param mimeType 媒体类型，未配置时为空
     */
    private record Logo(String storageKey, String storageId, String objectKey, String mimeType) {

        /**
         * 未配置图标。
         *
         * @return Logo 空图标
         */
        private static Logo empty() {
            return new Logo(null, null, null, null);
        }
    }
}
