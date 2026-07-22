import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createNodesChangeHandler } from "./rf-adapter.ts";
import { createImageNode } from "../constants.ts";
import type { CanvasNode } from "../types.ts";

const nodeActionContextSource = readFileSync(new URL("./node-action-context.ts", import.meta.url), "utf8");
const canvasPageSource = readFileSync(new URL("../pages/canvas-client-page.tsx", import.meta.url), "utf8");
const resizeNodeSources = ["image-node.tsx", "video-node.tsx", "text-node.tsx"].map((fileName) => readFileSync(new URL(`./${fileName}`, import.meta.url), "utf8"));

test("缩放产生的临时位置变化不会被当作节点拖动写回", () => {
    const harness = createNodeChangeHarness();

    harness.handle([{ id: "node-1", type: "position", position: { x: 80, y: 90 } }]);
    harness.flush();

    assert.deepEqual(harness.nodes[0].frame.position, { x: 10, y: 20 });
});

test("节点拖动结束的位置仍然正常写回", () => {
    const harness = createNodeChangeHarness();

    harness.handle([{ id: "node-1", type: "position", position: { x: 80, y: 90 }, dragging: false }]);
    harness.flush();

    assert.deepEqual(harness.nodes[0].frame.position, { x: 80, y: 90 });
});

test("缩放结束时一次性保存节点位置和尺寸", () => {
    assert.ok(nodeActionContextSource.includes("position?: CanvasPoint"), "节点缩放回调缺少位置参数");
    assert.ok(canvasPageSource.includes("updateCanvasNodeFrame(node, { width, height, position: position ?? node.frame.position })"), "画布缩放状态没有保存节点位置");
    resizeNodeSources.forEach((source) => {
        assert.ok(source.includes("{ x: params.x, y: params.y }"), "节点缩放结束回调没有提交左上角坐标");
    });
});

function createNodeChangeHarness() {
    let nodes: CanvasNode[] = [createImageNode({ id: "node-1", title: "测试节点", position: { x: 10, y: 20 } })];
    let scheduled: FrameRequestCallback | null = null;
    const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (callback) => {
        scheduled = callback;
        return 1;
    };
    const handle = createNodesChangeHandler((updater) => {
        nodes = typeof updater === "function" ? updater(nodes) : updater;
    });

    return {
        get nodes() {
            return nodes;
        },
        handle: (changes: Parameters<typeof handle>[0]) => handle(changes),
        flush: () => {
            const callback = scheduled;
            scheduled = null;
            callback?.(0);
            globalThis.requestAnimationFrame = originalRequestAnimationFrame;
        },
    };
}
