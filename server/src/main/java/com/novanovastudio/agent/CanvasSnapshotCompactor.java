package com.novanovastudio.agent;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;

/**
 * 画布快照裁剪器。
 * <p>
 * 前端画布快照包含节点全量字段（签名 URL、对象存储元数据、分镜逐镜头长文本等），
 * 直接原样发给大模型会消耗大量 token；本裁剪器只保留主 Agent 和画布操作 Agent
 * 判断节点、决定坐标、引用节点ID、沿用生成提示词所需的最小字段。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-09-15 18:00
 */
@Component
public class CanvasSnapshotCompactor {

    /** 标题最大保留长度 */
    private static final int TITLE_MAX = 80;
    /** 文本节点正文最大保留长度 */
    private static final int TEXT_MAX = 400;
    /** 生成提示词最大保留长度 */
    private static final int PROMPT_MAX = 400;
    /** 分镜脚本说明最大保留长度 */
    private static final int INSTRUCTION_MAX = 300;
    /** 分镜视觉风格最大保留长度 */
    private static final int STYLE_MAX = 200;

    /**
     * 裁剪画布快照。
     *
     * @param canvasSnapshot Map<String, Object> 前端原始画布快照
     * @return Map<String, Object> 裁剪后的画布快照
     */
    public Map<String, Object> compact(Map<String, Object> canvasSnapshot) {
        if (canvasSnapshot == null || canvasSnapshot.isEmpty()) return Map.of();
        Map<String, Object> result = new LinkedHashMap<>();
        putIfPresent(canvasSnapshot, result, "projectId");
        putIfPresent(canvasSnapshot, result, "title");
        putIfPresent(canvasSnapshot, result, "viewport");
        putIfPresent(canvasSnapshot, result, "selectedNodeIds");
        Object connections = canvasSnapshot.get("connections");
        if (connections instanceof List<?> list) result.put("connections", list);
        Object nodes = canvasSnapshot.get("nodes");
        if (nodes instanceof List<?> list) {
            List<Object> compactedNodes = new ArrayList<>();
            for (Object node : list) {
                if (node instanceof Map<?, ?> map) compactedNodes.add(compactNode(asStringKeyMap(map)));
            }
            result.put("nodes", compactedNodes);
        }
        return result;
    }

    /**
     * 裁剪单个节点，仅保留结构字段和轻量业务字段。
     *
     * @param node Map<String, Object> 原始节点
     * @return Map<String, Object> 裁剪后的节点
     */
    private Map<String, Object> compactNode(Map<String, Object> node) {
        Map<String, Object> result = new LinkedHashMap<>();
        putIfPresent(node, result, "id");
        putIfPresent(node, result, "kind");
        Object title = node.get("title");
        if (title instanceof String text) result.put("title", truncate(text, TITLE_MAX));
        Object frame = node.get("frame");
        if (frame instanceof Map<?, ?> frameMap) result.put("frame", compactFrame(asStringKeyMap(frameMap)));
        Object execution = node.get("execution");
        if (execution instanceof Map<?, ?> executionMap) {
            Object phase = executionMap.get("phase");
            if (phase != null) result.put("execution", Map.of("phase", phase));
        }
        String kind = node.get("kind") instanceof String value ? value : "";
        switch (kind) {
            case "text" -> compactTextContent(node, result);
            case "image", "video" -> compactMediaContent(node, result);
            case "storyboard" -> compactStoryboardContent(node, result);
            case "videoComposition" -> putIfPresent(node, result, "composition");
            case "background" -> putIfPresent(node, result, "memberNodeIds");
            default -> { }
        }
        return result;
    }

    /**
     * 裁剪节点位置尺寸，去除自然宽高等非必要字段。
     *
     * @param frame Map<String, Object> 原始 frame
     * @return Map<String, Object> 裁剪后的 frame
     */
    private Map<String, Object> compactFrame(Map<String, Object> frame) {
        Map<String, Object> result = new LinkedHashMap<>();
        putIfPresent(frame, result, "position");
        putIfPresent(frame, result, "width");
        putIfPresent(frame, result, "height");
        return result;
    }

    /**
     * 裁剪文本节点内容，只保留截断后的正文。
     *
     * @param node Map<String, Object> 原始节点
     * @param result Map<String, Object> 裁剪结果承载对象
     * @return void 无返回值
     */
    private void compactTextContent(Map<String, Object> node, Map<String, Object> result) {
        Object content = node.get("content");
        if (!(content instanceof Map<?, ?> contentMap)) return;
        Object text = asStringKeyMap(contentMap).get("text");
        if (text instanceof String value) result.put("content", Map.of("text", truncate(value, TEXT_MAX)));
    }

    /**
     * 裁剪图片、视频节点内容和生成参数，去除签名URL、对象存储元数据和参考图列表。
     *
     * @param node Map<String, Object> 原始节点
     * @param result Map<String, Object> 裁剪结果承载对象
     * @return void 无返回值
     */
    private void compactMediaContent(Map<String, Object> node, Map<String, Object> result) {
        Object content = node.get("content");
        if (content instanceof Map<?, ?> contentMap) {
            Map<String, Object> contentSource = asStringKeyMap(contentMap);
            Object mimeType = contentSource.get("mimeType");
            if (mimeType != null) result.put("content", Map.of("mimeType", mimeType));
        }
        Object generation = node.get("generation");
        if (generation instanceof Map<?, ?> generationMap) {
            Map<String, Object> generationSource = asStringKeyMap(generationMap);
            Map<String, Object> compactedGeneration = new LinkedHashMap<>();
            Object prompt = generationSource.get("prompt");
            if (prompt instanceof String value && !value.isBlank()) compactedGeneration.put("prompt", truncate(value, PROMPT_MAX));
            putIfPresent(generationSource, compactedGeneration, "model");
            putIfPresent(generationSource, compactedGeneration, "size");
            putIfPresent(generationSource, compactedGeneration, "quality");
            putIfPresent(generationSource, compactedGeneration, "resolution");
            putIfPresent(generationSource, compactedGeneration, "count");
            putIfPresent(generationSource, compactedGeneration, "seconds");
            putIfPresent(generationSource, compactedGeneration, "videoGenerationMode");
            Object references = generationSource.get("references");
            if (references instanceof List<?> list && !list.isEmpty()) compactedGeneration.put("referenceCount", list.size());
            if (!compactedGeneration.isEmpty()) result.put("generation", compactedGeneration);
        }
    }

