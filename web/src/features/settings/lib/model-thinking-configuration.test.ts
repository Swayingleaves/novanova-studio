import assert from "node:assert/strict";
import test from "node:test";

import { isOpenAiTextModel, isReasoningEffortDisabled, reasoningEffortOptions } from "./model-thinking-configuration.ts";

test("仅OpenAI文本模型显示思考配置", () => {
    const channels = [
        { id: "openai", apiFormat: "openai" },
        { id: "gemini", apiFormat: "gemini" },
    ];

    assert.equal(isOpenAiTextModel({ modelType: "text", channelId: "openai" }, channels), true);
    assert.equal(isOpenAiTextModel({ modelType: "text", channelId: "gemini" }, channels), false);
    assert.equal(isOpenAiTextModel({ modelType: "image", channelId: "openai" }, channels), false);
});

test("关闭思考模式时保留强度但禁止编辑", () => {
    assert.deepEqual(reasoningEffortOptions.map((option) => option.value), ["high", "max"]);
    assert.equal(isReasoningEffortDisabled(false, false), true);
    assert.equal(isReasoningEffortDisabled(false, true), false);
    assert.equal(isReasoningEffortDisabled(true, true), true);
});
