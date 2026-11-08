package com.novanovastudio.service;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.SharedWorkDtos;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Component;

/**
 * 按公开字段白名单构造作品快照，将所有媒体转换为分享内部引用。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-06 10:00
 */
@Component
public class SharedWorkSnapshotFactory {
    /** 分享媒体占位符，不包含源存储键。 */
    public static final String ASSET_PREFIX = "shared-asset:";
    /** 节点种类是项目现有场景协议，未知种类明确拒绝，不能静默丢失场景。 */
    private static final Set<String> NODE_KINDS = Set.of("image", "video", "audio", "text", "storyboard", "videoComposition", "directorDesk", "background");
    /** 三维工程只允许恢复场景所需的结构字段，不接受自由配置或运行状态。 */
    private static final Set<String> DIRECTOR_FIELDS = Set.of("schemaVersion", "projectRevision", "objects", "id", "name", "kind",
            "position", "rotation", "scale", "x", "y", "z", "color", "visible", "locked", "assetId", "pose", "joints", "rootOffset",
            "body", "spine", "neck", "head", "leftShoulder", "rightShoulder", "leftElbow", "rightElbow", "leftWrist", "rightWrist",
            "leftHip", "rightHip", "leftKnee", "rightKnee", "leftAnkle", "rightAnkle", "transform", "track", "keyframes", "value",
            "timeMilliseconds", "motionPaths", "actions", "actionClips", "preset", "startTimeMilliseconds", "endTimeMilliseconds", "speed",
            "anchors", "incoming", "outgoing", "closed", "followDirection", "cameras", "target", "fieldOfView", "targetObjectId",
            "targetOffset", "selectedCameraId", "timeline", "durationMilliseconds", "frameRate", "background", "exportSettings", "aspectRatio", "width", "height");

    /** 服务端确认的媒体来源，禁止作为公开数据返回。 */
    public record MediaSource(String assetId, String storageKey, String sourceUrl, String mimeType, String fileName) { }
    /** 公开快照与仅内部使用的媒体来源列表。 */
    public record Snapshot(JSONObject data, List<MediaSource> media, String modelConfigurationId) { }

    /**
     * 从已校验归属的来源记录中提取分享内容。
     * @param source 服务端保存的生成记录或画布
     * @param request 投稿参数
     * @return 不含源媒体地址和账号配置的快照
     * @throws BusinessException 源结果不存在、未完成或场景不受支持时抛出
     */
    public Snapshot build(JSONObject source, SharedWorkDtos.SubmitRequest request) {
        // 复制画布保存的地址会续签，先还原为稳定的个人媒体标识，避免内容摘要随授权地址变化。
        Map<String, String> ownedMedia = new LinkedHashMap<>();
        for (Object value : array(source, "sharedMedia")) {
            JSONObject reference = (JSONObject) value;
            ownedMedia.put(reference.getString("url"), "owned-media:" + reference.getString("storageKey"));
        }
        source = (JSONObject) SharedWorkService.replace(source, ownedMedia);
        Map<String, MediaSource> media = new LinkedHashMap<>();
        JSONObject data;
        String modelId = "";
        if ("canvas".equals(request.sourceType())) {
            if ("canvas".equals(request.workType())) data = canvas(source, media);
            else {
                JSONObject node = find(array(source.getJSONObject("scene"), "nodes"), request.nodeId());
                if (!request.workType().equals(node.getString("kind"))) throw invalid("分享类型与画布节点不一致");
                data = single(node.getJSONObject("content"), node.getJSONObject("generation"), request, media);
                modelId = text(node.getJSONObject("generation"), "model");
            }
        } else if ("generation".equals(request.sourceType()) && Set.of("image", "video").contains(request.workType())) {
            JSONObject round = find(array(source, "rounds"), request.roundId());
            JSONObject result;
            if (request.resultId() != null && (request.resultId().startsWith("stage:") || request.resultId().startsWith("output:"))) result = workflowResult(round, request.resultId(), request.workType());
            else if ("image".equals(request.workType())) result = find(array(round, "results"), request.resultId());
            else {
                result = round.getJSONObject("result");
                if (result == null || !request.resultId().equals(result.getString("id"))) {
                    result = videoResult(round, request.resultId());
                }
            }
            if (result.containsKey("status") && !"success".equals(result.getString("status"))) throw invalid("只能分享已成功生成的结果");
            JSONObject content = result.getJSONObject(request.workType());
            if (content == null) content = result;
            JSONObject settings = scalar(round.getJSONObject("config"), "quality", "imageResolution", "resolution", "size", "count", "seconds", "videoSeconds", "vquality", "videoWatermark", "videoGenerationMode");
            settings.put("prompt", text(round, "prompt"));
            settings.put("generationPrompt", text(round, "generationPrompt"));
            data = single(content, settings, request, media);
            JSONObject config = round.getJSONObject("config");
            modelId = text(config, "image".equals(request.workType()) ? "imageModel" : "videoModel");
        } else throw invalid("分享来源或作品类型不正确");
        if (!request.includeGenerationInformation() || "canvas".equals(request.workType())) modelId = "";
        return new Snapshot(data, List.copyOf(media.values()), modelId);
    }

