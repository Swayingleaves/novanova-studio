import assert from "node:assert/strict";
import test from "node:test";

import { createImageNode, createStoryboardNode, createTextNode } from "../constants.ts";
import {
    applyCanvasNodeConfig,
    createCanvasConnection,
    findCanvasConnectionDropTarget,
    normalizeCanvasConnection,
    resetInterruptedCanvasNodes,
    selectCanvasNodesInRectangle,
    updateCanvasNodeSelection,
    moveCanvasNodesFromOrigins,
    applyGeneratedImageToBatchNodes,
    synchronizeImageBatchRootExecution,
} from "./canvas-page-node.ts";

test("修改空图片节点尺寸配置时保持中心点不变", () => {
    const node = createImageNode({ id: "image-1", position: { x: 100, y: 80 } });
    const updated = applyCanvasNodeConfig(node, { size: "16:9" });

    assert.equal(updated.kind, "image");
    assert.equal(updated.generation.size, "16:9");
    assert.equal(updated.frame.position.x + updated.frame.width / 2, node.frame.position.x + node.frame.width / 2);
    assert.equal(updated.frame.position.y + updated.frame.height / 2, node.frame.position.y + node.frame.height / 2);
});

test("已有内容的图片节点修改配置时不自动调整尺寸", () => {
    const node = createImageNode({ id: "image-1", position: { x: 100, y: 80 } });
    node.content.source = "image:stored";

    const updated = applyCanvasNodeConfig(node, { size: "16:9" });

    assert.deepEqual(updated.frame, node.frame);
});

test("连接使用明确的源端点和目标端点", () => {
    const first = createTextNode({ id: "text-1", position: { x: 0, y: 0 } });
    const second = createImageNode({ id: "image-1", position: { x: 400, y: 0 } });

    assert.deepEqual(normalizeCanvasConnection(first.id, second.id, [first, second]), {
        source: { nodeId: "text-1" },
        target: { nodeId: "image-1" },
    });
    assert.deepEqual(createCanvasConnection("connection-1", first.id, second.id, "right", "left"), {
        id: "connection-1",
        source: { nodeId: "text-1", portId: "right" },
        target: { nodeId: "image-1", portId: "left" },
    });
});

test("刷新后只把没有服务端任务标识的运行节点标记为失败", () => {
    const resumable = createImageNode({ id: "image-1", position: { x: 0, y: 0 } });
    resumable.execution = { phase: "running", taskId: "task-1" };
    const interrupted = createImageNode({ id: "image-2", position: { x: 0, y: 0 } });
    interrupted.execution = { phase: "running" };

    const [first, second] = resetInterruptedCanvasNodes([resumable, interrupted]);

    assert.equal(first.execution.phase, "running");
    assert.equal(second.execution.phase, "failed");
    assert.equal(second.execution.errorMessage, "页面刷新后生成已中断，请重新生成。");
});

test("刷新后会把同步分镜生成标记为可重新生成", () => {
    const storyboard = createStoryboardNode({ id: "storyboard-1", position: { x: 0, y: 0 } });
    storyboard.execution = { phase: "running" };

    const [restored] = resetInterruptedCanvasNodes([storyboard]);

    assert.equal(restored.execution.phase, "failed");
    assert.equal(restored.execution.errorMessage, "页面刷新后生成已中断，请重新生成。");
});

test("框选只返回与矩形相交的节点标识", () => {
    const first = createTextNode({ id: "text-1", position: { x: 10, y: 10 } });
    const second = createImageNode({ id: "image-1", position: { x: 500, y: 500 } });

    assert.deepEqual(selectCanvasNodesInRectangle([first, second], { left: 0, top: 0, right: 200, bottom: 200 }), ["text-1"]);
});

test("连接拖放优先命中节点内部", () => {
    const source = createTextNode({ id: "text-1", position: { x: 0, y: 0 } });
    const target = createImageNode({ id: "image-1", position: { x: 400, y: 0 } });

    assert.deepEqual(
        findCanvasConnectionDropTarget([source, target], "text-1", "source", { x: 450, y: 100 }, 1, 32, 40),
        { nodeId: "image-1", isNearNode: true },
    );
});

