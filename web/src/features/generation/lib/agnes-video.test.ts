import assert from "node:assert/strict";
import test from "node:test";

import { readAgnesVideoReferenceImageIssue } from "./agnes-video.ts";

test("Agnes 视频关键帧最多支持三张参考图片", () => {
    assert.equal(readAgnesVideoReferenceImageIssue(0), "");
    assert.equal(readAgnesVideoReferenceImageIssue(1), "");
    assert.equal(readAgnesVideoReferenceImageIssue(2), "");
    assert.equal(readAgnesVideoReferenceImageIssue(3), "");
    assert.match(readAgnesVideoReferenceImageIssue(4), /最多支持3张参考图片/);
});
