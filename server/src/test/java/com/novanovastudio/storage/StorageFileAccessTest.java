package com.novanovastudio.storage;

import static org.junit.jupiter.api.Assertions.*;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.dto.PersistenceDtos;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Map;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.web.util.UriComponentsBuilder;

/**
 * 离线验证三种提供方SDK签名、到期时间、对象键编码及中文下载文件名。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-20 12:00
 */
class StorageFileAccessTest {
    /**
     * 签名不发出网络请求，也不调整对象或桶的公开权限。
     * @param provider 提供方标识
     */
    @ParameterizedTest
    @ValueSource(strings = {"tencentCos", "aliyunOss", "qiniuKodo"})
    void signsReadOnlyLinksWithExpiryAndDownloadName(String provider) {
        var adapters = Map.<String, ObjectStorageProviderAdapter>of(
                "tencentCos", new TencentCosObjectStorageProviderAdapter(new NovanovaProperties()),
                "aliyunOss", new AliyunOssObjectStorageProviderAdapter(), "qiniuKodo", new QiniuKodoObjectStorageProviderAdapter());
        var config = new PersistenceDtos.ObjectStorageConfig(provider, "test-access", "test-private-secret", "test-bucket-123456",
                provider.equals("qiniuKodo") ? "z0" : provider.equals("aliyunOss") ? "cn-hangzhou" : "ap-guangzhou",
                "https://oss-cn-hangzhou.aliyuncs.com", "", "https://files.example.com", "original-storage", "原存储", "", false);
        Instant expiry = Instant.now().plusSeconds(300);
        String key = "images/中文 图片.png";
        String url = adapters.get(provider).createReadUrl(config, key, "中文 图片.png", "image/png", true, expiry);
        URI uri = URI.create(url);
        assertEquals("/" + key, uri.getPath());
        assertFalse(url.contains("test-private-secret"));
        var parameters = UriComponentsBuilder.fromUri(uri).build().getQueryParams();
        if (provider.equals("qiniuKodo")) {
            assertEquals(Long.toString(expiry.getEpochSecond()), parameters.getFirst("e"));
            assertTrue(parameters.containsKey("token"));
            assertEquals("中文 图片.png", URLDecoder.decode(parameters.getFirst("attname"), StandardCharsets.UTF_8));
        } else {
            assertTrue(URLDecoder.decode(parameters.getFirst("response-content-disposition"), StandardCharsets.UTF_8).startsWith("attachment;"));
            assertEquals("image/png", URLDecoder.decode(parameters.getFirst("response-content-type"), StandardCharsets.UTF_8));
            var signature = provider.equals("tencentCos") && parameters.containsKey("sign")
                    ? UriComponentsBuilder.fromUriString("https://example.com/?" + URLDecoder.decode(parameters.getFirst("sign"), StandardCharsets.UTF_8)).build().getQueryParams() : parameters;
            assertTrue(provider.equals("tencentCos") ? signature.containsKey("q-signature") : parameters.containsKey("x-oss-signature"), parameters.toString());
            if (provider.equals("tencentCos")) assertTrue(URLDecoder.decode(signature.getFirst("q-sign-time"), StandardCharsets.UTF_8).endsWith(";" + expiry.getEpochSecond()));
            else assertTrue(Long.parseLong(parameters.getFirst("x-oss-expires")) >= 295 && Long.parseLong(parameters.getFirst("x-oss-expires")) <= 300);
        }
    }
}
