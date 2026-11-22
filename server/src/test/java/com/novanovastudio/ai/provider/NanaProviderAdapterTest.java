package com.novanovastudio.ai.provider;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.ai.AiTaskTypes;
import com.novanovastudio.config.NovanovaProperties;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

/**
 * NANA-API 渠道适配器测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-20 18:30
 */
class NanaProviderAdapterTest {

    /**
     * NANA-API 应同时支持文本、图片和视频任务。
     *
     * @return void 无返回值
     */
    @Test
    void shouldSupportTextImageAndVideoTasks() {
        NanaProviderAdapter adapter = new NanaProviderAdapter(null, null, new NovanovaProperties());

        Assertions.assertEquals("nana", adapter.apiFormat());
        Assertions.assertTrue(adapter.supports(AiTaskTypes.TEXT));
        Assertions.assertTrue(adapter.supports(AiTaskTypes.IMAGE));
        Assertions.assertTrue(adapter.supports(AiTaskTypes.VIDEO));
    }

    /**
     * Seedance 请求应使用文档定义的内容数组、比例和分辨率。
     *
     * @return void 无返回值
     */
    @Test
    void shouldBuildSeedancePayloadWithReferencesAndRoles() {
        JSONObject payload = toJsonObject(NanaProviderAdapter.buildSeedancePayload(
                "doubao-seedance-2-0-mini-260615", "让图片1中的人物动起来",
                Map.of("size", "1280x720", "resolution", "1080p", "seconds", "8", "watermark", false),
                List.of("https://example.com/first.png"), List.of("https://example.com/reference.mp4"), List.of("https://example.com/audio.mp3"),
                "image-to-video", List.of()));

        Assertions.assertEquals("doubao-seedance-2-0-mini-260615", payload.getString("model"));
        Assertions.assertEquals("16:9", payload.getString("ratio"));
        Assertions.assertEquals("1080p", payload.getString("resolution"));
        Assertions.assertEquals(8, payload.getIntValue("duration"));
        Assertions.assertFalse(payload.getBooleanValue("watermark"));
        JSONArray content = payload.getJSONArray("content");
        Assertions.assertTrue(content.getJSONObject(0).getString("text").startsWith("参考素材编号：图片1、视频1、音频1。"));
        Assertions.assertEquals("first_frame", content.getJSONObject(1).getString("role"));
        Assertions.assertEquals("reference_video", content.getJSONObject(2).getString("role"));
        Assertions.assertEquals("reference_audio", content.getJSONObject(3).getString("role"));
    }

    /**
     * Wan 请求应使用 input.media 与 parameters 结构。
     *
     * @return void 无返回值
     */
    @Test
    void shouldBuildWanPayloadWithMediaAndParameters() {
        JSONObject payload = toJsonObject(NanaProviderAdapter.buildWanPayload(
                "wan3.0-video", "首帧为图片1，尾帧为图片2",
                Map.of("size", "9:16", "resolution", "720p", "seconds", "-1", "watermark", true),
                List.of("https://example.com/first.png", "https://example.com/last.png"), List.of("https://example.com/reference.mp4"), List.of(),
                "first-last-frame-to-video", List.of()));

        JSONObject input = payload.getJSONObject("input");
        Assertions.assertEquals("wan3.0-video", payload.getString("model"));
        Assertions.assertTrue(input.getString("prompt").startsWith("参考素材编号：图片1、图片2、视频1。"));
        JSONArray media = input.getJSONArray("media");
        Assertions.assertEquals("first_frame", media.getJSONObject(0).getString("type"));
        Assertions.assertEquals("last_frame", media.getJSONObject(1).getString("type"));
        Assertions.assertEquals("reference_video", media.getJSONObject(2).getString("type"));
        JSONObject parameters = payload.getJSONObject("parameters");
        Assertions.assertEquals("9:16", parameters.getString("ratio"));
        Assertions.assertEquals("720P", parameters.getString("resolution"));
        Assertions.assertEquals(-1, parameters.getIntValue("duration"));
        Assertions.assertTrue(parameters.getBooleanValue("watermark"));
    }

