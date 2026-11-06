import assert from "node:assert/strict";
import test from "node:test";
import { collectGenerationShareSources } from "./use-generation-share-sources.ts";

test("服务端图片没有独立媒体标识时，仍能按存储标识定位真实结果", () => {
    const sources = collectGenerationShareSources([{ id: "image-log", rounds: [{ id: "round", results: [{ id: "result", status: "success", image: { storageKey: "image:stored", url: "https://example.com/image" } }] }] }], "image");
    assert.deepEqual(sources["image:stored"], { sourceType: "generation", sourceId: "image-log", workType: "image", roundId: "round", resultId: "result" });
    assert.equal(sources["https://example.com/image"], undefined);
});

test("视频单结果和服务端批量结果均可按存储标识分享", () => {
    const sources = collectGenerationShareSources([{ id: "video-log", rounds: [{ id: "round", result: { id: "single", video: { storageKey: "video:single" } }, results: [{ id: "batch", video: { storageKey: "video:batch" } }] }] }], "video");
    assert.equal(sources["video:single"].resultId, "single");
    assert.equal(sources["video:batch"].resultId, "batch");
});

test("实时卡片的媒体标识与历史卡片的存储标识指向同一服务端来源", () => {
    const sources = collectGenerationShareSources([{ id: "log", rounds: [{ id: "round", results: [{ id: "result", image: { id: "media", storageKey: "image:stored" } }] }] }], "image");
    assert.equal(sources.media, sources["image:stored"]);
});

test("工作流使用成功阶段的一基序号，音频与未完成阶段不显示分享", () => {
    const sources = collectGenerationShareSources([{ id: "log", rounds: [{ id: "round", stages: [{ status: "success", outputs: [{ id: "audio", taskType: "audio", url: "https://example.com/audio" }, { id: "video", storageKey: "video:stored", taskType: "video", url: "https://example.com/video" }] }, { status: "running", outputs: [{ id: "pending", taskType: "video", url: "https://example.com/pending" }] }] }] }], "video");
    assert.equal(sources["video:stored"].resultId, "stage:1:2");
    assert.equal(sources.audio, undefined);
    assert.equal(sources.pending, undefined);
});

test("参考素材不能被误认成可分享的生成结果", () => {
    const sources = collectGenerationShareSources([{ id: "log", rounds: [{ id: "round", references: [{ id: "reference", storageKey: "image:reference" }] }] }], "image");
    assert.deepEqual(sources, {});
});
