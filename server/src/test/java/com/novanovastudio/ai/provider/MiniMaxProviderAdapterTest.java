package com.novanovastudio.ai.provider;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.ai.AiHttpClient;
import com.novanovastudio.ai.AiMediaSupport;
import com.novanovastudio.ai.AiTaskTypes;
import com.novanovastudio.ai.AiTaskExecutionContext;
import com.novanovastudio.ai.GeneratedBinary;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.dto.AiTaskDtos;
import com.novanovastudio.dto.PersistenceDtos;
import com.novanovastudio.entity.AiGenerationTask;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;
import reactor.test.scheduler.VirtualTimeScheduler;

/**
 * MiniMax H3 渠道适配器测试。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-08-03 22:00
 */
class MiniMaxProviderAdapterTest {

    /**
     * MiniMax 适配器应只声明视频任务能力。
     *
     * @return void 无返回值
     */
    @Test
    void shouldOnlySupportVideoTasks() {
        MiniMaxProviderAdapter adapter = new MiniMaxProviderAdapter(null, null, new NovanovaProperties());

        Assertions.assertEquals("minimax", adapter.apiFormat());
        Assertions.assertTrue(adapter.supports(AiTaskTypes.VIDEO));
        Assertions.assertFalse(adapter.supports(AiTaskTypes.IMAGE));
        Assertions.assertFalse(adapter.supports(AiTaskTypes.TEXT));
    }

    /**
     * 通用视频参数应转换为 MiniMax H3 请求字段。
     *
     * @return void 无返回值
     */
    @Test
    void shouldBuildMiniMaxH3VideoParameters() {
        JSONObject payload = toJsonObject(MiniMaxProviderAdapter.buildRequestPayload(
                "MiniMax-H3",
                "城市夜景",
                Map.of("size", "1280x720", "resolution", "2k", "seconds", "8", "watermark", true),
                List.of(),
                List.of()
        ));

        Assertions.assertEquals("MiniMax-H3", payload.getString("model"));
        Assertions.assertEquals("16:9", payload.getString("ratio"));
        Assertions.assertEquals("2K", payload.getString("resolution"));
        Assertions.assertEquals(8, payload.getIntValue("duration"));
        Assertions.assertTrue(payload.getBooleanValue("aigc_watermark"));
        Assertions.assertEquals("城市夜景", payload.getJSONArray("content").getJSONObject(0).getString("text"));
    }

    /**
     * 图片和视频引用应转换为 H3 多模态参考内容。
     *
     * @return void 无返回值
     */
    @Test
    void shouldBuildMiniMaxH3ReferenceContent() {
        JSONObject payload = toJsonObject(MiniMaxProviderAdapter.buildRequestPayload(
                "MiniMax-H3",
                "让图片中的人物进入视频场景",
                Map.of("size", "adaptive", "resolution", "768p", "seconds", "5"),
                List.of("https://example.com/reference.png"),
                List.of("https://example.com/reference.mp4")
        ));
        JSONArray content = payload.getJSONArray("content");

        Assertions.assertEquals(3, content.size());
        Assertions.assertEquals("reference_image", content.getJSONObject(1).getString("role"));
        Assertions.assertEquals("https://example.com/reference.png",
                content.getJSONObject(1).getJSONObject("image_url").getString("url"));
        Assertions.assertEquals("reference_video", content.getJSONObject(2).getString("role"));
        Assertions.assertEquals("https://example.com/reference.mp4",
                content.getJSONObject(2).getJSONObject("video_url").getString("url"));
        Assertions.assertEquals("adaptive", payload.getString("ratio"));
        Assertions.assertEquals("image_url", content.getJSONObject(1).getString("type"));
        Assertions.assertEquals("video_url", content.getJSONObject(2).getString("type"));
    }

