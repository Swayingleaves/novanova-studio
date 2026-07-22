import assert from "node:assert/strict";
import test from "node:test";

import {
    findLatestPendingConversation,
    hasPendingImageConversation,
    hasPendingVideoConversation,
} from "./generation-conversation-recovery.ts";

test("hasPendingImageConversation 检查所有图片结果状态", () => {
    assert.equal(
        hasPendingImageConversation({
            updatedAt: 100,
            rounds: [{ results: [{ status: "success" }, { status: "pending" }] }],
        }),
        true,
    );
    assert.equal(
        hasPendingImageConversation({
            updatedAt: 100,
            rounds: [{ results: [{ status: "success" }, { status: "failed" }] }],
        }),
        false,
    );
});

test("hasPendingVideoConversation 检查每轮视频结果状态", () => {
    assert.equal(
        hasPendingVideoConversation({
            updatedAt: 100,
            rounds: [{ result: { status: "success" } }, { result: { status: "pending" } }],
        }),
        true,
    );
    assert.equal(
        hasPendingVideoConversation({
            updatedAt: 100,
            rounds: [{ result: { status: "success" } }, { result: { status: "failed" } }],
        }),
        false,
    );
});

test("findLatestPendingConversation 返回更新时间最新的进行中会话且不修改输入", () => {
    const conversations = Object.freeze([
        { id: "old", updatedAt: 100, rounds: [{ results: [{ status: "pending" }] }] },
        { id: "completed", updatedAt: 300, rounds: [{ results: [{ status: "success" }] }] },
        { id: "latest", updatedAt: 200, rounds: [{ results: [{ status: "pending" }] }] },
    ]);

    const conversation = findLatestPendingConversation(conversations, hasPendingImageConversation);

    assert.equal(conversation?.id, "latest");
    assert.deepEqual(conversations.map((item) => item.id), ["old", "completed", "latest"]);
});

test("findLatestPendingConversation 在没有进行中会话时返回 null", () => {
    const conversation = findLatestPendingConversation(
        [{ id: "finished", updatedAt: 100, rounds: [{ result: { status: "success" } }] }],
        hasPendingVideoConversation,
    );

    assert.equal(conversation, null);
});
