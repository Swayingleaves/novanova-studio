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
        throw unsupportedPrivateObject();
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
        return new BusinessException(ErrorCode.BUSINESS_ERROR, "当前默认对象存储不支持私有原文存储，请更换为腾讯云COS");
    }
}
