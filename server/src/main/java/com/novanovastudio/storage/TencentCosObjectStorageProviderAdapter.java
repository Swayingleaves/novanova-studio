package com.novanovastudio.storage;

import com.novanovastudio.common.SystemMessage;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.dto.PersistenceDtos;
import com.qcloud.cos.COSClient;
import com.qcloud.cos.ClientConfig;
import com.qcloud.cos.auth.BasicCOSCredentials;
import com.qcloud.cos.exception.CosClientException;
import com.qcloud.cos.model.ObjectMetadata;
import com.qcloud.cos.model.CannedAccessControlList;
import com.qcloud.cos.model.COSObject;
import com.qcloud.cos.region.Region;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
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
@RequiredArgsConstructor
public class TencentCosObjectStorageProviderAdapter implements ObjectStorageProviderAdapter {

    /** 腾讯云COS服务商标识。 */
    public static final String PROVIDER = "tencentCos";

    /** 应用配置。 */
    private final NovanovaProperties properties;

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
     * @param config 原对象存储配置
     * @param key 对象键
     * @param fileName 原始文件名
     * @param mimeType 文件媒体类型
     * @param download 是否附件下载
     * @param expiresAt 到期时间
     * @return 腾讯云SDK签发的临时GET地址
     */
    @Override
    public String createReadUrl(PersistenceDtos.ObjectStorageConfig config, String key, String fileName, String mimeType, boolean download, java.time.Instant expiresAt) {
        validate(config);
        COSClient client = createClient(config);
        try {
            var request = new com.qcloud.cos.model.GeneratePresignedUrlRequest(config.bucket(), key, com.qcloud.cos.http.HttpMethodName.GET);
            request.setExpiration(java.util.Date.from(expiresAt));
            var headers = new com.qcloud.cos.model.ResponseHeaderOverrides();
            headers.setContentDisposition(org.springframework.http.ContentDisposition.builder(download ? "attachment" : "inline")
                    .filename(fileName, java.nio.charset.StandardCharsets.UTF_8).build().toString());
            headers.setContentType(mimeType);
            request.setResponseHeaders(headers);
            return client.generatePresignedUrl(request).toString();
        } finally { client.shutdown(); }
    }

