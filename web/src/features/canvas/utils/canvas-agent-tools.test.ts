import assert from "node:assert/strict";
import test from "node:test";

import { positionCanvasAgentAddNodeOps, resolveCanvasAgentTool } from "./canvas-agent-tools.ts";

test("图片生成工具创建稳定配置节点并立即触发生成", () => {
    const execution = resolveCanvasAgentTool("canvas_generate_image", {
        prompt: "小猫在吃鱼",
        size: "9:16",
        quality: "high",
        count: 3,
    }, () => "fixed-id");

    assert.ok(execution);
    assert.deepEqual(execution.ops, [
        {
            type: "add_node",
            id: "image-fixed-id",
            nodeType: "image",
            title: "图片生成",
            x: undefined,
            y: undefined,
            attributes: {
                prompt: "小猫在吃鱼",
                status: "idle",
                size: "9:16",
                quality: "high",
                count: 3,
            },
        },
        {
            type: "run_generation",
            nodeId: "image-fixed-id",
            mode: "image",
            prompt: "小猫在吃鱼",
        },
    ]);
    assert.deepEqual(execution.result.data, { nodeId: "image-fixed-id", status: "running" });
    assert.match(execution.result.message, /已开始/);
    assert.doesNotMatch(execution.result.message, /生成成功|生成完成/);
});

test("通用生成流程仅在autoRun为true时触发生成", () => {
    const idleExecution = resolveCanvasAgentTool("canvas_create_generation_flow", {
        mode: "image",
        prompt: "静物摄影",
        size: "1:1",
        autoRun: false,
    }, () => "idle-id");
    const runningExecution = resolveCanvasAgentTool("canvas_create_generation_flow", {
        mode: "image",
        prompt: "静物摄影",
        size: "1:1",
        autoRun: true,
    }, () => "running-id");

    assert.ok(idleExecution);
    assert.equal(idleExecution.ops.length, 1);
    assert.deepEqual(idleExecution.result.data, { nodeId: "image-idle-id", status: "idle" });
    assert.ok(runningExecution);
    assert.equal(runningExecution.ops[1]?.type, "run_generation");
    assert.deepEqual(runningExecution.result.data, { nodeId: "image-running-id", status: "running" });
});

test("通用生成流程缺少明确模式时拒绝执行", () => {
    const execution = resolveCanvasAgentTool("canvas_create_generation_flow", {
        prompt: "没有模式",
        autoRun: true,
    }, () => "unused");

    assert.equal(execution, null);
});

test("立即生图缺少尺寸时不创建节点也不启动任务", () => {
    const execution = resolveCanvasAgentTool("canvas_create_generation_flow", {
        mode: "image",
        prompt: "缺少尺寸",
        autoRun: true,
    }, () => "unused");

    assert.ok(execution);
    assert.equal(execution.result.ok, false);
    assert.match(execution.result.message, /尺寸不能为空/);
    assert.deepEqual(execution.ops, []);
});

test("已有配置节点可以单独触发生成", () => {
    const execution = resolveCanvasAgentTool("canvas_run_generation", {
        nodeId: "image-existing",
        mode: "image",
        prompt: "重新生成",
    });

    assert.ok(execution);
    assert.deepEqual(execution.ops, [{
        type: "run_generation",
        nodeId: "image-existing",
        mode: "image",
        prompt: "重新生成",
    }]);
    assert.deepEqual(execution.result.data, { nodeId: "image-existing", status: "running" });
});

test("缺少坐标的生成节点放在当前画布视口中心", () => {
    const execution = resolveCanvasAgentTool("canvas_generate_image", {
        prompt: "小猫在吃鱼",
        size: "9:16",
    }, () => "centered");

    assert.ok(execution);
    const positioned = positionCanvasAgentAddNodeOps(execution.ops, { x: 1000, y: 800 });
    assert.equal(positioned[0]?.x, 830);
    assert.equal(positioned[0]?.y, 680);
    assert.equal(positioned[1]?.type, "run_generation");
});

test("恢复生成复用失败节点并标记为恢复执行", () => {
    const execution = resolveCanvasAgentTool("canvas_generate_image", {
        prompt: "调整后的提示词",
        size: "1:1",
        quality: "medium",
        recoveryNodeIds: ["image-failed"],
    });

    assert.ok(execution);
    assert.deepEqual(execution.ops, [
        {
            type: "update_node",
            id: "image-failed",
            attributes: { prompt: "调整后的提示词", size: "1:1", quality: "medium" },
        },
        {
            type: "run_generation",
            nodeId: "image-failed",
            prompt: "调整后的提示词",
            recovery: true,
        },
    ]);
    assert.equal(execution.ops.some((operation) => operation.type === "add_node"), false);
});

test("批量画布操作禁止夹带生成", () => {
    const execution = resolveCanvasAgentTool("canvas_apply_ops", {
        ops: [{ type: "run_generation", nodeId: "image-existing" }],
    });

    assert.ok(execution);
    assert.equal(execution.result.ok, false);
    assert.deepEqual(execution.ops, []);
    assert.match(execution.result.message, /不能执行生成/);
});
