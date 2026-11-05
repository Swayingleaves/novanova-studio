import assert from "node:assert/strict";
import test from "node:test";

import { createImageNode, createTextNode, createVideoCompositionNode, createVideoNode } from "../constants.ts";
import { canvasNodeContainsPoint, planBatchImageToVideoConnections, readCanvasNodesBounds } from "./canvas-batch-connection.ts";
import { createCanvasConnection } from "./canvas-page-node.ts";

function createConnectionIdFactory() {
    let index = 0;
    return () => `batch-connection-${++index}`;
}

test("按画布位置从左到右批量连接选中的图片节点", () => {
    const right = createImageNode({ id: "image-right", position: { x: 600, y: 0 } });
    const left = createImageNode({ id: "image-left", position: { x: 0, y: 0 } });
    const middle = createImageNode({ id: "image-middle", position: { x: 300, y: 0 } });
    const video = createVideoNode({ id: "video-1", position: { x: 1200, y: 0 } });

    const plan = planBatchImageToVideoConnections({
        sourceNodeIds: [right.id, left.id, middle.id],
        targetNodeId: video.id,
        nodes: [right, left, middle, video],
        connections: [],
        createConnectionId: createConnectionIdFactory(),
    });

    assert.ok(plan);
    assert.equal(plan.imageNodeCount, 3);
    assert.equal(plan.skippedExistingCount, 0);
    assert.deepEqual(plan.connections.map((connection) => connection.source.nodeId), [left.id, middle.id, right.id]);
    assert.deepEqual(plan.connections.map((connection) => connection.source.portId), ["right", "right", "right"]);
    assert.deepEqual(plan.connections.map((connection) => connection.target.portId), ["left", "left", "left"]);
});

test("视频节点在左侧时从图片左侧连接", () => {
    const image = createImageNode({ id: "image-1", position: { x: 800, y: 0 } });
    const video = createVideoNode({ id: "video-1", position: { x: 0, y: 0 } });
    const otherImage = createImageNode({ id: "image-2", position: { x: 900, y: 0 } });

    const plan = planBatchImageToVideoConnections({
        sourceNodeIds: [image.id, otherImage.id],
        targetNodeId: video.id,
        nodes: [image, otherImage, video],
        connections: [],
        createConnectionId: createConnectionIdFactory(),
    });

    assert.ok(plan);
    assert.deepEqual(plan.connections.map((connection) => connection.source.portId), ["left", "left"]);
    assert.deepEqual(plan.connections.map((connection) => connection.target.portId), ["right", "right"]);
});

test("只连接来源中的图片节点并跳过隐藏节点", () => {
    const first = createImageNode({ id: "image-1", position: { x: 0, y: 0 } });
    const second = createImageNode({ id: "image-2", position: { x: 300, y: 0 } });
    const hiddenImage = createImageNode({ id: "image-hidden", position: { x: 100, y: 0 } });
    const text = createTextNode({ id: "text-1", position: { x: 200, y: 0 } });
    const video = createVideoNode({ id: "video-1", position: { x: 1000, y: 0 } });
    const composition = createVideoCompositionNode({ id: "composition-1", position: { x: 1200, y: 0 } });

    const plan = planBatchImageToVideoConnections({
        sourceNodeIds: [first.id, second.id, hiddenImage.id, text.id, composition.id],
        targetNodeId: video.id,
        nodes: [first, second, hiddenImage, text, video, composition],
        connections: [],
        hiddenNodeIds: new Set([hiddenImage.id]),
        createConnectionId: createConnectionIdFactory(),
    });

    assert.ok(plan);
    assert.equal(plan.imageNodeCount, 2);
    assert.deepEqual(plan.connections.map((connection) => connection.source.nodeId), [first.id, second.id]);
});

test("跳过已经连接到目标视频的图片节点", () => {
    const first = createImageNode({ id: "image-1", position: { x: 0, y: 0 } });
    const second = createImageNode({ id: "image-2", position: { x: 300, y: 0 } });
    const video = createVideoNode({ id: "video-1", position: { x: 1000, y: 0 } });
    const existing = createCanvasConnection("connection-1", first.id, video.id, "right", "left");

    const plan = planBatchImageToVideoConnections({
        sourceNodeIds: [first.id, second.id],
        targetNodeId: video.id,
        nodes: [first, second, video],
        connections: [existing],
        createConnectionId: createConnectionIdFactory(),
    });

    assert.ok(plan);
    assert.equal(plan.imageNodeCount, 2);
    assert.equal(plan.skippedExistingCount, 1);
    assert.deepEqual(plan.connections.map((connection) => connection.source.nodeId), [second.id]);
});

test("不满足批量条件时返回 null", () => {
    const first = createImageNode({ id: "image-1", position: { x: 0, y: 0 } });
    const second = createImageNode({ id: "image-2", position: { x: 300, y: 0 } });
    const video = createVideoNode({ id: "video-1", position: { x: 1000, y: 0 } });
    const text = createTextNode({ id: "text-1", position: { x: 500, y: 0 } });

    const base = {
        targetNodeId: video.id,
        nodes: [first, second, video, text],
        connections: [],
        createConnectionId: createConnectionIdFactory(),
    };

    assert.equal(planBatchImageToVideoConnections({ ...base, sourceNodeIds: [first.id] }), null);
    assert.equal(planBatchImageToVideoConnections({ ...base, sourceNodeIds: [first.id, second.id], targetNodeId: text.id }), null);
    assert.equal(planBatchImageToVideoConnections({ ...base, sourceNodeIds: [text.id] }), null);
    assert.equal(planBatchImageToVideoConnections({ ...base, sourceNodeIds: [] }), null);
});

test("计算多节点外接矩形和点命中", () => {
    const first = createImageNode({ id: "image-1", position: { x: 100, y: 200 } });
    const second = createVideoNode({ id: "video-1", position: { x: 700, y: 50 } });

    assert.deepEqual(readCanvasNodesBounds([first, second]), {
        left: 100,
        top: 50,
        width: 700 + 630 - 100,
        height: 200 + 360 - 50,
    });
    assert.equal(canvasNodeContainsPoint(first, { x: 100, y: 200 }), true);
    assert.equal(canvasNodeContainsPoint(first, { x: 99, y: 200 }), false);
    assert.equal(canvasNodeContainsPoint(first, { x: 100 + first.frame.width, y: 200 + first.frame.height }), true);
    assert.equal(readCanvasNodesBounds([]), null);
});
