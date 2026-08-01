"use client";

import React from "react";
import { Image } from "antd";
import { LoaderCircle, Palette } from "lucide-react";
import { nanoid } from "nanoid";

import type { AgentAction } from "@/features/canvas/api/agent";
import type { AgentActivityState, ChatAttachment, ChatGenerationStyle, ChatMessageItem, ThinkingBlockState, ToolCallState } from "../../chat/types.ts";
import { isAgentActivityState } from "./agent-activity.ts";
import type { CreationThreadRound, CreationThreadSection } from "./creation-workspace-types.ts";
import { formatGenerationStyleMessage } from "../lib/style-command.ts";

/**
 * 从 Agent 聊天消息构建对话区 section，图片/视频页面共用。
 * 结果渲染由调用方通过 renderResults 回调注入。
 *
 * @param messages       ChatMessageItem[] 聊天消息列表
 * @param thinkings      ThinkingBlockState[] 已完成思考块
 * @param activeThinking ThinkingBlockState | null 当前活跃思考
 * @param streamingText  { messageId, text } | null 流式文本
 * @param toolCalls      ToolCallState[] 工具调用状态（供外部引用，此处仅作为上下文透传）
 * @param renderResults  (data) => ReactNode 结果渲染回调，注入页面自己的 renderResultImages/Videos
 */
export function buildChatThreadSection(
    messages: ChatMessageItem[],
    thinkings: ThinkingBlockState[],
    activeThinking: ThinkingBlockState | null,
    streamingText: { messageId: string; text: string } | null,
    toolCalls: ToolCallState[],
    renderResults: (data: Record<string, unknown>) => React.ReactNode,
    renderPendingToolCall?: (call: ToolCallState) => React.ReactNode,
): CreationThreadSection | null {
    if (!messages.length && !thinkings.length && !activeThinking && !streamingText) return null;
    const allThinkings = (activeThinking ? [...thinkings, activeThinking] : thinkings).filter((thinking) => thinking.text);

    // 将消息配对为 user → tool/assistant round
    const rounds: CreationThreadRound[] = [];
    let currentRoundId = "";
    let currentUserText = "";
    let currentUserStyles: ChatGenerationStyle[] | undefined;
    let currentUserAttachments: React.ReactNode = null;
    let currentResultContent: React.ReactNode = null;
    let currentAssistantText = "";
    let currentStatusText = "";
    let currentActivities: AgentActivityState[] = [];
    let currentAction: AgentAction | undefined;

    for (const msg of messages) {
        if (msg.role === "user") {
            if (currentUserText || currentActivities.length) {
                rounds.push(makeRound(currentRoundId, currentUserText, currentUserStyles, currentUserAttachments, currentActivities, currentStatusText, currentAssistantText, currentResultContent, currentAction));
            }
            currentRoundId = msg.id;
            currentUserText = msg.text;
            currentUserStyles = msg.generationStyles;
            currentUserAttachments = renderUserAttachments(msg.attachments, currentUserStyles);
            currentResultContent = null;
            currentAssistantText = "";
            currentStatusText = "";
            currentActivities = [];
            currentAction = undefined;
        } else if (msg.role === "assistant") {
            currentAssistantText = msg.text;
            currentAction = msg.action;
        } else if (msg.role === "system" && isAgentActivityState(msg.detail)) {
            currentActivities = [...currentActivities.filter((activity) => activity.id !== msg.detail.id), msg.detail];
        } else if (msg.role === "tool") {
            const call = msg.detail as ToolCallState | undefined;
            if (call?.status === "executing") {
                currentStatusText = msg.text;
                currentResultContent = renderPendingToolCall?.(call)
                    ?? React.createElement(LoaderCircle, { key: "loading", className: "size-5 animate-spin text-[var(--studio-muted)]" });
            } else if (call?.status === "failed") {
                currentStatusText = `❌ ${call.resultMessage || "生成失败"}`;
            } else if (call?.status === "canceled") {
                currentStatusText = "已停止生成";
            } else if (call?.status === "success" && call.resultData) {
                const mediaNodes = renderResults(call.resultData);
                if (mediaNodes) {
                    currentStatusText = "✅ 生成完成";
                    currentResultContent = mediaNodes;
                } else {
                    currentStatusText = `✅ ${call.resultMessage || "完成"}`;
                }
            }
        } else if (msg.role === "error") {
            currentStatusText = `❌ ${msg.text}`;
        }
    }
    if (currentUserText || currentActivities.length) {
        rounds.push(makeRound(currentRoundId, currentUserText, currentUserStyles, currentUserAttachments, currentActivities, currentStatusText, currentAssistantText, currentResultContent, currentAction));
    }

    if (streamingText) {
        rounds.push({ id: "loading", userText: "", statusText: "AI 正在输入...", assistantText: streamingText.text, resultContent: null } as CreationThreadRound);
    }

    const latestConversationRound = rounds.findLast((round) => Boolean(round.userText || round.userAttachments));
    if (latestConversationRound && allThinkings.length) {
        latestConversationRound.thinkings = allThinkings;
        latestConversationRound.activeThinkingId = activeThinking?.id;
    }

    return { id: "chat", label: "当前对话", rounds };
}

/** 将助手文本以 Markdown 渲染后与结果内容合并为单条 round */
function makeRound(
    id: string,
    userText: string,
    userStyles: ChatGenerationStyle[] | undefined,
    userAttachments: React.ReactNode,
    activities: AgentActivityState[],
    statusText: string,
    assistantText: string,
    resultContent: React.ReactNode,
    action?: AgentAction,
): CreationThreadRound {
    return {
        id: id || nanoid(),
        userText,
        userCopyText: formatGenerationStyleMessage(userText, userStyles),
        activities,
        statusText,
        assistantText,
        resultContent,
        userAttachments,
        action,
    } as CreationThreadRound;
}

function renderUserAttachments(attachments?: ChatAttachment[], styles?: ChatGenerationStyle[]): React.ReactNode {
    const visibleAttachments = attachments?.filter((attachment) => Boolean(attachment.url.trim())) || [];
    if (!visibleAttachments.length && !styles?.length) {
        return null;
    }
    const imageAttachments = visibleAttachments.filter((attachment) => !attachment.type || attachment.type.startsWith("image/"));
    const videoAttachments = visibleAttachments.filter((attachment) => attachment.type?.startsWith("video/"));

    return React.createElement(
        "div",
        { className: "flex flex-wrap gap-2" },
        styles?.map((style) => React.createElement(
            "span",
            {
                key: `generation-style-${style.id}`,
                className: "inline-flex max-w-52 items-center gap-1.5 rounded-full border border-[var(--studio-primary-line)] bg-[var(--studio-primary-soft)] px-2.5 py-1 text-xs font-medium text-[var(--studio-ink)]",
                title: style.stylePrompt,
            },
            React.createElement(Palette, { className: "size-3.5 shrink-0 text-[var(--studio-action)]" }),
            React.createElement("span", { className: "truncate" }, style.name),
        )),
        React.createElement(
            Image.PreviewGroup,
            null,
            imageAttachments.map((attachment) => React.createElement(Image, {
                key: attachment.id,
                src: attachment.url,
                alt: attachment.name,
                title: attachment.name,
                width: 112,
                height: 112,
                style: { objectFit: "contain" },
                className: "rounded-lg",
            })),
        ),
        videoAttachments.map((attachment) => React.createElement("video", {
            key: attachment.id,
            src: attachment.url,
            className: "size-24 rounded-lg object-contain",
            title: attachment.name,
            muted: true,
            controls: true,
        })),
    );
}
