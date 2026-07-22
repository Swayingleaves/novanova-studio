import assert from "node:assert/strict";
import test from "node:test";

import { createResponseEventStreamParser } from "./image-stream-parser.ts";

test("Responses 事件流支持跨分块累积文本", () => {
    const deltas: string[] = [];
    const parser = createResponseEventStreamParser((text) => deltas.push(text));
    parser.push('data: {"type":"response.output_text.delta","delta":"你');
    parser.push('好"}\n\ndata: {"type":"response.output_text.delta","delta":"！"}\n\n');
    const result = parser.finish();
    assert.equal(result.content, "你好！");
    assert.deepEqual(deltas, ["你好", "你好！"]);
});
