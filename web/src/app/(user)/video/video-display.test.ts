import assert from "node:assert/strict";
import test from "node:test";

const { findLatestPlayableVideo, hasPlayableVideoUrl } = await import("./video-display" + ".ts");

test("空字符串和空白字符串不能作为视频地址", () => {
    assert.equal(hasPlayableVideoUrl(""), false);
    assert.equal(hasPlayableVideoUrl("   "), false);
    assert.equal(hasPlayableVideoUrl("https://example.com/video.mp4"), true);
});

test("会话缩略图跳过地址为空的视频结果", () => {
    const latestVideo = findLatestPlayableVideo([
        { video: { id: "valid", url: "https://example.com/video.mp4" } },
        { video: { id: "empty", url: "" } },
    ]);

    assert.equal(latestVideo?.id, "valid");
});
