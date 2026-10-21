package com.novanovastudio.ai.provider;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.ai.AiHttpClient;
import com.novanovastudio.ai.AiMediaSupport;
import com.novanovastudio.ai.AiProviderAdapter;
import com.novanovastudio.ai.AiTaskExecutionContext;
import com.novanovastudio.ai.AiTaskTypes;
import com.novanovastudio.ai.GeneratedBinary;
import com.novanovastudio.ai.MultipartPart;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.dto.AiTaskDtos;
import com.novanovastudio.entity.AiGenerationTask;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

/**
 * 普通图片模型的比例开关、图片编辑与手写尺寸优先级测试。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-20 17:00
 */
class ImageSizeProviderRequestTest {

    /**
     * 文生图和图生图的请求均应遵循当前模型的转换开关。
     *
     * @param provider String 渠道格式
     * @param editing boolean 是否携带参考图
     * @param custom boolean 是否使用模型自定义尺寸表
     */
    @ParameterizedTest
    @CsvSource({"openai,false,false", "openai,true,false", "newapi,false,false", "newapi,true,false", "agnes,false,false", "agnes,true,false",
            "openai,false,true", "openai,true,true", "newapi,false,true", "newapi,true,true", "agnes,false,true", "agnes,true,true"})
    void shouldUseModelConversionForGenerationAndEditing(String provider, boolean editing, boolean custom) {
        AiHttpClient client = mock(AiHttpClient.class);
        AiMediaSupport mediaSupport = mock(AiMediaSupport.class);
        AiProviderAdapter adapter = adapter(provider, client, mediaSupport);
        AtomicReference<String> submittedSize = new AtomicReference<>();
        when(client.sendJsonRequest(any(), eq("POST"), eq("/images/generations"), any()))
                .thenAnswer(invocation -> {
                    Map<?, ?> payload = invocation.getArgument(3);
                    submittedSize.set((String) payload.get("size"));
                    return Mono.error(new IllegalStateException("测试已捕获请求"));
                });
        when(client.formPart(anyString(), anyString())).thenAnswer(invocation -> new MultipartPart(
                invocation.getArgument(0), null, null, invocation.<String>getArgument(1).getBytes(StandardCharsets.UTF_8)));
        when(client.filePart(anyString(), anyString(), anyString(), any())).thenAnswer(invocation -> new MultipartPart(
                invocation.getArgument(0), invocation.getArgument(1), invocation.getArgument(2), invocation.getArgument(3)));
        when(client.sendMultipartRequest(any(), eq("/images/edits"), anyString(), anyList()))
                .thenAnswer(invocation -> {
                    List<MultipartPart> parts = invocation.getArgument(3);
                    submittedSize.set(parts.stream().filter(part -> "size".equals(part.name()))
                            .map(part -> new String(part.data(), StandardCharsets.UTF_8)).findFirst().orElseThrow());
                    return Mono.error(new IllegalStateException("测试已捕获请求"));
                });
        when(mediaSupport.resolveReferenceUrl(any(), any())).thenReturn(Mono.just("https://example.com/reference.png"));
        when(mediaSupport.resolveReferenceBinary(any(), any(), anyString()))
                .thenReturn(Mono.just(new GeneratedBinary(new byte[]{1}, "image/png")));

        for (boolean conversion : List.of(false, true)) {
            AiTaskExecutionContext context = context(conversion, editing, new JSONObject(), custom ? Map.of("9:16", Map.of("2K", "1440x2560")) : null);
            StepVerifier.create(adapter.execute(context)).expectErrorMessage("测试已捕获请求").verify();
            Assertions.assertEquals(conversion ? custom ? "1440x2560" : "1152x2048" : "9:16", submittedSize.get());
            Assertions.assertEquals("9:16", context.request().parameters().get("size"));
        }
    }

