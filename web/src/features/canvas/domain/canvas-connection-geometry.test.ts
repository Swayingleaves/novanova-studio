import assert from "node:assert/strict";
import test from "node:test";

import {
    createCanvasConnectionPath,
    resolveCanvasConnectionAnchors,
} from "./canvas-connection-geometry.ts";

test("连接锚点使用源节点右侧中点和目标节点左侧中点", () => {
    const anchors = resolveCanvasConnectionAnchors(
        { position: { x: 10, y: 20 }, width: 100, height: 60 },
        { position: { x: 300, y: 80 }, width: 120, height: 40 },
    );
    assert.deepEqual(anchors, { start: { x: 110, y: 50 }, end: { x: 300, y: 100 } });
});

test("连接路径在节点距离较近时仍保留最小曲率", () => {
    assert.equal(
        createCanvasConnectionPath({ start: { x: 100, y: 50 }, end: { x: 120, y: 70 }, minimumCurve: 48 }),
        "M 100 50 C 148 50 72 70 120 70",
    );
});
