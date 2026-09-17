package com.novanovastudio.agent;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

/**
 * 画布快照裁剪器测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-09-15 23:00
 */
class CanvasSnapshotCompactorTest {

    /**
     * 验证图片节点保留生成所需字段并移除大型媒体字段。
     */
    @Test
    void shouldCompactImageNodeAndPreserveResolution() {
        CanvasSnapshotCompactor compactor = new CanvasSnapshotCompactor();
        Map<String, Object> imageNode = Map.of(
                "id", "image-1",
                "kind", "image",
                "title", "测试图片",
                "frame", Map.of("position", Map.of("x", 10, "y", 20), "width", 320, "height", 240),
                "execution", Map.of("phase", "succeeded", "taskId", "task-1"),
                "content", Map.of("source", "data:image/png;base64,large-content", "mimeType", "image/png"),
                "generation", Map.of(
                        "prompt", "一只站在雪山上的白色狐狸",
                        "model", "image-model",
                        "size", "16:9",
                        "quality", "high",
                        "resolution", "2K",
                        "count", 1,
                        "references", List.of("data:image/png;base64,reference")));

        Map<String, Object> compacted = compactor.compact(Map.of(
                "projectId", "project-1",
                "nodes", List.of(imageNode),
                "connections", List.of(),
                "selectedNodeIds", List.of("image-1")));

        Map<String, Object> compactedNode = firstNode(compacted);
        Map<String, Object> compactedContent = objectMap(compactedNode.get("content"));
        Map<String, Object> compactedGeneration = objectMap(compactedNode.get("generation"));
        Assertions.assertEquals("image/png", compactedContent.get("mimeType"));
        Assertions.assertFalse(compactedContent.containsKey("source"));
        Assertions.assertEquals("2K", compactedGeneration.get("resolution"));
        Assertions.assertEquals(1, compactedGeneration.get("referenceCount"));
        Assertions.assertFalse(compactedGeneration.containsKey("references"));
    }

    /**
     * 验证空画布快照返回空结果。
     */
    @Test
    void shouldReturnEmptyMapForEmptySnapshot() {
        CanvasSnapshotCompactor compactor = new CanvasSnapshotCompactor();

        Assertions.assertTrue(compactor.compact(null).isEmpty());
        Assertions.assertTrue(compactor.compact(Map.of()).isEmpty());
    }

    /**
     * 读取裁剪结果中的首个节点。
     *
     * @param compacted Map<String, Object> 裁剪后的画布快照
     * @return Map<String, Object> 首个节点
     */
    private Map<String, Object> firstNode(Map<String, Object> compacted) {
        List<?> nodes = (List<?>) compacted.get("nodes");
        return objectMap(nodes.getFirst());
    }

    /**
     * 将测试对象转换为字符串键映射。
     *
     * @param value Object 待转换对象
     * @return Map<String, Object> 字符串键映射
     */
    @SuppressWarnings("unchecked")
    private Map<String, Object> objectMap(Object value) {
        return (Map<String, Object>) value;
    }
}
