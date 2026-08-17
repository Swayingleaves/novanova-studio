import assert from "node:assert/strict";
import test from "node:test";

const { imageReferenceAttachments, referenceMediaType, referenceMediaUrl, videoReferenceAttachments } = await import(new URL("./reference-attachments.ts", import.meta.url).href);

test("URL-only 历史参考图转换为图片附件", () => {
    const references = imageReferenceAttachments([
        { name: "最近上传的参考图", mimeType: "image/png", url: "https://storage.example.com/recent.png" },
    ]);

    assert.deepEqual(references, [{
        name: "最近上传的参考图",
        type: "image/png",
        url: "https://storage.example.com/recent.png",
    }]);
});

test("存储键参考素材优先使用对象存储地址并保留存储键", () => {
    const references = videoReferenceAttachments([
        {
            name: "clip.mp4",
            type: "video/mp4",
            url: "https://source.example.com/clip.mp4",
            storageKey: "video:clip",
            objectStorage: { url: "https://storage.example.com/clip.mp4" },
        },
    ]);

    assert.deepEqual(references, [{
        name: "clip.mp4",
        type: "video/mp4",
        url: "https://storage.example.com/clip.mp4",
        storageKey: "video:clip",
    }]);
});

test("历史字段可恢复为前端参考图字段", () => {
    const reference = { mimeType: "image/webp", url: "https://storage.example.com/reference.webp" };

    assert.equal(referenceMediaType(reference, "image/*"), "image/webp");
    assert.equal(referenceMediaUrl(reference), "https://storage.example.com/reference.webp");
});
