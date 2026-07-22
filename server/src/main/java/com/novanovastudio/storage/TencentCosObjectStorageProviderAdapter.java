package com.novanovastudio.storage;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.PersistenceDtos;
import com.qcloud.cos.COSClient;
import com.qcloud.cos.ClientConfig;
import com.qcloud.cos.auth.BasicCOSCredentials;
import com.qcloud.cos.exception.CosClientException;
import com.qcloud.cos.model.ObjectMetadata;
import com.qcloud.cos.region.Region;
import java.io.InputStream;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

/**
 * 腾讯云COS对象存储适配器。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-07-19 00:00
 */
@Slf4j
@Component
public class TencentCosObjectStorageProviderAdapter implements ObjectStorageProviderAdapter {

    /** 腾讯云COS服务商标识。 */
    public static final String PROVIDER = "tencentCos";

    /**
     * 获取腾讯云COS服务商标识。
     *
     * @return String 腾讯云COS服务商标识
     */
    @Override
    public String provider() {
        return PROVIDER;
    }

    /**
     * 校验腾讯云COS配置。
     *
     * @param config ObjectStorageConfig 对象存储配置
     * @throws BusinessException 配置不完整或公开访问地址不合法时抛出
     */
    @Override
    public void validate(PersistenceDtos.ObjectStorageConfig config) {
        ObjectStorageUrlBuilder.requireText(config.accessKey(), "腾讯云COS SecretId");
        ObjectStorageUrlBuilder.requireText(config.secretKey(), "腾讯云COS SecretKey");
        ObjectStorageUrlBuilder.requireText(config.bucket(), "腾讯云COS Bucket");
        ObjectStorageUrlBuilder.requireText(config.region(), "腾讯云COS Region");
        if (StringUtils.hasText(config.publicBaseUrl())) {
            ObjectStorageUrlBuilder.requireHttpUrl(config.publicBaseUrl(), "腾讯云COS公开访问地址");
        }
    }

    /**
     * 上传对象到腾讯云COS。
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
        COSClient client = new COSClient(new BasicCOSCredentials(config.accessKey().trim(), config.secretKey().trim()), new ClientConfig(new Region(config.region().trim())));
        try {
            ObjectMetadata metadata = new ObjectMetadata();
            metadata.setContentLength(contentLength);
            if (StringUtils.hasText(mimeType)) {
                metadata.setContentType(mimeType);
            }
            client.putObject(config.bucket().trim(), key, inputStream, metadata);
            String baseUrl = StringUtils.hasText(config.publicBaseUrl())
                    ? config.publicBaseUrl()
                    : "https://" + config.bucket().trim() + ".cos." + config.region().trim() + ".myqcloud.com";
            return ObjectStorageUrlBuilder.buildPublicUrl(baseUrl, key);
        } catch (CosClientException exception) {
            log.error("上传腾讯云COS失败: bucket={}, region={}, key={}", config.bucket(), config.region(), key, exception);
            throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "上传腾讯云COS失败: " + exception.getMessage());
        } finally {
            client.shutdown();
        }
    }
}
