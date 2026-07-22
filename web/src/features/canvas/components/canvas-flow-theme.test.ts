import test from "node:test";
import assert from "node:assert/strict";

import { canvasThemes } from "../../../shared/lib/canvas-theme.ts";
import { getCanvasControlStyleVars } from "./canvas-flow-theme.ts";

test("getCanvasControlStyleVars 为暗色控制按钮输出主题变量", () => {
    const styles = getCanvasControlStyleVars(canvasThemes.dark);

    assert.equal(styles.background, canvasThemes.dark.toolbar.panel);
    assert.equal(styles.borderColor, canvasThemes.dark.toolbar.border);
    assert.equal(styles.color, canvasThemes.dark.node.text);
    assert.equal(styles["--xy-controls-button-background-color"], canvasThemes.dark.toolbar.panel);
    assert.equal(styles["--xy-controls-button-background-color-hover-props"], canvasThemes.dark.toolbar.itemHover);
    assert.equal(styles["--xy-controls-button-border-color-props"], canvasThemes.dark.toolbar.border);
    assert.equal(styles["--xy-controls-button-color-props"], canvasThemes.dark.toolbar.item);
    assert.equal(styles["--xy-controls-button-color-hover-props"], canvasThemes.dark.node.text);
});
