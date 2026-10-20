package com.novanovastudio.ai.provider;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.agent.AgentScopeModelFactory;
import com.novanovastudio.ai.AiHttpClient;
import com.novanovastudio.ai.AiMediaSupport;
import com.novanovastudio.ai.AiTaskExecutionContext;
import com.novanovastudio.ai.AiTaskTypes;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.dto.AiTaskDtos;
import com.novanovastudio.dto.PersistenceDtos;
import com.novanovastudio.entity.AiGenerationTask;
import com.novanovastudio.service.PersistenceService;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.test.util.ReflectionTestUtils;
import reactor.core.publisher.Mono;

/**
 * 自定义模型图片结果解析与存储测试。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-20 16:00
 */
class CustomProviderAdapterTest {

    /** 第三方接口客户端。 */
    private AiHttpClient aiHttpClient;

    /** 媒体持久化服务。 */
    private PersistenceService persistenceService;

    /** 用于确认已配置的图片结果不会交给文本模型处理。 */
    private AgentScopeModelFactory modelFactory;

    /** 待测试的自定义模型适配器。 */
    private CustomProviderAdapter adapter;

    /**
     * 使用真实媒体解析流程初始化适配器，仅模拟外部接口与持久化。
     *
     * @return void 无返回值
     */
    @BeforeEach
    void setUp() {
        aiHttpClient = mock(AiHttpClient.class);
        persistenceService = mock(PersistenceService.class);
        modelFactory = mock(AgentScopeModelFactory.class);
        NovanovaProperties properties = new NovanovaProperties();
        adapter = new CustomProviderAdapter(aiHttpClient, new AiMediaSupport(aiHttpClient, persistenceService, properties), properties);
        ReflectionTestUtils.setField(adapter, "agentScopeModelFactory", modelFactory);
    }

    /**
     * 结果路径中的纯Base64应按实际图片格式转存，支持统一响应包装。
     *
     * @param format String 图片格式
     * @param wrapped boolean 是否包装code/data响应
     * @return void 无返回值
     * @throws IOException 测试图片编码失败时抛出
     */
    @ParameterizedTest
    @CsvSource({"png,false", "jpeg,false", "png,true", "jpeg,true"})
    void shouldStoreBase64ImageFromConfiguredPath(String format, boolean wrapped) throws IOException {
        byte[] expected = imageBytes(format);
        String mimeType = "image/" + format;
        String fileName = "generated." + ("jpeg".equals(format) ? "jpg" : format);
        when(persistenceService.storeGeneratedMediaForUser(eq(1L), eq(AiTaskTypes.IMAGE), eq(fileName), eq(mimeType),
                eq(expected), eq(null), eq(null), eq(null)))
                .thenReturn(Mono.just(mediaResponse("https://storage.example/generated", mimeType)));

        JSONObject result = execute(AiTaskTypes.IMAGE, Base64.getEncoder().encodeToString(expected), wrapped);

        Assertions.assertEquals("https://storage.example/generated", result.getJSONObject("item").getString("url"));
        verify(persistenceService).storeGeneratedMediaForUser(eq(1L), eq(AiTaskTypes.IMAGE), eq(fileName), eq(mimeType),
                eq(expected), eq(null), eq(null), eq(null));
        verify(persistenceService, never()).registerRemoteMediaForUser(any(), any());
        verify(aiHttpClient, never()).readRemoteMediaHeaders(anyString());
        verify(aiHttpClient, never()).downloadRemoteBinary(anyString(), anyString());
        verifyNoInteractions(modelFactory);
    }

    /**
     * 带媒体类型前缀的Base64图片应复用data URL解析并转存。
     *
     * @return void 无返回值
     * @throws IOException 测试图片编码失败时抛出
     */
    @Test
    void shouldStoreDataUrlImageFromConfiguredPath() throws IOException {
        byte[] expected = imageBytes("jpeg");
        when(persistenceService.storeGeneratedMediaForUser(eq(1L), eq(AiTaskTypes.IMAGE), eq("generated.jpg"), eq("image/jpeg"),
                eq(expected), eq(null), eq(null), eq(null)))
                .thenReturn(Mono.just(mediaResponse("https://storage.example/generated.jpg", "image/jpeg")));

        JSONObject result = execute(AiTaskTypes.IMAGE, "data:image/jpeg;base64," + Base64.getEncoder().encodeToString(expected), false);

        Assertions.assertEquals("image/jpeg", result.getJSONObject("item").getString("mimeType"));
        verify(persistenceService, never()).registerRemoteMediaForUser(any(), any());
        verify(aiHttpClient, never()).downloadRemoteBinary(anyString(), anyString());
        verifyNoInteractions(modelFactory);
    }

