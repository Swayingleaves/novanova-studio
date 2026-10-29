import assert from "node:assert/strict";
import { test } from "node:test";
import { createMediaDownloadFileName } from "./media-download-name";

test("生成带本地时间戳和扩展名的图片下载文件名", () => {
    const date = new Date(2026, 9, 29, 18, 10, 40);
    assert.equal(createMediaDownloadFileName("img", "png", date), "novanovastudio-img-20261029181040.png");
});

test("生成带本地时间戳和扩展名的视频下载文件名", () => {
    const date = new Date(2026, 9, 29, 8, 4, 3);
    assert.equal(createMediaDownloadFileName("video", ".mp4", date), "novanovastudio-video-20261029080403.mp4");
});
