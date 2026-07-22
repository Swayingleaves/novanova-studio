package com.novanovastudio.storage;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.PersistenceDtos;
import java.io.InputStream;
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
            throw new BusinessException(ErrorCode.PARAM_INVALID, "对象存储服务商不受支持");
        }
        return adapter;
    }
}
