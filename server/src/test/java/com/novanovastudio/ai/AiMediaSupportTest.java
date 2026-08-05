package com.novanovastudio.ai;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.dto.PersistenceDtos;
import com.novanovastudio.service.PersistenceService;
import java.util.Base64;
import java.util.Arrays;
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
     * 验证关闭开关时HTTP图片仅登记原始地址。
     *
     * @return void 无返回值
     */
    @Test
    void shouldRegisterHttpImageUrlWhenObjectStorageUploadIsDisabled() {
        String sourceUrl = "http://provider.example/generated.png";
        when(aiHttpClient.readRemoteMediaHeaders(sourceUrl)).thenReturn(Mono.just(new AiHttpClient.RemoteMediaHeaders(12L, "image/png")));
        when(persistenceService.registerRemoteMediaForUser(eq(1L), any(PersistenceDtos.RegisterRemoteMediaRequest.class)))
                .thenReturn(Mono.just(mediaResponse(sourceUrl)));

        PersistenceDtos.UploadedMediaResponse response = service.storeGeneratedImageItem(1L, imageItem(sourceUrl), null, null, 0).block();

        Assertions.assertNotNull(response);
        Assertions.assertEquals(sourceUrl, response.url());
        verify(aiHttpClient, never()).downloadRemoteBinary(anyString(), anyString());
        verify(persistenceService, never()).storeGeneratedMediaForUser(any(), anyString(), anyString(), anyString(), any(), any(), any(), any());
    }

    /**
     * 验证开启开关时HTTP图片转存到默认对象存储。
     *
     * @return void 无返回值
     */
    @Test
    void shouldUploadHttpImageResultToObjectStorageWhenEnabled() {
        String sourceUrl = "http://provider.example/generated.png";
        GeneratedBinary binary = new GeneratedBinary(new byte[] {1, 2, 3}, "image/png");
        properties.getAi().getImage().setUploadHttpResultToObjectStorage(true);
        when(aiHttpClient.downloadRemoteBinary(sourceUrl, "image/png")).thenReturn(Mono.just(binary));
        when(persistenceService.storeGeneratedMediaForUser(eq(1L), eq(AiTaskTypes.IMAGE), eq("generated.png"), eq("image/png"), eq(binary.data()), eq(null), eq(null), eq(0)))
                .thenReturn(Mono.just(mediaResponse("https://cos.example/generated.png")));

        PersistenceDtos.UploadedMediaResponse response = service.storeGeneratedImageItem(1L, imageItem(sourceUrl), null, null, 0).block();

        Assertions.assertNotNull(response);
        Assertions.assertEquals("https://cos.example/generated.png", response.url());
        verify(persistenceService, never()).registerRemoteMediaForUser(any(), any(PersistenceDtos.RegisterRemoteMediaRequest.class));
    }

    /**
     * 验证开启开关后下载失败会直接使生成结果失败。
     *
     * @return void 无返回值
     */
    @Test
    void shouldFailHttpImageResultWhenRemoteDownloadFails() {
        String sourceUrl = "http://provider.example/generated.png";
        properties.getAi().getImage().setUploadHttpResultToObjectStorage(true);
        when(aiHttpClient.downloadRemoteBinary(sourceUrl, "image/png"))
                .thenReturn(Mono.error(new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "下载图片失败")));

        Assertions.assertThrows(BusinessException.class, () -> service.storeGeneratedImageItem(1L, imageItem(sourceUrl), null, null, 0).block());

        verify(persistenceService, never()).registerRemoteMediaForUser(any(), any(PersistenceDtos.RegisterRemoteMediaRequest.class));
        verify(persistenceService, never()).storeGeneratedMediaForUser(any(), anyString(), anyString(), anyString(), any(), any(), any(), any());
    }

    /**
     * 验证开启开关后对象存储上传失败会直接使生成结果失败。
     *
     * @return void 无返回值
     */
    @Test
    void shouldFailHttpImageResultWhenObjectStorageUploadFails() {
        String sourceUrl = "http://provider.example/generated.png";
        GeneratedBinary binary = new GeneratedBinary(new byte[] {1, 2, 3}, "image/png");
        properties.getAi().getImage().setUploadHttpResultToObjectStorage(true);
        when(aiHttpClient.downloadRemoteBinary(sourceUrl, "image/png")).thenReturn(Mono.just(binary));
        when(persistenceService.storeGeneratedMediaForUser(eq(1L), eq(AiTaskTypes.IMAGE), eq("generated.png"), eq("image/png"), eq(binary.data()), eq(null), eq(null), eq(0)))
                .thenReturn(Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "对象存储上传失败")));

        Assertions.assertThrows(BusinessException.class, () -> service.storeGeneratedImageItem(1L, imageItem(sourceUrl), null, null, 0).block());

        verify(persistenceService, never()).registerRemoteMediaForUser(any(), any(PersistenceDtos.RegisterRemoteMediaRequest.class));
    }

    /**
     * 验证HTTPS图片结果仍按原始远程地址登记。
     *
     * @return void 无返回值
     */
    @Test
    void shouldKeepHttpsImageResultAsRemoteUrlWhenObjectStorageUploadIsEnabled() {
        String sourceUrl = "https://provider.example/generated.png";
        properties.getAi().getImage().setUploadHttpResultToObjectStorage(true);
        when(aiHttpClient.readRemoteMediaHeaders(sourceUrl)).thenReturn(Mono.just(new AiHttpClient.RemoteMediaHeaders(12L, "image/png")));
        when(persistenceService.registerRemoteMediaForUser(eq(1L), any(PersistenceDtos.RegisterRemoteMediaRequest.class)))
                .thenReturn(Mono.just(mediaResponse(sourceUrl)));

        PersistenceDtos.UploadedMediaResponse response = service.storeGeneratedImageItem(1L, imageItem(sourceUrl), null, null, 0).block();

        Assertions.assertNotNull(response);
        Assertions.assertEquals(sourceUrl, response.url());
        verify(aiHttpClient, never()).downloadRemoteBinary(anyString(), anyString());
    }

    /**
     * 验证Base64图片结果仍直接保存到默认对象存储。
     *
     * @return void 无返回值
     */
    @Test
    void shouldStoreBase64ImageResultWithoutRemoteDownload() {
        JSONObject item = new JSONObject();
        item.put("b64_json", Base64.getEncoder().encodeToString(new byte[] {1, 2, 3}));
        when(persistenceService.storeGeneratedMediaForUser(eq(1L), eq(AiTaskTypes.IMAGE), eq("generated.png"), eq("image/png"), any(byte[].class), eq(null), eq(null), eq(0)))
                .thenReturn(Mono.just(mediaResponse("https://cos.example/generated.png")));

        PersistenceDtos.UploadedMediaResponse response = service.storeGeneratedImageItem(1L, item, null, null, 0).block();

        Assertions.assertNotNull(response);
        Assertions.assertEquals("https://cos.example/generated.png", response.url());
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
                org.mockito.ArgumentMatchers.argThat((byte[] data) -> Arrays.equals(expected, data)), eq(null), eq(null), eq(0)))
                .thenReturn(Mono.just(mediaResponse("https://cos.example/generated.png")));

        PersistenceDtos.UploadedMediaResponse response = service.storeGeneratedImageItem(1L, imageItem(dataUrl), null, null, 0).block();

        Assertions.assertNotNull(response);
        Assertions.assertEquals("https://cos.example/generated.png", response.url());
        verify(aiHttpClient, never()).downloadRemoteBinary(anyString(), anyString());
        verify(persistenceService, never()).registerRemoteMediaForUser(any(), any(PersistenceDtos.RegisterRemoteMediaRequest.class));
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
     * @return UploadedMediaResponse 媒体响应
     */
    private PersistenceDtos.UploadedMediaResponse mediaResponse(String url) {
        return new PersistenceDtos.UploadedMediaResponse("image:test", url, 12L, "image/png", null, null, 0, null);
    }
}
