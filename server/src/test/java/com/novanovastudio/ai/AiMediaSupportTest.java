package com.novanovastudio.ai;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.dto.AiTaskDtos;
import com.novanovastudio.dto.PersistenceDtos;
import com.novanovastudio.service.PersistenceService;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.Base64;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import reactor.core.publisher.Mono;

/**
 * AI媒体处理服务测试。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-07-26 00:00
 */
class AiMediaSupportTest {

    /** 第三方AI HTTP客户端 */
    private AiHttpClient aiHttpClient;

    /** 媒体持久化服务 */
    private PersistenceService persistenceService;

    /** 服务配置 */
    private NovanovaProperties properties;

    /** 待测试的AI媒体处理服务 */
    private AiMediaSupport service;

    /**
     * 初始化测试依赖。
     *
     * @return void 无返回值
     */
    @BeforeEach
    void setUp() {
        aiHttpClient = org.mockito.Mockito.mock(AiHttpClient.class);
        persistenceService = org.mockito.Mockito.mock(PersistenceService.class);
        properties = new NovanovaProperties();
        service = new AiMediaSupport(aiHttpClient, persistenceService, properties);
    }

    /**
     * 验证链接图片结果会转存对象存储，同时保留云存储链接和原始链接。
     *
     * @return void 无返回值
     */
    @Test
    void shouldStoreLinkedImageAndKeepSourceUrl() {
        String sourceUrl = "https://provider.example/generated.png";
        byte[] data = new byte[] {1, 2, 3};
        when(aiHttpClient.downloadRemoteBinary(sourceUrl, "image/png"))
                .thenReturn(Mono.just(new GeneratedBinary(data, "image/png")));
        when(persistenceService.storeGeneratedMediaForUser(eq(1L), eq(AiTaskTypes.IMAGE), eq("generated.png"), eq("image/png"),
                eq(data), isNull(), isNull(), eq(0), eq(sourceUrl)))
                .thenReturn(Mono.just(mediaResponse("https://cos.example/generated.png", sourceUrl)));

        PersistenceDtos.UploadedMediaResponse response = service.storeGeneratedImageItem(1L, imageItem(sourceUrl), null, null, 0).block();

        Assertions.assertNotNull(response);
        Assertions.assertEquals("https://cos.example/generated.png", response.url());
        Assertions.assertEquals(sourceUrl, response.sourceUrl());
        verify(persistenceService, never()).registerRemoteMediaForUser(any(), any(PersistenceDtos.RegisterRemoteMediaRequest.class));
    }

    /**
     * 验证图片转存失败时回退为登记原始链接，不使生成任务失败。
     *
     * @return void 无返回值
     */
    @Test
    void shouldFallbackToSourceUrlWhenImageTransferFails() {
        String sourceUrl = "https://provider.example/generated.png";
        when(aiHttpClient.downloadRemoteBinary(sourceUrl, "image/png"))
                .thenReturn(Mono.error(new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "下载图片失败")));
        when(aiHttpClient.readRemoteMediaHeaders(sourceUrl))
                .thenReturn(Mono.just(new AiHttpClient.RemoteMediaHeaders(12L, "image/png")));
        when(persistenceService.registerRemoteMediaForUser(eq(1L), any(PersistenceDtos.RegisterRemoteMediaRequest.class)))
                .thenReturn(Mono.just(mediaResponse(sourceUrl, sourceUrl)));

        PersistenceDtos.UploadedMediaResponse response = service.storeGeneratedImageItem(1L, imageItem(sourceUrl), null, null, 0).block();

