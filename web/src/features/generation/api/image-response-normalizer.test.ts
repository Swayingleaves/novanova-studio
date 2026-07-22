import assert from "node:assert/strict";
import test from "node:test";

import { normalizeResponsePayload } from "./image-response-normalizer.ts";

test("Responses 响应会归一化文本和工具调用", () => {
    const result = normalizeResponsePayload({
        output: [
            { type: "message", content: [{ type: "output_text", text: "已完成" }] },
            { type: "function_call", call_id: "call-1", name: "add_node", arguments: "{\"kind\":\"image\"}" },
        ],
    });
    assert.equal(result.content, "已完成");
    assert.deepEqual(result.toolCalls, [{ id: "call-1", type: "function", function: { name: "add_node", arguments: "{\"kind\":\"image\"}" } }]);
});

test("Responses 错误载荷会直接抛出服务端消息", () => {
    assert.throws(() => normalizeResponsePayload({ error: { message: "模型不可用" } }), /模型不可用/);
});
