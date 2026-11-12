package com.novanovastudio.storage;

import com.novanovastudio.common.SystemMessage;

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
import org.springframework.util.StringUtils;

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
     * @param config 原对象存储配置
     * @param key 对象键
     * @param fileName 原始文件名
     * @param mimeType 文件媒体类型
     * @param download 是否附件下载
     * @param expiresAt 到期时间
     * @return 七牛SDK签发的临时只读地址
     */
    @Override
    public String createReadUrl(PersistenceDtos.ObjectStorageConfig config, String key, String fileName, String mimeType, boolean download, java.time.Instant expiresAt) {
        return presign(config, key, fileName, download, expiresAt, 0);
    }

    /**
     * 签发图片处理地址，宽度不超过指定像素，并纳入私有空间签名。
     *
     * @param config 原对象存储配置
     * @param key 对象键
     * @param fileName 原始文件名
     * @param mimeType 文件媒体类型
     * @param download 是否附件下载
     * @param expiresAt 到期时间
     * @param edge 缩放后的长边像素
     * @return 带 imageView2 的临时只读地址
     */
    @Override
    public String createThumbnailReadUrl(PersistenceDtos.ObjectStorageConfig config, String key, String fileName, String mimeType, boolean download, java.time.Instant expiresAt, int edge) {
        return presign(config, key, fileName, download, expiresAt, Math.max(1, edge));
    }

    /**
     * 用七牛 SDK 签发临时只读地址。处理参数必须写进地址后再签名。
     *
     * @param config 原对象存储配置
     * @param key 对象键
     * @param fileName 原始文件名
     * @param download 是否附件下载
     * @param expiresAt 到期时间
     * @param thumbnailEdge 附加图片处理时的宽度像素，0 表示读取原图
     * @return 临时只读地址
     */
    private String presign(PersistenceDtos.ObjectStorageConfig config, String key, String fileName, boolean download, java.time.Instant expiresAt, int thumbnailEdge) {
        validate(config);
        String url = ObjectStorageUrlBuilder.buildPublicUrl(config.publicBaseUrl(), key);
        String separator = "?";
        if (thumbnailEdge > 0) {
            url += separator + "imageView2/2/w/" + thumbnailEdge;
            separator = "&";
        }
        if (download && StringUtils.hasText(fileName)) {
            url += separator + "attname=" + java.net.URLEncoder.encode(fileName, java.nio.charset.StandardCharsets.UTF_8);
        }
        return Auth.create(config.accessKey(), config.secretKey()).privateDownloadUrlWithDeadline(url, expiresAt.getEpochSecond());
    }

    /**
     * 读取空间信息确认七牛云空间为私有。
     *
     * @param config ObjectStorageConfig 对象存储配置
     * @return boolean 是否已确认空间私有
     */
    @Override
    public boolean verifyPrivateBucket(PersistenceDtos.ObjectStorageConfig config) {
        validate(config);
        try {
            Auth auth = Auth.create(config.accessKey().trim(), config.secretKey().trim());
            Configuration configuration = Configuration.create(Region.createWithRegionId(config.region().trim()));
            return new com.qiniu.storage.BucketManager(auth, configuration).getBucketInfo(config.bucket()).getPrivate() == 1;
        } catch (QiniuException exception) {
            log.error("验证七牛云Kodo私有空间失败: bucket={}", config.bucket(), exception);
            throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "无法验证七牛云Kodo私有访问，请检查存储配置");
        }
    }

    /**
     * 物理删除对象，七牛的612表示文件已经不存在。
     * @param config 对象存储配置
     * @param key 对象键
     * @throws BusinessException 删除失败时抛出
     */
    @Override
    public void deletePrivateObject(PersistenceDtos.ObjectStorageConfig config, String key) {
        validate(config);
        try {
            new com.qiniu.storage.BucketManager(Auth.create(config.accessKey(), config.secretKey()),
                    Configuration.create(Region.createWithRegionId(config.region()))).delete(config.bucket(), key);
        } catch (QiniuException exception) {
            if (exception.code() != 612) throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "删除七牛对象失败：" + exception.getMessage());
        }
    }

    /**
     * 七牛私有权限属于存储空间，上传前必须确认目标空间为私有。
     * @param config 存储配置
     * @param key 专用对象键
     * @param file 临时媒体文件
     * @throws BusinessException 空间公开或上传失败时抛出
     */
    @Override
    public void putPrivateObject(PersistenceDtos.ObjectStorageConfig config, String key, java.nio.file.Path file) {
        putPrivateObject(config, key, file, "application/octet-stream");
    }

    /** @param config 私有存储配置 @param key 专用对象键 @param file 临时文件 @param mimeType 服务端确认的实际媒体类型 */
    @Override
    public void putPrivateObject(PersistenceDtos.ObjectStorageConfig config, String key, java.nio.file.Path file, String mimeType) {
        validate(config);
        Auth auth = Auth.create(config.accessKey(), config.secretKey());
        Configuration configuration = Configuration.create(Region.createWithRegionId(config.region()));
        try {
            if (new com.qiniu.storage.BucketManager(auth, configuration).getBucketInfo(config.bucket()).getPrivate() != 1) {
                throw new BusinessException(ErrorCode.BUSINESS_ERROR, "七牛分享副本需要私有空间，请配置私有存储后重试");
            }
            new UploadManager(configuration).put(file.toFile(), key, auth.uploadToken(config.bucket()), null, mimeType, true);
        } catch (QiniuException exception) {
            log.error("上传七牛私有对象失败：key={}", key, exception);
            throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "上传七牛私有对象失败，请检查存储配置");
        }
    }

    /**
     * 校验七牛云Kodo配置。
     *
     * @param config ObjectStorageConfig 对象存储配置
     * @throws BusinessException 配置不完整、区域或公开访问地址不合法时抛出
     */
    @Override
    public void validate(PersistenceDtos.ObjectStorageConfig config) {
        ObjectStorageUrlBuilder.requireText(config.accessKey(), SystemMessage.of("business.qiniuKodoAccessKey"));
        ObjectStorageUrlBuilder.requireText(config.secretKey(), SystemMessage.of("business.qiniuKodoSecretKey"));
        ObjectStorageUrlBuilder.requireText(config.bucket(), SystemMessage.of("business.qiniuKodoBucket"));
        ObjectStorageUrlBuilder.requireText(config.region(), SystemMessage.of("business.qiniuKodoRegionID"));
        if (!SUPPORTED_REGION_IDS.contains(config.region().trim())) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.unsupportedQiniuKodoRegion"));
        }
        ObjectStorageUrlBuilder.requireHttpUrl(config.publicBaseUrl(), SystemMessage.of("business.qiniuKodoPublicURL"));
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
            throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, SystemMessage.of("business.qiniuKodoUploadFailed", exception.getMessage()));
        }
    }
}
