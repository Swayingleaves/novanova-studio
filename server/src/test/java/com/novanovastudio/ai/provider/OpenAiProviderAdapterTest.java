package com.novanovastudio.ai.provider;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.ai.AiHttpClient;
import com.novanovastudio.ai.AiMediaSupport;
import com.novanovastudio.ai.AiTaskExecutionContext;
import com.novanovastudio.ai.AiTaskTypes;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.dto.AiTaskDtos;
import com.novanovastudio.entity.AiGenerationTask;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import reactor.core.publisher.Mono;

/**
 * OpenAI兼容适配器请求测试。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-07-24 00:00
 */
class OpenAiProviderAdapterTest {

    /**
     * 文本任务应使用Chat Completions端点，并按思考开关发送正确参数。
     */
    @Test
    void shouldSendThinkingConfigurationToChatCompletions() {
        AiHttpClient aiHttpClient = mock(AiHttpClient.class);
        OpenAiProviderAdapter adapter = new OpenAiProviderAdapter(aiHttpClient, mock(AiMediaSupport.class), new NovanovaProperties());
        List<JSONObject> payloads = new ArrayList<>();
        when(aiHttpClient.sendJsonRequest(any(AiTaskDtos.AiChannelConfig.class), eq("POST"), eq("/chat/completions"), any()))
                .thenAnswer(invocation -> {
                    payloads.add(JSON.parseObject(JSON.toJSONString(invocation.getArgument(3))));
                    return Mono.just(JSON.parseObject("{\"choices\":[{\"message\":{\"content\":\"完成\"}}]}"));
                });

        adapter.execute(textContext(true, "max")).block();
        adapter.execute(textContext(false, "max")).block();

        Assertions.assertEquals(2, payloads.size());
        Assertions.assertEquals("enabled", payloads.get(0).getJSONObject("thinking").getString("type"));
        Assertions.assertEquals("max", payloads.get(0).getString("reasoning_effort"));
        Assertions.assertEquals("disabled", payloads.get(1).getJSONObject("thinking").getString("type"));
        Assertions.assertFalse(payloads.get(1).containsKey("reasoning_effort"));
        Assertions.assertEquals("user", payloads.get(0).getJSONArray("messages").getJSONObject(1).getString("role"));
    }

    /**
     * 图片比例必须结合清晰度转换为像素尺寸，已有像素尺寸保持不变。
     */
    @Test
    void shouldNormalizeImageRatioToPixelSize() {
        AiHttpClient aiHttpClient = mock(AiHttpClient.class);
        OpenAiProviderAdapter adapter = new OpenAiProviderAdapter(aiHttpClient, mock(AiMediaSupport.class), new NovanovaProperties());
        List<JSONObject> payloads = new ArrayList<>();
        when(aiHttpClient.sendJsonRequest(any(AiTaskDtos.AiChannelConfig.class), eq("POST"), eq("/images/generations"), any()))
                .thenAnswer(invocation -> {
                    payloads.add(JSON.parseObject(JSON.toJSONString(invocation.getArgument(3))));
                    return Mono.just(JSON.parseObject("{\"data\":[]}"));
                });

        adapter.execute(imageContext("9:16", "2K")).block();
        adapter.execute(imageContext("1024x1024", "4K")).block();

        Assertions.assertEquals("1152x2048", payloads.get(0).getString("size"));
        Assertions.assertEquals("1024x1024", payloads.get(1).getString("size"));
    }

