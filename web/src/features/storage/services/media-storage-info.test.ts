import assert from "node:assert/strict";
import test from "node:test";

import { mergeMediaStorageInfo } from "./media-storage-info.ts";

test("mergeMediaStorageInfo 优先恢复服务端云储存信息", () => {
    const objectStorage = {
        provider: "tencentCos" as const,
        url: "https://cloud.example.com/generated/image.png",
        key: "generated/image.png",
        bucket: "generation-bucket",
        region: "ap-shanghai",
        bytes: 1024,
        mimeType: "image/png",
        uploadedAt: "2026-07-12T10:00:00+08:00",
    };

    const resolved = mergeMediaStorageInfo(
        "https://source.example.com/generated/image.png",
        undefined,
        {
            url: objectStorage.url,
            objectStorage,
        },
    );

    assert.equal(resolved.url, objectStorage.url);
    assert.deepEqual(resolved.objectStorage, objectStorage);
});

test("mergeMediaStorageInfo 在服务端读取失败时保留会话数据", () => {
    const objectStorage = {
        provider: "tencentCos" as const,
        url: "https://cloud.example.com/generated/video.mp4",
        key: "generated/video.mp4",
        bucket: "generation-bucket",
        region: "ap-shanghai",
        bytes: 2048,
        mimeType: "video/mp4",
        uploadedAt: "2026-07-12T10:00:00+08:00",
    };

    const resolved = mergeMediaStorageInfo(
        "https://source.example.com/generated/video.mp4",
        objectStorage,
    );

    assert.equal(resolved.url, "https://source.example.com/generated/video.mp4");
    assert.deepEqual(resolved.objectStorage, objectStorage);
});
