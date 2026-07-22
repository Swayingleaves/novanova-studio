import assert from "node:assert/strict";
import test from "node:test";

import {
    classifyReferenceImageSource,
    type ReferenceImage,
} from "./image.ts";

const baseImage: ReferenceImage = {
    id: "image-1",
    name: "参考图.png",
    type: "image/png",
    dataUrl: "data:image/png;base64,abc",
};

test("参考图片来源优先识别对象存储、远程地址和内联数据", () => {
    assert.equal(classifyReferenceImageSource({ ...baseImage, objectStorage: { provider: "tencentCos", url: "https://cdn.test/a.png", key: "a.png", bucket: "bucket", region: "region", bytes: 3, mimeType: "image/png", uploadedAt: "2026-01-01" } }).kind, "objectStorage");
    assert.deepEqual(classifyReferenceImageSource({ ...baseImage, url: "https://example.test/a.png" }), { kind: "remote", url: "https://example.test/a.png" });
    assert.deepEqual(classifyReferenceImageSource(baseImage), { kind: "inline", dataUrl: baseImage.dataUrl });
});
