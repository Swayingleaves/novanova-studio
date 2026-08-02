import assert from "node:assert/strict";
import test from "node:test";

import { isMonochromeModelIcon, resolveModelIcon } from "./model-icon.ts";

test("resolveModelIcon 根据 Agnes 渠道格式显示渠道图标", () => {
    assert.equal(resolveModelIcon("custom-video-model", "agnes"), "/icons/agnes.svg");
});

test("isMonochromeModelIcon 标记需要暗色反色处理的图标", () => {
    assert.equal(isMonochromeModelIcon("gpt-image-2"), true);
    assert.equal(isMonochromeModelIcon("grok-video"), true);
    assert.equal(isMonochromeModelIcon("custom-video-model", "agnes"), true);
    assert.equal(isMonochromeModelIcon("gemini-2.5-flash"), false);
});
