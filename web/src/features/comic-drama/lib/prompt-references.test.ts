import assert from "node:assert/strict";
import test from "node:test";
import type { ComicDramaPromptVersion } from "../types";
import { fullPromptWithBody, readPromptBody, readReferenceInstructions } from "./prompt-references";

test("只编辑正文，复制保留系统图片说明且不重复", () => {
    const instructions = "参考图片说明：\n使用 @图片1 作为场景「庭院」的背景与环境参考。";
    const version = { prompt: `正文\n\n${instructions}`, sourceSnapshot: { promptBody: "正文", referenceInstructions: instructions } } as unknown as ComicDramaPromptVersion;
    assert.equal(readPromptBody(version), "正文");
    assert.equal(readReferenceInstructions(version), instructions);
    assert.equal(fullPromptWithBody(readPromptBody(version), version), version.prompt);
    assert.equal(fullPromptWithBody(" 新正文 ", version), `新正文\n\n${instructions}`);
    assert.equal((fullPromptWithBody(readPromptBody(version), version).match(/参考图片说明/g) || []).length, 1);
});

test("旧版与首次手动创建保持原文，不猜测缺失的图片说明", () => {
    const version = { prompt: "旧版正文", sourceSnapshot: {} } as unknown as ComicDramaPromptVersion;
    assert.equal(readPromptBody(version), "旧版正文");
    assert.equal(readReferenceInstructions(version), "");
    assert.equal(fullPromptWithBody("正文", null), "正文");
    assert.equal(readPromptBody(), "");
});