    /**
     * 构造单个图片或视频的公开内容。
     * @param content 源媒体
     * @param settings 生成设置
     * @param request 分享选项
     * @param media 批内媒体集合
     * @return 公开结果
     */
    private JSONObject single(JSONObject content, JSONObject settings, SharedWorkDtos.SubmitRequest request, Map<String, MediaSource> media) {
        JSONObject result = JSONObject.of("kind", request.workType(), "media", media(content, request.workType(), media));
        if (result.getJSONObject("media").getString("source").isBlank()) throw invalid("结果尚无可分享的媒体，请完成生成后重试");
        if (request.includeGenerationInformation()) {
            result.put("generation", scalar(settings, "prompt", "generationPrompt", "quality", "imageResolution", "resolution", "size", "count", "seconds", "videoSeconds", "vquality", "videoWatermark", "videoGenerationMode"));
        }
        return result;
    }

    /**
     * 构造完整画布，仅保留场景及展示偏好。
     * @param source 已保存画布
     * @param media 分享内媒体
     * @return 公开画布快照
     */
    private JSONObject canvas(JSONObject source, Map<String, MediaSource> media) {
        JSONObject scene = source.getJSONObject("scene");
        JSONArray sourceNodes = array(scene, "nodes");
        if (sourceNodes.isEmpty()) throw invalid("空画布不能分享");
        JSONArray nodes = new JSONArray();
        for (int index = 0; index < sourceNodes.size(); index++) nodes.add(node(sourceNodes.getJSONObject(index), media));
        JSONArray connections = new JSONArray();
        for (Object value : array(scene, "connections")) {
            JSONObject connection = (JSONObject) value;
            connections.add(JSONObject.of("id", connection.getString("id"),
                    "source", scalar(connection.getJSONObject("source"), "nodeId", "portId"),
                    "target", scalar(connection.getJSONObject("target"), "nodeId", "portId")));
        }
        return JSONObject.of("kind", "canvas", "scene", JSONObject.of("nodes", nodes, "connections", connections,
                "viewport", scalar(scene.getJSONObject("viewport"), "offsetX", "offsetY", "zoom")),
                "preferences", scalar(source.getJSONObject("preferences"), "background", "showImageInformation"));
    }

