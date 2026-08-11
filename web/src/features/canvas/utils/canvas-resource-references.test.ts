import assert from "node:assert/strict";
import test from "node:test";

import { createVideoNode } from "../constants.ts";
import { buildNodeGenerationReferences } from "./canvas-resource-references.ts";

test("视频节点可从持久化生成配置恢复参考图", () => {
    const video = createVideoNode({ id: "video-1", position: { x: 0, y: 0 } });
    video.generation.references = ["https://example.com/reference.png"];
    video.generation.referenceObjectStorages = [{
        provider: "aliyunOss",
        url: "https://example.com/reference.png",
        key: "canvas/reference.png",
        bucket: "canvas",
        region: "cn-hangzhou",
        bytes: 128,
        mimeType: "image/png",
        uploadedAt: "2026-08-10T00:00:00.000Z",
    }];

    const references = buildNodeGenerationReferences(video);

    assert.deepEqual(references.map((reference) => ({ kind: reference.kind, label: reference.label, previewUrl: reference.previewUrl })), [
        { kind: "image", label: "参考图1", previewUrl: "https://example.com/reference.png" },
    ]);
});

test("视频节点可直接使用批量任务保存的公开参考图地址", () => {
    const video = createVideoNode({ id: "video-1", position: { x: 0, y: 0 } });
    video.generation.references = ["https://example.com/batch-reference.png"];

    const references = buildNodeGenerationReferences(video);

    assert.deepEqual(references.map((reference) => ({ kind: reference.kind, label: reference.label, previewUrl: reference.previewUrl })), [
        { kind: "image", label: "参考图1", previewUrl: "https://example.com/batch-reference.png" },
    ]);
});
