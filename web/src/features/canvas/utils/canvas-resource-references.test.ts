import assert from "node:assert/strict";
import test from "node:test";

import { createVideoCompositionNode, createVideoNode } from "../constants.ts";
import { buildNodeMentionReferences, buildNodeGenerationReferences } from "./canvas-resource-references.ts";

test("视频节点可从持久化生成配置恢复参考图", () => {
    const video = createVideoNode({ id: "video-1", position: { x: 0, y: 0 } });
    video.generation.references = ["https://example.com/reference.png"];
    video.generation.referenceObjectStorages = [
        {
            provider: "aliyunOss",
            url: "https://example.com/reference.png",
            key: "canvas/reference.png",
            bucket: "canvas",
            region: "cn-hangzhou",
            bytes: 128,
            mimeType: "image/png",
            uploadedAt: "2026-08-10T00:00:00.000Z",
        },
    ];

    const references = buildNodeGenerationReferences(video);

    assert.deepEqual(
        references.map((reference) => ({ kind: reference.kind, label: reference.label, previewUrl: reference.previewUrl })),
        [{ kind: "image", label: "参考图1", previewUrl: "https://example.com/reference.png" }],
    );
});

test("视频节点可直接使用批量任务保存的公开参考图地址", () => {
    const video = createVideoNode({ id: "video-1", position: { x: 0, y: 0 } });
    video.generation.references = ["https://example.com/batch-reference.png"];

    const references = buildNodeGenerationReferences(video);

    assert.deepEqual(
        references.map((reference) => ({ kind: reference.kind, label: reference.label, previewUrl: reference.previewUrl })),
        [{ kind: "image", label: "参考图1", previewUrl: "https://example.com/batch-reference.png" }],
    );
});

test("视频节点可恢复独立保存的参考视频", () => {
    const video = createVideoNode({ id: "video-1", position: { x: 0, y: 0 } });
    video.generation.videoReferences = ["video:reference-1"];
    video.generation.videoReferenceObjectStorages = [
        {
            provider: "aliyunOss",
            url: "https://example.com/reference.mp4",
            key: "reference-1",
            bucket: "canvas",
            region: "cn-hangzhou",
            bytes: 256,
            mimeType: "video/mp4",
            uploadedAt: "2026-08-10T00:00:00.000Z",
        },
    ];

    const references = buildNodeGenerationReferences(video);

    assert.deepEqual(
        references.map((reference) => ({ kind: reference.kind, label: reference.label, previewUrl: reference.previewUrl })),
        [{ kind: "video", label: "参考视频1", previewUrl: "https://example.com/reference.mp4" }],
    );
});

test("视频节点可同时恢复独立保存的图片和视频参考", () => {
    const video = createVideoNode({ id: "video-1", position: { x: 0, y: 0 } });
    video.generation.references = ["https://example.com/reference.png"];
    video.generation.videoReferences = ["https://example.com/reference.mp4"];

    const references = buildNodeGenerationReferences(video);

    assert.deepEqual(
        references.map((reference) => ({ kind: reference.kind, label: reference.label, previewUrl: reference.previewUrl })),
        [
            { kind: "image", label: "参考图1", previewUrl: "https://example.com/reference.png" },
            { kind: "video", label: "参考视频1", previewUrl: "https://example.com/reference.mp4" },
        ],
    );
});

test("历史混合参考字段可按媒体类型恢复", () => {
    const video = createVideoNode({ id: "video-1", position: { x: 0, y: 0 } });
    video.generation.references = ["https://example.com/legacy.mp4", "https://example.com/legacy.png"];

    const references = buildNodeGenerationReferences(video);

    assert.deepEqual(
        references.map((reference) => reference.kind),
        ["video", "image"],
    );
});

test("合成视频结果节点展示全部输入视频作为参考内容", () => {
    const composition = createVideoCompositionNode({ id: "composition-1", position: { x: 0, y: 0 } });
    const videos = Array.from({ length: 4 }, (_, index) => {
        const video = createVideoNode({ id: `video-${index + 1}`, position: { x: index * 100, y: 0 } });
        video.content.source = `https://example.com/video-${index + 1}.mp4`;
        return video;
    });
    composition.composition.inputVideoNodeIds = videos.map((video) => video.id);
    const result = createVideoNode({ id: "result-1", position: { x: 500, y: 0 } });
    result.content.source = "https://example.com/combined.mp4";
    const connections = [
        { id: "composition-result", source: { nodeId: composition.id }, target: { nodeId: result.id } },
        ...videos.map((video, index) => ({ id: `video-composition-${index + 1}`, source: { nodeId: video.id }, target: { nodeId: composition.id } })),
    ];

    const references = buildNodeMentionReferences(result, [composition, ...videos, result], connections);

    assert.deepEqual(
        references.map((reference) => ({ id: reference.nodeId, kind: reference.kind, label: reference.label })),
        videos.map((video, index) => ({ id: video.id, kind: "video", label: `视频${index + 1}` })),
    );
});