    /**
     * 校验腾讯云COS配置。
     *
     * @param config ObjectStorageConfig 对象存储配置
     * @throws BusinessException 配置不完整或公开访问地址不合法时抛出
     */
    @Override
    public void validate(PersistenceDtos.ObjectStorageConfig config) {
        ObjectStorageUrlBuilder.requireText(config.accessKey(), SystemMessage.of("business.tencentCloudCOSSecretId"));
        ObjectStorageUrlBuilder.requireText(config.secretKey(), SystemMessage.of("business.tencentCloudCOSSecretKey"));
        ObjectStorageUrlBuilder.requireText(config.bucket(), SystemMessage.of("business.tencentCloudCOSBucket"));
        ObjectStorageUrlBuilder.requireText(config.region(), SystemMessage.of("business.tencentCloudCOSRegion"));
        if (StringUtils.hasText(config.publicBaseUrl())) {
            ObjectStorageUrlBuilder.requireHttpUrl(config.publicBaseUrl(), SystemMessage.of("business.tencentCloudCOSPublicURL"));
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
        COSClient client = new COSClient(new BasicCOSCredentials(config.accessKey().trim(), config.secretKey().trim()), createClientConfig(config.region().trim()));
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
            throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, SystemMessage.of("business.tencentCloudCOSUploadFailed", exception.getMessage()));
        } finally {
            client.shutdown();
        }
    }

    /**
     * 使用无敏感内容的探针确认存储桶拒绝匿名读取。
     *
     * @param config ObjectStorageConfig 对象存储配置
     * @return boolean 是否确认匿名读取被拒绝
     */
    @Override
    public boolean verifyPrivateBucket(PersistenceDtos.ObjectStorageConfig config) {
        validate(config);
        String key = "script-source/private-probe/" + UUID.randomUUID();
        COSClient client = createClient(config);
        try {
            byte[] marker = "private-probe".getBytes(java.nio.charset.StandardCharsets.UTF_8);
            ObjectMetadata metadata = new ObjectMetadata();
            metadata.setContentLength(marker.length);
            client.putObject(config.bucket().trim(), key, new ByteArrayInputStream(marker), metadata);
            client.setObjectAcl(config.bucket().trim(), key, CannedAccessControlList.Private);
            String base = StringUtils.hasText(config.publicBaseUrl()) ? config.publicBaseUrl().replaceAll("/+$", "")
                    : "https://" + config.bucket().trim() + ".cos." + config.region().trim() + ".myqcloud.com";
            HttpRequest request = HttpRequest.newBuilder(URI.create(base + "/" + key)).timeout(Duration.ofSeconds(10)).method("HEAD", HttpRequest.BodyPublishers.noBody()).build();
            int status = HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.discarding()).statusCode();
            return status == 403;
        } catch (Exception exception) {
            log.error("验证原文存储桶私有访问失败: bucket={}", config.bucket(), exception);
            throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "无法验证存储桶私有访问，请检查对象存储配置");
        } finally {
            try {
                client.deleteObject(config.bucket().trim(), key);
            } catch (Exception exception) {
                log.error("清理私有存储探针失败: key={}", key, exception);
            }
            client.shutdown();
        }
    }

    /**
     * 从磁盘上传私有对象并显式收敛为私有读写。
     *
     * @param config ObjectStorageConfig 对象存储配置
     * @param key String 私有对象键
     * @param file Path 本地文件
     */
    @Override
    public void putPrivateObject(PersistenceDtos.ObjectStorageConfig config, String key, Path file) {
        validate(config);
        COSClient client = createClient(config);
        try {
            client.putObject(config.bucket().trim(), key, file.toFile());
            client.setObjectAcl(config.bucket().trim(), key, CannedAccessControlList.Private);
        } catch (CosClientException exception) {
            log.error("上传腾讯云COS私有对象失败: bucket={}, key={}", config.bucket(), key, exception);
            throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "上传腾讯云COS失败: " + exception.getMessage());
        } finally {
            client.shutdown();
        }
    }

    /**
     * 将私有对象下载到本地路径。
     *
     * @param config ObjectStorageConfig 对象存储配置
     * @param key String 私有对象键
     * @param target Path 目标路径
     */
    @Override
    public void downloadPrivateObject(PersistenceDtos.ObjectStorageConfig config, String key, Path target) {
        validate(config);
        COSClient client = createClient(config);
        try (COSObject object = client.getObject(config.bucket().trim(), key)) {
            Files.copy(object.getObjectContent(), target, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException exception) {
            log.error("读取腾讯云COS私有对象失败: bucket={}, key={}", config.bucket(), key, exception);
            throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "读取私有原文件失败");
        } finally {
            client.shutdown();
        }
    }

    /**
     * 删除私有对象。
     *
     * @param config ObjectStorageConfig 对象存储配置
     * @param key String 对象键
     */
    @Override
    public void deletePrivateObject(PersistenceDtos.ObjectStorageConfig config, String key) {
        COSClient client = createClient(config);
        try {
            client.deleteObject(config.bucket().trim(), key);
        } finally {
            client.shutdown();
        }
    }

    /**
     * 创建用于私有对象操作的客户端。
     *
     * @param config ObjectStorageConfig 对象存储配置
     * @return COSClient 客户端
     */
    private COSClient createClient(PersistenceDtos.ObjectStorageConfig config) {
        return new COSClient(new BasicCOSCredentials(config.accessKey().trim(), config.secretKey().trim()), createClientConfig(config.region().trim()));
    }

    /**
     * 创建腾讯云COS客户端配置。
     *
     * @param region String 腾讯云COS地域
     * @return ClientConfig COS客户端配置
     */
    private ClientConfig createClientConfig(String region) {
        NovanovaProperties.ObjectStorage.TencentCos tencentCos = properties.getObjectStorage().getTencentCos();
        ClientConfig clientConfig = new ClientConfig(new Region(region));
        clientConfig.setMaxErrorRetry(tencentCos.getMaxErrorRetry());
        clientConfig.setSocketTimeout(tencentCos.getSocketTimeoutMilliseconds());
        return clientConfig;
    }
}
