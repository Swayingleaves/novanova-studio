import assert from "node:assert/strict";
import test from "node:test";

import { isReasoningEffortDisabled, reasoningEffortOptions, supportsThinkingConfiguration } from "./model-thinking-configuration.ts";

test("所有文本模型均显示思考配置，非文本模型不显示", () => {
    assert.equal(supportsThinkingConfiguration({ modelType: "text" }), true);
    assert.equal(supportsThinkingConfiguration({ modelType: "image" }), false);
    assert.equal(supportsThinkingConfiguration({ modelType: "video" }), false);
});

test("关闭思考模式时保留强度但禁止编辑", () => {
    assert.deepEqual(reasoningEffortOptions.map((option) => option.value), ["high", "max"]);
    assert.equal(isReasoningEffortDisabled(false, false), true);
    assert.equal(isReasoningEffortDisabled(false, true), false);
    assert.equal(isReasoningEffortDisabled(true, true), true);
});
