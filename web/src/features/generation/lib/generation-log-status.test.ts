import assert from "node:assert/strict";
import test from "node:test";

import { getGenerationConversationStatus, hasRunningGeneration } from "./generation-log-status.ts";

test("运行中的记录优先显示加载状态", () => {
    assert.equal(getGenerationConversationStatus({ generationStatus: "running" }), "running");
});

test("完成时间晚于查看时间时显示对应未读状态", () => {
    assert.equal(getGenerationConversationStatus({ generationStatus: "success", generationCompletedAt: "2026-07-11T10:00:00Z", generationViewedAt: "2026-07-11T09:00:00Z" }), "unreadSuccess");
    assert.equal(getGenerationConversationStatus({ generationStatus: "failed", generationCompletedAt: "2026-07-11T10:00:00Z" }), "unreadFailed");
});

test("已查看的完成记录不显示未读状态", () => {
    assert.equal(getGenerationConversationStatus({ generationStatus: "success", generationCompletedAt: "2026-07-11T10:00:00Z", generationViewedAt: "2026-07-11T10:00:00Z" }), "none");
});

test("列表中任一记录运行时继续轮询", () => {
    assert.equal(hasRunningGeneration([{ generationStatus: "success" }, { generationStatus: "running" }]), true);
    assert.equal(hasRunningGeneration([{ generationStatus: "success" }]), false);
});
