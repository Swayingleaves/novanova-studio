import assert from "node:assert/strict";
import test from "node:test";

import { positionCanvasAgentAddNodeOps, resolveCanvasAgentTool } from "./canvas-agent-tools.ts";

test("图片生成工具创建稳定配置节点并立即触发生成", () => {
    const execution = resolveCanvasAgentTool(
        "canvas_generate_image",
        {
            prompt: "小猫在吃鱼",
            size: "9:16",
            quality: "high",
            count: 3,
        },
        () => "fixed-id",
    );

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
    const idleExecution = resolveCanvasAgentTool(
        "canvas_create_generation_flow",
        {
            mode: "image",
            prompt: "静物摄影",
            size: "1:1",
            autoRun: false,
        },
        () => "idle-id",
    );
    const runningExecution = resolveCanvasAgentTool(
        "canvas_create_generation_flow",
        {
            mode: "image",
            prompt: "静物摄影",
            size: "1:1",
            autoRun: true,
        },
        () => "running-id",
    );

    assert.ok(idleExecution);
    assert.equal(idleExecution.ops.length, 1);
    assert.deepEqual(idleExecution.result.data, { nodeId: "image-idle-id", status: "idle" });
    assert.ok(runningExecution);
    assert.equal(runningExecution.ops[1]?.type, "run_generation");
    assert.deepEqual(runningExecution.result.data, { nodeId: "image-running-id", status: "running" });
});

test("自动生成操作携带服务端注入的风格快照", () => {
    const snapshot = { id: 7, name: "电影感", generationType: "image", stylePrompt: "电影感提示词" } as const;
    const execution = resolveCanvasAgentTool(
        "canvas_generate_image",
        {
            prompt: "城市夜景",
            size: "16:9",
            generationStyleSnapshots: [snapshot],
        },
        () => "styled-id",
    );

    assert.ok(execution);
    assert.deepEqual(execution.ops[1], {
        type: "run_generation",
        nodeId: "image-styled-id",
        mode: "image",
        prompt: "城市夜景",
        generationStyleSnapshots: [snapshot],
    });
});

test("视频生成工具保留服务端强制的视频模型和计费参数", () => {
    const execution = resolveCanvasAgentTool(
        "canvas_generate_video",
        {
            prompt: "海边日落延时摄影",
            model: "video-model",
            size: "16:9",
            seconds: "6",
            vquality: "1080p",
            videoGenerationMode: "reference-to-video",
            watermark: true,
        },
        () => "video-id",
    );

    assert.ok(execution);
    assert.deepEqual(execution.ops[0], {
        type: "add_node",
        id: "video-video-id",
        nodeType: "video",
        title: "视频生成",
        x: undefined,
        y: undefined,
        attributes: {
            prompt: "海边日落延时摄影",
            status: "idle",
            model: "video-model",
            size: "16:9",
            seconds: "6",
            vquality: "1080p",
            videoGenerationMode: "reference-to-video",
            watermark: "true",
        },
    });
});

test("通用生成流程缺少明确模式时拒绝执行", () => {
    const execution = resolveCanvasAgentTool(
        "canvas_create_generation_flow",
        {
            prompt: "没有模式",
            autoRun: true,
        },
        () => "unused",
    );

    assert.equal(execution, null);
});

test("立即生图缺少尺寸时不创建节点也不启动任务", () => {
    const execution = resolveCanvasAgentTool(
        "canvas_create_generation_flow",
        {
            mode: "image",
            prompt: "缺少尺寸",
            autoRun: true,
        },
        () => "unused",
    );

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
    assert.deepEqual(execution.ops, [
        {
            type: "run_generation",
            nodeId: "image-existing",
            mode: "image",
            prompt: "重新生成",
        },
    ]);
    assert.deepEqual(execution.result.data, { nodeId: "image-existing", status: "running" });
});

test("已有视频节点生成前覆盖服务端固定设置", () => {
    const execution = resolveCanvasAgentTool("canvas_run_generation", {
        nodeId: "video-existing",
        mode: "video",
        prompt: "重新生成视频",
        model: "video-model",
        size: "16:9",
        seconds: "4",
        vquality: "720p",
        videoGenerationMode: "image-to-video",
    });

    assert.ok(execution);
    assert.deepEqual(execution.ops, [
        {
            type: "update_node",
            id: "video-existing",
            attributes: {
                model: "video-model",
                size: "16:9",
                seconds: "4",
                vquality: "720p",
                videoGenerationMode: "image-to-video",
            },
        },
        {
            type: "run_generation",
            nodeId: "video-existing",
            mode: "video",
            prompt: "重新生成视频",
        },
    ]);
});

test("缺少坐标的生成节点放在当前画布视口中心", () => {
    const execution = resolveCanvasAgentTool(
        "canvas_generate_image",
        {
            prompt: "小猫在吃鱼",
            size: "9:16",
        },
        () => "centered",
    );

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
    assert.equal(
        execution.ops.some((operation) => operation.type === "add_node"),
        false,
    );
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

test("通用 Agent 不允许直接创建分镜节点", () => {
    const execution = resolveCanvasAgentTool("canvas_create_node", { nodeType: "storyboard" });

    assert.ok(execution);
    assert.equal(execution.result.ok, false);
    assert.deepEqual(execution.ops, []);
    assert.match(execution.result.message, /分镜脚本请通过剧本文本节点创建/);
});