    /**
     * 非法模型、比例、分辨率、时长或纯文生自适应比例必须明确失败。
     *
     * @return void 无返回值
     */
    @Test
    void shouldRejectUnsupportedMiniMaxH3Parameters() {
        Assertions.assertThrows(BusinessException.class, () -> MiniMaxProviderAdapter.buildRequestPayload(
                "MiniMax-H3", " ", Map.of("size", "16:9", "resolution", "768p", "seconds", "5"), List.of(), List.of()));
        Assertions.assertThrows(BusinessException.class, () -> MiniMaxProviderAdapter.buildRequestPayload(
                "MiniMax-H2", "城市夜景", Map.of("size", "16:9", "resolution", "768p", "seconds", "5"), List.of(), List.of()));
        JSONObject legacyPayload = toJsonObject(MiniMaxProviderAdapter.buildRequestPayload(
                "MiniMax-H3", "城市夜景", Map.of("size", "auto", "resolution", "768p", "seconds", "5"), List.of(), List.of()));
        Assertions.assertEquals("16:9", legacyPayload.getString("ratio"));
        Assertions.assertThrows(BusinessException.class, () -> MiniMaxProviderAdapter.buildRequestPayload(
                "MiniMax-H3", "城市夜景", Map.of("size", "adaptive", "resolution", "768p", "seconds", "5"), List.of(), List.of()));
        Assertions.assertThrows(BusinessException.class, () -> MiniMaxProviderAdapter.buildRequestPayload(
                "MiniMax-H3", "城市夜景", Map.of("size", "16:9", "resolution", "720p", "seconds", "5"), List.of(), List.of()));
        Assertions.assertThrows(BusinessException.class, () -> MiniMaxProviderAdapter.buildRequestPayload(
                "MiniMax-H3", "城市夜景", Map.of("size", "16:9", "resolution", "768p", "seconds", "3"), List.of(), List.of()));
        Assertions.assertThrows(BusinessException.class, () -> MiniMaxProviderAdapter.buildRequestPayload(
                "MiniMax-H3", "城市夜景", Map.of("size", "16:9", "resolution", "768p", "seconds", "5"),
                java.util.stream.IntStream.range(0, 10).mapToObj(index -> "image-" + index).toList(), List.of()));
        Assertions.assertThrows(BusinessException.class, () -> MiniMaxProviderAdapter.buildRequestPayload(
                "MiniMax-H3", "城市夜景", Map.of("size", "16:9", "resolution", "768p", "seconds", "5"),
                List.of(), java.util.stream.IntStream.range(0, 4).mapToObj(index -> "video-" + index).toList()));
    }

    /**
     * MiniMax 查询响应必须包含任务对象。
     *
     * @return void 无返回值
     */
    @Test
    void shouldExtractMiniMaxTaskPayload() {
        JSONObject task = MiniMaxProviderAdapter.taskPayload(JSON.parseObject("{\"task\":{\"id\":\"task-1\",\"status\":\"queued\"}}"));

        Assertions.assertEquals("task-1", task.getString("id"));
        Assertions.assertThrows(BusinessException.class,
                () -> MiniMaxProviderAdapter.taskPayload(new JSONObject()));
    }

    /**
     * 成功任务应完成状态轮询、下载限时视频地址并转存媒体库。
     *
     * @return void 无返回值
     */
    @Test
    void shouldPollAndStoreMiniMaxVideoResult() {
        AiHttpClient aiHttpClient = mock(AiHttpClient.class);
        AiMediaSupport mediaSupport = mock(AiMediaSupport.class);
        MiniMaxProviderAdapter adapter = new MiniMaxProviderAdapter(aiHttpClient, mediaSupport, new NovanovaProperties());
        String providerTaskId = "provider-task-1";
        String remoteUrl = "https://cdn.example.com/video.mp4";
        PersistenceDtos.UploadedMediaResponse stored = new PersistenceDtos.UploadedMediaResponse(
                "video:stored-1", "https://storage.example.com/video.mp4", 3L, "video/mp4", null, null, 5000, null);
        when(aiHttpClient.sendJsonRequest(any(AiTaskDtos.AiChannelConfig.class), eq("POST"), eq("/v2/video_generation"), any()))
                .thenReturn(Mono.just(JSON.parseObject("{\"task_id\":\"provider-task-1\"}")));
        when(aiHttpClient.sendJsonRequest(any(AiTaskDtos.AiChannelConfig.class), eq("GET"), eq("/v2/query/video_generation/" + providerTaskId), isNull()))
                .thenReturn(Mono.just(JSON.parseObject("{\"task\":{\"status\":\"succeeded\",\"duration\":5,\"content\":{\"url\":\"" + remoteUrl + "\"}}}")));
        when(aiHttpClient.downloadRemoteBinary(remoteUrl, "video/mp4"))
                .thenReturn(Mono.just(new GeneratedBinary(new byte[]{1, 2, 3}, "video/mp4")));
        when(mediaSupport.storeGeneratedMedia(eq(7L), eq(AiTaskTypes.VIDEO), eq("generated-minimax-h3-video.mp4"),
                any(GeneratedBinary.class), isNull(Integer.class), isNull(Integer.class), eq(5000)))
                .thenReturn(Mono.just(stored));

        VirtualTimeScheduler scheduler = VirtualTimeScheduler.create();
        StepVerifier.withVirtualTime(() -> adapter.execute(videoContext(() -> Mono.just(false))), () -> scheduler, 1)
                .thenAwait(Duration.ofSeconds(5))
                .assertNext(result -> Assertions.assertEquals("https://storage.example.com/video.mp4",
                        result.getJSONObject("item").getString("url")))
                .verifyComplete();

        verify(aiHttpClient).downloadRemoteBinary(remoteUrl, "video/mp4");
        verify(mediaSupport).storeGeneratedMedia(eq(7L), eq(AiTaskTypes.VIDEO), eq("generated-minimax-h3-video.mp4"),
                any(GeneratedBinary.class), isNull(Integer.class), isNull(Integer.class), eq(5000));
    }

