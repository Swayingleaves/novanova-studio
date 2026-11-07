package com.novanovastudio.storage;

import static org.junit.jupiter.api.Assertions.*;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.PersistenceDtos;
import com.sun.net.httpserver.HttpServer;
import java.io.ByteArrayInputStream;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.ContentDisposition;
import org.springframework.web.util.UriComponentsBuilder;

/** 使用离线签名和回环 HTTP 服务验证 S3 请求；无需真实云账号、存储桶或网络。 */
class CloudflareR2ObjectStorageProviderAdapterTest {

    private final CloudflareR2ObjectStorageProviderAdapter adapter = new CloudflareR2ObjectStorageProviderAdapter();

    @Test
    void registersProviderAndAcceptsJurisdictionEndpoint() {
        var service = new ObjectStorageService(List.of(adapter));
        assertTrue(service.supports("cloudflareR2"));
        assertDoesNotThrow(() -> service.validate(config("https://account.eu.r2.cloudflarestorage.com/", "https://cdn.example.com/")));
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "ftp://example.com", "https://account.r2.cloudflarestorage.com/bucket", "https://example.com?bucket=x", "https://user:password@example.com", "https://example.com#bucket"})
    void rejectsMissingOrInvalidEndpoints(String endpoint) {
        assertThrows(BusinessException.class, () -> adapter.validate(config(endpoint, "https://cdn.example.com")));
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "not-a-url", "https://account.r2.cloudflarestorage.com", "https://account.eu.r2.cloudflarestorage.com"})
    void requiresPublicMediaDomainInsteadOfS3Endpoint(String publicBaseUrl) {
        assertThrows(BusinessException.class, () -> adapter.validate(config("https://account.r2.cloudflarestorage.com", publicBaseUrl)));
    }

    @Test
    void signsReadOnlyLinkWithEncodedKeyExpiryAndChineseDownloadName() {
        String key = "images/中文 图片.png";
        String url = adapter.createReadUrl(config("https://account.r2.cloudflarestorage.com/", "https://cdn.example.com"),
                key, "中文 图片.png", "image/png", true, Instant.now().plusSeconds(300));
        URI uri = URI.create(url);
        assertEquals("account.r2.cloudflarestorage.com", uri.getHost());
        assertEquals("/test-bucket/" + key, uri.getPath());
        assertFalse(url.contains("test-private-secret"));
        var parameters = UriComponentsBuilder.fromUri(uri).build().getQueryParams();
        assertEquals("AWS4-HMAC-SHA256", parameters.getFirst("X-Amz-Algorithm"));
        assertNotNull(parameters.getFirst("X-Amz-Signature"));
        assertTrue(URLDecoder.decode(parameters.getFirst("X-Amz-Credential"), StandardCharsets.UTF_8).contains("/auto/s3/aws4_request"));
        long expires = Long.parseLong(parameters.getFirst("X-Amz-Expires"));
        assertTrue(expires >= 295 && expires <= 300);
        assertEquals("image/png", URLDecoder.decode(parameters.getFirst("response-content-type"), StandardCharsets.UTF_8));
        var disposition = ContentDisposition.parse(URLDecoder.decode(parameters.getFirst("response-content-disposition"), StandardCharsets.UTF_8));
        assertEquals("attachment", disposition.getType());
        assertEquals("中文 图片.png", disposition.getFilename());
    }

    @Test
    void signsInlinePreviewAndRejectsExpiredLink() {
        var config = config("https://account.r2.cloudflarestorage.com", "https://cdn.example.com");
        String url = adapter.createReadUrl(config, "image.png", "image.png", "image/png", false, Instant.now().plusSeconds(60));
        var parameters = UriComponentsBuilder.fromUriString(url).build().getQueryParams();
        assertTrue(URLDecoder.decode(parameters.getFirst("response-content-disposition"), StandardCharsets.UTF_8).startsWith("inline;"));
        assertThrows(IllegalArgumentException.class, () -> adapter.createReadUrl(config, "image.png", "image.png", "image/png", true, Instant.now().minusSeconds(10)));
    }

    @Test
    void uploadsExactBytesAndDeletesUsingPathStyleSignedRequests() throws Exception {
        byte[] bytes = "image-bytes-测试".getBytes(StandardCharsets.UTF_8);
        AtomicReference<String> method = new AtomicReference<>();
        AtomicReference<String> path = new AtomicReference<>();
        AtomicReference<String> authorization = new AtomicReference<>();
        AtomicReference<String> contentType = new AtomicReference<>();
        AtomicReference<byte[]> body = new AtomicReference<>();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            try (exchange) {
                method.set(exchange.getRequestMethod());
                path.set(exchange.getRequestURI().getPath());
                authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
                contentType.set(exchange.getRequestHeaders().getFirst("Content-Type"));
                body.set(exchange.getRequestBody().readAllBytes());
                exchange.sendResponseHeaders("DELETE".equals(exchange.getRequestMethod()) ? 204 : 200, -1);
            }
        });
        server.start();
        try {
            var config = config("http://127.0.0.1:" + server.getAddress().getPort() + "/", "https://cdn.example.com/");
            String url = adapter.putObject(config, "images/中文 图片.png", new ByteArrayInputStream(bytes), bytes.length, "image/png");
            assertEquals("PUT", method.get());
            assertEquals("/test-bucket/images/中文 图片.png", path.get());
            assertEquals("image/png", contentType.get());
            assertTrue(authorization.get().startsWith("AWS4-HMAC-SHA256 "));
            assertArrayEquals(bytes, body.get());
            assertEquals("https://cdn.example.com/images/%E4%B8%AD%E6%96%87%20%E5%9B%BE%E7%89%87.png", url);
            adapter.deletePrivateObject(config, "images/中文 图片.png");
            assertEquals("DELETE", method.get());
            assertEquals("/test-bucket/images/中文 图片.png", path.get());
        } finally {
            server.stop(0);
        }
    }

    @Test
    void translatesStorageFailureIntoBusinessError() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            try (exchange) {
                exchange.getRequestBody().readAllBytes();
                byte[] error = "<Error><Code>AccessDenied</Code><Message>Denied</Message></Error>".getBytes(StandardCharsets.UTF_8);
                exchange.sendResponseHeaders(403, error.length);
                exchange.getResponseBody().write(error);
            }
        });
        server.start();
        try {
            var config = config("http://127.0.0.1:" + server.getAddress().getPort(), "https://cdn.example.com");
            var upload = assertThrows(BusinessException.class, () -> adapter.putObject(config, "image.png", new ByteArrayInputStream(new byte[] {1}), 1, "image/png"));
            assertEquals(ErrorCode.THIRD_PARTY_CALL_ERROR, upload.getCode());
            var deletion = assertThrows(BusinessException.class, () -> adapter.deletePrivateObject(config, "image.png"));
            assertEquals(ErrorCode.THIRD_PARTY_CALL_ERROR, deletion.getCode());
        } finally {
            server.stop(0);
        }
    }

    @Test
    void refusesPrivateObjectWorkflowsForPublicR2Bucket() {
        var config = config("https://account.r2.cloudflarestorage.com", "https://cdn.example.com");
        assertThrows(BusinessException.class, () -> adapter.verifyPrivateBucket(config));
        assertThrows(BusinessException.class, () -> adapter.putPrivateObject(config, "private/file", Path.of("unused")));
        assertThrows(BusinessException.class, () -> adapter.putPrivateObject(config, "private/file", Path.of("unused"), "text/plain"));
    }

    private PersistenceDtos.ObjectStorageConfig config(String endpoint, String publicBaseUrl) {
        return new PersistenceDtos.ObjectStorageConfig("cloudflareR2", "test-access", "test-private-secret", "test-bucket",
                "auto", endpoint, "novanova-studio", publicBaseUrl, "r2-storage", "R2", "", false);
    }
}
