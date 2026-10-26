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
import io.agentscope.core.message.TextBlock;
import io.agentscope.core.model.ChatResponse;
import io.agentscope.core.model.Model;
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
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import reactor.core.publisher.Mono;
import reactor.core.publisher.Flux;

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
     * 自定义图片能力均应按模型开关替换size，同时保留模板写死的size。
     *
     * @param conversion boolean 是否转换为像素
     * @param editing boolean 是否为图生图
     * @param custom boolean 是否使用模型独立的尺寸映射
     */
    @ParameterizedTest
    @CsvSource({"false,false,false", "true,false,false", "false,true,false", "true,true,false",
            "false,false,true", "true,false,true", "false,true,true", "true,true,true"})
    void shouldResolveTemplateSizeWithoutChangingOriginalRatio(boolean conversion, boolean editing, boolean custom) {
        AiTaskExecutionContext context = imageContext(conversion, editing, "{\"size\":\"{{size}}\",\"resolution\":\"{{resolution}}\"}", null,
                custom ? Map.of("9:16", Map.of("2K", "1440x2560")) : null);
        stubImageResult();

        adapter.execute(context).block();

        ArgumentCaptor<JSONObject> body = ArgumentCaptor.forClass(JSONObject.class);
        verify(aiHttpClient).sendBearerJsonUrlRequest(any(), eq("POST"), anyString(), body.capture());
        Assertions.assertEquals(conversion ? custom ? "1440x2560" : "1152x2048" : "9:16", body.getValue().getString("size"));
        Assertions.assertEquals("2K", body.getValue().getString("resolution"));
        Assertions.assertEquals("9:16", context.request().parameters().get("size"));
        verifyNoInteractions(modelFactory);
    }

    /**
     * 模板未引用size时无需查表，手写值与省略size均不受缺失映射影响。
     *
     * @param editing boolean 是否为图生图
     * @param fixedSize boolean 模板是否写死size
     */
    @ParameterizedTest
    @CsvSource({"false,false", "false,true", "true,false", "true,true"})
    void shouldSkipConversionForTemplateWithoutSizePlaceholder(boolean editing, boolean fixedSize) {
        stubImageResult();

        String template = fixedSize ? "{\"size\":\"1024x1024\"}" : "{\"prompt\":\"{{prompt}}\"}";
        adapter.execute(imageContext(true, editing, template, null, Map.of())).block();

        ArgumentCaptor<JSONObject> body = ArgumentCaptor.forClass(JSONObject.class);
        verify(aiHttpClient).sendBearerJsonUrlRequest(any(), eq("POST"), anyString(), body.capture());
        Assertions.assertEquals(fixedSize ? "1024x1024" : null, body.getValue().getString("size"));
        verifyNoInteractions(modelFactory);
    }

    /**
     * AI构造请求应接收原始比例、分辨率和计算好的size，不自行换算。
     *
     * @param conversion boolean 是否转换为像素
     * @param expectedSize String 应传递的请求尺寸
     * @param custom boolean 是否使用模型尺寸表
     */
    @ParameterizedTest
    @CsvSource({"true,1152x2048,false", "false,9:16,false", "true,1440x2560,true"})
    void shouldDescribeCalculatedSizeToRequestAgent(boolean conversion, String expectedSize, boolean custom) {
        Model model = mock(Model.class);
        ChatResponse response = mock(ChatResponse.class);
        when(response.getContent()).thenReturn(List.of(TextBlock.builder().text("{\"size\":\"" + expectedSize + "\"}").build()));
        when(modelFactory.defaultTextModel()).thenReturn(Mono.just(model));
        when(model.stream(any(), any(), any())).thenAnswer(invocation -> {
            List<io.agentscope.core.message.Msg> messages = invocation.getArgument(0);
            String prompt = messages.getFirst().getTextContent();
            Assertions.assertTrue(prompt.contains("画幅: 9:16"));
            Assertions.assertTrue(prompt.contains("分辨率: 2K"));
            Assertions.assertTrue(prompt.contains("请求size: " + expectedSize));
            Assertions.assertTrue(prompt.contains("不要自行换算"));
            return Flux.just(response);
        });
        stubImageResult();

        adapter.execute(imageContext(conversion, false, "{}", "按参数构造size", custom ? Map.of("9:16", Map.of("2K", "1440x2560")) : null)).block();

        ArgumentCaptor<JSONObject> body = ArgumentCaptor.forClass(JSONObject.class);
        verify(aiHttpClient).sendBearerJsonUrlRequest(any(), eq("POST"), anyString(), body.capture());
        Assertions.assertEquals(expectedSize, body.getValue().getString("size"));
    }

    /** 选择未配置的档位时应在发起供应商请求前失败。 */
    @Test
    void shouldRejectUnconfiguredSizeBeforeSendingRequest() {
        AiTaskExecutionContext context = imageContext(true, false, "{\"size\":\"{{size}}\"}", null, Map.of());
        Assertions.assertThrows(BusinessException.class, () -> adapter.execute(context).block());
        verifyNoInteractions(aiHttpClient, persistenceService, modelFactory);
    }

    /**
     * AI把模型名改写成近似标识时，服务端应回填为配置的请求模型名称。
     *
     * @return void 无返回值
     */
    @Test
    void shouldRestoreModelNameRewrittenByAgent() {
        stubVideoAgentResult("{\"model\":\"seedance-2.0-fast-to-video\",\"prompt\":\"用户提示词\",\"duration\":5}");
        stubVideoSubmitResult();

        adapter.execute(videoContext("seedance-2.0-fast-text-to-video", "{\"model\":\"{{model}}\",\"prompt\":\"{{prompt}}\"}")).block();

        ArgumentCaptor<JSONObject> body = ArgumentCaptor.forClass(JSONObject.class);
        verify(aiHttpClient).sendBearerJsonUrlRequest(any(), eq("POST"), anyString(), body.capture());
        Assertions.assertEquals("seedance-2.0-fast-text-to-video", body.getValue().getString("model"));
    }

    /**
     * AI改写用户提示词时，服务端应回填为用户原始提示词。
     *
     * @return void 无返回值
     */
    @Test
    void shouldRestorePromptRewrittenByAgent() {
        stubVideoAgentResult("{\"model\":\"seedance-2.0-fast-text-to-video\",\"prompt\":\"被改写的提示词\"}");
        stubVideoSubmitResult();

        adapter.execute(videoContext("seedance-2.0-fast-text-to-video", "{\"model\":\"{{model}}\",\"prompt\":\"{{prompt}}\"}")).block();

        ArgumentCaptor<JSONObject> body = ArgumentCaptor.forClass(JSONObject.class);
        verify(aiHttpClient).sendBearerJsonUrlRequest(any(), eq("POST"), anyString(), body.capture());
        Assertions.assertEquals("真实电影感，清晨窗光下的木质桌面", body.getValue().getString("prompt"));
    }

    /**
     * AI输出没有模型字段时不应擅自新增，避免引入用户未要求的字段。
     *
     * @return void 无返回值
     */
    @Test
    void shouldNotAddModelFieldWhenAgentOmitsIt() {
        stubVideoAgentResult("{\"duration\":5}");
        stubVideoSubmitResult();

        adapter.execute(videoContext("seedance-2.0-fast-text-to-video", "{\"duration\":5}")).block();

        ArgumentCaptor<JSONObject> body = ArgumentCaptor.forClass(JSONObject.class);
        verify(aiHttpClient).sendBearerJsonUrlRequest(any(), eq("POST"), anyString(), body.capture());
        Assertions.assertFalse(body.getValue().containsKey("model"));
    }

    /**
     * 构造提示词里的模型占位符应替换为真实模型名，让模型直接照抄而无需翻译。
     *
     * @return void 无返回值
     */
    @Test
    void shouldRenderModelPlaceholderInAgentPrompt() {
        Model model = mock(Model.class);
        ChatResponse response = mock(ChatResponse.class);
        when(response.getContent()).thenReturn(List.of(TextBlock.builder().text("{\"model\":\"x\"}").build()));
        when(modelFactory.defaultTextModel()).thenReturn(Mono.just(model));
        when(model.stream(any(), any(), any())).thenAnswer(invocation -> {
            List<io.agentscope.core.message.Msg> messages = invocation.getArgument(0);
            String prompt = messages.getFirst().getTextContent();
            Assertions.assertTrue(prompt.contains("\"model\": \"seedance-2.0-fast-text-to-video\""));
            Assertions.assertFalse(prompt.contains("{{model}}"));
            return Flux.just(response);
        });
        stubVideoSubmitResult();

        adapter.execute(videoContext("seedance-2.0-fast-text-to-video", "{}")).block();

        verify(modelFactory).defaultTextModel();
    }

    /** 模拟AI构造请求体返回的JSON。 */
    private void stubVideoAgentResult(String body) {
        Model model = mock(Model.class);
        ChatResponse response = mock(ChatResponse.class);
        when(response.getContent()).thenReturn(List.of(TextBlock.builder().text(body).build()));
        when(modelFactory.defaultTextModel()).thenReturn(Mono.just(model));
        when(model.stream(any(), any(), any())).thenReturn(Flux.just(response));
    }

    /** 模拟视频提交接口直接返回媒体地址，避免进入轮询。 */
    private void stubVideoSubmitResult() {
        String sourceUrl = "https://provider.example/generated.mp4";
        when(aiHttpClient.sendBearerJsonUrlRequest(any(), eq("POST"), eq("https://provider.example/v1/videos/generations"), any()))
                .thenReturn(Mono.just(JSON.parseObject("{\"data\":{\"url\":\"" + sourceUrl + "\"}}")));
        when(aiHttpClient.readRemoteMediaHeaders(sourceUrl))
                .thenReturn(Mono.just(new AiHttpClient.RemoteMediaHeaders(12L, "video/mp4")));
        when(persistenceService.registerRemoteMediaForUser(eq(1L), any()))
                .thenReturn(Mono.just(mediaResponse(sourceUrl, "video/mp4")));
    }

    /**
     * 构造用于AI构造请求体验证的视频任务上下文。
     *
     * @param requestModelName String 配置的请求模型名称
     * @param template         String 请求模板
     * @return AiTaskExecutionContext 视频任务上下文
     */
    private AiTaskExecutionContext videoContext(String requestModelName, String template) {
        AiGenerationTask task = new AiGenerationTask();
        task.setId("custom-video-task");
        task.setUserId(1L);
        task.setTaskType(AiTaskTypes.VIDEO);
        PersistenceDtos.CustomModelGroupConfig group = new PersistenceDtos.CustomModelGroupConfig(
                "/videos/generations", "POST", requestModelName, template,
                "- model固定不变=" + requestModelName + "\n{\n  \"model\": \"{{model}}\",\n  \"prompt\": \"{{prompt}}\"\n}",
                "{}", "data.url", null, null, null, null, null, null);
        return new AiTaskExecutionContext(task,
                new AiTaskDtos.AiChannelConfig("custom-channel", "自定义渠道", "https://provider.example/v1", "key", "custom", List.of()),
                requestModelName, false, "", new JSONObject(),
                new AiTaskDtos.CreateAiTaskRequest(AiTaskTypes.VIDEO, "真实电影感，清晨窗光下的木质桌面", requestModelName,
                        Map.of("resolution", "480p", "seconds", "5"), List.of(), List.of(), "videoPage", List.of(), List.of(), "text-to-video", List.of()),
                () -> Mono.just(false), progress -> Mono.empty(), delta -> Mono.empty(), true,
                Map.of("text-to-video", group), false, null);
    }

    /** 模拟已完成的图片接口及其媒体登记。 */
    private void stubImageResult() {
        String sourceUrl = "https://provider.example/generated.png";
        when(aiHttpClient.sendBearerJsonUrlRequest(any(), eq("POST"), anyString(), any()))
                .thenReturn(Mono.just(JSON.parseObject("{\"data\":{\"url\":\"" + sourceUrl + "\"}}")));
        when(aiHttpClient.readRemoteMediaHeaders(sourceUrl))
                .thenReturn(Mono.just(new AiHttpClient.RemoteMediaHeaders(12L, "image/png")));
        when(persistenceService.registerRemoteMediaForUser(eq(1L), any()))
                .thenReturn(Mono.just(mediaResponse(sourceUrl, "image/png")));
    }

    /**
     * 开启异步查询的图片能力应提交拿任务ID后轮询查询接口取图。
     *
     * @return void 无返回值
     */
    @Test
    void shouldPollQueryForAsyncImageTask() {
        shortenPollingInterval();
        String sourceUrl = "https://provider.example/out.png";
        when(aiHttpClient.sendBearerJsonUrlRequest(any(), eq("POST"), eq("https://provider.example/v1/images/generations"), any()))
                .thenReturn(Mono.just(JSON.parseObject("{\"data\":{\"task_id\":\"img-1\"}}")));
        when(aiHttpClient.sendBearerJsonUrlRequest(any(), eq("GET"), eq("https://provider.example/v1/images/tasks/img-1"), any()))
                .thenReturn(Mono.just(JSON.parseObject("{\"data\":{\"status\":\"processing\"}}")))
                .thenReturn(Mono.just(JSON.parseObject("{\"data\":{\"status\":\"succeeded\",\"url\":\"" + sourceUrl + "\"}}")));
        when(aiHttpClient.readRemoteMediaHeaders(sourceUrl))
                .thenReturn(Mono.just(new AiHttpClient.RemoteMediaHeaders(12L, "image/png")));
        when(persistenceService.registerRemoteMediaForUser(eq(1L), any()))
                .thenReturn(Mono.just(mediaResponse(sourceUrl, "image/png")));

        JSONObject result = adapter.execute(asyncImageContext(asyncImageGroup("/images/tasks/{{taskId}}", "data.url"))).block();

        Assertions.assertEquals(sourceUrl, result.getJSONObject("item").getString("url"));
        // 一次提交加两次查询：第一轮仍在处理，第二轮取到地址
        verify(aiHttpClient, org.mockito.Mockito.times(3)).sendBearerJsonUrlRequest(any(), anyString(), anyString(), any());
        verifyNoInteractions(modelFactory);
    }

    /**
     * 查询接口返回data URL时同样按图片内容转存，不要求http地址。
     *
     * @return void 无返回值
     * @throws IOException 测试图片编码失败时抛出
     */
    @Test
    void shouldStoreDataUrlReturnedByAsyncImageQuery() throws IOException {
        shortenPollingInterval();
        byte[] expected = imageBytes("jpeg");
        when(aiHttpClient.sendBearerJsonUrlRequest(any(), eq("POST"), eq("https://provider.example/v1/images/generations"), any()))
                .thenReturn(Mono.just(JSON.parseObject("{\"data\":{\"task_id\":\"img-1\"}}")));
        when(aiHttpClient.sendBearerJsonUrlRequest(any(), eq("GET"), eq("https://provider.example/v1/images/tasks/img-1"), any()))
                .thenReturn(Mono.just(JSON.parseObject("{\"data\":{\"image\":\"data:image/jpeg;base64,"
                        + Base64.getEncoder().encodeToString(expected) + "\"}}")));
        when(persistenceService.storeGeneratedMediaForUser(eq(1L), eq(AiTaskTypes.IMAGE), eq("generated.jpg"), eq("image/jpeg"),
                eq(expected), eq(null), eq(null), eq(null)))
                .thenReturn(Mono.just(mediaResponse("https://storage.example/generated.jpg", "image/jpeg")));

        JSONObject result = adapter.execute(asyncImageContext(asyncImageGroup("/images/tasks/{{taskId}}", "data.image"))).block();

        Assertions.assertEquals("image/jpeg", result.getJSONObject("item").getString("mimeType"));
        verify(persistenceService, never()).registerRemoteMediaForUser(any(), any());
    }

    /**
     * 图片保持同步时，残留的查询字段不会触发轮询。
     *
     * @return void 无返回值
     */
    @Test
    void shouldNotPollQueryForSyncImageWithQueryFields() {
        shortenPollingInterval();
        String sourceUrl = "https://provider.example/generated.png";
        when(aiHttpClient.sendBearerJsonUrlRequest(any(), eq("POST"), eq("https://provider.example/v1/images/generations"), any()))
                .thenReturn(Mono.just(JSON.parseObject("{\"data\":{\"url\":\"" + sourceUrl + "\"}}")));
        when(aiHttpClient.readRemoteMediaHeaders(sourceUrl))
                .thenReturn(Mono.just(new AiHttpClient.RemoteMediaHeaders(12L, "image/png")));
        when(persistenceService.registerRemoteMediaForUser(eq(1L), any()))
                .thenReturn(Mono.just(mediaResponse(sourceUrl, "image/png")));
        PersistenceDtos.CustomModelGroupConfig group = new PersistenceDtos.CustomModelGroupConfig(
                "/images/generations", "POST", "image-model", "{}", null, null, "data.url",
                "/images/tasks/{{taskId}}", "GET", null, null, null, "data.url", null, null);

        JSONObject result = adapter.execute(asyncImageContext(group)).block();

        Assertions.assertEquals(sourceUrl, result.getJSONObject("item").getString("url"));
        verify(aiHttpClient, org.mockito.Mockito.times(1)).sendBearerJsonUrlRequest(any(), anyString(), anyString(), any());
        verifyNoInteractions(modelFactory);
    }

    /** 构造带异步开关的图片分组配置，提交响应按结果路径取出任务ID。 */
    private PersistenceDtos.CustomModelGroupConfig asyncImageGroup(String queryPath, String queryResultPath) {
        return new PersistenceDtos.CustomModelGroupConfig("/images/generations", "POST", "image-model", "{}", null, null,
                "data.task_id", queryPath, "GET", null, null, null, queryResultPath, null, Boolean.TRUE);
    }

    /** 构造图片异步查询任务的执行上下文。 */
    private AiTaskExecutionContext asyncImageContext(PersistenceDtos.CustomModelGroupConfig group) {
        AiGenerationTask task = new AiGenerationTask();
        task.setId("custom-async-image-task");
        task.setUserId(1L);
        task.setTaskType(AiTaskTypes.IMAGE);
        return new AiTaskExecutionContext(task,
                new AiTaskDtos.AiChannelConfig("custom-channel", "自定义渠道", "https://provider.example/v1", "key", "custom", List.of()),
                "image-model", false, "", new JSONObject(),
                new AiTaskDtos.CreateAiTaskRequest(AiTaskTypes.IMAGE, "生成小猫", "image-model", Map.of(), List.of(), List.of(), "imagePage"),
                () -> Mono.just(false), progress -> Mono.empty(), delta -> Mono.empty(), true,
                Map.of("text-to-image", group), false, null);
    }

    /** 把轮询间隔压到1秒，避免测试等待默认的3秒。 */
    private void shortenPollingInterval() {
        NovanovaProperties properties = (NovanovaProperties) ReflectionTestUtils.getField(adapter, "properties");
        properties.getAi().getTask().setPollingIntervalSeconds(1);
    }

    /**
     * 构造用于自定义图片请求尺寸验证的执行上下文。
     *
     * @param conversion boolean 是否转换为像素
     * @param editing boolean 是否为图生图
     * @param template String 请求模板
     * @param agentPrompt String AI请求构造提示词
     * @param mappings Map<String, Map<String, String>> 模型独立的尺寸映射
     * @return AiTaskExecutionContext 图片任务上下文
     */
    private AiTaskExecutionContext imageContext(boolean conversion, boolean editing, String template, String agentPrompt,
                                               Map<String, Map<String, String>> mappings) {
        AiGenerationTask task = new AiGenerationTask();
        task.setId("custom-size-task");
        task.setUserId(1L);
        task.setTaskType(AiTaskTypes.IMAGE);
        PersistenceDtos.CustomModelGroupConfig group = new PersistenceDtos.CustomModelGroupConfig(
                "/images/generations", "POST", "custom-image", template, agentPrompt,
                "{}", "data.url", null, null, null, null, null, null);
        List<AiTaskDtos.AiTaskMediaReference> references = editing ? List.of(new AiTaskDtos.AiTaskMediaReference(
                "reference", "参考图片", "image/png", null, "https://provider.example/reference.png")) : List.of();
        return new AiTaskExecutionContext(task,
                new AiTaskDtos.AiChannelConfig("custom-channel", "自定义渠道", "https://provider.example/v1", "key", "custom", List.of()),
                "custom-image", false, "", new JSONObject(),
                new AiTaskDtos.CreateAiTaskRequest(AiTaskTypes.IMAGE, "生成小猫", "custom-image", Map.of("size", "9:16", "resolution", "2K"), references, List.of(), "imagePage"),
                () -> Mono.just(false), progress -> Mono.empty(), delta -> Mono.empty(), true,
                Map.of(editing ? "image-to-image" : "text-to-image", group), conversion, mappings);
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
                Map.of(AiTaskTypes.VIDEO.equals(taskKind) ? "text-to-video" : "text-to-image", group), false, null);
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
