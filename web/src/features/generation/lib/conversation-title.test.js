import assert from "node:assert/strict";
import test from "node:test";

import {
    MAX_CONVERSATION_TITLE_LENGTH,
    normalizeConversationTitle,
    validateConversationTitle,
} from "./conversation-title.js";

test("normalizeConversationTitle 会裁剪标题首尾空格", () => {
    assert.equal(normalizeConversationTitle("  新标题  "), "新标题");
});

test("validateConversationTitle 会拒绝空标题", () => {
    assert.equal(validateConversationTitle("   "), "标题不能为空");
});

test("validateConversationTitle 会拒绝超过最大长度的标题", () => {
    assert.equal(validateConversationTitle("a".repeat(MAX_CONVERSATION_TITLE_LENGTH + 1)), `标题不能超过 ${MAX_CONVERSATION_TITLE_LENGTH} 个字符`);
});

test("validateConversationTitle 允许最大长度内的标题", () => {
    assert.equal(validateConversationTitle("a".repeat(MAX_CONVERSATION_TITLE_LENGTH)), "");
});
