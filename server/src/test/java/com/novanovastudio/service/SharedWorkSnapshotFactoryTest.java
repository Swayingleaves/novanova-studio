package com.novanovastudio.service;

import static org.assertj.core.api.Assertions.*;
import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.dto.SharedWorkDtos;
import org.junit.jupiter.api.Test;

/**
 * 验证公开快照边界，避免编辑器配置、聊天或源存储信息被公开。
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-06 10:00
 */
class SharedWorkSnapshotFactoryTest {
    /** 实际白名单构造器。 */
    private final SharedWorkSnapshotFactory factory = new SharedWorkSnapshotFactory();

    /** 单结果默认不公开任何生成信息或参考素材。 */
    @Test
    void imageExcludesPrivateGenerationAndReferenceData() {
        var snapshot = factory.build(generation("image"), request("generation", "image", false));
        assertThat(snapshot.data().keySet()).containsExactlyInAnyOrder("kind", "media");
        assertThat(snapshot.data().toJSONString()).doesNotContain("secret", "https://", "storageKey", "prompt", "model");
        assertThat(snapshot.media()).hasSize(1);
        assertThat(snapshot.modelConfigurationId()).isEmpty();
    }

    /** 作者主动公开时只保留生成参数，并由服务层另查展示模型名称。 */
    @Test
    void imageIncludesOnlySelectedGenerationFields() {
        var snapshot = factory.build(generation("image"), request("generation", "image", true));
        assertThat(snapshot.data().getJSONObject("generation")).containsEntry("prompt", "公开提示词").containsEntry("size", "1:1");
        assertThat(snapshot.data().toJSONString()).doesNotContain("secret", "channel", "references", "apiKey");
        assertThat(snapshot.modelConfigurationId()).isEqualTo("private-model");
    }

    /** 视频标准结果与图片遵循相同的白名单。 */
    @Test
    void videoResolvesOnlySelectedResult() {
        var snapshot = factory.build(generation("video"), request("generation", "video", false));
        assertThat(snapshot.media()).singleElement().satisfies(media -> assertThat(media.storageKey()).isEqualTo("source-video"));
        assertThat(snapshot.data().getString("kind")).isEqualTo("video");
    }

    /** 批量视频按保存的结果标识读取，不能只支持最后一个结果。 */
    @Test
    void batchVideoSelectsStoredResult() {
        var source = generation("video"); var round = source.getJSONArray("rounds").getJSONObject(0);
        round.put("results", JSONArray.of(round.remove("result")));
        assertThat(factory.build(source, request("generation", "video", false)).media()).hasSize(1);
    }

    /** 工作流一基序号只在已成功阶段内选择对应媒体，并校验实际类型。 */
    @Test
    void workflowSelectorsRequireSuccessfulStageAndCorrectType() {
        var output = JSONObject.of("mimeType", "video/mp4", "taskType", "video", "url", "https://source/video", "id", "output-1");
        var stage = JSONObject.of("status", "success", "outputs", JSONArray.of(output));
        var source = JSONObject.of("rounds", JSONArray.of(JSONObject.of("id", "round", "stages", JSONArray.of(stage))));
        var request = new SharedWorkDtos.SubmitRequest("generation", "source", "video", "round", "stage:1:1", null, "视频", "", "视觉海报", false, "request", "");
        assertThat(factory.build(source, request).media()).hasSize(1);
        stage.put("status", "running");
        assertThatThrownBy(() -> factory.build(source, request)).isInstanceOf(BusinessException.class);
        stage.put("status", "success"); output.put("taskType", "image"); output.put("mimeType", "image/png");
        assertThatThrownBy(() -> factory.build(source, request)).isInstanceOf(BusinessException.class);
    }

