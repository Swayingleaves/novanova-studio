package com.novanovastudio.storage;

import com.novanovastudio.common.SystemMessage;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.dto.PersistenceDtos;
import java.io.InputStream;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Function;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.CollectionUtils;
import org.springframework.util.StringUtils;

/**
 * @title        ObjectStorageService.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  对象存储服务
 * @createTime   2026-06-24 11:44:00
 */
@Service
public class ObjectStorageService {

    /** 私有桶探测结果缓存时间，避免每次上传分享副本或原文都重新上传探针。 */
    private static final Duration PRIVACY_CHECK_TTL = Duration.ofMinutes(5);

    /** 私有桶探测结果缓存，按存储配置区分。 */
    private final Map<String, PrivacyCheck> privacyChecks = new ConcurrentHashMap<>();

    /** 服务商适配器映射。 */
    private final Map<String, ObjectStorageProviderAdapter> providerAdapters;

    /** 应用配置，测试环境允许为空。 */
    private final NovanovaProperties properties;

    /**
     * 创建对象存储服务。
     *
     * @param providerAdapters List<ObjectStorageProviderAdapter> 服务商适配器列表
     */
    public ObjectStorageService(List<ObjectStorageProviderAdapter> providerAdapters) {
        this(providerAdapters, null);
    }

    /**
     * 创建对象存储服务。
     *
     * @param providerAdapters List<ObjectStorageProviderAdapter> 服务商适配器列表
     * @param properties NovanovaProperties 应用配置
     */
    @Autowired
    public ObjectStorageService(List<ObjectStorageProviderAdapter> providerAdapters, NovanovaProperties properties) {
        if (CollectionUtils.isEmpty(providerAdapters)) {
            throw new IllegalStateException("对象存储服务商适配器不能为空");
        }
        this.providerAdapters = providerAdapters.stream().collect(java.util.stream.Collectors.toUnmodifiableMap(ObjectStorageProviderAdapter::provider, Function.identity()));
        this.properties = properties;
    }

    /**
     * 上传对象到指定对象存储服务商
     *
     * @param config ObjectStorageConfig 对象存储配置
     * @param key String 对象Key
     * @param inputStream InputStream 文件流
     * @param contentLength long 文件大小
     * @param mimeType String MIME类型
     * @return String 公开访问URL
     * @throws BusinessException 服务商不受支持、配置不合法或上传失败时抛出
     */
    public String putObject(PersistenceDtos.ObjectStorageConfig config, String key, InputStream inputStream, long contentLength, String mimeType) {
        return providerAdapter(config).putObject(config, key, inputStream, contentLength, mimeType);
    }

    /**
     * 确认默认存储桶拒绝匿名读取。
     * <p>
     * 探测结果短时缓存，配置变更后由管理入口清空缓存重新验证。
     *
     * @param config ObjectStorageConfig 对象存储配置
     * @return boolean 是否已确认匿名读取被拒绝
     */
    public boolean verifyPrivateBucket(PersistenceDtos.ObjectStorageConfig config) {
        String cacheKey = config.id() == null || config.id().isBlank() ? config.provider() + "|" + config.bucket() : config.id();
        PrivacyCheck cached = privacyChecks.get(cacheKey);
        if (cached != null && cached.checkedAt().plus(PRIVACY_CHECK_TTL).isAfter(Instant.now())) {
            return cached.privateRead();
        }
        boolean privateRead = providerAdapter(config).verifyPrivateBucket(config);
        privacyChecks.put(cacheKey, new PrivacyCheck(privateRead, Instant.now()));
        if (!privateRead && (properties == null || !properties.getObjectStorage().isRequirePrivateBucket())) {
            org.slf4j.LoggerFactory.getLogger(ObjectStorageService.class).warn(
                    "存储桶仍允许匿名读取，私有内容保护已降级为告警模式；切换为私有读写后请设置 STORAGE_REQUIRE_PRIVATE_BUCKET=true");
            return true;
        }
        return privateRead;
    }

    /**
     * 清空私有桶探测缓存，配置新增、修改、删除或切换默认时调用。
     */
    public void invalidatePrivacyChecks() {
        privacyChecks.clear();
    }

