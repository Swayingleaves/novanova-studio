import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { LoaderCircle } from "lucide-react";

import type { AgentActivityState, ChatMessageItem, ThinkingBlockState, ToolCallState } from "@/features/chat/types";

import { buildChatThreadSection } from "./chat-thread-section.ts";

test("buildChatThreadSection 在工具执行中保留状态文案并渲染自定义占位内容", () => {
    const pendingNode = React.createElement("div", { "data-testid": "pending-card" });
    const toolCall: ToolCallState = {
        callId: "call-1",
        name: "generate_image",
        arguments: {},
        status: "executing",
        progress: 0,
    };
    const messages: ChatMessageItem[] = [
        { id: "user-1", role: "user", text: "生成一只黑猫" },
        { id: "tool-1", role: "tool", text: "正在生成图片...", detail: toolCall },
    ];

    const section = buildChatThreadSection(messages, [], null, null, [toolCall], () => null, (call) => {
        assert.equal(call.callId, "call-1");
        return pendingNode;
    });

    assert.ok(section);
    assert.equal(section?.rounds.length, 1);
    assert.equal(section?.rounds[0]?.statusText, "正在生成图片...");
    assert.strictEqual(section?.rounds[0]?.resultContent, pendingNode);
});

test("buildChatThreadSection 未提供自定义占位时保持默认加载图标", () => {
    const toolCall: ToolCallState = {
        callId: "call-2",
        name: "generate_video",
        arguments: {},
        status: "executing",
        progress: 0,
    };
    const messages: ChatMessageItem[] = [
        { id: "user-2", role: "user", text: "生成一段视频" },
        { id: "tool-2", role: "tool", text: "正在生成视频...", detail: toolCall },
    ];

    const section = buildChatThreadSection(messages, [], null, null, [toolCall], () => null);
    const resultContent = section?.rounds[0]?.resultContent as React.ReactElement<{ className?: string }> | null;

    assert.ok(section);
    assert.equal(section?.rounds[0]?.statusText, "正在生成视频...");
    assert.ok(resultContent);
    assert.equal(resultContent?.type, LoaderCircle);
    assert.match(String(resultContent?.props.className || ""), /animate-spin/);
});

test("buildChatThreadSection 将用户素材传递到对话轮次", () => {
    const attachments = [{ id: "image-1", name: "参考图.png", url: "https://example.com/reference.png", type: "image/png" }];
    const messages: ChatMessageItem[] = [{ id: "user-3", role: "user", text: "以参考图生成视频", attachments }];

    const section = buildChatThreadSection(messages, [], null, null, [], () => null);

    assert.ok(section?.rounds[0]?.userAttachments);
});

test("buildChatThreadSection 将 Agent 执行活动归入当前对话轮次", () => {
    const activity: AgentActivityState = {
        id: "plan-plan-1",
        type: "plan-created",
        title: "创建创作计划",
        description: "生成一张小狗图片，共 1 个任务",
        status: "success",
    };
    const messages: ChatMessageItem[] = [
        { id: "user-4", role: "user", text: "生成一张小狗图片" },
        { id: "agent-activity-plan-plan-1", role: "system", text: activity.title, detail: activity },
    ];

    const section = buildChatThreadSection(messages, [], null, null, [], () => null);

    assert.equal(section?.rounds[0]?.id, "user-4");
    assert.deepEqual(section?.rounds[0]?.activities, [activity]);
});

test("buildChatThreadSection 将思考块挂到最新轮次且不影响计划活动", () => {
    const activity: AgentActivityState = {
        id: "plan-plan-2",
        type: "plan-created",
        title: "创建创作计划",
        status: "success",
    };
    const completedThinking: ThinkingBlockState = { id: "reply-1:block-1", text: "第一段推理", durationMs: 18, collapsed: true };
    const activeThinking: ThinkingBlockState = { id: "reply-2:block-1", text: "第二段推理", durationMs: 0, collapsed: false };
    const messages: ChatMessageItem[] = [
        { id: "user-5", role: "user", text: "第一轮" },
        { id: "assistant-5", role: "assistant", text: "第一轮完成" },
        { id: "user-6", role: "user", text: "第二轮" },
        { id: "agent-activity-plan-plan-2", role: "system", text: activity.title, detail: activity },
    ];

    const section = buildChatThreadSection(messages, [completedThinking], activeThinking, null, [], () => null);

    assert.equal(section?.rounds[0]?.thinkings, undefined);
    assert.deepEqual(section?.rounds[1]?.thinkings, [completedThinking, activeThinking]);
    assert.equal(section?.rounds[1]?.activeThinkingId, activeThinking.id);
    assert.deepEqual(section?.rounds[1]?.activities, [activity]);
});

test("buildChatThreadSection 将画布引导动作绑定到助手所在轮次", () => {
    const action = { type: "navigate" as const, label: "去画布操作", href: "/canvas", initialPrompt: "生成三个分镜" };
    const messages: ChatMessageItem[] = [
        { id: "user-6", role: "user", text: action.initialPrompt },
        { id: "assistant-6", role: "assistant", text: "请前往画布操作。", action },
    ];

    const section = buildChatThreadSection(messages, [], null, null, [], () => null);

    assert.deepEqual(section?.rounds[0]?.action, action);
});