    /** 非成功结果不能发布，客户端不能指定别的结果。 */
    @Test
    void unfinishedAndUnknownResultsAreRejected() {
        var source = generation("image");
        source.getJSONArray("rounds").getJSONObject(0).getJSONArray("results").getJSONObject(0).put("status", "running");
        assertThatThrownBy(() -> factory.build(source, request("generation", "image", false))).isInstanceOf(BusinessException.class);
        source.getJSONArray("rounds").getJSONObject(0).put("results", new JSONArray());
        assertThatThrownBy(() -> factory.build(source, request("generation", "image", false))).isInstanceOf(BusinessException.class);
    }

    /** 完整场景包括文字、连线及参考素材，但彻底排除聊天和运行凭据。 */
    @Test
    void canvasPublishesSceneAndCopiesEveryReference() {
        JSONObject document = canvas();
        document.getJSONObject("scene").getJSONArray("nodes").getJSONObject(0).getJSONObject("generation").put("resolution", "2k");
        var generation = document.getJSONObject("scene").getJSONArray("nodes").getJSONObject(0).getJSONObject("generation");
        generation.put("generationStyleSnapshots", JSONArray.of(JSONObject.of("id", 987654, "name", "画布风格", "generationType", "generation", "stylePrompt", "风格提示词", "channelId", "secret")));
        generation.put("settingGraph", JSONObject.of("id", 987655, "name", "设定图", "targetType", "canvasSettingGraph", "systemPrompt", "设定图提示词", "aspectRatio", "16:9", "apiKey", "secret"));
        var snapshot = factory.build(document, request("canvas", "canvas", false));
        assertThat(snapshot.media()).hasSize(2);
        String json = snapshot.data().toJSONString();
        assertThat(json).contains("画布文字", "节点提示词", "reference", "edge-1").doesNotContain("secret", "storageKey", "https://", "conversation", "taskId", "private-model");
        JSONObject image = snapshot.data().getJSONObject("scene").getJSONArray("nodes").getJSONObject(0);
        assertThat(image.getJSONObject("generation").getString("model")).isEmpty();
        assertThat(image.getJSONObject("generation").getString("resolution")).isEqualTo("2k");
        assertThat(image.getJSONObject("generation").getJSONArray("generationStyleSnapshots").getJSONObject(0).getIntValue("id")).isEqualTo(1);
        assertThat(image.getJSONObject("generation").getJSONObject("settingGraph").getIntValue("id")).isEqualTo(1);
        assertThat(json).contains("风格提示词", "设定图提示词").doesNotContain("987654", "987655");
        assertThat(image.getJSONObject("execution").getString("phase")).isEqualTo("idle");
        document.getJSONObject("scene").getJSONArray("nodes").getJSONObject(1).getJSONObject("content").put("text", "修改原文");
        assertThat(snapshot.data().toJSONString()).contains("画布文字").doesNotContain("修改原文");
    }

    /** 节点分享只取该节点的媒体，不因来源是画布而公开全部场景。 */
    @Test
    void canvasImageDoesNotRevealOtherNodes() {
        var snapshot = factory.build(canvas(), request("canvas", "image", false));
        assertThat(snapshot.media()).hasSize(1);
        assertThat(snapshot.data().toJSONString()).doesNotContain("画布文字", "节点提示词", "reference");
    }

    /** 不支持的节点不能静默丢失。 */
    @Test
    void unsupportedAndEmptyCanvasesFailExplicitly() {
        var document = canvas();
        document.getJSONObject("scene").getJSONArray("nodes").getJSONObject(0).put("kind", "unknown");
        assertThatThrownBy(() -> factory.build(document, request("canvas", "canvas", false))).isInstanceOf(BusinessException.class);
        document.getJSONObject("scene").put("nodes", new JSONArray());
        assertThatThrownBy(() -> factory.build(document, request("canvas", "canvas", false))).isInstanceOf(BusinessException.class);
    }