    /**
     * 普通图片和视频地址应继续登记远程媒体，不作为Base64转存。
     *
     * @param taskKind String 任务类型
     * @param sourceUrl String 第三方媒体地址
     * @param mimeType String 媒体类型
     * @return void 无返回值
     */
    @ParameterizedTest
    @CsvSource({"image,https://provider.example/generated.jpg,image/jpeg",
            "image,http://provider.example/generated.jpg,image/jpeg",
            "video,https://provider.example/generated.mp4,video/mp4"})
    void shouldKeepRegisteringRemoteMedia(String taskKind, String sourceUrl, String mimeType) {
        when(aiHttpClient.readRemoteMediaHeaders(sourceUrl))
                .thenReturn(Mono.just(new AiHttpClient.RemoteMediaHeaders(12L, mimeType)));
        when(persistenceService.registerRemoteMediaForUser(eq(1L), any()))
                .thenReturn(Mono.just(mediaResponse(sourceUrl, mimeType)));

        JSONObject result = execute(taskKind, sourceUrl, false);

        Assertions.assertEquals(sourceUrl, result.getJSONObject("item").getString("url"));
        verify(persistenceService, never()).storeGeneratedMediaForUser(any(), anyString(), anyString(), anyString(), any(), any(), any(), any());
        verifyNoInteractions(modelFactory);
    }

    /**
     * 已命中路径但Base64不合法时应明确失败，不能调用文本模型猜测地址。
     *
     * @return void 无返回值
     */
    @Test
    void shouldRejectInvalidBase64WithoutAgentExtraction() {
        Assertions.assertThrows(IllegalArgumentException.class, () -> execute(AiTaskTypes.IMAGE, "不是Base64图片", false));

        verifyNoInteractions(persistenceService, modelFactory);
    }

    /**
     * Base64转存失败应传播原始业务错误，不能改为登记远程地址。
     *
     * @return void 无返回值
     * @throws IOException 测试图片编码失败时抛出
     */
    @Test
    void shouldPropagateImageStorageFailure() throws IOException {
        BusinessException failure = new BusinessException(ErrorCode.BUSINESS_ERROR, "对象存储上传失败");
        when(persistenceService.storeGeneratedMediaForUser(any(), anyString(), anyString(), anyString(), any(), any(), any(), any()))
                .thenReturn(Mono.error(failure));
        String base64 = Base64.getEncoder().encodeToString(imageBytes("png"));

        Assertions.assertSame(failure, Assertions.assertThrows(BusinessException.class, () -> execute(AiTaskTypes.IMAGE, base64, false)));

        verify(persistenceService, never()).registerRemoteMediaForUser(any(), any());
        verifyNoInteractions(modelFactory);
    }

    /**
     * 构造与真实接口相同的结果路径并执行任务。
     *
     * @param taskKind String 任务类型
     * @param value String 结果路径上的媒体内容或地址
     * @param wrapped boolean 是否包装code/data响应
     * @return JSONObject 生成任务结果
     */
    private JSONObject execute(String taskKind, String value, boolean wrapped) {
        JSONObject response = JSON.parseObject("{\"task_id\":\"image:provider-task\",\"data\":[{}]}");
        response.getJSONArray("data").getJSONObject(0).put("b64_json", value);
        if (wrapped) {
            response = new JSONObject(Map.of("code", 0, "data", response));
        }
        when(aiHttpClient.sendBearerJsonUrlRequest(any(), eq("POST"), eq("https://provider.example/v1/images/generations"), any()))
                .thenReturn(Mono.just(response));
        AiGenerationTask task = new AiGenerationTask();
        task.setId("custom-task");
        task.setUserId(1L);
        task.setTaskType(taskKind);
        PersistenceDtos.CustomModelGroupConfig group = new PersistenceDtos.CustomModelGroupConfig(
                "/images/generations", "POST", "custom-image", "{}", null,
                "{\"data\":[{\"b64_json\":\"xxxx\"}]}", "data[0].b64_json", null, null, null, null, null, null);
        AiTaskExecutionContext context = new AiTaskExecutionContext(task,
                new AiTaskDtos.AiChannelConfig("custom-channel", "自定义渠道", "https://provider.example/v1", "test-key", "custom", List.of()),
                "custom-image", false, "", new JSONObject(),
                new AiTaskDtos.CreateAiTaskRequest(taskKind, "生成一只小猫", "custom-image", Map.of(), List.of(), List.of(), "imagePage"),
                () -> Mono.just(false), progress -> Mono.empty(), delta -> Mono.empty(), true,
                Map.of(AiTaskTypes.VIDEO.equals(taskKind) ? "text-to-video" : "text-to-image", group));
        return adapter.execute(context).block();
    }

    /**
     * 创建真实的单像素图片，验证解码字节与媒体类型。
     *
     * @param format String 图片编码格式
     * @return byte[] 图片二进制内容
     * @throws IOException 图片编码失败时抛出
     */
    private byte[] imageBytes(String format) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        Assertions.assertTrue(ImageIO.write(new BufferedImage(1, 1, BufferedImage.TYPE_INT_RGB), format, output));
        return output.toByteArray();
    }

    /**
     * 构造媒体持久化响应。
     *
     * @param url String 媒体访问地址
     * @param mimeType String 媒体类型
     * @return UploadedMediaResponse 媒体响应
     */
    private PersistenceDtos.UploadedMediaResponse mediaResponse(String url, String mimeType) {
        return new PersistenceDtos.UploadedMediaResponse("image:test", url, 12L, mimeType, null, null, null, null);
    }
}
