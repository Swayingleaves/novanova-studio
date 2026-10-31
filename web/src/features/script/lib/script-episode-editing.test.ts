import assert from "node:assert/strict";
import test from "node:test";

import { isScriptAiDraftStale, moveScriptBlock, removeScriptBlock, replaceScriptBlock, synchronizeDialogueCharacters } from "./script-episode-editing.ts";
import type { ScriptBlock } from "../types.ts";

const blocks: ScriptBlock[] = [
    { id: "action", blockType: "action", characterId: null, content: "推门", sortOrder: 0 },
    { id: "dialogue", blockType: "dialogue", characterId: "person-a", content: "你来了。", sortOrder: 1 },
    { id: "narration", blockType: "narration", characterId: null, content: "雨声渐强。", sortOrder: 2 },
];

test("正文块替换、移动和删除始终保留稳定标识并生成连续排序", () => {
    const replaced = replaceScriptBlock(blocks, { ...blocks[1], content: "终于来了。" });
    assert.equal(replaced[1].content, "终于来了。");

    const moved = moveScriptBlock(replaced, 1, -1);
    assert.deepEqual(moved.map((block) => [block.id, block.sortOrder]), [["dialogue", 0], ["action", 1], ["narration", 2]]);

    const removed = removeScriptBlock(moved, "action");
    assert.deepEqual(removed.map((block) => [block.id, block.sortOrder]), [["dialogue", 0], ["narration", 1]]);
});

test("移除出场人物会修正对白引用且陈旧AI草稿可被识别", () => {
    assert.equal(synchronizeDialogueCharacters(blocks, ["person-b"])[1].characterId, "person-b");
    assert.equal(synchronizeDialogueCharacters(blocks, [])[1].characterId, null);
    assert.equal(isScriptAiDraftStale({ baseRevision: 3 }, 4), true);
    assert.equal(isScriptAiDraftStale({ baseRevision: 4 }, 4), false);
});
