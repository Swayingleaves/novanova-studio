import assert from "node:assert/strict";
import test from "node:test";

import { translateMessage as translate } from "@/features/locale/translate";

import { CANVAS_BACKGROUND_PADDING } from "../constants.ts";
import { readCanvasNodesBounds } from "./canvas-batch-connection.ts";
import { isBackgroundNode, isImageNode, isVideoNode } from "./canvas-node.ts";
import { createFirstLastFrameVideoTemplate } from "./canvas-first-last-frame-template.ts";

test("首尾帧模板把两张图片放进背景板，视频节点留在板外并按顺序连线", () => {
    let serial = 0;
    const center = { x: 1000, y: 800 };
    const { nodes, connections } = createFirstLastFrameVideoTemplate(center, () => `node-${serial++}`);
    const board = nodes.find(isBackgroundNode);
    const images = nodes.filter(isImageNode);
    const video = nodes.find(isVideoNode);
    assert.ok(board);
    assert.equal(images.length, 2);
    assert.ok(video);
    if (!board || !video) return;

    const [firstFrame, lastFrame] = images;
    assert.ok(firstFrame);
    assert.ok(lastFrame);
    assert.equal(firstFrame.title, translate("canvas.firstFrame"));
    assert.equal(lastFrame.title, translate("canvas.lastFrame"));
    assert.deepEqual(board.memberNodeIds, [firstFrame.id, lastFrame.id]);
    assert.equal(board.memberNodeIds.includes(video.id), false);
    assert.equal(board.labels.length, 1);
    assert.equal(board.labels[0]?.text, translate("canvas.useFirstAndLastFramesToGenerateVideo"));
    assert.ok((board.labels[0]?.y ?? 0) >= 28);

    const label = board.labels[0];
    const labelBottom = (label?.y ?? 0) + Math.round((label?.fontSize ?? 16) * 1.4);
    const titleStack = 24 + 8;
    for (const image of images) {
        assert.ok(image.frame.position.x >= board.frame.position.x + CANVAS_BACKGROUND_PADDING);
        assert.ok(image.frame.position.y >= board.frame.position.y + labelBottom + titleStack);
        assert.ok(image.frame.position.x + image.frame.width <= board.frame.position.x + board.frame.width - CANVAS_BACKGROUND_PADDING);
        assert.ok(image.frame.position.y + image.frame.height <= board.frame.position.y + board.frame.height - CANVAS_BACKGROUND_PADDING);
    }
    assert.equal(firstFrame.frame.position.x, lastFrame.frame.position.x);
    assert.ok(lastFrame.frame.position.y >= firstFrame.frame.position.y + firstFrame.frame.height + titleStack);
    assert.ok(video.frame.position.x >= board.frame.position.x + board.frame.width);
    assert.equal(video.generation.videoGenerationMode, "first-last-frame-to-video");

    assert.equal(connections.length, 2);
    assert.equal(connections[0]?.source.nodeId, firstFrame.id);
    assert.equal(connections[1]?.source.nodeId, lastFrame.id);
    assert.equal(connections[0]?.target.nodeId, video.id);
    assert.equal(connections[1]?.target.nodeId, video.id);
    assert.equal(connections[0]?.source.portId, "right");
    assert.equal(connections[0]?.target.portId, "left");
    assert.equal(connections[1]?.source.portId, "right");
    assert.equal(connections[1]?.target.portId, "left");

    const bounds = readCanvasNodesBounds(nodes);
    assert.equal(bounds && bounds.left + bounds.width / 2, center.x);
    assert.equal(bounds && bounds.top + bounds.height / 2, center.y);
});
