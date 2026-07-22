import assert from "node:assert/strict";
import test from "node:test";

import { normalizeChannelName } from "./channel-name.ts";

test("normalizeChannelName 保留用户明确清空的渠道名称", () => {
    assert.equal(normalizeChannelName(""), "");
    assert.equal(normalizeChannelName("   "), "");
});

test("normalizeChannelName 仅在渠道名称未提供时使用默认名称", () => {
    assert.equal(normalizeChannelName(undefined), "未命名渠道");
    assert.equal(normalizeChannelName("  OpenAI  "), "OpenAI");
});
