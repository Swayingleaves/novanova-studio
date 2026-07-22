import assert from "node:assert/strict";
import test from "node:test";

import { normalizeImageTaskResult } from "./image-task-result.ts";

test("图片任务完成但没有有效结果时明确报错", () => {
    assert.throws(() => normalizeImageTaskResult({ items: [] }, () => "id"), /没有返回图片/);
});

test("图片任务保留可复用的媒体信息", () => {
    assert.deepEqual(
        normalizeImageTaskResult({ items: [{ url: "https://example.test/a.png", storageKey: "image:result-1", width: 1024, height: 768, bytes: 2048, mimeType: "image/png", objectStorage: { url: "https://storage.example.test/a.png", key: "images/a.png" } }, { storageKey: "invalid" }] }, () => "image-1"),
        [{ id: "image-1", dataUrl: "https://example.test/a.png", storageKey: "image:result-1", width: 1024, height: 768, bytes: 2048, mimeType: "image/png", objectStorage: { url: "https://storage.example.test/a.png", key: "images/a.png" } }],
    );
});
