import assert from "node:assert/strict";
import test from "node:test";

import { buildCanvasImageToolActions } from "./canvas-image-tool-actions.ts";

test("图片节点默认提供全部图片操作", () => {
    const actions = buildCanvasImageToolActions({ freeResize: false });
    assert.deepEqual(actions.map((action) => action.id), ["copyPrompt", "replace", "resize", "crop", "split", "view"]);
});

test("自由缩放节点显示恢复等比缩放动作", () => {
    const actions = buildCanvasImageToolActions({ freeResize: true });
    const resize = actions.find((action) => action.id === "resize");
    assert.deepEqual(resize, {
        id: "resize",
        label: "自由比例",
        title: "恢复等比缩放",
        active: true,
    });
});