    /**
     * OpenAI兼容视频接口应通过JSON提交images、videos、audios参考数组，且空数组字段不提交。
     */
    @Test
    void shouldSendVideoJsonPayloadWithImagesVideosAndAudios() {
        AiHttpClient aiHttpClient = mock(AiHttpClient.class);
        AiMediaSupport mediaSupport = mock(AiMediaSupport.class);
        OpenAiProviderAdapter adapter = new OpenAiProviderAdapter(aiHttpClient, mediaSupport, new NovanovaProperties());
        AiTaskDtos.AiTaskMediaReference imageRef = new AiTaskDtos.AiTaskMediaReference("img-1", "图1", "image/png", "image:1", "https://example.com/1.png");
        AiTaskDtos.AiTaskMediaReference videoRef = new AiTaskDtos.AiTaskMediaReference("vid-1", "视频1", "video/mp4", "video:1", "https://example.com/1.mp4");
        AiTaskDtos.AiTaskMediaReference audioRef = new AiTaskDtos.AiTaskMediaReference("aud-1", "音频1", "audio/mpeg", "audio:1", "https://example.com/1.mp3");
        when(mediaSupport.resolveReferenceUrl(1L, imageRef)).thenReturn(Mono.just("https://example.com/1.png"));
        when(mediaSupport.resolveReferenceUrl(1L, videoRef)).thenReturn(Mono.just("https://example.com/1.mp4"));
        when(mediaSupport.resolveReferenceUrl(1L, audioRef)).thenReturn(Mono.just("https://example.com/1.mp3"));

        List<JSONObject> payloads = new ArrayList<>();
        when(aiHttpClient.sendJsonRequest(any(AiTaskDtos.AiChannelConfig.class), eq("POST"), eq("/videos"), any()))
                .thenAnswer(invocation -> {
                    payloads.add(JSON.parseObject(JSON.toJSONString(invocation.getArgument(3))));
                    return Mono.error(new IllegalStateException("captured"));
                });

        AiGenerationTask task = new AiGenerationTask();
        task.setId("task-video-1");
        task.setTaskType(AiTaskTypes.VIDEO);
        task.setUserId(1L);
        AiTaskDtos.AiChannelConfig channel = new AiTaskDtos.AiChannelConfig("channel-1", "OpenAI", "https://api.example.com", "test-key", "openai", List.of("sora-2"));

        AiTaskDtos.CreateAiTaskRequest withRefs = new AiTaskDtos.CreateAiTaskRequest(
                AiTaskTypes.VIDEO, "参考图片1、视频1和音频1生成视频", "sora-2",
                Map.of("seconds", "10", "size", "16:9", "resolution", "720p"),
                List.of(imageRef), List.of(videoRef), "canvas", null, null, "reference-to-video", List.of(audioRef));
        AiTaskExecutionContext ctxWithRefs = new AiTaskExecutionContext(task, channel, "sora-2", false, "", withRefs,
                () -> Mono.just(false), progress -> Mono.empty(), delta -> Mono.empty());
        Assertions.assertThrows(IllegalStateException.class, () -> adapter.execute(ctxWithRefs).block());

        AiTaskDtos.CreateAiTaskRequest withoutRefs = new AiTaskDtos.CreateAiTaskRequest(
                AiTaskTypes.VIDEO, "纯文生视频", "sora-2",
                Map.of("seconds", "5", "size", "9:16", "resolution", "480p"),
                List.of(), List.of(), "canvas", null, null, "text-to-video", List.of());
        AiTaskExecutionContext ctxWithoutRefs = new AiTaskExecutionContext(task, channel, "sora-2", false, "", withoutRefs,
                () -> Mono.just(false), progress -> Mono.empty(), delta -> Mono.empty());
        Assertions.assertThrows(IllegalStateException.class, () -> adapter.execute(ctxWithoutRefs).block());

        Assertions.assertEquals(2, payloads.size());
        Assertions.assertEquals(List.of("https://example.com/1.png"), payloads.get(0).getList("images", String.class));
        Assertions.assertEquals(List.of("https://example.com/1.mp4"), payloads.get(0).getList("videos", String.class));
        Assertions.assertEquals(List.of("https://example.com/1.mp3"), payloads.get(0).getList("audios", String.class));
        Assertions.assertFalse(payloads.get(1).containsKey("images"));
        Assertions.assertFalse(payloads.get(1).containsKey("videos"));
        Assertions.assertFalse(payloads.get(1).containsKey("audios"));
    }

    /**
     * 构建文本任务上下文。
     *
     * @param thinkingEnabled boolean 是否开启思考模式
     * @param reasoningEffort String 思考强度
     * @return AiTaskExecutionContext 文本任务上下文
     */
    private AiTaskExecutionContext textContext(boolean thinkingEnabled, String reasoningEffort) {
        AiGenerationTask task = new AiGenerationTask();
        task.setTaskType(AiTaskTypes.TEXT);
        task.setUserId(1L);
        return new AiTaskExecutionContext(task,
                new AiTaskDtos.AiChannelConfig("channel-1", "DeepSeek", "https://api.deepseek.com", "test-key", "openai", List.of("deepseek-chat")),
                "deepseek-chat", thinkingEnabled, reasoningEffort,
                new AiTaskDtos.CreateAiTaskRequest(AiTaskTypes.TEXT, "请优化提示词", "deepseek-chat", Map.of("systemPrompt", "你是提示词专家"), List.of(), List.of(), "prompt-optimization"),
                () -> Mono.just(false), progress -> Mono.empty(), delta -> Mono.empty());
    }

    /**
     * 构建图片任务上下文。
     *
     * @param size String 图片比例或像素尺寸
     * @param resolution String 图片清晰度
     * @return AiTaskExecutionContext 图片任务上下文
     */
    private AiTaskExecutionContext imageContext(String size, String resolution) {
        AiGenerationTask task = new AiGenerationTask();
        task.setTaskType(AiTaskTypes.IMAGE);
        task.setUserId(1L);
        return new AiTaskExecutionContext(task,
                new AiTaskDtos.AiChannelConfig("channel-1", "OpenAI", "https://api.example.com", "test-key", "openai", List.of("gpt-image-2")),
                "gpt-image-2", false, "", new JSONObject(),
                new AiTaskDtos.CreateAiTaskRequest(AiTaskTypes.IMAGE, "生成一只小猫", "gpt-image-2",
                        Map.of("count", 1, "quality", "medium", "size", size, "resolution", resolution),
                        List.of(), List.of(), "imagePage"),
                () -> Mono.just(false), progress -> Mono.empty(), delta -> Mono.empty(), false, null, true, null);
    }
}
