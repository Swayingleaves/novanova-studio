import assert from "node:assert/strict";
import test from "node:test";
import type { ComicDramaAssetVersion, ComicDramaMediaResult, ComicDramaShot } from "../types";
import { countShotReferenceImages } from "./shot-reference-images";

const shot = { id: "shot", assetVersionIds: ["actor", "scene", "prop", "text"] } as ComicDramaShot;
const versions = [
    { id: "actor", referenceMedia: [{ storageKey: "uploaded-actor.png" }] },
    { id: "scene", referenceMedia: [{ url: " " }, { url: "https://example.test/scene.png" }] },
    { id: "prop", referenceMedia: [] },
    { id: "text", referenceMedia: [] },
] as unknown as ComicDramaAssetVersion[];

/** 创建已完成的生成图片。 */
function media(id: string, targetId: string, item: Record<string, unknown>, adopted = false, createdAt = "2026-10-28T10:00:00Z"): ComicDramaMediaResult {
    return { id, targetType: targetId === "shot" ? "shot" : "assetVersion", targetId, mediaType: "image", status: "completed", adopted, createdAt, resultData: { item }, inputSnapshot: {} };
}

test("上传图、存储键图片和分镜图均计数，无图资产不计数，每资产最多一图", () => {
    assert.equal(countShotReferenceImages(shot, [], versions), 2);
    assert.equal(countShotReferenceImages(shot, [media("frame", "shot", { storageKey: "frame.png" }), media("prop", "prop", { storageKey: "prop.png" }), media("actor", "actor", { url: "actor.png" })], versions), 4);
});

test("已采用优先于新结果，选中无效生成图时仅使用有效上传图", () => {
    const generated = [media("adopted", "prop", {}, true), media("new", "prop", { url: "prop.png" }, false, "2026-10-28T11:00:00Z")];
    assert.equal(countShotReferenceImages(shot, generated, versions), 2);
    assert.equal(countShotReferenceImages(shot, [media("actor", "actor", {})], versions), 2);
    assert.equal(countShotReferenceImages(shot, [media("old", "prop", {}), media("new", "prop", { url: "prop.png" }, false, "2026-10-28T11:00:00Z")], versions), 3);
});

test("只选已完成结果，item 优先于 items，时间相同按媒体标识排序", () => {
    const result = media("a", "prop", {});
    result.resultData.items = [{ url: "unused.png" }];
    const processing = { ...media("processing", "shot", { url: "frame.png" }), status: "processing" } as ComicDramaMediaResult;
    assert.equal(countShotReferenceImages(shot, [result, media("b", "prop", { url: "unused.png" }), processing], versions), 2);
    result.resultData = { items: [{ storageKey: "prop.png" }] };
    result.status = "needsUpdate";
    assert.equal(countShotReferenceImages(shot, [result], versions), 3);
});
