package com.novanovastudio.storage;

import com.aliyun.oss.ClientBuilderConfiguration;
import com.aliyun.oss.OSS;
import com.aliyun.oss.OSSClientBuilder;
import com.aliyun.oss.common.auth.DefaultCredentialProvider;
import com.aliyun.oss.common.comm.SignVersion;
import com.aliyun.oss.model.ObjectMetadata;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.PersistenceDtos;
import java.io.InputStream;
import java.net.URI;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

/**
 * 阿里云OSS对象存储适配器。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-07-19 00:00
 */
@Slf4j
@Component
public class AliyunOssObjectStorageProviderAdapter implements ObjectStorageProviderAdapter {

    /** 阿里云OSS服务商标识。 */
    public static final String PROVIDER = "aliyunOss";

    /**
     * 获取阿里云OSS服务商标识。
     *
     * @return String 阿里云OSS服务商标识
     */
    @Override
    public String provider() {
        return PROVIDER;
    }

    /**
     * 校验阿里云OSS配置。
     *
     * @param config ObjectStorageConfig 对象存储配置
     * @throws BusinessException 配置不完整或Endpoint不合法时抛出
     */
    @Override
    public void validate(PersistenceDtos.ObjectStorageConfig config) {
        ObjectStorageUrlBuilder.requireText(config.accessKey(), "阿里云OSS AccessKey ID");
        ObjectStorageUrlBuilder.requireText(config.secretKey(), "阿里云OSS AccessKey Secret");
        ObjectStorageUrlBuilder.requireText(config.bucket(), "阿里云OSS Bucket");
        ObjectStorageUrlBuilder.requireText(config.region(), "阿里云OSS地域ID");
        ObjectStorageUrlBuilder.requireHttpUrl(config.endpoint(), "阿里云OSS Endpoint");
        if (StringUtils.hasText(config.publicBaseUrl())) {
            ObjectStorageUrlBuilder.requireHttpUrl(config.publicBaseUrl(), "阿里云OSS公开访问地址");
        }
    }

    /**
     * 上传对象到阿里云OSS。
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
        ClientBuilderConfiguration clientConfiguration = new ClientBuilderConfiguration();
        clientConfiguration.setSignatureVersion(SignVersion.V4);
        OSS client = OSSClientBuilder.create()
                .credentialsProvider(new DefaultCredentialProvider(config.accessKey().trim(), config.secretKey().trim()))
                .clientConfiguration(clientConfiguration)
                .region(config.region().trim())
                .endpoint(config.endpoint().trim())
                .build();
        try {
            ObjectMetadata metadata = new ObjectMetadata();
            metadata.setContentLength(contentLength);
            if (StringUtils.hasText(mimeType)) {
                metadata.setContentType(mimeType);
            }
            client.putObject(config.bucket().trim(), key, inputStream, metadata);
            return ObjectStorageUrlBuilder.buildPublicUrl(StringUtils.hasText(config.publicBaseUrl()) ? config.publicBaseUrl() : defaultPublicBaseUrl(config), key);
        } catch (RuntimeException exception) {
            log.error("上传阿里云OSS失败: bucket={}, region={}, key={}", config.bucket(), config.region(), key, exception);
            throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "上传阿里云OSS失败: " + exception.getMessage());
        } finally {
            client.shutdown();
        }
    }

    /**
     * 根据公开Endpoint构建默认访问基础地址。
     *
     * @param config ObjectStorageConfig 对象存储配置
     * @return String 默认公开访问基础地址
     */
    private String defaultPublicBaseUrl(PersistenceDtos.ObjectStorageConfig config) {
        URI endpoint = URI.create(config.endpoint().trim());
        return endpoint.getScheme() + "://" + config.bucket().trim() + "." + endpoint.getHost();
    }
}