    /**
     * 按现有节点协议构造公开节点，执行状态重置为空闲。
     * @param source 源节点
     * @param media 分享内媒体
     * @return 公开节点
     */
    private JSONObject node(JSONObject source, Map<String, MediaSource> media) {
        String kind = source.getString("kind");
        if (!NODE_KINDS.contains(kind)) throw invalid("画布含有不支持分享的节点类型：" + kind);
        JSONObject result = scalar(source, "id", "kind", "title");
        JSONObject frame = scalar(source.getJSONObject("frame"), "width", "height", "naturalWidth", "naturalHeight", "freeResize");
        frame.put("position", scalar(source.getJSONObject("frame").getJSONObject("position"), "x", "y"));
        result.put("frame", frame);
        result.put("execution", JSONObject.of("phase", "idle"));
        switch (kind) {
            case "image", "video", "audio" -> {
                JSONObject content = source.getJSONObject("content");
                JSONObject publicContent = media(content, kind, media);
                for (String key : List.of("durationMilliseconds", "trimStartMilliseconds", "trimEndMilliseconds")) {
                    if (content.containsKey(key)) publicContent.put(key, content.get(key));
                }
                if ("audio".equals(kind)) publicContent.put("waveformPeaks", numbers(array(content, "waveformPeaks")));
                result.put("content", publicContent);
                if (!"audio".equals(kind)) {
                    JSONObject generation = scalar(source.getJSONObject("generation"), "operation", "prompt", "quality", "imageResolution", "resolution", "size", "count", "seconds", "videoGenerationMode", "watermark");
                    generation.put("model", "");
                    // 参考素材属于完整场景的一部分，也必须复制，不能留下原作者媒体地址。
                    generation.put("references", references(source.getJSONObject("generation"), "references", "referenceObjectStorages", "image", media));
                    generation.put("referenceObjectStorages", new JSONArray());
                    generation.put("generationStyleIds", new JSONArray());
                    // 保留场景中的提示词内容，用批内序号替代源风格及技能配置标识。
                    JSONArray styles = new JSONArray();
                    for (Object value : array(source.getJSONObject("generation"), "generationStyleSnapshots")) {
                        JSONObject style = scalar((JSONObject) value, "name", "generationType", "stylePrompt");
                        style.put("id", styles.size() + 1); styles.add(style);
                    }
                    generation.put("generationStyleSnapshots", styles);
                    JSONObject settingGraph = source.getJSONObject("generation").getJSONObject("settingGraph");
                    if ("image".equals(kind) && settingGraph != null) {
                        JSONObject skill = scalar(settingGraph, "name", "targetType", "systemPrompt", "aspectRatio");
                        skill.put("id", 1); generation.put("settingGraph", skill);
                    }
                    if ("video".equals(kind)) {
                        generation.put("videoReferences", references(source.getJSONObject("generation"), "videoReferences", "videoReferenceObjectStorages", "video", media));
                        generation.put("videoReferenceObjectStorages", new JSONArray());
                        JSONArray audios = new JSONArray();
                        for (Object value : array(source.getJSONObject("generation"), "audioReferences")) {
                            JSONObject audio = (JSONObject) value;
                            JSONObject copy = media(audio, "audio", media);
                            copy.putAll(scalar(audio, "id", "name", "type", "durationMs", "trimStartMs", "trimEndMs"));
                            copy.put("url", copy.remove("source"));
                            audios.add(copy);
                        }
                        generation.put("audioReferences", audios);
                    }
                    result.put("generation", generation);
                }
                if ("image".equals(kind)) {
                    JSONObject grouping = scalar(source.getJSONObject("grouping"), "isRoot", "rootId", "usesReferenceImages", "primaryImageId", "expanded");
                    grouping.put("childIds", strings(array(source.getJSONObject("grouping"), "childIds")));
                    result.put("grouping", grouping);
                }
            }
            case "text" -> result.put("content", scalar(source.getJSONObject("content"), "text", "fontSize"));
            case "background" -> {
                result.putAll(scalar(source, "backgroundColor"));
                result.put("memberNodeIds", strings(array(source, "memberNodeIds")));
                if (source.getJSONArray("labels") != null) {
                    JSONArray labels = new JSONArray();
                    for (Object value : array(source, "labels")) {
                        if (value instanceof JSONObject label) labels.add(scalar(label, "id", "text", "x", "y", "color", "fontSize"));
                    }
                    result.put("labels", labels);
                }
            }
            case "videoComposition" -> {
                JSONObject composition = scalar(source.getJSONObject("composition"), "resultVideoNodeId");
                composition.put("inputVideoNodeIds", strings(array(source.getJSONObject("composition"), "inputVideoNodeIds")));
                result.put("composition", composition);
            }
            case "storyboard" -> {
                result.put("content", scalar(source.getJSONObject("content"), "instruction", "visualStyle"));
                result.getJSONObject("content").put("model", "");
                JSONArray shots = new JSONArray();
                JSONObject storyboard = source.getJSONObject("storyboard");
                for (Object value : array(storyboard, "shots")) {
                    JSONObject shot = (JSONObject) value;
                    JSONObject copy = scalar(shot, "id", "shotNumber", "durationSeconds", "shotSize", "scene", "description", "visualDescription", "characterAction", "atmosphere", "lightingAtmosphere", "dialogueVoiceover", "soundEffect", "cameraMovement", "finalPrompt");
                    copy.put("assetIds", strings(array(shot, "assetIds")));
                    shots.add(copy);
                }
                JSONArray assets = new JSONArray();
                for (Object value : array(storyboard, "assets")) {
                    JSONObject asset = (JSONObject) value;
                    JSONObject copy = scalar(asset, "id", "kind", "name", "description");
                    if (asset.getJSONObject("image") != null) copy.put("image", media(asset.getJSONObject("image"), "image", media));
                    assets.add(copy);
                }
                result.put("storyboard", JSONObject.of("shots", shots, "assets", assets));
            }
            case "directorDesk" -> {
                JSONObject director = source.getJSONObject("director");
                JSONObject copy = (JSONObject) directorValue(director);
                JSONObject project = copy.getJSONObject("project");
                if (project == null) {
                    project = (JSONObject) directorValue(director.getJSONObject("project"));
                    copy.put("project", project);
                }
                JSONArray assets = new JSONArray();
                for (Object value : array(director.getJSONObject("project"), "assets")) {
                    JSONObject asset = (JSONObject) value;
                    JSONObject item = media(asset, "other", media);
                    item.putAll(scalar(asset, "id", "name", "kind"));
                    assets.add(item);
                }
                project.put("assets", assets);
                if (director.getJSONObject("cover") != null) copy.put("cover", media(director.getJSONObject("cover"), "image", media));
                result.put("director", copy);
            }
            default -> throw invalid("不支持的画布节点");
        }
        return result;
    }

