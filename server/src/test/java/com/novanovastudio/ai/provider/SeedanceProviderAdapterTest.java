package com.novanovastudio.ai.provider;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.ai.AiTaskTypes;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

/**
 * Seedance渠道适配器测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-28 11:45
 */
class SeedanceProviderAdapterTest {

    /**
     * Seedance适配器应只声明视频任务能力。
     *
     * @return void 无返回值
     */
    @Test
    void shouldOnlySupportVideoTasks() {
        SeedanceProviderAdapter adapter = new SeedanceProviderAdapter(null, null);

        Assertions.assertEquals("seedance", adapter.apiFormat());
        Assertions.assertTrue(adapter.supports(AiTaskTypes.VIDEO));
        Assertions.assertFalse(adapter.supports(AiTaskTypes.IMAGE));
        Assertions.assertFalse(adapter.supports(AiTaskTypes.TEXT));
    }

    /**
     * 通用视频参数应转换为Seedance请求字段。
     *
     * @return void 无返回值
     */
    @Test
    void shouldBuildSeedanceVideoParameters() {
        JSONObject payload = toJsonObject(SeedanceProviderAdapter.buildRequestPayload(
                "doubao-seedance-2-0-260128",
                "城市夜景",
                Map.of("size", "1280x720", "resolution", "1080p", "seconds", "8", "watermark", true),
                List.of(),
                List.of()
        ));

        Assertions.assertEquals("doubao-seedance-2-0-260128", payload.getString("model"));
        Assertions.assertEquals("16:9", payload.getString("ratio"));
        Assertions.assertEquals("1080p", payload.getString("resolution"));
        Assertions.assertEquals(8, payload.getIntValue("duration"));
        Assertions.assertTrue(payload.getBooleanValue("watermark"));
        Assertions.assertEquals("城市夜景", payload.getJSONArray("content").getJSONObject(0).getString("text"));
    }

    /**
     * 图片和视频引用应转换为Seedance多模态内容并带有稳定编号。
     *
     * @return void 无返回值
     */
    @Test
    void shouldBuildSeedanceReferenceContent() {
        JSONObject payload = toJsonObject(SeedanceProviderAdapter.buildRequestPayload(
                "doubao-seedance-2-0-260128",
                "让图片1中的人物进入视频1的场景",
                Map.of("size", "adaptive", "resolution", "720p", "seconds", "-1"),
                List.of("https://example.com/reference.png"),
                List.of("https://example.com/reference.mp4")
        ));
        JSONArray content = payload.getJSONArray("content");

        Assertions.assertEquals(3, content.size());
        Assertions.assertTrue(content.getJSONObject(0).getString("text").startsWith("参考素材编号：图片1、视频1。"));
        Assertions.assertEquals("image_url", content.getJSONObject(1).getString("type"));
        Assertions.assertEquals("reference_image", content.getJSONObject(1).getString("role"));
        Assertions.assertEquals("https://example.com/reference.png",
                content.getJSONObject(1).getJSONObject("image_url").getString("url"));
        Assertions.assertEquals("video_url", content.getJSONObject(2).getString("type"));
        Assertions.assertEquals("reference_video", content.getJSONObject(2).getString("role"));
        Assertions.assertEquals("https://example.com/reference.mp4",
                content.getJSONObject(2).getJSONObject("video_url").getString("url"));
        Assertions.assertEquals(-1, payload.getIntValue("duration"));
        Assertions.assertFalse(payload.containsKey("watermark"));
    }

    /**
     * 将请求映射转换为便于断言的Fastjson2对象。
     *
     * @param value Map<String, Object> 请求映射
     * @return JSONObject JSON对象
     */
    private JSONObject toJsonObject(Map<String, Object> value) {
        return JSON.parseObject(JSON.toJSONString(value));
    }
}
