package com.novanovastudio.ai.provider;

import com.alibaba.fastjson2.JSON;
import com.novanovastudio.ai.AiHttpClient;
import com.novanovastudio.ai.AiMediaSupport;
import com.novanovastudio.ai.AiTaskExecutionContext;
import com.novanovastudio.entity.AiGenerationTask;
import com.novanovastudio.dto.AiTaskDtos;
import com.novanovastudio.config.NovanovaProperties;
import org.mockito.Mockito;
import org.mockito.ArgumentMatchers;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

/**
 * 音频引用渠道协议测试。
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-09-10 15:00
 */
class AudioReferencePayloadTest {
    /** 任务快照序列化后必须保留音频引用，确保异步执行阶段不会丢失。 */
    @Test
    void shouldKeepAudioReferencesInTaskSnapshot() {
        AiTaskDtos.CreateAiTaskRequest request = new AiTaskDtos.CreateAiTaskRequest(
                "video", "参考音频1", "agnes-video-2.5", Map.of(), List.of(), List.of(), "canvas",
                null, null, "reference-to-video", List.of(new AiTaskDtos.AiTaskMediaReference(
                        "audio-1", "配乐", "audio/mpeg", "audio:reference", "https://example.com/audio.mp3")));

        String snapshot = JSON.toJSONString(request);
        AiTaskDtos.CreateAiTaskRequest restored = JSON.parseObject(snapshot, AiTaskDtos.CreateAiTaskRequest.class);

        Assertions.assertNotNull(restored.audioReferences());
        Assertions.assertEquals(1, restored.audioReferences().size());
        Assertions.assertEquals("audio:reference", restored.audioReferences().get(0).storageKey());
    }

    /** MiniMax 的音频必须使用独立媒体类型和参考角色，保持输入顺序。 */
    @Test
    void shouldBuildMiniMaxAudioContent() {
        Map<String, Object> payload = MiniMaxProviderAdapter.buildRequestPayload("MiniMax-H3", "跟随音频1和音频2",
                Map.of("resolution", "768p", "seconds", "5", "size", "16:9"), List.of(), List.of(),
                "reference-to-video", List.of(), List.of("https://example.com/first.mp3", "https://example.com/second.wav"));
        List<?> content = (List<?>) payload.get("content");
        Assertions.assertEquals(3, content.size());
        Assertions.assertEquals(Map.of("type", "audio_url", "audio_url", Map.of("url", "https://example.com/first.mp3"), "role", "reference_audio"), content.get(1));
        Assertions.assertEquals(Map.of("type", "audio_url", "audio_url", Map.of("url", "https://example.com/second.wav"), "role", "reference_audio"), content.get(2));
    }

    /** Evolink 引用标签必须与实际数组下标一致，且不能误改更长编号。 */
    @Test
    void shouldNormalizeEvolinkAudioLabels() {
        Assertions.assertEquals("根据@audio1与@audio2，保留音频10", EvolinkProviderAdapter.audioReferencePrompt("根据`音频1`与音频2，保留音频10", 2));
        Assertions.assertEquals("直接描述", EvolinkProviderAdapter.audioReferencePrompt("直接描述", 0));
        Assertions.assertEquals("直接描述\n\n参考音频：@audio1、@audio2", EvolinkProviderAdapter.audioReferencePrompt("直接描述", 2));
    }
    /** Evolink 执行入口必须实际发送音频数组和与之对应的显式标签。 */
    @Test
    void shouldSendEvolinkAudioUrls() {
        AiHttpClient client = Mockito.mock(AiHttpClient.class);
        AiMediaSupport media = Mockito.mock(AiMediaSupport.class);
        AiGenerationTask task = new AiGenerationTask();
        task.setId("audio-task");
        task.setTaskType("video");
        task.setUserId(7L);
        AiTaskDtos.AiTaskMediaReference audio = new AiTaskDtos.AiTaskMediaReference("audio", "配乐", "audio/mpeg", "audio:key", "https://example.com/audio.mp3");
        AiTaskDtos.AiTaskMediaReference image = new AiTaskDtos.AiTaskMediaReference("image", "参考图", "image/png", "image:key", "https://example.com/image.png");
        Mockito.when(media.resolveReferenceUrl(7L, audio)).thenReturn(Mono.just(audio.url()));
        Mockito.when(media.resolveReferenceUrl(7L, image)).thenReturn(Mono.just(image.url()));
        AiTaskDtos.CreateAiTaskRequest request = new AiTaskDtos.CreateAiTaskRequest("video", "参考音频1", "seedance-2.0-reference-to-video", Map.of(), List.of(image), List.of(), "canvas", null, null, "reference-to-video", List.of(audio));
        AiTaskDtos.AiChannelConfig channel = new AiTaskDtos.AiChannelConfig("channel", "测试", "https://example.com", "key", "evolink", List.of(request.model()));
        Mockito.when(client.sendJsonRequest(ArgumentMatchers.eq(channel), ArgumentMatchers.eq("POST"), ArgumentMatchers.eq("/videos/generations"), ArgumentMatchers.any()))
                .thenAnswer(invocation -> {
                    Map<?, ?> payload = invocation.getArgument(3);
                    Assertions.assertEquals(List.of(audio.url()), payload.get("audio_urls"));
                    Assertions.assertEquals("参考@audio1", payload.get("prompt"));
                    return Mono.error(new IllegalStateException("测试已捕获请求"));
                });
        AiTaskExecutionContext context = new AiTaskExecutionContext(task, channel, request.model(), false, "high", request, () -> Mono.just(false), progress -> Mono.empty(), delta -> Mono.empty());
        StepVerifier.create(new EvolinkProviderAdapter(client, media, new NovanovaProperties()).execute(context))
                .expectErrorMessage("测试已捕获请求").verify();
    }