    /**
     * 普通模型自定义JSON中明确指定的size应覆盖自动转换结果。
     *
     * @param provider String 渠道格式
     */
    @ParameterizedTest
    @CsvSource({"openai", "newapi", "agnes"})
    void shouldKeepExplicitJsonSize(String provider) {
        AiHttpClient client = mock(AiHttpClient.class);
        when(client.sendJsonRequest(any(), eq("POST"), eq("/images/generations"), any()))
                .thenAnswer(invocation -> {
                    Map<?, ?> payload = invocation.getArgument(3);
                    Assertions.assertEquals("1536x1024", payload.get("size"));
                    return Mono.error(new IllegalStateException("测试已捕获请求"));
                });

        StepVerifier.create(adapter(provider, client, mock(AiMediaSupport.class))
                        .execute(context(true, false, new JSONObject(Map.of("size", "1536x1024")), Map.of())))
                .expectErrorMessage("测试已捕获请求").verify();
    }

    /**
     * 创建真实适配器，避免仅测试私有尺寸函数而漏掉请求组装。
     *
     * @param provider String 渠道格式
     * @param client AiHttpClient 第三方客户端
     * @param mediaSupport AiMediaSupport 媒体依赖
     * @return AiProviderAdapter 图片适配器
     */
    private AiProviderAdapter adapter(String provider, AiHttpClient client, AiMediaSupport mediaSupport) {
        return switch (provider) {
            case "openai" -> new OpenAiProviderAdapter(client, mediaSupport, new NovanovaProperties());
            case "newapi" -> new NewApiProviderAdapter(client, mediaSupport, new NovanovaProperties());
            case "agnes" -> new AgnesProviderAdapter(client, mediaSupport, new NovanovaProperties());
            default -> throw new IllegalArgumentException("不支持的测试渠道");
        };
    }

    /**
     * Evolink 图片任务在 size 为比例时必须同时发送 resolution，否则供应商按默认档位生成。
     */
    @Test
    void shouldSendEvolinkImageResolutionWithRatioSize() {
        AiHttpClient client = mock(AiHttpClient.class);
        AiMediaSupport mediaSupport = mock(AiMediaSupport.class);
        AiGenerationTask task = new AiGenerationTask();
        task.setId("evolink-image-task");
        task.setTaskType(AiTaskTypes.IMAGE);
        task.setUserId(7L);
        AiTaskDtos.CreateAiTaskRequest request = new AiTaskDtos.CreateAiTaskRequest(AiTaskTypes.IMAGE, "夜晚街头人像",
                "gpt-image-2", Map.<String, Object>of("size", "9:16", "resolution", "2k", "quality", "medium"),
                List.of(), List.of(), "imagePage");
        AiTaskDtos.AiChannelConfig channel = new AiTaskDtos.AiChannelConfig("channel", "Evolink",
                "https://api.evolink.ai/v1", "key", "evolink", List.of("gpt-image-2"));
        when(client.sendJsonRequest(any(), eq("POST"), eq("/images/generations"), any()))
                .thenAnswer(invocation -> {
                    Map<?, ?> payload = invocation.getArgument(3);
                    Assertions.assertEquals("9:16", payload.get("size"));
                    Assertions.assertEquals("2K", payload.get("resolution"));
                    Assertions.assertEquals("medium", payload.get("quality"));
                    return Mono.error(new IllegalStateException("测试已捕获请求"));
                });

        AiTaskExecutionContext context = new AiTaskExecutionContext(task, channel, "gpt-image-2", false, "high", request,
                () -> Mono.just(false), progress -> Mono.empty(), delta -> Mono.empty());

        StepVerifier.create(new EvolinkProviderAdapter(client, mediaSupport, new NovanovaProperties()).execute(context))
                .expectErrorMessage("测试已捕获请求").verify();
    }

