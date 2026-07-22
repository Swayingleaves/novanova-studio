import assert from "node:assert/strict";
import test from "node:test";

import { createImageNode } from "../constants.ts";
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
