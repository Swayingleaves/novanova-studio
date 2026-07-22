package com.novanovastudio.storage;

import com.novanovastudio.dto.PersistenceDtos;
import java.io.InputStream;

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
}