    /**
     * Gemini/Nano Banana 用 quality 表示分辨率档位：不能发 resolution，也不能发画质值。
     */
    @Test
    void shouldSendGeminiResolutionAsQuality() {
        AiHttpClient client = mock(AiHttpClient.class);
        AiMediaSupport mediaSupport = mock(AiMediaSupport.class);
        AiGenerationTask task = new AiGenerationTask();
        task.setId("evolink-gemini-task");
        task.setTaskType(AiTaskTypes.IMAGE);
        task.setUserId(7L);
        AiTaskDtos.CreateAiTaskRequest request = new AiTaskDtos.CreateAiTaskRequest(AiTaskTypes.IMAGE, "夜晚街头人像",
                "gemini-nano-banana-2.1", Map.<String, Object>of("size", "9:16", "resolution", "4k", "quality", "medium", "count", 1),
                List.of(), List.of(), "imagePage");
        AiTaskDtos.AiChannelConfig channel = new AiTaskDtos.AiChannelConfig("channel", "Evolink",
                "https://api.evolink.ai/v1", "key", "evolink", List.of("gemini-nano-banana-2.1"));
        when(client.sendJsonRequest(any(), eq("POST"), eq("/images/generations"), any()))
                .thenAnswer(invocation -> {
                    Map<?, ?> payload = invocation.getArgument(3);
                    Assertions.assertEquals("9:16", payload.get("size"));
                    Assertions.assertEquals("4K", payload.get("quality"));
                    Assertions.assertFalse(payload.containsKey("resolution"));
                    Assertions.assertFalse(payload.containsKey("n"));
                    return Mono.error(new IllegalStateException("测试已捕获请求"));
                });

        AiTaskExecutionContext context = new AiTaskExecutionContext(task, channel, "gemini-nano-banana-2.1", false, "high", request,
                () -> Mono.just(false), progress -> Mono.empty(), delta -> Mono.empty());

        StepVerifier.create(new EvolinkProviderAdapter(client, mediaSupport, new NovanovaProperties()).execute(context))
                .expectErrorMessage("测试已捕获请求").verify();
    }

    /**
     * Gemini 系列不支持一次生成多张，数量大于1时应在提交前拒绝。
     */
    @Test
    void shouldRejectMultipleImagesForGeminiModel() {
        AiHttpClient client = mock(AiHttpClient.class);
        AiMediaSupport mediaSupport = mock(AiMediaSupport.class);
        AiGenerationTask task = new AiGenerationTask();
        task.setId("evolink-gemini-batch-task");
        task.setTaskType(AiTaskTypes.IMAGE);
        task.setUserId(7L);
        AiTaskDtos.CreateAiTaskRequest request = new AiTaskDtos.CreateAiTaskRequest(AiTaskTypes.IMAGE, "夜晚街头人像",
                "gemini-nano-banana-2.1", Map.<String, Object>of("size", "1:1", "resolution", "2K", "count", 2),
                List.of(), List.of(), "imagePage");
        AiTaskDtos.AiChannelConfig channel = new AiTaskDtos.AiChannelConfig("channel", "Evolink",
                "https://api.evolink.ai/v1", "key", "evolink", List.of("gemini-nano-banana-2.1"));

        AiTaskExecutionContext context = new AiTaskExecutionContext(task, channel, "gemini-nano-banana-2.1", false, "high", request,
                () -> Mono.just(false), progress -> Mono.empty(), delta -> Mono.empty());

        StepVerifier.create(new EvolinkProviderAdapter(client, mediaSupport, new NovanovaProperties()).execute(context))
                .expectErrorMessage("Nano Banana 系列一次只能生成一张图片，请把图片数量设为1").verify();
    }

    /**
     * 构造相同模型参数、不同开关值的执行上下文。
     *
     * @param conversion boolean 是否转换图片比例
     * @param editing boolean 是否携带参考图
     * @param customBody JSONObject 手写请求参数
     * @param mappings Map<String, Map<String, String>> 模型尺寸映射
     * @return AiTaskExecutionContext 图片任务上下文
     */
    private AiTaskExecutionContext context(boolean conversion, boolean editing, JSONObject customBody, Map<String, Map<String, String>> mappings) {
        AiGenerationTask task = new AiGenerationTask();
        task.setUserId(1L);
        task.setTaskType(AiTaskTypes.IMAGE);
        List<AiTaskDtos.AiTaskMediaReference> references = editing
                ? List.of(new AiTaskDtos.AiTaskMediaReference("reference", "参考图片", "image/png", null, "https://example.com/reference.png")) : List.of();
        return new AiTaskExecutionContext(task,
                new AiTaskDtos.AiChannelConfig("channel", "测试渠道", "https://example.com", "key", "openai", List.of("image-model")),
                "image-model", false, "", customBody,
                new AiTaskDtos.CreateAiTaskRequest(AiTaskTypes.IMAGE, "生成一只猫", "image-model", Map.of("size", "9:16", "resolution", "2K"), references, List.of(), "imagePage"),
                () -> Mono.just(false), progress -> Mono.empty(), delta -> Mono.empty(), false, null, conversion, mappings);
    }
}