    /**
     * MiniMax 请求应使用顶层参数和 images 数组传递参考图。
     *
     * @return void 无返回值
     */
    @Test
    void shouldBuildMiniMaxPayloadWithImages() {
        JSONObject payload = toJsonObject(NanaProviderAdapter.buildMiniMaxPayload(
                "minimax-h3-ref", "参考图片1的风格",
                Map.of("size", "1280x720", "resolution", "1080p", "seconds", "5"),
                List.of("https://example.com/reference.png"), List.of()));

        Assertions.assertEquals("minimax-h3-ref", payload.getString("model"));
        Assertions.assertEquals("16:9", payload.getString("ratio"));
        Assertions.assertEquals("960P", payload.getString("resolution"));
        Assertions.assertEquals(5, payload.getIntValue("duration"));
        Assertions.assertEquals("https://example.com/reference.png", payload.getJSONArray("images").getString(0));
    }

    /**
     * Seedance 完成响应应从 content.video_url 读取视频地址。
     *
     * @return void 无返回值
     */
    @Test
    void shouldReadSeedanceCompletedVideoUrl() {
        JSONObject response = JSON.parseObject("""
                {"status":"succeeded","duration":4,"content":{"video_url":"https://example.com/video.mp4"}}
                """);

        NanaProviderAdapter.VideoTaskState state = NanaProviderAdapter.readSeedanceState(response);

        Assertions.assertEquals("succeeded", state.status());
        Assertions.assertEquals("https://example.com/video.mp4", state.videoUrl());
        Assertions.assertEquals(4, state.durationSeconds().intValue());
    }

    /**
     * Wan 完成响应应从 output.results 读取视频地址。
     *
     * @return void 无返回值
     */
    @Test
    void shouldReadWanCompletedVideoUrl() {
        JSONObject response = JSON.parseObject("""
                {"output":{"task_id":"task-1","task_status":"SUCCEEDED","results":[{"url":"https://example.com/wan.mp4"}]},"progress":100}
                """);

        NanaProviderAdapter.VideoTaskState state = NanaProviderAdapter.readWanState(response);

        Assertions.assertEquals("succeeded", state.status());
        Assertions.assertEquals("https://example.com/wan.mp4", state.videoUrl());
        Assertions.assertEquals(100, state.progress());
    }

    /**
     * MiniMax 完成响应应从 data.results 读取视频地址。
     *
     * @return void 无返回值
     */
    @Test
    void shouldReadMiniMaxCompletedVideoUrl() {
        JSONObject response = JSON.parseObject("""
                {"code":"Success","msg":"","data":{"status":"SUCCESS","results":[{"url":"https://example.com/minimax.mp4"}]}}
                """);

        NanaProviderAdapter.VideoTaskState state = NanaProviderAdapter.readMiniMaxState(response);

        Assertions.assertEquals("success", state.status());
        Assertions.assertEquals("https://example.com/minimax.mp4", state.videoUrl());
    }

    /**
     * Wan 模型识别应覆盖 wan3.0-video 等名称且不误判其他模型。
     *
     * @return void 无返回值
     */
    @Test
    void shouldDetectWanVideoModels() {
        Assertions.assertTrue(NanaProviderAdapter.isWanVideoModel("wan3.0-video"));
        Assertions.assertTrue(NanaProviderAdapter.isWanVideoModel("wan2.5-i2v"));
        Assertions.assertFalse(NanaProviderAdapter.isWanVideoModel("doubao-seedance-2-0-mini"));
        Assertions.assertFalse(NanaProviderAdapter.isWanVideoModel("minimax-h3-ref"));
    }

    /**
     * 比例转换应把像素尺寸映射到最近的支持比例。
     *
     * @return void 无返回值
     */
    @Test
    void shouldNormalizeAspectRatioFromPixelSize() {
        Assertions.assertEquals("16:9", NanaProviderAdapter.normalizeAspectRatio("1280x720"));
        Assertions.assertEquals("9:16", NanaProviderAdapter.normalizeAspectRatio("720x1280"));
        Assertions.assertEquals("adaptive", NanaProviderAdapter.normalizeAspectRatio("auto"));
    }

