import assert from "node:assert/strict";
import test from "node:test";

import { createAudioNode, createImageNode, createTextNode, createVideoNode } from "../constants.ts";
import { createCanvasConnection } from "../domain/canvas-page-node.ts";
import type { CanvasNode, CanvasVideoNode } from "../types.ts";
import { readCanvasVideoNodeReferenceCounts, resolveVideoNodeGenerationMode, synchronizeVideoNodeGenerationModes, type CanvasVideoNodeReferenceCounts } from "./canvas-video-node-mode.ts";

function createTargetVideo(id: string, mode: CanvasVideoNode["generation"]["videoGenerationMode"] = "text-to-video") {
    const node = createVideoNode({ id, position: { x: 0, y: 0 } });
    node.generation.videoGenerationMode = mode;
    return node;
}

function createImageWithSource(id: string) {
    const node = createImageNode({ id, position: { x: 0, y: 0 } });
    node.content.source = `https://example.com/${id}.png`;
    return node;
}

function createVideoWithSource(id: string) {
    const node = createVideoNode({ id, position: { x: 0, y: 0 } });
    node.content.source = `https://example.com/${id}.mp4`;
    return node;
}

function createAudioWithSource(id: string) {
    const node = createAudioNode({ id, position: { x: 0, y: 0 } });
    node.content.source = `https://example.com/${id}.mp3`;
    return node;
}

function readVideoMode(nodes: CanvasNode[], nodeId: string) {
    const node = nodes.find((item) => item.id === nodeId);
    return node && node.kind === "video" ? node.generation.videoGenerationMode : undefined;
}

function emptyCounts(): CanvasVideoNodeReferenceCounts {
    return { connected: { image: 0, video: 0, audio: 0 }, persisted: { image: 0, video: 0, audio: 0 } };
}

test("文本节点接入视频节点时保持文生视频且不触发节点更新", () => {
    const text = createTextNode({ id: "text-1", position: { x: 0, y: 0 }, text: "一段画面描述" });
    const video = createTargetVideo("video-4");
    const nodes: CanvasNode[] = [text, video];

    const result = synchronizeVideoNodeGenerationModes(nodes, [createCanvasConnection("conn-1", text.id, video.id)]);

    assert.equal(readVideoMode(result.nodes, "video-4"), "text-to-video");
    assert.equal(result.nodes, nodes);
});

test("图片节点接入视频节点后切换为图生视频", () => {
    const image = createImageWithSource("image-1");
    const video = createTargetVideo("video-4");
    const nodes: CanvasNode[] = [image, video];

    const result = synchronizeVideoNodeGenerationModes(nodes, [createCanvasConnection("conn-1", image.id, video.id)]);

    assert.equal(readVideoMode(result.nodes, "video-4"), "image-to-video");
});

test("多张图片与视频节点同时接入后切换为全能参考", () => {
    const images = ["image-1", "image-2", "image-3"].map(createImageWithSource);
    const sourceVideo = createVideoWithSource("video-1");
    const targetVideo = createTargetVideo("video-4");
    const nodes: CanvasNode[] = [...images, sourceVideo, targetVideo];
    const connections = [...images, sourceVideo].map((node) => createCanvasConnection(`conn-${node.id}`, node.id, targetVideo.id));

    const result = synchronizeVideoNodeGenerationModes(nodes, connections);

    assert.equal(readVideoMode(result.nodes, "video-4"), "reference-to-video");
});

test("只接入视频节点时切换为全能参考", () => {
    const sourceVideo = createVideoWithSource("video-1");
    const targetVideo = createTargetVideo("video-4");
    const nodes: CanvasNode[] = [sourceVideo, targetVideo];

    const result = synchronizeVideoNodeGenerationModes(nodes, [createCanvasConnection("conn-1", sourceVideo.id, targetVideo.id)]);

    assert.equal(readVideoMode(result.nodes, "video-4"), "reference-to-video");
});

test("图生视频模式接入视频节点后切换为全能参考", () => {
    const image = createImageWithSource("image-1");
    const sourceVideo = createVideoWithSource("video-1");
    const targetVideo = createTargetVideo("video-4", "image-to-video");
    const nodes: CanvasNode[] = [image, sourceVideo, targetVideo];
    const connections = [image, sourceVideo].map((node) => createCanvasConnection(`conn-${node.id}`, node.id, targetVideo.id));

    const result = synchronizeVideoNodeGenerationModes(nodes, connections);

    assert.equal(readVideoMode(result.nodes, "video-4"), "reference-to-video");
});

