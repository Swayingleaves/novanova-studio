package com.novanovastudio.storage;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.common.SystemMessage;
import com.novanovastudio.dto.PersistenceDtos;
import java.io.InputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ContentDisposition;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.core.checksums.RequestChecksumCalculation;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

/** Cloudflare R2 公开素材存储，通过 S3 兼容 API 上传、签名读取和删除对象。 */
@Slf4j
@Component
public class CloudflareR2ObjectStorageProviderAdapter implements ObjectStorageProviderAdapter {

    public static final String PROVIDER = "cloudflareR2";

    @Override
    public String provider() {
        return PROVIDER;
    }

    @Override
    public void validate(PersistenceDtos.ObjectStorageConfig config) {
        ObjectStorageUrlBuilder.requireText(config.accessKey(), SystemMessage.of("business.cloudflareR2AccessKeyID"));
        ObjectStorageUrlBuilder.requireText(config.secretKey(), SystemMessage.of("business.cloudflareR2SecretAccessKey"));
        ObjectStorageUrlBuilder.requireText(config.bucket(), SystemMessage.of("business.cloudflareR2Bucket"));
        ObjectStorageUrlBuilder.requireText(config.region(), SystemMessage.of("business.cloudflareR2Region"));
        ObjectStorageUrlBuilder.requireHttpUrl(config.endpoint(), SystemMessage.of("business.cloudflareR2Endpoint"));
        URI endpoint = endpoint(config);
        if (StringUtils.hasText(endpoint.getRawPath()) || endpoint.getRawQuery() != null
                || endpoint.getRawFragment() != null || endpoint.getUserInfo() != null) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.cloudflareR2EndpointMustBeOrigin"));
        }
        ObjectStorageUrlBuilder.requireHttpUrl(config.publicBaseUrl(), SystemMessage.of("business.cloudflareR2PublicURL"));
        String publicHost = URI.create(config.publicBaseUrl().trim()).getHost().toLowerCase(java.util.Locale.ROOT);
        if (publicHost.endsWith(".r2.cloudflarestorage.com")) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.cloudflareR2PublicURLMustNotBeEndpoint"));
        }
    }

    @Override
    public String putObject(PersistenceDtos.ObjectStorageConfig config, String key,
                            InputStream inputStream, long contentLength, String mimeType) {
        validate(config);
        try (S3Client client = client(config)) {
            PutObjectRequest.Builder request = PutObjectRequest.builder().bucket(config.bucket().trim()).key(key);
            if (StringUtils.hasText(mimeType)) {
                request.contentType(mimeType);
            }
            client.putObject(request.build(), RequestBody.fromInputStream(inputStream, contentLength));
            return ObjectStorageUrlBuilder.buildPublicUrl(config.publicBaseUrl().trim(), key);
        } catch (RuntimeException exception) {
            log.error("上传 Cloudflare R2 失败: bucket={}, key={}", config.bucket(), key, exception);
            throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR,
                    SystemMessage.of("business.cloudflareR2UploadFailed"));
        }
    }

    @Override
    public String createReadUrl(PersistenceDtos.ObjectStorageConfig config, String key, String fileName,
                                String mimeType, boolean download, Instant expiresAt) {
        validate(config);
        try (S3Presigner signer = S3Presigner.builder()
                .endpointOverride(endpoint(config))
                .region(Region.of(config.region().trim()))
                .credentialsProvider(credentials(config))
                .serviceConfiguration(S3Configuration.builder().pathStyleAccessEnabled(true).build())
                .build()) {
            GetObjectRequest.Builder request = GetObjectRequest.builder().bucket(config.bucket().trim()).key(key);
            if (StringUtils.hasText(mimeType)) {
                request.responseContentType(mimeType);
            }
            if (StringUtils.hasText(fileName)) {
                request.responseContentDisposition(ContentDisposition.builder(download ? "attachment" : "inline")
                        .filename(fileName, StandardCharsets.UTF_8).build().toString());
            }
            return signer.presignGetObject(builder -> builder.getObjectRequest(request.build())
                    .signatureDuration(Duration.between(Instant.now(), expiresAt))).url().toString();
        }
    }

    /** 文件清理也使用该接口；S3 DeleteObject 对已不存在的对象保持幂等。 */
    @Override
    public void deletePrivateObject(PersistenceDtos.ObjectStorageConfig config, String key) {
        validate(config);
        try (S3Client client = client(config)) {
            client.deleteObject(builder -> builder.bucket(config.bucket().trim()).key(key));
        } catch (RuntimeException exception) {
            log.error("删除 Cloudflare R2 对象失败: bucket={}, key={}", config.bucket(), key, exception);
            throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR,
                    SystemMessage.of("business.cloudflareR2DeleteFailed"));
        }
    }

    /** R2 不支持对象级 ACL，不能将已绑定公开域名的桶用于私有原文或私有分享素材。 */
    @Override
    public boolean verifyPrivateBucket(PersistenceDtos.ObjectStorageConfig config) {
        throw new BusinessException(ErrorCode.BUSINESS_ERROR, SystemMessage.of("business.cloudflareR2PrivateStorageUnsupported"));
    }

    private S3Client client(PersistenceDtos.ObjectStorageConfig config) {
        return S3Client.builder()
                .endpointOverride(endpoint(config))
                .credentialsProvider(credentials(config))
                .region(Region.of(config.region().trim()))
                .serviceConfiguration(S3Configuration.builder().pathStyleAccessEnabled(true).chunkedEncodingEnabled(false).build())
                .requestChecksumCalculation(RequestChecksumCalculation.WHEN_REQUIRED)
                .build();
    }

    private StaticCredentialsProvider credentials(PersistenceDtos.ObjectStorageConfig config) {
        return StaticCredentialsProvider.create(AwsBasicCredentials.create(config.accessKey().trim(), config.secretKey().trim()));
    }

    private URI endpoint(PersistenceDtos.ObjectStorageConfig config) {
        return URI.create(config.endpoint().trim().replaceAll("/+$", ""));
    }
}
