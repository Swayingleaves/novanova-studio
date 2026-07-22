import assert from "node:assert/strict";
import test from "node:test";

import {
    buildCanvasAgentAttachmentSummary,
    groupCanvasAgentMessages,
} from "./canvas-agent-message.ts";

test("连续同角色消息会归入同一消息组", () => {
    const groups = groupCanvasAgentMessages([
        { id: "1", role: "assistant", text: "第一条" },
        { id: "2", role: "assistant", text: "第二条" },
        { id: "3", role: "user", text: "用户消息" },
    ]);
    assert.deepEqual(groups.map((group) => ({ role: group.role, ids: group.messages.map((message) => message.id) })), [
        { role: "assistant", ids: ["1", "2"] },
        { role: "user", ids: ["3"] },
    ]);
});

test("附件摘要优先显示数量和附件名称", () => {
    assert.equal(
        buildCanvasAgentAttachmentSummary({
            id: "1",
            role: "user",
            text: "",
            attachments: [
                { id: "a", name: "参考图.png", url: "data:image/png;base64,a" },
                { id: "b", name: "草图.png", url: "data:image/png;base64,b" },
            ],
        }),
        "2 个附件：参考图.png、草图.png",
    );
});
