import assert from "node:assert/strict";
import test from "node:test";

import { createImageNode, createTextNode, createVideoNode } from "../constants.ts";
import {
    applyCanvasNodeAttributes,
    isImageNode,
    isTextNode,
    isVideoNode,
    updateCanvasNodeExecution,
    updateCanvasNodeFrame,
    updateCanvasNodeTitle,
    updateImageNodeGeneration,
    updateImageNodeGrouping,
    updateImageNodeContent,
    updateTextNodeContent,
    updateVideoNodeContent,
    updateVideoNodeGeneration,
} from "./canvas-node.ts";

test("更新节点尺寸时保留内容和任务状态引用", () => {
    const original = createImageNode({ id: "image-1", position: { x: 10, y: 20 } });

    const updated = updateCanvasNodeFrame(original, { width: 480, height: 320, position: { x: 30, y: 40 } });

    assert.deepEqual(updated.frame, { position: { x: 30, y: 40 }, width: 480, height: 320 });
    assert.equal(updated.content, original.content);
    assert.equal(updated.execution, original.execution);
});

test("更新任务状态只修改 execution 分组", () => {
    const original = createImageNode({ id: "image-1", position: { x: 0, y: 0 } });

    const updated = updateCanvasNodeExecution(original, { phase: "running", progress: 35 });

    assert.deepEqual(updated.execution, { phase: "running", progress: 35 });
    assert.equal(updated.content, original.content);
    assert.equal(updated.frame, original.frame);
});

test("图片和文本内容通过各自领域函数更新", () => {
    const image = createImageNode({ id: "image-1", position: { x: 0, y: 0 } });
    const text = createTextNode({ id: "text-1", position: { x: 0, y: 0 } });

    const updatedImage = updateImageNodeContent(image, { source: "data:image/png;base64,abc", bytes: 3 });
    const updatedText = updateTextNodeContent(text, { text: "新文本", fontSize: 18 });

    assert.equal(updatedImage.content.source, "data:image/png;base64,abc");
    assert.equal(updatedImage.content.bytes, 3);
    assert.deepEqual(updatedText.content, { text: "新文本", fontSize: 18 });
});

test("不同节点类型由判别字段可靠缩小", () => {
    const image = createImageNode({ id: "image-1", position: { x: 0, y: 0 } });
    const text = createTextNode({ id: "text-1", position: { x: 0, y: 0 } });
    const video = createVideoNode({ id: "video-1", position: { x: 0, y: 0 } });

    assert.equal(isImageNode(image), true);
    assert.equal(isTextNode(text), true);
    assert.equal(isVideoNode(video), true);
    assert.equal(isVideoNode(image), false);
});

test("图片生成配置和批量关系独立更新", () => {
    const image = createImageNode({ id: "image-1", position: { x: 0, y: 0 } });

    const generated = updateImageNodeGeneration(image, { prompt: "生成提示", count: 4 });
    const grouped = updateImageNodeGrouping(generated, { isRoot: true, childIds: ["image-2"] });

    assert.equal(grouped.generation.prompt, "生成提示");
    assert.equal(grouped.generation.count, 4);
    assert.deepEqual(grouped.grouping.childIds, ["image-2"]);
    assert.equal(grouped.grouping.isRoot, true);
});

test("视频内容、生成配置和标题独立更新", () => {
    const video = createVideoNode({ id: "video-1", position: { x: 0, y: 0 } });

    const withContent = updateVideoNodeContent(video, { source: "https://example.com/video.mp4", durationMilliseconds: 1000 });
    const withGeneration = updateVideoNodeGeneration(withContent, { prompt: "视频提示", seconds: "5" });
    const renamed = updateCanvasNodeTitle(withGeneration, "  新标题  ");

    assert.equal(renamed.content.source, "https://example.com/video.mp4");
    assert.equal(renamed.generation.prompt, "视频提示");
    assert.equal(renamed.generation.seconds, "5");
    assert.equal(renamed.title, "新标题");
});

test("节点成功完成时清理运行任务和错误信息", () => {
    const node = createImageNode({ id: "image-1", position: { x: 0, y: 0 } });
    node.execution = { phase: "running", taskId: "task-1", progress: 45, errorMessage: "旧错误" };

    const completed = applyCanvasNodeAttributes(node, { status: "success" });

    assert.deepEqual(completed.execution, { phase: "succeeded" });
});