    /**
     * 失败状态应转换为业务异常且不转存结果媒体。
     *
     * @return void 无返回值
     */
    @Test
    void shouldPropagateMiniMaxFailureResponse() {
        AiHttpClient aiHttpClient = mock(AiHttpClient.class);
        MiniMaxProviderAdapter adapter = new MiniMaxProviderAdapter(aiHttpClient, mock(AiMediaSupport.class), new NovanovaProperties());
        when(aiHttpClient.sendJsonRequest(any(AiTaskDtos.AiChannelConfig.class), eq("POST"), eq("/v2/video_generation"), any()))
                .thenReturn(Mono.just(JSON.parseObject("{\"task_id\":\"provider-task-2\"}")));
        when(aiHttpClient.sendJsonRequest(any(AiTaskDtos.AiChannelConfig.class), eq("GET"), eq("/v2/query/video_generation/provider-task-2"), isNull()))
                .thenReturn(Mono.just(JSON.parseObject("{\"task\":{\"status\":\"failed\",\"error\":{\"message\":\"内容不合规\"}}}")));

        VirtualTimeScheduler scheduler = VirtualTimeScheduler.create();
        StepVerifier.withVirtualTime(() -> adapter.execute(videoContext(() -> Mono.just(false))), () -> scheduler, 1)
                .thenAwait(Duration.ofSeconds(5))
                .expectErrorSatisfies(exception -> {
                    Assertions.assertInstanceOf(BusinessException.class, exception);
                    Assertions.assertTrue(exception.getMessage().contains("内容不合规"));
                })
                .verify();
    }

    /**
     * 取消排队任务时应先查询状态，再仅发送一次删除请求。
     *
     * @return void 无返回值
     */
    @Test
    void shouldCancelQueuedMiniMaxTask() {
        AiHttpClient aiHttpClient = mock(AiHttpClient.class);
        MiniMaxProviderAdapter adapter = new MiniMaxProviderAdapter(aiHttpClient, mock(AiMediaSupport.class), new NovanovaProperties());
        String queryPath = "/v2/query/video_generation/provider-task-3";
        when(aiHttpClient.sendJsonRequest(any(AiTaskDtos.AiChannelConfig.class), eq("POST"), eq("/v2/video_generation"), any()))
                .thenReturn(Mono.just(JSON.parseObject("{\"task_id\":\"provider-task-3\"}")));
        when(aiHttpClient.sendJsonRequest(any(AiTaskDtos.AiChannelConfig.class), eq("GET"), eq(queryPath), isNull()))
                .thenReturn(Mono.just(JSON.parseObject("{\"task\":{\"status\":\"queued\"}}")));
        when(aiHttpClient.sendJsonRequest(any(AiTaskDtos.AiChannelConfig.class), eq("DELETE"), eq("/v2/video_generation/provider-task-3"), isNull()))
                .thenReturn(Mono.just(JSON.parseObject("{\"task_id\":\"provider-task-3\",\"status\":\"cancelled\"}")));

        VirtualTimeScheduler scheduler = VirtualTimeScheduler.create();
        StepVerifier.withVirtualTime(() -> adapter.execute(videoContext(() -> Mono.just(true))), () -> scheduler, 1)
                .thenAwait(Duration.ofSeconds(5))
                .expectErrorSatisfies(exception -> Assertions.assertEquals("任务已取消", exception.getMessage()))
                .verify();

        verify(aiHttpClient).sendJsonRequest(any(AiTaskDtos.AiChannelConfig.class), eq("DELETE"),
                eq("/v2/video_generation/provider-task-3"), isNull());
    }

    /**
     * 将请求映射转换为便于断言的 Fastjson2 对象。
     *
     * @param value Map<String, Object> 请求映射
     * @return JSONObject JSON 对象
     */
    private JSONObject toJsonObject(Map<String, Object> value) {
        return JSON.parseObject(JSON.toJSONString(value));
    }

    /**
     * 构建 MiniMax 视频任务上下文。
     *
     * @param cancelChecker Supplier<Mono<Boolean>> 取消状态检查器
     * @return AiTaskExecutionContext 视频任务上下文
     */
    private AiTaskExecutionContext videoContext(java.util.function.Supplier<Mono<Boolean>> cancelChecker) {
        AiGenerationTask task = new AiGenerationTask();
        task.setId("task-1");
        task.setUserId(7L);
        task.setTaskType(AiTaskTypes.VIDEO);
        return new AiTaskExecutionContext(task,
                new AiTaskDtos.AiChannelConfig("channel-1", "MiniMax", "https://api.minimaxi.com", "test-key", "minimax", List.of("MiniMax-H3")),
                "MiniMax-H3", false, "",
                new AiTaskDtos.CreateAiTaskRequest(AiTaskTypes.VIDEO, "城市夜景", "MiniMax-H3",
                        Map.of("size", "16:9", "resolution", "768p", "seconds", "5"), List.of(), List.of(), "videoPage"),
                cancelChecker, progress -> Mono.empty(), delta -> Mono.empty());
    }
}