    /**
     * 将节点媒体转换为去重后的本次分享引用。
     * @param content 已保存的媒体对象
     * @param kind 媒体种类
     * @param media 去重集合
     * @return 不含源地址的媒体内容
     */
    private JSONObject media(JSONObject content, String kind, Map<String, MediaSource> media) {
        if (content == null) throw invalid("分享结果没有媒体内容");
        String storageKey = text(content, "storageKey");
        String url = first(text(content, "source"), text(content, "url"), text(content, "dataUrl"), text(content.getJSONObject("objectStorage"), "url"));
        if (url.startsWith("owned-media:")) { storageKey = url.substring("owned-media:".length()); url = ""; }
        if (storageKey.isBlank() && url.isBlank()) return JSONObject.of("source", "");
        String identity = storageKey.isBlank() ? url : storageKey;
        MediaSource asset = media.get(identity);
        if (asset == null) {
            asset = new MediaSource("asset" + (media.size() + 1), storageKey, url,
                    first(text(content, "mimeType"), text(content, "type"), "other".equals(kind) ? "application/octet-stream" : kind + "/" + ("image".equals(kind) ? "png" : "video".equals(kind) ? "mp4" : "mpeg")),
                    first(text(content, "name"), kind + "-" + (media.size() + 1)));
            media.put(identity, asset);
        }
        JSONObject result = scalar(content, "width", "height", "bytes", "durationMs");
        result.put("source", ASSET_PREFIX + asset.assetId());
        result.put("mimeType", asset.mimeType());
        return result;
    }

    /**
     * 复制按位置关联的参考媒体。
     * @param settings 源生成设置
     * @param key 地址数组字段
     * @param objects 对象信息数组字段
     * @param kind 媒体种类
     * @param media 媒体集合
     * @return 分享内部媒体引用
     */
    private JSONArray references(JSONObject settings, String key, String objects, String kind, Map<String, MediaSource> media) {
        JSONArray result = new JSONArray();
        JSONArray urls = array(settings, key);
        JSONArray objectStorages = array(settings, objects);
        for (int index = 0; index < urls.size(); index++) {
            JSONObject content = JSONObject.of("source", urls.getString(index));
            if (index < objectStorages.size()) content.put("objectStorage", objectStorages.getJSONObject(index));
            result.add(media(content, kind, media).getString("source"));
        }
        return result;
    }

    /** @param round 已保存视频轮次 @param id 结果标识 @return 标准或工作流中成功完成的结果 @throws BusinessException 结果不存在时抛出 */
    private JSONObject videoResult(JSONObject round, String id) {
        for (Object value : array(round, "results")) { JSONObject result = (JSONObject) value; if (id.equals(result.getString("id"))) return result; }
        for (Object value : array(round, "outputs")) { JSONObject result = (JSONObject) value; if (id.equals(result.getString("id"))) return result; }
        for (Object stage : array(round, "stages")) {
            for (Object value : array((JSONObject) stage, "outputs")) { JSONObject result = (JSONObject) value; if (id.equals(result.getString("id"))) return result; }
        }
        throw invalid("源结果不存在，请刷新后重试");
    }

