package com.novanovastudio.storage;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.PersistenceDtos;
import java.io.InputStream;
import java.nio.file.Path;

/**
 * 对象存储服务商适配器。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-07-19 00:00
 */
public interface ObjectStorageProviderAdapter {

    /**
     * 通过提供方SDK签发临时只读链接，不改变对象访问权限。
     * @param config 原对象存储配置
     * @param key 对象键
     * @param fileName 原始文件名
     * @param mimeType 文件媒体类型
     * @param download 是否要求附件下载
     * @param expiresAt 到期时间
     * @return 临时只读链接
     * @throws BusinessException 当前适配器不支持签名读取时抛出
     */
    default String createReadUrl(PersistenceDtos.ObjectStorageConfig config, String key, String fileName, String mimeType, boolean download, java.time.Instant expiresAt) {
        throw new BusinessException(ErrorCode.BUSINESS_ERROR, "当前对象存储不支持临时文件访问");
    }

    /**
     * 签发长边不超过指定像素的图片读取地址。
     * <p>
     * 服务商不能在读取时缩放时返回 null，调用方再决定是否使用原图地址。
     *
     * @param config 原对象存储配置
     * @param key 对象键
     * @param fileName 原始文件名
     * @param mimeType 文件媒体类型
     * @param download 是否要求附件下载
     * @param expiresAt 到期时间
     * @param edge 缩放后的长边像素
     * @return 缩略图临时地址，不支持时返回 null
     */
    default String createThumbnailReadUrl(PersistenceDtos.ObjectStorageConfig config, String key, String fileName, String mimeType, boolean download, java.time.Instant expiresAt, int edge) {
        return null;
    }

    /**
     * 获取适配器支持的服务商标识。
     *
     * @return String 服务商标识
     */
    String provider();

    /**
     * 校验服务商上传所需的配置。
     *
     * @param config ObjectStorageConfig 对象存储配置
     * @throws com.novanovastudio.common.BusinessException 配置不完整或不合法时抛出
     */
    void validate(PersistenceDtos.ObjectStorageConfig config);

    /**
     * 上传对象并返回公开访问地址。
     *
     * @param config ObjectStorageConfig 对象存储配置
     * @param key String 对象键
     * @param inputStream InputStream 文件流
     * @param contentLength long 文件大小
     * @param mimeType String MIME类型
     * @return String 公开访问地址
     * @throws com.novanovastudio.common.BusinessException 上传失败或配置不合法时抛出
     */
    String putObject(PersistenceDtos.ObjectStorageConfig config, String key, InputStream inputStream, long contentLength, String mimeType);

    /**
     * 确认存储桶拒绝匿名读取。
     *
     * @param config ObjectStorageConfig 对象存储配置
     * @return boolean 是否已确认匿名读取被拒绝
     * @throws com.novanovastudio.common.BusinessException 服务商不支持私有对象时抛出
     */
    default boolean verifyPrivateBucket(PersistenceDtos.ObjectStorageConfig config) {
        String key = "private-probe/" + java.util.UUID.randomUUID();
        boolean uploaded = false;
        try {
            byte[] marker = "private-probe".getBytes(java.nio.charset.StandardCharsets.UTF_8);
            // 探针必须继承桶权限，不能单独设置私有 ACL，否则公有读桶也会返回 403。
            String publicUrl = putObject(config, key, new java.io.ByteArrayInputStream(marker), marker.length, "text/plain");
            uploaded = true;
            var request = java.net.http.HttpRequest.newBuilder(java.net.URI.create(publicUrl.split("\\?", 2)[0]))
                    .timeout(java.time.Duration.ofSeconds(10))
                    .method("HEAD", java.net.http.HttpRequest.BodyPublishers.noBody()).build();
            int anonymousStatus = java.net.http.HttpClient.newHttpClient().send(request, java.net.http.HttpResponse.BodyHandlers.discarding()).statusCode();
            if (anonymousStatus != 403) {
                return false;
            }
            String signed = createReadUrl(config, key, "private-probe.txt", "text/plain", false, java.time.Instant.now().plusSeconds(60));
            var signedRequest = java.net.http.HttpRequest.newBuilder(java.net.URI.create(signed))
                    .timeout(java.time.Duration.ofSeconds(10)).GET().build();
            int signedStatus = java.net.http.HttpClient.newHttpClient().send(signedRequest, java.net.http.HttpResponse.BodyHandlers.discarding()).statusCode();
            return signedStatus == 200;
        } catch (Exception exception) {
            org.slf4j.LoggerFactory.getLogger(ObjectStorageProviderAdapter.class).error("验证私有对象访问失败：provider={}", provider(), exception);
            throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "无法验证私有对象访问，请检查对象存储权限及访问域名");
        } finally {
            if (uploaded) {
                try { deletePrivateObject(config, key); }
                catch (RuntimeException exception) { org.slf4j.LoggerFactory.getLogger(ObjectStorageProviderAdapter.class).error("清理私有探针对象失败", exception); }
            }
        }
    }

    /**
     * 上传不可公开访问的私有对象。
     *
     * @param config ObjectStorageConfig 对象存储配置
     * @param key String 对象键
     * @param file Path 本地文件
     * @throws com.novanovastudio.common.BusinessException 服务商不支持私有对象或上传失败时抛出
     */
    default void putPrivateObject(PersistenceDtos.ObjectStorageConfig config, String key, Path file) {
        throw unsupportedPrivateObject();
    }

    /** @param config 私有存储配置 @param key 对象键 @param file 临时文件 @param mimeType 已验证媒体类型 @throws BusinessException 提供方未支持媒体类型元数据时抛出 */
    default void putPrivateObject(PersistenceDtos.ObjectStorageConfig config, String key, Path file, String mimeType) {
        throw unsupportedPrivateObject();
    }

    /**
     * 下载私有对象到本地路径。
     *
     * @param config ObjectStorageConfig 对象存储配置
     * @param key String 对象键
     * @param target Path 目标路径
     * @throws com.novanovastudio.common.BusinessException 服务商不支持私有对象或下载失败时抛出
     */
    default void downloadPrivateObject(PersistenceDtos.ObjectStorageConfig config, String key, Path target) {
        throw unsupportedPrivateObject();
    }

    /**
     * 删除私有对象。
     *
     * @param config ObjectStorageConfig 对象存储配置
     * @param key String 对象键
     * @throws com.novanovastudio.common.BusinessException 服务商不支持私有对象或删除失败时抛出
     */
    default void deletePrivateObject(PersistenceDtos.ObjectStorageConfig config, String key) {
        throw unsupportedPrivateObject();
    }

    /**
     * 构造私有对象不受支持的统一异常。
     *
     * @return BusinessException 不受支持异常
     */
    private static BusinessException unsupportedPrivateObject() {
        return new BusinessException(ErrorCode.BUSINESS_ERROR, "当前对象存储提供方不支持私有对象操作，请调整存储配置");
    }
}
