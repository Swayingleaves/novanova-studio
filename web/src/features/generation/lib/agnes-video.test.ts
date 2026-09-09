import assert from "node:assert/strict";
import test from "node:test";

import { readAgnesVideoReferenceImageIssue } from "./agnes-video.ts";

test("Agnes 视频参考图片数量不受前端限制", () => {
    assert.equal(readAgnesVideoReferenceImageIssue(0), "");
    assert.equal(readAgnesVideoReferenceImageIssue(1), "");
    assert.equal(readAgnesVideoReferenceImageIssue(2), "");
    assert.equal(readAgnesVideoReferenceImageIssue(3), "");
    assert.equal(readAgnesVideoReferenceImageIssue(4), "");
    assert.equal(readAgnesVideoReferenceImageIssue(10), "");
});