        Assertions.assertNotNull(response);
        Assertions.assertEquals(sourceUrl, response.url());
        Assertions.assertEquals(sourceUrl, response.sourceUrl());
        Assertions.assertNull(response.objectStorage());
    }

    /**
     * 验证视频结果流式下载到临时文件后转存，成功后清理临时文件并保留原始链接。
     *
     * @return void 无返回值
     */
    @Test
    void shouldStoreLinkedVideoByStreamingTempFileAndKeepSourceUrl() {
        String sourceUrl = "https://provider.example/generated.mp4";
        AtomicReference<Path> temporaryFile = new AtomicReference<>();
        when(aiHttpClient.downloadRemoteMediaToFile(eq(sourceUrl), eq("video/mp4"), any(Path.class), anyLong()))
                .thenAnswer(invocation -> {
                    Path target = invocation.getArgument(2);
                    Assertions.assertTrue(Files.exists(target));
                    temporaryFile.set(target);
                    return Mono.just(new AiHttpClient.RemoteMediaFile(3L, "video/mp4"));
                });
        when(persistenceService.storeGeneratedMediaFileForUser(eq(1L), eq(AiTaskTypes.VIDEO), eq("generated.mp4"), eq("video/mp4"),
                any(Path.class), isNull(), isNull(), eq(5000), eq(sourceUrl)))
                .thenReturn(Mono.just(mediaResponse("https://cos.example/generated.mp4", sourceUrl)));

        PersistenceDtos.UploadedMediaResponse response = service.storeGeneratedMediaUrl(
                1L, AiTaskTypes.VIDEO, sourceUrl, "video/mp4", null, null, 5000).block();

        Assertions.assertNotNull(response);
        Assertions.assertEquals("https://cos.example/generated.mp4", response.url());
        Assertions.assertEquals(sourceUrl, response.sourceUrl());
        Assertions.assertFalse(Files.exists(temporaryFile.get()));
        verify(aiHttpClient, never()).downloadRemoteBinary(anyString(), anyString());
        verify(persistenceService, never()).registerRemoteMediaForUser(any(), any(PersistenceDtos.RegisterRemoteMediaRequest.class));
    }

    /**
     * 验证视频转存失败时清理临时文件并回退登记原始链接，不使生成任务失败。
     *
     * @return void 无返回值
     */
    @Test
    void shouldFallbackToSourceUrlWhenVideoTransferFailsAndCleanTempFile() {
        String sourceUrl = "https://provider.example/generated.mp4";
        AtomicReference<Path> temporaryFile = new AtomicReference<>();
        when(aiHttpClient.downloadRemoteMediaToFile(eq(sourceUrl), eq("video/mp4"), any(Path.class), anyLong()))
                .thenAnswer(invocation -> {
                    temporaryFile.set(invocation.getArgument(2));
                    return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "源视频超过大小限制"));
                });
        when(aiHttpClient.readRemoteMediaHeaders(sourceUrl))
                .thenReturn(Mono.just(new AiHttpClient.RemoteMediaHeaders(12L, "video/mp4")));
        when(persistenceService.registerRemoteMediaForUser(eq(1L), any(PersistenceDtos.RegisterRemoteMediaRequest.class)))
                .thenReturn(Mono.just(mediaResponse(sourceUrl, sourceUrl)));

        PersistenceDtos.UploadedMediaResponse response = service.storeGeneratedMediaUrl(
                1L, AiTaskTypes.VIDEO, sourceUrl, "video/mp4", null, null, 5000).block();

        Assertions.assertNotNull(response);
        Assertions.assertEquals(sourceUrl, response.url());
        Assertions.assertEquals(sourceUrl, response.sourceUrl());
        Assertions.assertNotNull(temporaryFile.get());
        Assertions.assertFalse(Files.exists(temporaryFile.get()));
    }

    /**
     * 验证Base64图片结果只保存云存储链接，sourceUrl保持为空。
     *
     * @return void 无返回值
     */
    @Test
    void shouldStoreBase64ImageResultWithoutSourceUrl() {
        JSONObject item = new JSONObject();
        item.put("b64_json", Base64.getEncoder().encodeToString(new byte[] {1, 2, 3}));
        when(persistenceService.storeGeneratedMediaForUser(eq(1L), eq(AiTaskTypes.IMAGE), eq("generated.png"), eq("image/png"),
                any(byte[].class), isNull(), isNull(), eq(0)))
                .thenReturn(Mono.just(mediaResponse("https://cos.example/generated.png", null)));

        PersistenceDtos.UploadedMediaResponse response = service.storeGeneratedImageItem(1L, item, null, null, 0).block();

        Assertions.assertNotNull(response);
        Assertions.assertEquals("https://cos.example/generated.png", response.url());
        Assertions.assertNull(response.sourceUrl());
        verify(aiHttpClient, never()).downloadRemoteBinary(anyString(), anyString());
        verify(persistenceService, never()).registerRemoteMediaForUser(any(), any(PersistenceDtos.RegisterRemoteMediaRequest.class));
    }

    /**
     * 验证url字段返回base64 data URL时应直接解码并转存，不能走远程下载。
     *
     * @return void 无返回值
     */
    @Test
    void shouldStoreDataUrlImageResultWithoutRemoteDownload() {
        byte[] expected = new byte[] {1, 2, 3};
        String dataUrl = "data:image/png;base64," + Base64.getEncoder().encodeToString(expected);
        when(persistenceService.storeGeneratedMediaForUser(eq(1L), eq(AiTaskTypes.IMAGE), eq("generated.png"), eq("image/png"),
                org.mockito.ArgumentMatchers.argThat((byte[] data) -> Arrays.equals(expected, data)), isNull(), isNull(), eq(0)))
                .thenReturn(Mono.just(mediaResponse("https://cos.example/generated.png", null)));

        PersistenceDtos.UploadedMediaResponse response = service.storeGeneratedImageItem(1L, imageItem(dataUrl), null, null, 0).block();

        Assertions.assertNotNull(response);
        Assertions.assertEquals("https://cos.example/generated.png", response.url());
        Assertions.assertNull(response.sourceUrl());
        verify(aiHttpClient, never()).downloadRemoteBinary(anyString(), anyString());
        verify(persistenceService, never()).registerRemoteMediaForUser(any(), any(PersistenceDtos.RegisterRemoteMediaRequest.class));
    }

    /** 参考媒体解析应拒绝任意非HTTP或data协议。 */
    @Test
    void shouldRejectUnsafeReferenceUrlProtocol() {
        AiTaskDtos.AiTaskMediaReference reference = new AiTaskDtos.AiTaskMediaReference(
                "reference-1", "参考", "image/png", "", " javascript:alert(1) ");

        Assertions.assertThrows(BusinessException.class, () -> service.resolveReferenceUrl(1L, reference).block());
        verify(persistenceService, never()).getMediaInfoForUser(any(), anyString());
    }

    /** 参考媒体解析应去除HTTP地址首尾空白。 */
    @Test
    void shouldTrimSafeReferenceUrl() {
        AiTaskDtos.AiTaskMediaReference reference = new AiTaskDtos.AiTaskMediaReference(
                "reference-1", "参考", "image/png", "", " https://example.com/reference.png ");

        Assertions.assertEquals("https://example.com/reference.png", service.resolveReferenceUrl(1L, reference).block());
    }

    /** 存储媒体查询为空时，参考解析应返回明确资源错误。 */
    @Test
    void shouldRejectMissingStoredReference() {
        when(persistenceService.getMediaInfoForUser(eq(1L), eq("image:missing"), any())).thenReturn(Mono.empty());
        AiTaskDtos.AiTaskMediaReference reference = new AiTaskDtos.AiTaskMediaReference(
                "reference-1", "参考", "image/png", "image:missing", null);

        BusinessException exception = Assertions.assertThrows(BusinessException.class, () -> service.resolveReferenceUrl(1L, reference).block());

        Assertions.assertTrue(exception.getMessage().contains("不存在或不属于当前用户"));
    }

    /**
     * 创建图片接口结果项。
     *
     * @param url String 图片地址
     * @return JSONObject 图片接口结果项
     */
    private JSONObject imageItem(String url) {
        JSONObject item = new JSONObject();
        item.put("url", url);
        item.put("mimeType", "image/png");
        return item;
    }

    /**
     * 创建媒体响应。
     *
     * @param url String 媒体访问地址
     * @param sourceUrl String 上游原始链接
     * @return UploadedMediaResponse 媒体响应
     */
    private PersistenceDtos.UploadedMediaResponse mediaResponse(String url, String sourceUrl) {
        return new PersistenceDtos.UploadedMediaResponse("media:test", url, 12L, "image/png", null, null, null, null, sourceUrl);
    }
}
