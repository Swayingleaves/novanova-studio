import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { LoaderCircle } from "lucide-react";

import type { ChatMessageItem, ToolCallState } from "@/features/chat/types";

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