    /**
     * 裁剪分镜脚本节点，去除逐镜头长文本和资产存储元数据。
     *
     * @param node Map<String, Object> 原始节点
     * @param result Map<String, Object> 裁剪结果承载对象
     * @return void 无返回值
     */
    private void compactStoryboardContent(Map<String, Object> node, Map<String, Object> result) {
        Object content = node.get("content");
        if (content instanceof Map<?, ?> contentMap) {
            Map<String, Object> contentSource = asStringKeyMap(contentMap);
            Map<String, Object> compactedContent = new LinkedHashMap<>();
            putIfPresent(contentSource, compactedContent, "model");
            Object instruction = contentSource.get("instruction");
            if (instruction instanceof String value && !value.isBlank()) compactedContent.put("instruction", truncate(value, INSTRUCTION_MAX));
            Object visualStyle = contentSource.get("visualStyle");
            if (visualStyle instanceof String value && !value.isBlank()) compactedContent.put("visualStyle", truncate(value, STYLE_MAX));
            if (!compactedContent.isEmpty()) result.put("content", compactedContent);
        }
        Object storyboard = node.get("storyboard");
        if (storyboard instanceof Map<?, ?> storyboardMap) {
            Map<String, Object> storyboardSource = asStringKeyMap(storyboardMap);
            Map<String, Object> compactedStoryboard = new LinkedHashMap<>();
            Object shots = storyboardSource.get("shots");
            if (shots instanceof List<?> shotList) {
                List<Object> compactedShots = new ArrayList<>();
                for (Object shot : shotList) {
                    if (!(shot instanceof Map<?, ?> shotMap)) continue;
                    Map<String, Object> shotSource = asStringKeyMap(shotMap);
                    Map<String, Object> compactedShot = new LinkedHashMap<>();
                    putIfPresent(shotSource, compactedShot, "id");
                    putIfPresent(shotSource, compactedShot, "shotNumber");
                    putIfPresent(shotSource, compactedShot, "shotSize");
                    putIfPresent(shotSource, compactedShot, "durationSeconds");
                    compactedShots.add(compactedShot);
                }
                compactedStoryboard.put("shots", compactedShots);
            }
            Object assets = storyboardSource.get("assets");
            if (assets instanceof List<?> assetList) {
                List<Object> compactedAssets = new ArrayList<>();
                for (Object asset : assetList) {
                    if (!(asset instanceof Map<?, ?> assetMap)) continue;
                    Map<String, Object> assetSource = asStringKeyMap(assetMap);
                    Map<String, Object> compactedAsset = new LinkedHashMap<>();
                    putIfPresent(assetSource, compactedAsset, "id");
                    putIfPresent(assetSource, compactedAsset, "kind");
                    putIfPresent(assetSource, compactedAsset, "name");
                    compactedAssets.add(compactedAsset);
                }
                compactedStoryboard.put("assets", compactedAssets);
            }
            Object assetGeneration = storyboardSource.get("assetGeneration");
            if (assetGeneration instanceof Map<?, ?> assetGenerationMap) {
                Map<String, Object> assetGenerationSource = asStringKeyMap(assetGenerationMap);
                Map<String, Object> compactedAssetGeneration = new LinkedHashMap<>();
                putIfPresent(assetGenerationSource, compactedAssetGeneration, "phase");
                putIfPresent(assetGenerationSource, compactedAssetGeneration, "progress");
                compactedStoryboard.put("assetGeneration", compactedAssetGeneration);
            }
            if (!compactedStoryboard.isEmpty()) result.put("storyboard", compactedStoryboard);
        }
    }

    /**
     * 从源 Map 复制指定键到目标 Map（存在且非空时）。
     *
     * @param source Map<String, Object> 源
     * @param target Map<String, Object> 目标
     * @param key String 键
     * @return void 无返回值
     */
    private void putIfPresent(Map<String, Object> source, Map<String, Object> target, String key) {
        Object value = source.get(key);
        if (value != null) target.put(key, value);
    }

    /**
     * 截断字符串，超出长度时追加省略标记。
     *
     * @param value String 原始字符串
     * @param maxLength int 最大长度
     * @return String 截断后的字符串
     */
    private String truncate(String value, int maxLength) {
        if (value.length() <= maxLength) return value;
        return value.substring(0, maxLength) + "...(已截断)";
    }

    /**
     * 将泛型 Map 转为 String 键 Map，便于按键读取。
     *
     * @param map Map<?, ?> 原始 Map
     * @return Map<String, Object> String 键 Map
     */
    @SuppressWarnings("unchecked")
    private Map<String, Object> asStringKeyMap(Map<?, ?> map) {
        return (Map<String, Object>) map;
    }
}
