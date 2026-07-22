package com.novanovastudio.storage;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.PersistenceDtos;
import com.qiniu.common.QiniuException;
import com.qiniu.storage.Configuration;
import com.qiniu.storage.Region;
import com.qiniu.storage.UploadManager;
import com.qiniu.util.Auth;
import java.io.InputStream;
import java.util.Set;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

/**
 * 七牛云Kodo对象存储适配器。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-07-19 00:00
 */
@Slf4j
@Component
public class QiniuKodoObjectStorageProviderAdapter implements ObjectStorageProviderAdapter {

    /** 七牛云Kodo服务商标识。 */
    public static final String PROVIDER = "qiniuKodo";

    /** 已开放的七牛云区域ID。 */
    private static final Set<String> SUPPORTED_REGION_IDS = Set.of("z0", "cn-east-2", "z1", "z2", "na0", "as0");

    /**
     * 获取七牛云Kodo服务商标识。
     *
     * @return String 七牛云Kodo服务商标识
     */
    @Override
    public String provider() {
        return PROVIDER;
    }

    /**
     * 校验七牛云Kodo配置。
     *
     * @param config ObjectStorageConfig 对象存储配置
     * @throws BusinessException 配置不完整、区域或公开访问地址不合法时抛出
     */
    @Override
    public void validate(PersistenceDtos.ObjectStorageConfig config) {
        ObjectStorageUrlBuilder.requireText(config.accessKey(), "七牛云Kodo AccessKey");
        ObjectStorageUrlBuilder.requireText(config.secretKey(), "七牛云Kodo SecretKey");
        ObjectStorageUrlBuilder.requireText(config.bucket(), "七牛云Kodo Bucket");
        ObjectStorageUrlBuilder.requireText(config.region(), "七牛云Kodo区域ID");
        if (!SUPPORTED_REGION_IDS.contains(config.region().trim())) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "七牛云Kodo区域ID不受支持");
        }
        ObjectStorageUrlBuilder.requireHttpUrl(config.publicBaseUrl(), "七牛云Kodo公开访问地址");
    }

    /**
     * 上传对象到七牛云Kodo。
     *
     * @param config ObjectStorageConfig 对象存储配置
     * @param key String 对象键
     * @param inputStream InputStream 文件流
     * @param contentLength long 文件大小
     * @param mimeType String MIME类型
     * @return String 公开访问地址
     * @throws BusinessException 上传失败或配置不合法时抛出
     */
    @Override
    public String putObject(PersistenceDtos.ObjectStorageConfig config, String key, InputStream inputStream, long contentLength, String mimeType) {
        validate(config);
        try {
            Auth auth = Auth.create(config.accessKey().trim(), config.secretKey().trim());
            UploadManager uploadManager = new UploadManager(Configuration.create(Region.createWithRegionId(config.region().trim())));
            uploadManager.put(inputStream, contentLength, key, auth.uploadToken(config.bucket().trim()), null, mimeType, false);
            return ObjectStorageUrlBuilder.buildPublicUrl(config.publicBaseUrl(), key);
        } catch (QiniuException exception) {
            log.error("上传七牛云Kodo失败: bucket={}, region={}, key={}", config.bucket(), config.region(), key, exception);
            throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "上传七牛云Kodo失败: " + exception.getMessage());
        }
    }
}
