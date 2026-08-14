import assert from "node:assert/strict";
import test from "node:test";

import type { AgentActivityState, ToolCallState } from "@/features/chat/types";

import { createToolExecutionActivity, finishRoundAgentActivities, finishRunningAgentActivities, getPlanTaskActivityStatus, mergePlanTaskActivityMessage, normalizeAgentActivities, normalizeHistoricalAgentActivities, updateAgentActivityMessage, upsertAgentActivityMessage } from "./agent-activity.ts";

test("upsertAgentActivityMessage 对重复 SSE 活动执行幂等覆盖", () => {
    const firstActivity = {
        id: "task-plan-1-task-1",
        type: "plan-task-status" as const,
        title: "执行创作任务",
        description: "子Agent正在准备任务",
        status: "running" as const,
    };
    const firstMessages = upsertAgentActivityMessage([], firstActivity);
    const nextMessages = upsertAgentActivityMessage(firstMessages, { ...firstActivity, description: "任务执行中" });
    const activity = nextMessages[0]?.detail as AgentActivityState;

    assert.equal(nextMessages.length, 1);
    assert.equal(activity.description, "任务执行中");
});

test("updateAgentActivityMessage 更新工具进度和完成状态", () => {
    const call: ToolCallState = {
        callId: "task-1",
        name: "generate_image",
        arguments: { size: "3:4", resolution: "1K", quality: "medium", count: 1 },
        status: "executing",
        progress: 0,
    };
    const messages = upsertAgentActivityMessage([], createToolExecutionActivity(call));
    const nextMessages = updateAgentActivityMessage(messages, "tool-task-1", { status: "success", progress: 100 });
    const activity = nextMessages[0]?.detail as AgentActivityState;

    assert.equal(activity.description, "3:4 / 1K / 标准质量 / 1 个结果");
    assert.equal(activity.status, "success");
    assert.equal(activity.progress, 100);
});

test("finishRunningAgentActivities 在 SSE 异常时结束所有运行中活动", () => {
    const planMessages = upsertAgentActivityMessage([], {
        id: "task-plan-2-task-2",
        type: "plan-task-status",
        title: "执行创作任务",
        status: "running",
    });
    const toolMessages = upsertAgentActivityMessage(planMessages, {
        id: "tool-task-2",
        type: "tool-execute",
        title: "调用视频生成工具",
        status: "running",
    });
    const nextMessages = finishRunningAgentActivities(toolMessages, "failed", "生成连接已关闭");

    for (const message of nextMessages) {
        const activity = message.detail as AgentActivityState;
        assert.equal(activity.status, "failed");
        assert.equal(activity.description, "生成连接已关闭");
    }
});

test("恢复诊断状态继续显示为运行中活动", () => {
    assert.equal(getPlanTaskActivityStatus("diagnosing"), "running");
    assert.equal(getPlanTaskActivityStatus("adjusting"), "running");
    assert.equal(getPlanTaskActivityStatus("retrying"), "running");
});

test("normalizeAgentActivities 忽略历史记录中的非法活动", () => {
    const activity: AgentActivityState = {
        id: "tool-task-4",
        type: "tool-execute",
        title: "调用视频生成工具",
        status: "success",
    };

    assert.deepEqual(normalizeAgentActivities([
        activity,
        null,
        { id: "missing-fields" },
        { ...activity, type: "unknown" },
        { ...activity, status: "unknown" },
    ]), [activity]);
});

test("mergePlanTaskActivityMessage 失败终态不被后到的诊断状态回退覆盖", () => {
    const messages = mergePlanTaskActivityMessage([], "plan-1", "task-1", "running", "子Agent正在准备任务");
    const failedMessages = mergePlanTaskActivityMessage(messages, "plan-1", "task-1", "failed", "任务执行失败");
    const diagnosingMessages = mergePlanTaskActivityMessage(failedMessages, "plan-1", "task-1", "diagnosing", "主Agent正在诊断失败原因");
    const activity = diagnosingMessages[0]?.detail as AgentActivityState;

    assert.equal(activity.status, "failed");
    assert.equal(activity.description, "任务执行失败");
});

test("mergePlanTaskActivityMessage 成功终态不被后到的重试状态回退覆盖", () => {
    const messages = mergePlanTaskActivityMessage([], "plan-2", "task-2", "success", "生成完成");
    const retryingMessages = mergePlanTaskActivityMessage(messages, "plan-2", "task-2", "retrying", "正在执行唯一一次恢复重试");
    const activity = retryingMessages[0]?.detail as AgentActivityState;

    assert.equal(activity.status, "success");
});

test("mergePlanTaskActivityMessage 未知状态不更新消息", () => {
    const messages = mergePlanTaskActivityMessage([], "plan-3", "task-3", "unknown", "未知状态");
    assert.equal(messages.length, 0);
});

test("finishRoundAgentActivities 在工具失败后收尾残留的运行中计划步骤", () => {
    const runningMessages = upsertAgentActivityMessage([], {
        id: "task-plan-4-task-4",
        type: "plan-task-status",
        title: "执行创作任务",
        description: "子Agent正在准备任务",
        status: "running",
    });
    const failedMessages = upsertAgentActivityMessage(runningMessages, {
        id: "tool-task-4",
        type: "tool-execute",
        title: "调用视频生成工具",
        description: "16:9 / 720p / 标准质量 / 5 秒",
        status: "failed",
    });

    const finalizedMessages = finishRoundAgentActivities(failedMessages, "这轮视频生成失败了");
    const activity = finalizedMessages[0]?.detail as AgentActivityState;

    assert.equal(activity.status, "failed");
    assert.equal(activity.description, "这轮视频生成失败了");
});

test("normalizeHistoricalAgentActivities 根据轮次终态收尾旧的运行中活动", () => {
    const activities = normalizeHistoricalAgentActivities([{
        id: "task-plan-5-task-5",
        type: "plan-task-status",
        title: "执行创作任务",
        status: "running",
    }], "failed");

    assert.equal(activities[0]?.status, "failed");
});
