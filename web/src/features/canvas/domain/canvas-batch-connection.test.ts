import assert from "node:assert/strict";
import test from "node:test";

import { createImageNode, createTextNode, createVideoCompositionNode, createVideoNode } from "../constants.ts";
import { canvasNodeContainsPoint, planBatchNodesToVideoConnections, readCanvasNodesBounds } from "./canvas-batch-connection.ts";
import { createCanvasConnection } from "./canvas-page-node.ts";

function createConnectionIdFactory() {
    let index = 0;
    return () => `batch-connection-${++index}`;
}

test("按画布位置从左到右批量连接选中的图片和视频节点", () => {
    const rightImage = createImageNode({ id: "image-right", position: { x: 600, y: 0 } });
    const leftImage = createImageNode({ id: "image-left", position: { x: 0, y: 0 } });
    const middleVideo = createVideoNode({ id: "video-middle", position: { x: 300, y: 0 } });
    const targetVideo = createVideoNode({ id: "video-target", position: { x: 1200, y: 0 } });

    const plan = planBatchNodesToVideoConnections({
        sourceNodeIds: [rightImage.id, leftImage.id, middleVideo.id],
        targetNodeId: targetVideo.id,
        nodes: [rightImage, leftImage, middleVideo, targetVideo],
        connections: [],
        createConnectionId: createConnectionIdFactory(),
    });

    assert.ok(plan);
    assert.equal(plan.sourceNodeCount, 3);
    assert.equal(plan.skippedExistingCount, 0);
    assert.deepEqual(plan.connections.map((connection) => connection.source.nodeId), [leftImage.id, middleVideo.id, rightImage.id]);
    assert.deepEqual(plan.connections.map((connection) => connection.source.portId), ["right", "right", "right"]);
    assert.deepEqual(plan.connections.map((connection) => connection.target.portId), ["left", "left", "left"]);
});

test("目标视频也在选区中时排除目标节点", () => {
    const firstImage = createImageNode({ id: "image-1", position: { x: 0, y: 0 } });
    const secondImage = createImageNode({ id: "image-2", position: { x: 300, y: 0 } });
    const targetVideo = createVideoNode({ id: "video-target", position: { x: 1000, y: 0 } });

    const plan = planBatchNodesToVideoConnections({
        sourceNodeIds: [firstImage.id, targetVideo.id, secondImage.id],
        targetNodeId: targetVideo.id,
        nodes: [firstImage, secondImage, targetVideo],
        connections: [],
        createConnectionId: createConnectionIdFactory(),
    });

    assert.ok(plan);
    assert.equal(plan.sourceNodeCount, 2);
    assert.deepEqual(plan.connections.map((connection) => connection.source.nodeId), [firstImage.id, secondImage.id]);
});

test("视频节点在左侧时从来源左侧连接", () => {
    const image = createImageNode({ id: "image-1", position: { x: 800, y: 0 } });
    const otherVideo = createVideoNode({ id: "video-2", position: { x: 900, y: 0 } });
    const targetVideo = createVideoNode({ id: "video-target", position: { x: 0, y: 0 } });

    const plan = planBatchNodesToVideoConnections({
        sourceNodeIds: [image.id, otherVideo.id],
        targetNodeId: targetVideo.id,
        nodes: [image, otherVideo, targetVideo],
        connections: [],
        createConnectionId: createConnectionIdFactory(),
    });

    assert.ok(plan);
    assert.deepEqual(plan.connections.map((connection) => connection.source.portId), ["left", "left"]);
    assert.deepEqual(plan.connections.map((connection) => connection.target.portId), ["right", "right"]);
});

test("只连接来源中的图片/视频节点并跳过隐藏节点", () => {
    const firstImage = createImageNode({ id: "image-1", position: { x: 0, y: 0 } });
    const secondImage = createImageNode({ id: "image-2", position: { x: 300, y: 0 } });
    const video = createVideoNode({ id: "video-1", position: { x: 500, y: 0 } });
    const hiddenVideo = createVideoNode({ id: "video-hidden", position: { x: 100, y: 0 } });
    const text = createTextNode({ id: "text-1", position: { x: 200, y: 0 } });
    const targetVideo = createVideoNode({ id: "video-target", position: { x: 1000, y: 0 } });
    const composition = createVideoCompositionNode({ id: "composition-1", position: { x: 1200, y: 0 } });

    const plan = planBatchNodesToVideoConnections({
        sourceNodeIds: [firstImage.id, secondImage.id, video.id, hiddenVideo.id, text.id, composition.id],
        targetNodeId: targetVideo.id,
        nodes: [firstImage, secondImage, video, hiddenVideo, text, targetVideo, composition],
        connections: [],
        hiddenNodeIds: new Set([hiddenVideo.id]),
        createConnectionId: createConnectionIdFactory(),
    });

    assert.ok(plan);
    assert.equal(plan.sourceNodeCount, 3);
    assert.deepEqual(plan.connections.map((connection) => connection.source.nodeId), [firstImage.id, secondImage.id, video.id]);
});

test("跳过已经连接到目标视频的来源节点", () => {
    const firstImage = createImageNode({ id: "image-1", position: { x: 0, y: 0 } });
    const video = createVideoNode({ id: "video-1", position: { x: 300, y: 0 } });
    const targetVideo = createVideoNode({ id: "video-target", position: { x: 1000, y: 0 } });
    const existing = createCanvasConnection("connection-1", firstImage.id, targetVideo.id, "right", "left");

    const plan = planBatchNodesToVideoConnections({
        sourceNodeIds: [firstImage.id, video.id],
        targetNodeId: targetVideo.id,
        nodes: [firstImage, video, targetVideo],
        connections: [existing],
        createConnectionId: createConnectionIdFactory(),
    });

    assert.ok(plan);
    assert.equal(plan.sourceNodeCount, 2);
    assert.equal(plan.skippedExistingCount, 1);
    assert.deepEqual(plan.connections.map((connection) => connection.source.nodeId), [video.id]);
});

test("不满足批量条件时返回 null", () => {
    const firstImage = createImageNode({ id: "image-1", position: { x: 0, y: 0 } });
    const secondImage = createImageNode({ id: "image-2", position: { x: 300, y: 0 } });
    const targetVideo = createVideoNode({ id: "video-target", position: { x: 1000, y: 0 } });
    const text = createTextNode({ id: "text-1", position: { x: 500, y: 0 } });

    const base = {
        targetNodeId: targetVideo.id,
        nodes: [firstImage, secondImage, targetVideo, text],
        connections: [],
        createConnectionId: createConnectionIdFactory(),
    };

    assert.equal(planBatchNodesToVideoConnections({ ...base, sourceNodeIds: [firstImage.id] }), null);
    assert.equal(planBatchNodesToVideoConnections({ ...base, sourceNodeIds: [firstImage.id, secondImage.id], targetNodeId: text.id }), null);
    assert.equal(planBatchNodesToVideoConnections({ ...base, sourceNodeIds: [text.id] }), null);
    assert.equal(planBatchNodesToVideoConnections({ ...base, sourceNodeIds: [] }), null);
    assert.equal(planBatchNodesToVideoConnections({ ...base, sourceNodeIds: [firstImage.id, targetVideo.id] }), null);
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