    /** 已复制画布续签后仍通过稳定媒体标识准备新分享，避免读取过期地址。 */
    @Test
    void copiedCanvasRestoresOwnedMediaKeysForReferences() {
        var document = canvas();
        document.put("sharedMedia", JSONArray.of(JSONObject.of("url", "https://reference/image", "storageKey", "image:shared-copy:reference")));
        var snapshot = factory.build(document, request("canvas", "canvas", false));
        assertThat(snapshot.media().get(1).storageKey()).isEqualTo("image:shared-copy:reference");
        assertThat(snapshot.media().get(1).sourceUrl()).isEmpty();
    }

    /** 媒体占位符只可用于媒体字段，文字和提示词中的相同字符串必须原样保留。 */
    @Test
    void hydrationDoesNotReplaceLiteralTextOrPrompts() {
        var input = JSONObject.of("prompt", "shared-asset:asset1", "text", "shared-asset:asset1", "source", "shared-asset:asset1", "references", JSONArray.of("shared-asset:asset1"));
        var result = (JSONObject) SharedWorkService.replace(input, java.util.Map.of("shared-asset:asset1", "https://private/media"));
        assertThat(result.getString("prompt")).isEqualTo("shared-asset:asset1");
        assertThat(result.getString("text")).isEqualTo("shared-asset:asset1");
        assertThat(result.getString("source")).isEqualTo("https://private/media");
        assertThat(result.getJSONArray("references").getString(0)).isEqualTo("https://private/media");
    }

    /** @param sourceType 来源种类 @param type 作品类型 @param information 是否公开生成信息 @return 测试表单 */
    static SharedWorkDtos.SubmitRequest request(String sourceType, String type, boolean information) {
        return new SharedWorkDtos.SubmitRequest(sourceType, "source", type, "round", "result", "node-1", "作品", "简介", "视觉海报", information, "request", "");
    }

    /** @param kind 结果类型 @return 带有敏感扩展字段的真实形状记录 */
    static JSONObject generation(String kind) {
        var result = JSONObject.of("id", "result", "status", "success", kind, JSONObject.of("id", "media", "storageKey", "source-" + kind, "url", "https://source/file", "mimeType", kind + ("image".equals(kind) ? "/png" : "/mp4"), "objectStorage", JSONObject.of("secret", "secret")));
        var round = JSONObject.of("id", "round", "prompt", "公开提示词", "references", JSONArray.of(JSONObject.of("url", "https://secret-reference")), "config", JSONObject.of("size", "1:1", "imageModel", "private-model", "videoModel", "private-model", "apiKey", "secret", "channel", "secret"));
        round.put("image".equals(kind) ? "results" : "result", "image".equals(kind) ? JSONArray.of(result) : result);
        return JSONObject.of("rounds", JSONArray.of(round));
    }

    /** @return 包含媒体、文字、参考素材和私密配置的场景 */
    static JSONObject canvas() {
        return JSON.parseObject("""
                {"identity":{"id":"source","title":"测试画布"},"conversation":{"sessions":[{"secret":"secret"}]},
                 "scene":{"nodes":[
                   {"id":"node-1","kind":"image","title":"图片","frame":{"position":{"x":0,"y":0},"width":320,"height":240},
                    "content":{"source":"data:image/png;base64,aGVsbG8=","mimeType":"image/png"},
                    "execution":{"phase":"succeeded","taskId":"secret"},
                    "generation":{"prompt":"节点提示词","model":"private-model","references":["https://reference/image"],"referenceObjectStorages":[],"apiKey":"secret"},"grouping":{"childIds":[]}},
                   {"id":"node-2","kind":"text","title":"文字","frame":{"position":{"x":400,"y":0},"width":240,"height":200},"content":{"text":"画布文字","fontSize":16}}],
                 "connections":[{"id":"edge-1","source":{"nodeId":"node-1"},"target":{"nodeId":"node-2"}}],"viewport":{"offsetX":0,"offsetY":0,"zoom":1}},
                 "preferences":{"background":"dots","showImageInformation":false},"apiKey":"secret"}
                """);
    }
}
