import assert from "node:assert/strict";
import test from "node:test";

import { createBackgroundNode, createImageNode } from "../constants.ts";
import { createCanvasConnection } from "../domain/canvas-page-node.ts";
import { toRFEdges, toRFNodes } from "./rf-adapter.ts";

test("批次折叠时保留 React Flow 节点并标记为隐藏", () => {
    const root = createImageNode({ id: "root", position: { x: 0, y: 0 } });
    const child = createImageNode({ id: "child", position: { x: 400, y: 0 } });

    const nodes = toRFNodes([root, child], undefined, new Set([child.id]));

    assert.equal(nodes.length, 2);
    assert.equal(nodes.find((node) => node.id === root.id)?.hidden, false);
    assert.equal(nodes.find((node) => node.id === child.id)?.hidden, true);
});

test("批次折叠时保留连线并标记为隐藏", () => {
    const connection = createCanvasConnection("connection-1", "root", "child");

    const edges = toRFEdges([connection], new Set(["root", "child"]), new Set(["child"]));

    assert.equal(edges.length, 1);
    assert.equal(edges[0]?.hidden, true);
});

test("背景板位于普通节点底部且不允许业务连线", () => {
    const board = createBackgroundNode({ id: "background", position: { x: 0, y: 0 } });
    const image = createImageNode({ id: "image", position: { x: 20, y: 20 } });
    const nodes = toRFNodes([image, board]);
    assert.equal(nodes.find((node) => node.id === board.id)?.zIndex, 0);
    assert.equal(nodes.find((node) => node.id === image.id)?.zIndex, 1);
    assert.equal(toRFEdges([createCanvasConnection("connection", board.id, image.id)], new Set([board.id, image.id]), undefined, new Set([board.id])).length, 0);
});