    /**
     * 上传不可公开访问的私有对象。
     *
     * @param config ObjectStorageConfig 对象存储配置
     * @param key String 对象键
     * @param file Path 本地文件
     */
    public void putPrivateObject(PersistenceDtos.ObjectStorageConfig config, String key, Path file) {
        providerAdapter(config).putPrivateObject(config, key, file);
    }

    /** @param config 存储配置 @param key 专用对象键 @param file 临时文件 @param mimeType 已确认的媒体类型 */
    public void putPrivateObject(PersistenceDtos.ObjectStorageConfig config, String key, Path file, String mimeType) {
        providerAdapter(config).putPrivateObject(config, key, file, mimeType);
    }

    /**
     * 下载私有对象到本地路径。
     *
     * @param config ObjectStorageConfig 对象存储配置
     * @param key String 对象键
     * @param target Path 目标路径
     */
    public void downloadPrivateObject(PersistenceDtos.ObjectStorageConfig config, String key, Path target) {
        providerAdapter(config).downloadPrivateObject(config, key, target);
    }

    /**
     * 删除私有对象。
     *
     * @param config ObjectStorageConfig 对象存储配置
     * @param key String 对象键
     */
    public void deletePrivateObject(PersistenceDtos.ObjectStorageConfig config, String key) {
        providerAdapter(config).deletePrivateObject(config, key);
    }

    /**
     * @param config 原对象存储配置
     * @param key 对象键
     * @param fileName 原始文件名
     * @param mimeType 文件媒体类型
     * @param download 是否作为附件下载
     * @param expiresAt 到期时间
     * @return 由原存储提供方签名的只读地址
     */
    public String createReadUrl(PersistenceDtos.ObjectStorageConfig config, String key, String fileName, String mimeType, boolean download, java.time.Instant expiresAt) {
        return providerAdapter(config).createReadUrl(config, key, fileName, mimeType, download, expiresAt);
    }

    /**
     * 按指定长边签发图片读取地址。服务商支持读取时缩放则返回小图地址，否则返回原图地址。
     *
     * @param config 原对象存储配置
     * @param key 对象键
     * @param fileName 原始文件名
     * @param mimeType 文件媒体类型
     * @param download 是否作为附件下载
     * @param expiresAt 到期时间
     * @param edge 缩放后的长边像素
     * @return 缩放后或原图的临时只读地址
     */
    public String createThumbnailReadUrl(PersistenceDtos.ObjectStorageConfig config, String key, String fileName, String mimeType, boolean download, java.time.Instant expiresAt, int edge) {
        String thumbnail = providerAdapter(config).createThumbnailReadUrl(config, key, fileName, mimeType, download, expiresAt, edge);
        if (StringUtils.hasText(thumbnail)) {
            return thumbnail;
        }
        return createReadUrl(config, key, fileName, mimeType, download, expiresAt);
    }

    /**
     * 校验对象存储配置。
     *
     * @param config ObjectStorageConfig 对象存储配置
     * @throws BusinessException 服务商不受支持或配置不合法时抛出
     */
    public void validate(PersistenceDtos.ObjectStorageConfig config) {
        providerAdapter(config).validate(config);
    }

    /**
     * 判断服务商是否受支持。
     *
     * @param provider String 服务商标识
     * @return boolean 是否受支持
     */
    public boolean supports(String provider) {
        return providerAdapters.containsKey(provider);
    }

    /**
     * 获取指定配置的服务商适配器。
     *
     * @param config ObjectStorageConfig 对象存储配置
     * @return ObjectStorageProviderAdapter 服务商适配器
     */
    private ObjectStorageProviderAdapter providerAdapter(PersistenceDtos.ObjectStorageConfig config) {
        ObjectStorageProviderAdapter adapter = config == null ? null : providerAdapters.get(config.provider());
        if (adapter == null) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.unsupportedObjectStorageProvider"));
        }
        return adapter;
    }

    /**
     * 私有桶探测结果。
     *
     * @param privateRead boolean 是否拒绝匿名读取
     * @param checkedAt Instant 探测时间
     */
    private record PrivacyCheck(boolean privateRead, Instant checkedAt) {
    }
}
