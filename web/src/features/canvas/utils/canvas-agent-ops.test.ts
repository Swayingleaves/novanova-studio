import assert from "node:assert/strict";
import test from "node:test";

import { applyCanvasAgentOps, type CanvasAgentOp, type CanvasAgentSnapshot } from "./canvas-agent-ops.ts";

test("Agent 新增图片节点使用新领域模型", () => {
    const snapshot = emptySnapshot();

    const next = applyCanvasAgentOps(snapshot, [
        {
            type: "add_node",
            nodeType: "image",
            id: "image-1",
            title: "示例图",
            x: 20,
            y: 30,
            attributes: {
                content: "data:image/png;base64,abc",
                status: "success",
                prompt: "图片提示",
            },
        },
    ]);

    const node = next.nodes[0];
    assert.equal(node.kind, "image");
    assert.equal(node.frame.position.x, 20);
    assert.equal(node.frame.position.y, 30);
    assert.equal(node.execution.phase, "succeeded");
    assert.equal(node.kind === "image" ? node.content.source : "", "data:image/png;base64,abc");
    assert.equal(node.kind === "image" ? node.generation.prompt : "", "图片提示");
    assert.equal(node.kind === "image" ? node.generation.count : 0, 1);
});

test("Agent 更新文本节点只修改文本内容和标题", () => {
    const created = applyCanvasAgentOps(emptySnapshot(), [
        { type: "add_node", nodeType: "text", id: "text-1", attributes: { content: "旧文本" } },
    ]);

    const updated = applyCanvasAgentOps(created, [
        { type: "update_node", id: "text-1", title: "新标题", attributes: { content: "新文本", status: "success" } },
    ]);

    const node = updated.nodes[0];
    assert.equal(node.title, "新标题");
    assert.equal(node.kind === "text" ? node.content.text : "", "新文本");
    assert.equal(node.execution.phase, "succeeded");
});

test("Agent 连接操作使用明确的源节点和目标节点", () => {
    const created = applyCanvasAgentOps(emptySnapshot(), [
        { type: "add_node", nodeType: "text", id: "text-1" },
        { type: "add_node", nodeType: "image", id: "image-1" },
    ]);

    const connected = applyCanvasAgentOps(created, [
        { type: "connect_nodes", sourceNodeId: "text-1", targetNodeId: "image-1", id: "connection-1" },
    ]);

    assert.deepEqual(connected.connections, [
        { id: "connection-1", source: { nodeId: "text-1" }, target: { nodeId: "image-1" } },
    ]);
});

test("Agent 不会把分镜节点降级创建为文本节点", () => {
    const invalidOperation = { type: "add_node", nodeType: "storyboard" } as unknown as CanvasAgentOp;
    const next = applyCanvasAgentOps(emptySnapshot(), [invalidOperation]);

    assert.deepEqual(next.nodes, []);
});

function emptySnapshot(): CanvasAgentSnapshot {
    return {
        projectId: "document-1",
        title: "测试",
        nodes: [],
        connections: [],
        selectedNodeIds: [],
        viewport: { x: 0, y: 0, k: 1 },
    };
}
