import assert from "node:assert/strict";
import test from "node:test";

import { RECENT_REFERENCE_IMAGE_LIMIT, normalizeRecentReferenceImageUrls, prependRecentReferenceImageUrl, recentReferenceImageStorageKey } from "./recent-reference-images.ts";

test("最近参考图仅保留合法的 OSS URL 并去重", () => {
    assert.deepEqual(normalizeRecentReferenceImageUrls([" https://cdn.example.com/a.png ", "invalid", "https://cdn.example.com/a.png", "ftp://cdn.example.com/b.png", 1]), ["https://cdn.example.com/a.png"]);
});

test("最近参考图将新上传的 URL 置顶并最多保留二十条", () => {
    const urls = Array.from({ length: RECENT_REFERENCE_IMAGE_LIMIT }, (_, index) => `https://cdn.example.com/${index}.png`);
    const next = prependRecentReferenceImageUrl(urls, "https://cdn.example.com/latest.png");
    assert.equal(next.length, RECENT_REFERENCE_IMAGE_LIMIT);
    assert.equal(next[0], "https://cdn.example.com/latest.png");
    assert.equal(next.at(-1), "https://cdn.example.com/18.png");
    assert.equal(prependRecentReferenceImageUrl(next, "https://cdn.example.com/5.png")[0], "https://cdn.example.com/5.png");
});

test("最近参考图存储键按用户隔离", () => {
    assert.equal(recentReferenceImageStorageKey("1"), "user:1");
    assert.equal(recentReferenceImageStorageKey("2"), "user:2");
});
