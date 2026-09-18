import assert from "node:assert/strict";
import test from "node:test";

import { canvasThemes } from "./canvas-theme.ts";

test("canvasThemes 保留浅色画布色板", () => {
    assert.equal(canvasThemes.light.canvas.background, "#f4f5f2");
    assert.equal(canvasThemes.light.node.text, "#171a17");
});

test("canvasThemes 提供暗色画布色板", () => {
    assert.equal(canvasThemes.dark.canvas.background, "#050606");
    assert.equal(canvasThemes.dark.node.text, "#f3f6f0");
    assert.equal(canvasThemes.dark.toolbar.panel, "rgba(12,14,13,.94)");
});

test("canvasThemes 提供紫色画布色板（暗色系）", () => {
    assert.equal(canvasThemes.purple.canvas.background, "#050505");
    assert.equal(canvasThemes.purple.node.fill, "#0d0d0f");
    assert.equal(canvasThemes.purple.node.text, "#f5f5f5");
    assert.equal(canvasThemes.purple.node.activeStroke, "#b85cf6");
});
