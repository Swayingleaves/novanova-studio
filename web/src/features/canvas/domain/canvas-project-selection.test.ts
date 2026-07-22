import assert from "node:assert/strict";
import test from "node:test";

import {
    normalizeCanvasDocumentIds,
    removeCanvasDocumentIds,
    toggleCanvasDocumentSelection,
} from "./canvas-project-selection.ts";

test("画布标识会去除空值并保持首次出现顺序", () => {
    assert.deepEqual(normalizeCanvasDocumentIds([" first ", "", "second", "first", "  "]), ["first", "second"]);
});

test("选择切换不会产生重复标识", () => {
    assert.deepEqual(toggleCanvasDocumentSelection(["first"], "first", true), ["first"]);
    assert.deepEqual(toggleCanvasDocumentSelection(["first"], "second", true), ["first", "second"]);
    assert.deepEqual(toggleCanvasDocumentSelection(["first", "second"], "first", false), ["second"]);
});

test("删除画布会同步清理选择、待删除和编辑状态", () => {
    const next = removeCanvasDocumentIds(
        {
            editingDocumentId: "second",
            editingTitleDraft: "第二个画布",
            selectedDocumentIds: ["first", "second"],
            pendingDeleteDocumentIds: ["second", "third"],
        },
        ["second"],
    );

    assert.deepEqual(next, {
        editingDocumentId: null,
        editingTitleDraft: "",
        selectedDocumentIds: ["first"],
        pendingDeleteDocumentIds: ["third"],
    });
});
