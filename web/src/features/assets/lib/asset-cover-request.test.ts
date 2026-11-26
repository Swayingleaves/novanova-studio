import assert from "node:assert/strict";
import test from "node:test";
import type { ImageAsset, VideoAsset } from "../stores/use-asset-store";
import { getAssetCoverRequest } from "./asset-cover-request.ts";

const common = { id: "asset-1", title: "素材", coverUrl: "", tags: [], createdAt: "2026-11-26", updatedAt: "2026-11-26" };
const image: ImageAsset = {
    ...common, kind: "image",
    data: { dataUrl: "https://example.com/source.png", storageKey: "image:1", width: 960, height: 640, bytes: 1000, mimeType: "image/png" },
};
const video: VideoAsset = {
    ...common, kind: "video",
    data: { url: "https://example.com/source.mp4", storageKey: "video:1", width: 960, height: 640, bytes: 1000, mimeType: "video/mp4" },
};

test("默认图片封面通过媒体键取缩略图，签名刷新不会改变缓存键", () => {
    const signedUrl = "https://example.com/source.png?signature=new";
    assert.deepEqual(getAssetCoverRequest({ ...image, coverUrl: signedUrl, data: { ...image.data, dataUrl: signedUrl } }), {
        kind: "image", key: "image:1",
    });
});

test("自定义封面使用资产版本缓存，组合视频封面时仍只传图片地址", () => {
    const coverUrl = "https://example.com/cover.png";
    assert.deepEqual(getAssetCoverRequest({ ...video, coverUrl }), {
        kind: "imageUrl", key: "asset-cover:asset-1:2026-11-26", url: coverUrl,
    });
    assert.equal(getAssetCoverRequest({ ...image, coverUrl, updatedAt: "2026-11-27" })?.key, "asset-cover:asset-1:2026-11-27");
});

test("视频列表只请求封面，有无存储键都不读取视频地址", () => {
    assert.deepEqual(getAssetCoverRequest(video), { kind: "video", key: "video:1" });
    assert.deepEqual(getAssetCoverRequest({ ...video, coverUrl: video.data.url }), { kind: "video", key: "video:1" });
    assert.equal(getAssetCoverRequest({ ...video, data: { ...video.data, storageKey: undefined } }), undefined);
});
