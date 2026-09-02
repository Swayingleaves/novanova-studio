import assert from "node:assert/strict";
import test from "node:test";

import { createImageNode, createStoryboardNode, createTextNode, createVideoNode } from "../constants.ts";
import {
    applyCanvasNodeAttributes,
    isImageNode,
    isStoryboardNode,
    isTextNode,
    isVideoNode,
    updateCanvasNodeExecution,
    updateCanvasNodeFrame,
    updateCanvasNodeTitle,
    updateImageNodeGeneration,
    updateImageNodeGrouping,
    updateImageNodeContent,
    updateStoryboardNodeData,
    updateStoryboardNodeContent,
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
    const storyboard = createStoryboardNode({ id: "storyboard-1", position: { x: 0, y: 0 } });

    assert.equal(isImageNode(image), true);
    assert.equal(isTextNode(text), true);
    assert.equal(isVideoNode(video), true);
    assert.equal(isVideoNode(image), false);
    assert.equal(isStoryboardNode(storyboard), true);
    assert.equal(isStoryboardNode(text), false);
});

test("分镜节点属性更新保留镜头与资产编辑数据", () => {
    const original = createStoryboardNode({ id: "storyboard-1", position: { x: 0, y: 0 } });
    const withInstruction = applyCanvasNodeAttributes(original, { content: "夜晚追逐片段", model: "channel-1::text-model" });
    if (!isStoryboardNode(withInstruction)) throw new Error("应返回分镜节点");
    const withVisualStyle = updateStoryboardNodeContent(withInstruction, { visualStyle: "国风手绘厚涂" });
    const updated = updateStoryboardNodeData(withVisualStyle, {
        shots: [
            {
                id: "shot-1",
                shotNumber: 1,
                durationSeconds: 5,
                visualDescription: "雨夜街道",
                shotSize: "远景",
                lightingAtmosphere: "霓虹反光",
                dialogueVoiceover: "",
                soundEffect: "雨声",
                cameraMovement: "推进",
                finalPrompt: "待生成提示词",
                assetIds: ["asset-1"],
            },
        ],
        assets: [{ id: "asset-1", kind: "scene", name: "雨夜街道", description: "潮湿路面" }],
    });

    assert.equal(updated.content.instruction, "夜晚追逐片段");
    assert.equal(updated.content.visualStyle, "国风手绘厚涂");
    assert.equal(updated.content.model, "channel-1::text-model");
    assert.equal(updated.storyboard.shots[0].finalPrompt, "待生成提示词");
    assert.deepEqual(updated.storyboard.shots[0].assetIds, ["asset-1"]);
    assert.equal(updated.storyboard.assets[0].kind, "scene");
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

test("节点标题为空时保留原名称，相同名称保留原节点引用", () => {
    const node = createTextNode({ id: "text-1", position: { x: 0, y: 0 }, title: "原名称" });

    assert.equal(updateCanvasNodeTitle(node, "   "), node);
    assert.equal(updateCanvasNodeTitle(node, "原名称"), node);
});

test("节点成功完成时清理运行任务和错误信息", () => {
    const node = createImageNode({ id: "image-1", position: { x: 0, y: 0 } });
    node.execution = { phase: "running", taskId: "task-1", progress: 45, errorMessage: "旧错误" };

    const completed = applyCanvasNodeAttributes(node, { status: "success" });

    assert.deepEqual(completed.execution, { phase: "succeeded" });
});
