package com.novanovastudio.storage;

import com.novanovastudio.common.SystemMessage;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.PersistenceDtos;
import java.io.InputStream;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import org.springframework.stereotype.Service;
import org.springframework.util.CollectionUtils;

/**
 * @title        ObjectStorageService.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  对象存储服务
 * @createTime   2026-06-24 11:44:00
 */
@Service
public class ObjectStorageService {

    /** 服务商适配器映射。 */
    private final Map<String, ObjectStorageProviderAdapter> providerAdapters;

    /**
     * 创建对象存储服务。
     *
     * @param providerAdapters List<ObjectStorageProviderAdapter> 服务商适配器列表
     */
    public ObjectStorageService(List<ObjectStorageProviderAdapter> providerAdapters) {
        if (CollectionUtils.isEmpty(providerAdapters)) {
            throw new IllegalStateException("对象存储服务商适配器不能为空");
        }
        this.providerAdapters = providerAdapters.stream().collect(java.util.stream.Collectors.toUnmodifiableMap(ObjectStorageProviderAdapter::provider, Function.identity()));
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
     *
     * @param config ObjectStorageConfig 对象存储配置
     * @return boolean 是否已确认匿名读取被拒绝
     */
    public boolean verifyPrivateBucket(PersistenceDtos.ObjectStorageConfig config) {
        return providerAdapter(config).verifyPrivateBucket(config);
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
}
