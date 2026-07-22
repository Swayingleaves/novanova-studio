package com.novanovastudio.storage;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.dto.PersistenceDtos;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.util.List;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

/**
 * 对象存储服务测试。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-07-19 00:00
 */
class ObjectStorageServiceTest {

    /**
     * putObject 应拒绝未注册的对象存储服务商。
     */
    @Test
    void shouldRejectUnsupportedProvider() {
        ObjectStorageService service = new ObjectStorageService(List.of(new StubObjectStorageProviderAdapter()));

        BusinessException exception = Assertions.assertThrows(BusinessException.class,
                () -> service.putObject(config("unknown"), "images/example.png", new ByteArrayInputStream(new byte[0]), 0, "image/png"));

        Assertions.assertTrue(exception.getMessage().contains("不受支持"));
    }

    /**
     * putObject 应分发到已注册的服务商适配器。
     */
    @Test
    void shouldDispatchToRegisteredProvider() {
        ObjectStorageService service = new ObjectStorageService(List.of(new StubObjectStorageProviderAdapter()));

        String url = service.putObject(config("test"), "images/example.png", new ByteArrayInputStream(new byte[0]), 0, "image/png");

        Assertions.assertEquals("https://example.com/images/example.png", url);
    }

    /**
     * validate 应要求七牛云Kodo配置公开访问地址。
     */
    @Test
    void shouldRequirePublicBaseUrlForQiniuKodo() {
        PersistenceDtos.ObjectStorageConfig config = new PersistenceDtos.ObjectStorageConfig(
                "qiniuKodo", "access-key", "secret-key", "bucket", "z0", "", "directory", "", "storage", "七牛云", "", false);

        BusinessException exception = Assertions.assertThrows(BusinessException.class,
                () -> new QiniuKodoObjectStorageProviderAdapter().validate(config));

        Assertions.assertTrue(exception.getMessage().contains("公开访问地址"));
    }

    /**
     * validate 应拒绝七牛云Kodo不支持的区域ID。
     */
    @Test
    void shouldRejectUnsupportedQiniuKodoRegion() {
        PersistenceDtos.ObjectStorageConfig config = new PersistenceDtos.ObjectStorageConfig(
                "qiniuKodo", "access-key", "secret-key", "bucket", "invalid-region", "", "directory", "https://cdn.example.com", "storage", "七牛云", "", false);

        BusinessException exception = Assertions.assertThrows(BusinessException.class,
                () -> new QiniuKodoObjectStorageProviderAdapter().validate(config));

        Assertions.assertTrue(exception.getMessage().contains("区域ID不受支持"));
    }

    /**
     * validate 应要求阿里云OSS填写Endpoint。
     */
    @Test
    void shouldRequireEndpointForAliyunOss() {
        PersistenceDtos.ObjectStorageConfig config = new PersistenceDtos.ObjectStorageConfig(
                "aliyunOss", "access-key", "secret-key", "bucket", "cn-hangzhou", "", "directory", "", "storage", "阿里云", "", false);

        BusinessException exception = Assertions.assertThrows(BusinessException.class,
                () -> new AliyunOssObjectStorageProviderAdapter().validate(config));

        Assertions.assertTrue(exception.getMessage().contains("Endpoint不能为空"));
    }

    /**
     * buildPublicUrl 应保留对象键的路径层级并编码路径片段。
     */
    @Test
    void shouldBuildEncodedPublicUrl() {
        String url = ObjectStorageUrlBuilder.buildPublicUrl("https://cdn.example.com/", "images/测试 图片.png");

        Assertions.assertEquals("https://cdn.example.com/images/%E6%B5%8B%E8%AF%95%20%E5%9B%BE%E7%89%87.png", url);
    }

    /**
     * 构造基础对象存储配置。
     *
     * @param provider String 服务商标识
     * @return ObjectStorageConfig 对象存储配置
     */
    private PersistenceDtos.ObjectStorageConfig config(String provider) {
        return new PersistenceDtos.ObjectStorageConfig(provider, "access-key", "secret-key", "bucket", "region", "", "directory", "", "storage", "测试存储", "", false);
    }

    /**
     * 用于验证注册表分发的测试适配器。
     */
    private static class StubObjectStorageProviderAdapter implements ObjectStorageProviderAdapter {

        /**
         * 获取测试服务商标识。
         *
         * @return String 服务商标识
         */
        @Override
        public String provider() {
            return "test";
        }

        /**
         * 校验测试配置。
         *
         * @param config ObjectStorageConfig 对象存储配置
         */
        @Override
        public void validate(PersistenceDtos.ObjectStorageConfig config) {
        }

        /**
         * 上传测试对象。
         *
         * @param config ObjectStorageConfig 对象存储配置
         * @param key String 对象键
         * @param inputStream InputStream 文件流
         * @param contentLength long 文件大小
         * @param mimeType String MIME类型
         * @return String 公开访问地址
         */
        @Override
        public String putObject(PersistenceDtos.ObjectStorageConfig config, String key, InputStream inputStream, long contentLength, String mimeType) {
            return "https://example.com/" + key;
        }
    }
}
