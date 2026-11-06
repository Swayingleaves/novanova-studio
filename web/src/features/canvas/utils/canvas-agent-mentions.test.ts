import assert from "node:assert/strict";
import test from "node:test";

import { createAudioNode, createImageNode, createTextNode, createVideoNode } from "../constants.ts";
import { buildCanvasAgentMentionCandidates, buildCanvasAgentMentionMessage, filterCanvasAgentMentionCandidates, formatCanvasAgentMentionDisplayText, readCanvasAgentMentionCommand, readCanvasAgentMentionNodeIds } from "./canvas-agent-mentions.ts";

function imageNode(id: string, title: string, source = "") {
    const node = createImageNode({ id, title, position: { x: 0, y: 0 } });
    node.content.source = source;
    return node;
}

test("画布 Agent @ 候选保留节点名称、类型和缩略图", () => {
    const image = imageNode("image-1", "主角参考", "https://example.com/hero.png");
    const video = createVideoNode({ id: "video-1", title: "", position: { x: 0, y: 0 } });
    video.content.source = "https://example.com/clip.mp4";
    const text = createTextNode({ id: "text-1", title: "", position: { x: 0, y: 0 } });
    const audio = createAudioNode({ id: "audio-1", title: "背景音乐", position: { x: 0, y: 0 } });

    const candidates = buildCanvasAgentMentionCandidates([image, video, text, audio]);

    assert.deepEqual(candidates[0], { id: "image-1", kind: "image", kindLabel: "图片", title: "主角参考", previewUrl: "https://example.com/hero.png" });
    assert.equal(candidates[1].title, "视频");
    assert.equal(candidates[1].previewUrl, "https://example.com/clip.mp4");
    assert.equal(candidates[2].title, "文本");
    assert.equal(candidates[2].previewUrl, undefined);
    assert.equal(candidates[3].title, "背景音乐");
    assert.equal(candidates[3].previewUrl, undefined);
});

test("输入 @ 时读取查询范围，完整引用标记后不再弹出菜单", () => {
    const ids = new Set(["V1StGXR8_Z5jdHi6B-myT"]);
    assert.deepEqual(readCanvasAgentMentionCommand("请参考 @主角", 7, ids), { start: 4, end: 7, query: "主角" });
    assert.deepEqual(readCanvasAgentMentionCommand("@", 1, ids), { start: 0, end: 1, query: "" });
    assert.equal(readCanvasAgentMentionCommand("请参考 @V1StGXR8_Z5jdHi6B-myT", 26, ids), null);
    assert.deepEqual(readCanvasAgentMentionCommand("请参考@图片 后继续", 5, ids), { start: 3, end: 5, query: "图" });
});

test("按节点名称和类型过滤 @ 候选", () => {
    const candidates = buildCanvasAgentMentionCandidates([imageNode("image-1", "主角参考"), createVideoNode({ id: "video-1", title: "开场镜头", position: { x: 0, y: 0 } })]);

    assert.equal(filterCanvasAgentMentionCandidates(candidates, "主角").length, 1);
    assert.equal(filterCanvasAgentMentionCandidates(candidates, "视频")[0].id, "video-1");
    assert.equal(filterCanvasAgentMentionCandidates(candidates, "不存在").length, 0);
    assert.equal(filterCanvasAgentMentionCandidates(candidates, "").length, 2);
});

test("发送前把 @ 标记转换为名称和真实节点 ID", () => {
    const nodes = [imageNode("image-1", "主角参考"), createTextNode({ id: "text-1", title: "旁白", position: { x: 0, y: 0 } })];
    const prompt = "把 @image-1 改成蓝色，并参考 @text-1";

    assert.equal(formatCanvasAgentMentionDisplayText(prompt, nodes), "把 @主角参考 改成蓝色，并参考 @旁白");
    assert.equal(buildCanvasAgentMentionMessage(prompt, nodes), "把 @主角参考（节点ID：image-1） 改成蓝色，并参考 @旁白（节点ID：text-1）");
    assert.equal(formatCanvasAgentMentionDisplayText("联系 @unknown", nodes), "联系 @unknown");
});

test("读取输入框中已引用的节点标识并去重", () => {
    const nodes = [imageNode("image-1", "主角参考"), imageNode("image-2", "背景参考")];
    const prompt = "参考 @image-1 和 @image-2，再看 @image-1";

    assert.deepEqual(readCanvasAgentMentionNodeIds(prompt, nodes), ["image-1", "image-2"]);
    assert.deepEqual(readCanvasAgentMentionNodeIds("没有引用", nodes), []);
});
