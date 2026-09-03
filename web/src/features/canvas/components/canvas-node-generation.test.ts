import assert from "node:assert/strict";
import test from "node:test";

import { createImageNode, createTextNode, createVideoNode } from "../constants.ts";
import { createCanvasConnection } from "../domain/canvas-page-node.ts";
import { buildNodeGenerationContext, hasNodeGenerationInputs, resolveNodeGenerationPrompt } from "./canvas-node-generation.ts";

test("节点没有自身输入时使用上游文本作为最终提示词", () => {
    const source = createTextNode({ id: "text-source", position: { x: 0, y: 0 }, text: "夜晚的古镇街道" });
    const target = createImageNode({ id: "image-target", position: { x: 800, y: 0 } });
    const connections = [createCanvasConnection("connection-1", source.id, target.id)];

    assert.equal(resolveNodeGenerationPrompt(target.id, [source, target], connections, ""), "夜晚的古镇街道");
    assert.equal(hasNodeGenerationInputs(target.id, [source, target], connections), true);
});

test("节点自身输入与上游文本同时保留且不重复上游内容", () => {
    const source = createTextNode({ id: "text-source", position: { x: 0, y: 0 }, text: "夜晚的古镇街道" });
    const target = createImageNode({ id: "image-target", position: { x: 800, y: 0 } });
    const connections = [createCanvasConnection("connection-1", source.id, target.id)];

    assert.equal(resolveNodeGenerationPrompt(target.id, [source, target], connections, "补充雨景"), "补充雨景\n\n夜晚的古镇街道");
    assert.equal(resolveNodeGenerationPrompt(target.id, [source, target], connections, "夜晚的古镇街道"), "夜晚的古镇街道");
});

test("当前节点有文字时仍明确标注上游图片引用", () => {
    const image = createImageNode({ id: "image-source", position: { x: 0, y: 0 } });
    image.content.source = "data:image/png;base64,reference";
    const target = createImageNode({ id: "image-target", position: { x: 800, y: 0 } });
    const connections = [createCanvasConnection("connection-image", image.id, target.id)];

    assert.equal(resolveNodeGenerationPrompt(target.id, [image, target], connections, "补充三视图", true), "补充三视图\n\n请根据图片1生成");
});

test("多个上游文本逐条去重并保持原有顺序", () => {
    const firstSource = createTextNode({ id: "text-source-1", position: { x: 0, y: 0 }, text: "夜晚的古镇街道" });
    const secondSource = createTextNode({ id: "text-source-2", position: { x: 0, y: 300 }, text: "细雨中的石板路" });
    const target = createImageNode({ id: "image-target", position: { x: 800, y: 0 } });
    const connections = [createCanvasConnection("connection-1", firstSource.id, target.id), createCanvasConnection("connection-2", secondSource.id, target.id)];

    assert.equal(
        resolveNodeGenerationPrompt(target.id, [firstSource, secondSource, target], connections, "补充雨景\n\n夜晚的古镇街道"),
        "补充雨景\n\n夜晚的古镇街道\n\n细雨中的石板路",
    );
});

test("上游图片和视频仍保留在生成上下文引用中", () => {
    const image = createImageNode({ id: "image-source", position: { x: 0, y: 0 } });
    image.content.source = "data:image/png;base64,reference";
    const video = createVideoNode({ id: "video-source", position: { x: 0, y: 500 } });
    video.content.source = "https://example.com/reference.mp4";
    const target = createImageNode({ id: "image-target", position: { x: 800, y: 0 } });
    const connections = [createCanvasConnection("connection-image", image.id, target.id), createCanvasConnection("connection-video", video.id, target.id)];

    const context = buildNodeGenerationContext(target.id, [image, video, target], connections, "场景设定");

    assert.equal(context.prompt, "场景设定");
    assert.equal(context.referenceImages.length, 1);
    assert.equal(context.referenceVideos.length, 1);
    assert.equal(hasNodeGenerationInputs(target.id, [image, video, target], connections), true);
});

test("上游图片只作为引用，不继承图片节点历史提示词", () => {
    const image = createImageNode({ id: "image-source", position: { x: 0, y: 0 } });
    image.content.source = "data:image/png;base64,reference";
    image.generation.prompt = "角色站立，全身设定";
    const target = createImageNode({ id: "image-target", position: { x: 800, y: 0 } });
    const connections = [createCanvasConnection("connection-image", image.id, target.id)];

    assert.equal(resolveNodeGenerationPrompt(target.id, [image, target], connections, ""), "");
    assert.equal(resolveNodeGenerationPrompt(target.id, [image, target], connections, "", true), "请根据图片1生成");
});

test("上游设定图节点不会把技能系统提示词传给下游", () => {
    const image = createImageNode({ id: "image-source", position: { x: 0, y: 0 } });
    image.content.source = "data:image/png;base64,reference";
    image.generation.settingGraph = {
        id: 1,
        name: "角色设定图",
        targetType: "canvasSettingGraph",
        systemPrompt: "你是角色设定图技能，请严格按规则工作。",
    };
    image.generation.prompt = `${image.generation.settingGraph.systemPrompt}\n\n末世废土世界，幸存者杨光走在空无一人的大街上。`;
    const target = createImageNode({ id: "image-target", position: { x: 800, y: 0 } });
    const connections = [createCanvasConnection("connection-image", image.id, target.id)];

    assert.equal(resolveNodeGenerationPrompt(target.id, [image, target], connections, ""), "");
    assert.equal(resolveNodeGenerationPrompt(target.id, [image, target], connections, "", true), "请根据图片1生成");
});

test("没有上游资源时不允许依赖空提示词生成", () => {
    const target = createImageNode({ id: "image-target", position: { x: 0, y: 0 } });

    assert.equal(resolveNodeGenerationPrompt(target.id, [target], [], ""), "");
    assert.equal(hasNodeGenerationInputs(target.id, [target], []), false);
});
