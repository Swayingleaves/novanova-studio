import assert from "node:assert/strict";
import test from "node:test";

import { RECENT_REFERENCE_ASSET_LIMIT, normalizeRecentReferenceAssets, prependRecentReferenceAsset, recentReferenceAssetStorageKey } from "./recent-reference-assets.ts";

test("最近上传素材仅保留合法的 OSS URL 并去重，旧版纯 URL 记录按图片处理", () => {
    assert.deepEqual(normalizeRecentReferenceAssets([" https://cdn.example.com/a.png ", "invalid", "https://cdn.example.com/a.png", "ftp://cdn.example.com/b.png", 1]), [{ url: "https://cdn.example.com/a.png", kind: "image" }]);
    assert.deepEqual(normalizeRecentReferenceAssets([{ url: "https://cdn.example.com/a.mp4", kind: "video", durationMs: 6000 }]), [{ url: "https://cdn.example.com/a.mp4", kind: "video", durationMs: 6000 }]);
});

test("最近上传素材将新上传的素材置顶并最多保留二十条", () => {
    const assets = Array.from({ length: RECENT_REFERENCE_ASSET_LIMIT }, (_, index) => ({ url: `https://cdn.example.com/${index}.png`, kind: "image" as const }));
    const next = prependRecentReferenceAsset(assets, { url: "https://cdn.example.com/latest.mp4", kind: "video", durationMs: 6000 });
    assert.equal(next.length, RECENT_REFERENCE_ASSET_LIMIT);
    assert.deepEqual(next[0], { url: "https://cdn.example.com/latest.mp4", kind: "video", durationMs: 6000 });
    assert.equal(next.at(-1)?.url, "https://cdn.example.com/18.png");
    assert.equal(prependRecentReferenceAsset(next, { url: "https://cdn.example.com/5.png", kind: "image" })[0]?.url, "https://cdn.example.com/5.png");
});

test("最近上传素材存储键按用户隔离", () => {
    assert.equal(recentReferenceAssetStorageKey("1"), "user:1");
    assert.equal(recentReferenceAssetStorageKey("2"), "user:2");
});