test("首尾帧模式不参与自动切换", () => {
    const image = createImageWithSource("image-1");
    const sourceVideo = createVideoWithSource("video-1");
    const targetVideo = createTargetVideo("video-4", "first-last-frame-to-video");
    const nodes: CanvasNode[] = [image, sourceVideo, targetVideo];
    const connections = [image, sourceVideo].map((node) => createCanvasConnection(`conn-${node.id}`, node.id, targetVideo.id));

    const result = synchronizeVideoNodeGenerationModes(nodes, connections);

    assert.equal(readVideoMode(result.nodes, "video-4"), "first-last-frame-to-video");
    assert.equal(result.nodes, nodes);
});

test("参考连线被移除后回落文生视频", () => {
    const video = createTargetVideo("video-4", "image-to-video");

    const result = synchronizeVideoNodeGenerationModes([video], [], new Map([["video-4", 1]]));

    assert.equal(readVideoMode(result.nodes, "video-4"), "text-to-video");
});

test("主动选择的模式在没有参考内容时不会被改回文生视频", () => {
    const video = createTargetVideo("video-4", "image-to-video");
    const nodes: CanvasNode[] = [video];

    const result = synchronizeVideoNodeGenerationModes(nodes, [], new Map([["video-4", 0]]));

    assert.equal(readVideoMode(result.nodes, "video-4"), "image-to-video");
    assert.equal(result.nodes, nodes);
});

test("节点自身上传的参考图参与模式判定", () => {
    const video = createTargetVideo("video-4");
    video.generation.references = ["https://example.com/reference.png"];

    const result = synchronizeVideoNodeGenerationModes([video], []);

    assert.equal(readVideoMode(result.nodes, "video-4"), "image-to-video");
});

test("节点自身上传的参考视频参与模式判定", () => {
    const video = createTargetVideo("video-4");
    video.generation.videoReferences = ["https://example.com/reference.mp4"];

    const result = synchronizeVideoNodeGenerationModes([video], []);

    assert.equal(readVideoMode(result.nodes, "video-4"), "reference-to-video");
});

test("仍有持久化参考素材时不因断开连线回落文生视频", () => {
    const video = createTargetVideo("video-4", "image-to-video");
    video.generation.references = ["https://example.com/reference.png"];

    const result = synchronizeVideoNodeGenerationModes([video], [], new Map([["video-4", 1]]));

    assert.equal(readVideoMode(result.nodes, "video-4"), "image-to-video");
});

test("统计连线接入与节点持久化的参考素材数量", () => {
    const image = createImageWithSource("image-1");
    const sourceVideo = createVideoWithSource("video-1");
    const audio = createAudioWithSource("audio-1");
    const text = createTextNode({ id: "text-1", position: { x: 0, y: 0 }, text: "描述" });
    const targetVideo = createTargetVideo("video-4");
    targetVideo.generation.references = ["https://example.com/persisted.png"];
    const nodes: CanvasNode[] = [image, sourceVideo, audio, text, targetVideo];
    const connections = [image, sourceVideo, audio, text].map((node) => createCanvasConnection(`conn-${node.id}`, node.id, targetVideo.id));

    const counts = readCanvasVideoNodeReferenceCounts(targetVideo, nodes, connections);

    assert.deepEqual(counts.connected, { image: 1, video: 1, audio: 1 });
    assert.deepEqual(counts.persisted, { image: 1, video: 0, audio: 0 });
});

test("按参考类型推导模式的基础规则", () => {
    const empty = emptyCounts();
    const imageOnly = { connected: { image: 2, video: 0, audio: 0 }, persisted: { image: 0, video: 0, audio: 0 } };
    const videoOnly = { connected: { image: 0, video: 1, audio: 0 }, persisted: { image: 0, video: 0, audio: 0 } };
    const imageAndVideo = { connected: { image: 2, video: 1, audio: 0 }, persisted: { image: 0, video: 0, audio: 0 } };

    assert.equal(resolveVideoNodeGenerationMode("text-to-video", empty), "text-to-video");
    assert.equal(resolveVideoNodeGenerationMode("image-to-video", empty), "image-to-video");
    assert.equal(resolveVideoNodeGenerationMode("reference-to-video", empty), "reference-to-video");
    assert.equal(resolveVideoNodeGenerationMode("image-to-video", empty, true), "text-to-video");
    assert.equal(resolveVideoNodeGenerationMode("text-to-video", imageOnly), "image-to-video");
    assert.equal(resolveVideoNodeGenerationMode("reference-to-video", imageOnly), "reference-to-video");
    assert.equal(resolveVideoNodeGenerationMode("text-to-video", videoOnly), "reference-to-video");
    assert.equal(resolveVideoNodeGenerationMode("text-to-video", imageAndVideo), "reference-to-video");
    assert.equal(resolveVideoNodeGenerationMode("first-last-frame-to-video", imageAndVideo), "first-last-frame-to-video");
});
