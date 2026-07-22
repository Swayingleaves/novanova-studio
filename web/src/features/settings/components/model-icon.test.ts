import assert from "node:assert/strict";
import test from "node:test";

import { resolveModelIcon } from "./model-icon.ts";

test("resolveModelIcon 根据 Agnes 渠道格式显示渠道图标", () => {
    assert.equal(resolveModelIcon("custom-video-model", "agnes"), "/icons/agnes.svg");
});