    /**
     * 视频协议路由应区分豆包官转与 Seedance-cheap 通道。
     *
     * @return void 无返回值
     */
    @Test
    void shouldResolveVideoProtocolForOfficialAndCheapSeedance() {
        Assertions.assertEquals(NanaProviderAdapter.VideoProtocol.SEEDANCE_OFFICIAL,
                NanaProviderAdapter.resolveVideoProtocol("doubao-seedance-2-0-mini-260615"));
        for (String cheapModel : List.of("seedance-2.0-933", "seedance-2.0-fast", "seedance-2.5-480p",
                "seedance-2.5-720p", "seedance-2.5-flash-480p", "seedance-2.5-flash-720p",
                "seedance-2.5-tk-480p", "seedance-2.5-tk-720p")) {
            Assertions.assertEquals(NanaProviderAdapter.VideoProtocol.SEEDANCE_CHEAP,
                    NanaProviderAdapter.resolveVideoProtocol(cheapModel), cheapModel);
        }
        Assertions.assertEquals(NanaProviderAdapter.VideoProtocol.WAN, NanaProviderAdapter.resolveVideoProtocol("wan3.0-video"));
        Assertions.assertEquals(NanaProviderAdapter.VideoProtocol.MINIMAX, NanaProviderAdapter.resolveVideoProtocol("minimax-h3-ref"));
        Assertions.assertNull(NanaProviderAdapter.resolveVideoProtocol("unknown-video-model"));
    }

    /**
     * Seedance-cheap 请求应使用 seconds、aspect_ratio 与顶层素材数组，不默认传递 resolution。
     *
     * @return void 无返回值
     */
    @Test
    void shouldBuildSeedanceCheapPayloadWithoutResolution() {
        JSONObject payload = toJsonObject(NanaProviderAdapter.buildSeedanceCheapPayload(
                "seedance-2.0-933", "清晨的湖面",
                Map.of("size", "auto", "resolution", "720p", "seconds", "20"),
                List.of("https://example.com/a.png"), List.of(), List.of("https://example.com/bgm.mp3")));

        Assertions.assertEquals("seedance-2.0-933", payload.getString("model"));
        Assertions.assertEquals(20, payload.getIntValue("seconds"));
        Assertions.assertEquals("16:9", payload.getString("aspect_ratio"));
        Assertions.assertFalse(payload.containsKey("resolution"));
        Assertions.assertFalse(payload.containsKey("videos"));
        Assertions.assertEquals("https://example.com/a.png", payload.getJSONArray("images").getString(0));
        Assertions.assertEquals("https://example.com/bgm.mp3", payload.getJSONArray("audios").getString(0));
    }

    /**
     * Seedance-cheap 响应应把 unknown 视作继续轮询状态，并在 completed 时读取顶层 url。
     *
     * @return void 无返回值
     */
    @Test
    void shouldReadSeedanceCheapUnknownAndCompletedState() {
        NanaProviderAdapter.VideoTaskState unknownState = NanaProviderAdapter.readSeedanceCheapState(
                JSON.parseObject("{\"id\":\"task-1\",\"status\":\"unknown\",\"progress\":0}"));
        Assertions.assertEquals("queued", unknownState.status());

        NanaProviderAdapter.VideoTaskState completedState = NanaProviderAdapter.readSeedanceCheapState(
                JSON.parseObject("{\"id\":\"task-1\",\"status\":\"completed\",\"progress\":100,\"url\":\"https://example.com/cheap.mp4\"}"));
        Assertions.assertEquals("completed", completedState.status());
        Assertions.assertEquals(100, completedState.progress());
        Assertions.assertEquals("https://example.com/cheap.mp4", completedState.videoUrl());
    }

    /**
     * 转换请求体为 JSON 对象。
     *
     * @param payload Map<String, Object> 请求体
     * @return JSONObject JSON 请求体
     */
    private static JSONObject toJsonObject(Map<String, Object> payload) {
        return JSON.parseObject(JSON.toJSONString(payload));
    }
}