    /** Agnes 视频参考模式必须发送 audios 数组，并将画布音频编号转换为协议标签。 */
    @Test
    void shouldSendAgnesAudioUrlsInReferenceMode() {
        AiHttpClient client = Mockito.mock(AiHttpClient.class);
        AiMediaSupport media = Mockito.mock(AiMediaSupport.class);
        AiGenerationTask task = new AiGenerationTask();
        task.setId("agnes-audio-task");
        task.setTaskType("video");
        task.setUserId(7L);
        AiTaskDtos.AiTaskMediaReference audio = new AiTaskDtos.AiTaskMediaReference(
                "audio", "配乐", "audio/mpeg", "audio:key", "https://example.com/audio.mp3");
        Mockito.when(media.resolveReferenceUrl(7L, audio)).thenReturn(Mono.just(audio.url()));
        AiTaskDtos.CreateAiTaskRequest request = new AiTaskDtos.CreateAiTaskRequest(
                "video", "跟随音频1的节奏", "agnes-video-2.5",
                Map.of("resolution", "720p", "seconds", "5", "size", "16:9"),
                List.of(), List.of(), "canvas", null, null, "reference-to-video", List.of(audio));
        AiTaskDtos.AiChannelConfig channel = new AiTaskDtos.AiChannelConfig(
                "channel", "测试", "https://example.com/v1", "key", "agnes", List.of(request.model()));
        Mockito.when(client.sendJsonRequest(ArgumentMatchers.eq(channel), ArgumentMatchers.eq("POST"),
                        ArgumentMatchers.eq("/videos"), ArgumentMatchers.any()))
                .thenAnswer(invocation -> {
                    Map<?, ?> payload = invocation.getArgument(3);
                    Assertions.assertEquals("reference", payload.get("mode"));
                    Assertions.assertEquals(List.of(audio.url()), payload.get("audios"));
                    Assertions.assertEquals("跟随<Audio 1>的节奏", payload.get("prompt"));
                    return Mono.error(new IllegalStateException("测试已捕获请求"));
                });
        AiTaskExecutionContext context = new AiTaskExecutionContext(task, channel, request.model(), false, "high",
                request, () -> Mono.just(false), progress -> Mono.empty(), delta -> Mono.empty());
        StepVerifier.create(new AgnesProviderAdapter(client, media, new NovanovaProperties()).execute(context))
                .expectErrorMessage("测试已捕获请求").verify();
    }

    /** Agnes 音频编号转换应避免误改更长编号，并自动补齐未显式引用的音频标签。 */
    @Test
    void shouldNormalizeAgnesAudioLabels() {
        Assertions.assertEquals("根据<Audio 1>与<Audio 2>，保留音频10",
                AgnesProviderAdapter.agnesAudioReferencePrompt("根据`音频1`与音频2，保留音频10", 2));
        Assertions.assertEquals("直接描述\n\n参考音频：<Audio 1>、<Audio 2>",
                AgnesProviderAdapter.agnesAudioReferencePrompt("直接描述", 2));
        Assertions.assertEquals("直接描述", AgnesProviderAdapter.agnesAudioReferencePrompt("直接描述", 0));
    }

}