test("追加选择会切换目标节点，普通选择只保留目标节点", () => {
    assert.deepEqual([...updateCanvasNodeSelection(new Set(["node-1"]), "node-2", false)], ["node-2"]);
    assert.deepEqual([...updateCanvasNodeSelection(new Set(["node-1"]), "node-2", true)], ["node-1", "node-2"]);
    assert.deepEqual([...updateCanvasNodeSelection(new Set(["node-1", "node-2"]), "node-2", true)], ["node-1"]);
});

test("拖动节点按照初始位置统一偏移", () => {
    const node = createTextNode({ id: "text-1", position: { x: 10, y: 20 } });
    const [moved] = moveCanvasNodesFromOrigins([node], [{ id: "text-1", x: 10, y: 20 }], 30, -5);
    assert.deepEqual(moved.frame.position, { x: 40, y: 15 });
});

test("批量图片生成结果只写入目标子节点并同步根节点进度", () => {
    const root = createImageNode({ id: "root", position: { x: 0, y: 0 } });
    root.grouping = { ...root.grouping, isRoot: true, childIds: ["child-1", "child-2"] };
    root.execution = { phase: "running", progress: 0 };
    const firstChild = createImageNode({ id: "child-1", position: { x: 400, y: 0 } });
    firstChild.grouping = { ...firstChild.grouping, rootId: "root" };
    firstChild.execution = { phase: "running" };
    const secondChild = createImageNode({ id: "child-2", position: { x: 800, y: 0 } });
    secondChild.grouping = { ...secondChild.grouping, rootId: "root" };
    secondChild.execution = { phase: "running" };

    const updated = applyGeneratedImageToBatchNodes([root, firstChild, secondChild], {
        rootId: "root",
        targetId: "child-1",
        attributes: { content: "image:generated", status: "success" },
        width: 200,
        height: 100,
    });

    const updatedRoot = updated[0];
    const updatedChild = updated[1];
    assert.equal(updatedRoot.kind === "image" ? updatedRoot.grouping.primaryImageId : "", undefined);
    assert.equal(updatedRoot.kind === "image" ? updatedRoot.content.source : "", "");
    assert.equal(updatedRoot.execution.phase, "running");
    assert.equal(updatedRoot.execution.progress, 50);
    assert.equal(updatedChild.kind === "image" ? updatedChild.content.source : "", "image:generated");
});

test("批量图片生成结果把服务端风格快照同步到根节点和子节点", () => {
    const root = createImageNode({ id: "root", position: { x: 0, y: 0 } });
    root.grouping = { ...root.grouping, isRoot: true, childIds: ["child-1"] };
    root.execution = { phase: "running" };
    const child = createImageNode({ id: "child-1", position: { x: 400, y: 0 } });
    child.grouping = { ...child.grouping, rootId: "root" };
    child.execution = { phase: "running" };

    const snapshot = { id: 7, name: "电影感", generationType: "image" as const, stylePrompt: "cinematic" };
    const updated = applyGeneratedImageToBatchNodes([root, child], {
        rootId: "root",
        targetId: "child-1",
        attributes: { content: "image:generated", status: "success", generationStyleIds: [7], generationStyleSnapshots: [snapshot] },
        width: 200,
        height: 100,
    });

    assert.deepEqual(updated[0].kind === "image" ? updated[0].generation.generationStyleSnapshots : [], [snapshot]);
    assert.deepEqual(updated[1].kind === "image" ? updated[1].generation.generationStyleSnapshots : [], [snapshot]);
});

test("批量图片全部结束后根节点汇总部分失败状态", () => {
    const root = createImageNode({ id: "root", position: { x: 0, y: 0 } });
    root.grouping = { ...root.grouping, isRoot: true, childIds: ["child-1", "child-2"] };
    root.execution = { phase: "running", progress: 50 };
    const succeededChild = createImageNode({ id: "child-1", position: { x: 400, y: 0 } });
    succeededChild.grouping = { ...succeededChild.grouping, rootId: "root" };
    succeededChild.execution = { phase: "succeeded" };
    const failedChild = createImageNode({ id: "child-2", position: { x: 800, y: 0 } });
    failedChild.grouping = { ...failedChild.grouping, rootId: "root" };
    failedChild.execution = { phase: "failed", errorMessage: "生成失败" };

    const [updatedRoot] = synchronizeImageBatchRootExecution([root, succeededChild, failedChild], root.id);

    assert.equal(updatedRoot.execution.phase, "failed");
    assert.equal(updatedRoot.execution.progress, 100);
    assert.equal(updatedRoot.execution.errorMessage, "部分图片生成失败（成功 1/2）");
});
