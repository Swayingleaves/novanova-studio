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

/**
 * New API渠道适配器测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-08-12 11:00
 */
class NewApiProviderAdapterTest {

    /**
     * 验证New API渠道只支持图片和视频任务。
     *
     * @return void 无返回值
     */
    @Test
    void shouldSupportImageAndVideoTasks() {
        NewApiProviderAdapter adapter = new NewApiProviderAdapter(null, null, new NovanovaProperties());

        Assertions.assertEquals("newapi", adapter.apiFormat());
        Assertions.assertTrue(adapter.supports(AiTaskTypes.IMAGE));
        Assertions.assertTrue(adapter.supports(AiTaskTypes.VIDEO));
        Assertions.assertFalse(adapter.supports(AiTaskTypes.TEXT));
    }

    /**
     * 验证文生图使用New API兼容的图片生成接口。
     *
     * @return void 无返回值
     */
    @Test
    void shouldSubmitImageGenerationRequest() {
        AiHttpClient aiHttpClient = mock(AiHttpClient.class);
        NewApiProviderAdapter adapter = new NewApiProviderAdapter(aiHttpClient, mock(AiMediaSupport.class), new NovanovaProperties());
        List<JSONObject> payloads = new ArrayList<>();
        when(aiHttpClient.sendJsonRequest(any(AiTaskDtos.AiChannelConfig.class), eq("POST"), eq("/images/generations"), any()))
                .thenAnswer(invocation -> {
                    payloads.add(JSON.parseObject(JSON.toJSONString(invocation.getArgument(3))));
                    return reactor.core.publisher.Mono.just(JSON.parseObject("{\"data\":[]}"));
                });

        adapter.execute(imageContext()).block();

        Assertions.assertEquals(1, payloads.size());
        Assertions.assertEquals("gpt-image-1", payloads.getFirst().getString("model"));
        Assertions.assertEquals("生成一只小猫", payloads.getFirst().getString("prompt"));
        Assertions.assertEquals(2, payloads.getFirst().getIntValue("n"));
        Assertions.assertEquals("1024x688", payloads.getFirst().getString("size"));
    }

    /**
     * 验证页面视频参数和参考素材映射为New API请求字段。
     *
     * @return void 无返回值
     */
    @Test
    void shouldBuildVideoRequestPayload() {
        Map<String, Object> payload = NewApiProviderAdapter.buildVideoRequestPayload(
                "bytedance/seedance-2.0/image-to-video", "让人物缓慢转身",
                Map.of("seconds", "5", "resolution", "720p", "size", "9:16", "watermark", false),
                List.of("https://example.com/first.png", "https://example.com/last.png"),
                List.of("https://example.com/reference.mp4"));
        JSONObject json = JSON.parseObject(JSON.toJSONString(payload));

        Assertions.assertEquals(5, json.getIntValue("duration"));
        Assertions.assertEquals("5", json.getString("seconds"));
        Assertions.assertEquals("720p", json.getString("resolution"));
        Assertions.assertFalse(json.containsKey("size"));
        Assertions.assertEquals("https://example.com/first.png", json.getString("image"));
        Assertions.assertEquals("https://example.com/first.png", json.getString("input_reference"));
        Assertions.assertEquals(2, json.getJSONArray("images").size());
        Assertions.assertEquals("9:16", json.getJSONObject("metadata").getString("aspect_ratio"));
        Assertions.assertFalse(json.getJSONObject("metadata").getBooleanValue("watermark"));
        Assertions.assertEquals(2, json.getJSONObject("metadata").getJSONArray("reference_images").size());
        Assertions.assertEquals("https://example.com/reference.mp4", json.getJSONObject("metadata").getJSONArray("reference_videos").getString(0));
    }

    /**
     * 验证完成视频地址必须从metadata.url读取。
     *
     * @return void 无返回值
     */
    @Test
    void shouldReadCompletedVideoUrlFromMetadata() {
        JSONObject completed = JSON.parseObject("{\"status\":\"completed\",\"metadata\":{\"url\":\"https://example.com/video.mp4\"}}");

        Assertions.assertEquals("https://example.com/video.mp4", NewApiProviderAdapter.readVideoResultUrl(completed));
        Assertions.assertEquals("", NewApiProviderAdapter.readVideoResultUrl(JSON.parseObject("{\"status\":\"completed\"}")));
    }

