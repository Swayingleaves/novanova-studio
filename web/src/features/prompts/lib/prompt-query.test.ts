import assert from "node:assert/strict";
import test from "node:test";

import { createPromptExcerpt, normalizePromptTags, togglePromptTag } from "./prompt-query.ts";

test("提示词标签会去重、去空并排除全部选项", () => {
    assert.deepEqual(normalizePromptTags([" 摄影 ", "全部", "摄影", "", "产品"]), ["摄影", "产品"]);
});

test("提示词标签切换支持添加、移除和重置", () => {
    assert.deepEqual(togglePromptTag(["摄影"], "产品"), ["摄影", "产品"]);
    assert.deepEqual(togglePromptTag(["摄影", "产品"], "摄影"), ["产品"]);
    assert.deepEqual(togglePromptTag(["摄影"], "全部"), []);
});

test("提示词摘要会清理连续空白并按长度截断", () => {
    assert.equal(createPromptExcerpt("  第一行\n\n第二行很长  ", 8), "第一行 第二行…");
});