    /** @param round 已保存轮次 @param selector 批内一基序号 @param type 所选媒体种类 @return 已成功工作流输出 @throws BusinessException 输出不存在或种类不符时抛出 */
    private JSONObject workflowResult(JSONObject round, String selector, String type) {
        try {
            String[] parts = selector.split(":");
            JSONArray outputs;
            int index;
            if ("stage".equals(parts[0]) && parts.length == 3) {
                JSONObject stage = array(round, "stages").getJSONObject(Integer.parseInt(parts[1]) - 1);
                if (!"success".equals(stage.getString("status"))) throw invalid("只能分享已成功生成的工作流结果");
                outputs = array(stage, "outputs"); index = Integer.parseInt(parts[2]) - 1;
            } else if ("output".equals(parts[0]) && parts.length == 2) {
                outputs = array(round, "outputs"); index = Integer.parseInt(parts[1]) - 1;
            } else throw invalid("工作流结果标识不正确");
            JSONObject result = outputs.getJSONObject(index);
            if (!type.equals(result.getString("taskType")) && !text(result, "mimeType").startsWith(type + "/")) throw invalid("工作流输出与分享类型不一致");
            return result;
        } catch (IndexOutOfBoundsException | NumberFormatException exception) { throw invalid("工作流结果不存在，请刷新后重试"); }
    }

    /**
     * 递归保留三维工程协议字段。
     * @param value 源值
     * @return 白名单值
     */
    private Object directorValue(Object value) {
        if (value instanceof JSONObject object) {
            JSONObject result = new JSONObject();
            object.forEach((key, item) -> { if (DIRECTOR_FIELDS.contains(key)) result.put(key, directorValue(item)); });
            return result;
        }
        if (value instanceof JSONArray array) {
            JSONArray result = new JSONArray();
            array.forEach(item -> result.add(directorValue(item)));
            return result;
        }
        return value instanceof String || value instanceof Number || value instanceof Boolean ? value : null;
    }

    /**
     * 仅复制指定字段的简单值，禁止通过扩展对象夹带账号配置。
     * @param source 来源对象
     * @param keys 允许的字段
     * @return 简单字段对象
     */
    private static JSONObject scalar(JSONObject source, String... keys) {
        JSONObject result = new JSONObject();
        if (source != null) for (String key : keys) {
            Object value = source.get(key);
            if (value instanceof String || value instanceof Number || value instanceof Boolean) result.put(key, value);
        }
        return result;
    }

    /**
     * 查找保存结果的实际标识，工作流显式一基选择器由专用方法解析。
     * @param values 对象数组
     * @param id 实际标识
     * @return 对象
     * @throws BusinessException 对象不存在时抛出
     */
    private static JSONObject find(JSONArray values, String id) {
        for (int index = 0; index < values.size(); index++) if (id != null && id.equals(values.getJSONObject(index).getString("id"))) return values.getJSONObject(index);
        throw invalid("原结果不存在或尚未保存，请刷新后重试");
    }

    /** @param source 来源对象 @param key 数组字段 @return 现有数组或明确的空集合 */
    private static JSONArray array(JSONObject source, String key) { return source == null || source.getJSONArray(key) == null ? new JSONArray() : source.getJSONArray(key); }
    /** @param source 来源对象 @param key 文本字段 @return 已去空白的文本 */
    private static String text(JSONObject source, String key) { return source == null || source.getString(key) == null ? "" : source.getString(key).trim(); }
    /** @param values 已知来源的候选文本 @return 第一个有效值 */
    private static String first(String... values) { for (String value : values) if (!value.isBlank()) return value; return ""; }
    /** @param values 原数组 @return 仅含文本的数组 */
    private static JSONArray strings(JSONArray values) { return new JSONArray(values.stream().filter(String.class::isInstance).toList()); }
    /** @param values 原数组 @return 仅含数值的数组 */
    private static JSONArray numbers(JSONArray values) { return new JSONArray(values.stream().filter(Number.class::isInstance).toList()); }
    /** @param message 失败原因 @return 参数业务异常 */
    private static BusinessException invalid(String message) { return new BusinessException(ErrorCode.PARAM_INVALID, message); }
}
