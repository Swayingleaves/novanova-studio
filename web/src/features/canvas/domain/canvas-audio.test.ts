import assert from "node:assert/strict";
import test from "node:test";
import { createAudioNode, createVideoNode } from "../constants.ts";
import { applyCanvasNodeAttributes, isAudioNode } from "./canvas-node.ts";
import { createCanvasConnection, readCanvasNodeContent } from "./canvas-page-node.ts";
import { createCanvasDocument, replaceCanvasScene } from "./canvas-document.ts";
import { buildNodeGenerationContext } from "../components/canvas-node-generation.ts";
import { buildNodeMentionReferences, buildNodeGenerationReferences } from "../utils/canvas-resource-references.ts";
import { mergeAudioReferences } from "../utils/audio-references.ts";
import { activateCanvasAudio, releaseCanvasAudio, stopCanvasAudio } from "../services/canvas-audio-playback.ts";

test("音频节点保存恢复后保留媒体信息和真实波形，不包含播放状态", () => {
    const node = applyCanvasNodeAttributes(createAudioNode({ id: "audio-1", position: { x: 12, y: 20 } }), {
        content: "https://example.com/music.mp3", storageKey: "audio:music", mimeType: "audio/mpeg", durationMs: 4000, waveformPeaks: [0, 0.3, 0.8], status: "success",
    });
    assert.ok(isAudioNode(node));
    assert.equal(node.frame.width, 480);
    assert.equal(node.frame.height, 200);
    const document = createCanvasDocument({ id: "document", title: "音频画布", now: "2026-09-10" });
    const saved = replaceCanvasScene(document, { ...document.scene, nodes: [node] }, "2026-09-10");
    const restored = JSON.parse(JSON.stringify(saved));
    assert.deepEqual(restored.scene.nodes[0], node);
    assert.equal(readCanvasNodeContent(node), "https://example.com/music.mp3");
    assert.equal("currentTime" in restored.scene.nodes[0].content, false);
    const copied = structuredClone(node);
    assert.deepEqual(copied.content, node.content);
    assert.notEqual(copied.content.waveformPeaks, node.content.waveformPeaks);
});

test("音频连线按首次出现顺序去重，持久化引用沿用存储标识", () => {
    const first = createAudioNode({ id: "first", title: "配乐", position: { x: 0, y: 0 } });
    first.content = { source: "https://example.com/music.mp3", storageKey: "audio:music", mimeType: "audio/mpeg", durationMilliseconds: 4000, waveformPeaks: [0.1] };
    const copy = { ...first, id: "copy", title: "配乐副本" };
    const video = createVideoNode({ id: "video", position: { x: 500, y: 0 } });
    const nodes = [first, copy, video];
    const connections = [createCanvasConnection("one", first.id, video.id), createCanvasConnection("two", copy.id, video.id)];
    const context = buildNodeGenerationContext(video.id, nodes, connections, "跟随音频1的节奏");
    assert.equal(context.referenceAudios.length, 1);
    assert.equal(context.referenceAudios[0].storageKey, "audio:music");
    assert.equal(context.audioCount, 1);
    assert.equal(buildNodeMentionReferences(video, nodes, connections)[0].label, "音频1");
    video.generation.audioReferences = context.referenceAudios;
    assert.equal(buildNodeGenerationReferences(video)[0].kind, "audio");
    assert.equal(buildNodeGenerationReferences(video)[0].durationMs, 4000);
    assert.deepEqual(mergeAudioReferences(context.referenceAudios, [{ ...context.referenceAudios[0], url: "https://example.com/refreshed.mp3" }]), context.referenceAudios);
});

test("同一画布只播放一段音频，释放非当前节点不会停止其他节点", () => {
    let firstPauses = 0;
    let secondPauses = 0;
    const first = { pause: () => firstPauses++ } as HTMLAudioElement;
    const second = { pause: () => secondPauses++ } as HTMLAudioElement;
    activateCanvasAudio(first);
    activateCanvasAudio(second);
    assert.equal(firstPauses, 1);
    releaseCanvasAudio(first);
    assert.equal(secondPauses, 0);
    stopCanvasAudio();
    assert.equal(secondPauses, 1);
    stopCanvasAudio();
    assert.equal(secondPauses, 1);
});