    /**
     * 验证New API成功响应的状态和视频地址兼容处理。
     *
     * @return void 无返回值
     */
    @Test
    void shouldReadCompletedVideoPathFromNestedVideoData() {
        JSONObject response = JSON.parseObject("{\"status\":\"done\",\"progress\":100,\"data\":{\"video\":{\"url\":\"/v1/videos/video-1/content\"}}}");

        Assertions.assertEquals("/v1/videos/video-1/content", NewApiProviderAdapter.readVideoResultUrl(response));
        Assertions.assertEquals("https://api.example.com/v1/videos/video-1/content",
                NewApiProviderAdapter.resolveVideoResultUrl("/v1/videos/video-1/content", "https://api.example.com/v1"));
    }

    /**
     * 验证New API查询响应会读取嵌套的视频任务详情。
     *
     * @return void 无返回值
     */
    @Test
    void shouldReadNestedVideoTaskPayload() {
        JSONObject response = JSON.parseObject("""
                {"code":"success","data":{"task_id":"platform-task","status":"IN_PROGRESS","progress":"30%","data":{"task_id":"task-provider","status":"processing","progress":30}}}
                """);

        JSONObject task = NewApiProviderAdapter.responseTaskPayload(response);

        Assertions.assertEquals("task-provider", task.getString("task_id"));
        Assertions.assertEquals("processing", task.getString("status"));
        Assertions.assertEquals(30, task.getIntValue("progress"));
    }

    /**
     * 验证内层只有请求标识时保留New API外层任务状态。
     *
     * @return void 无返回值
     */
    @Test
    void shouldFallbackToOuterVideoTaskPayloadWhenNestedStatusIsMissing() {
        JSONObject response = JSON.parseObject("""
                {"code":"success","data":{"task_id":"task-provider","status":"NOT_START","progress":"0%","data":{"request_id":"request-1"}}}
                """);

        JSONObject task = NewApiProviderAdapter.responseTaskPayload(response);

        Assertions.assertEquals("task-provider", task.getString("task_id"));
        Assertions.assertEquals("NOT_START", task.getString("status"));
    }

    /**
     * 验证New API进度字段兼容数字和百分号字符串。
     *
     * @return void 无返回值
     */
    @Test
    void shouldParseVideoProgressWithPercentSuffix() {
        Assertions.assertEquals(0, NewApiProviderAdapter.parseProgress(JSON.parseObject("{\"progress\":\"0%\"}"), 10));
        Assertions.assertEquals(30, NewApiProviderAdapter.parseProgress(JSON.parseObject("{\"progress\":\"30%\"}"), 10));
        Assertions.assertEquals(40, NewApiProviderAdapter.parseProgress(JSON.parseObject("{\"progress\":40}"), 10));
        Assertions.assertEquals(10, NewApiProviderAdapter.parseProgress(JSON.parseObject("{\"progress\":\"invalid\"}"), 10));
    }

    /**
     * 构建图片任务上下文。
     *
     * @return AiTaskExecutionContext 图片生成任务上下文
     */
    private AiTaskExecutionContext imageContext() {
        AiGenerationTask task = new AiGenerationTask();
        task.setTaskType(AiTaskTypes.IMAGE);
        task.setUserId(1L);
        return new AiTaskExecutionContext(task,
                new AiTaskDtos.AiChannelConfig("channel-1", "New API", "https://newapi.example.com/v1", "test-key", "newapi", List.of("gpt-image-1")),
                "gpt-image-1", false, "",
                new AiTaskDtos.CreateAiTaskRequest(AiTaskTypes.IMAGE, "生成一只小猫", "gpt-image-1",
                        Map.of("count", 2, "quality", "medium", "size", "3:2", "resolution", "1K"),
                        List.of(), List.of(), "imagePage"),
                () -> reactor.core.publisher.Mono.just(false), progress -> reactor.core.publisher.Mono.empty(), delta -> reactor.core.publisher.Mono.empty());
    }
}
