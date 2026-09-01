"use client";

import React from "react";
import { Image } from "antd";
import { BookOpenText, LoaderCircle, Palette } from "lucide-react";
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
 * @param renderResults  (data, round, call) => ReactNode 结果渲染回调，注入页面自己的 renderResultImages/Videos；round 携带该轮用户消息上下文，call 携带工具调用信息
 * @param renderPendingToolCall (call) => ReactNode 可选：工具执行中卡片的自定义渲染
 * @param choiceDisabledReasons  Record<string,string> 可选：choice 选项禁用原因，key 为选项 value（如"确认生成"），命中后按钮置灰并提示
 * @param renderChoiceSettings   (roundId) => ReactNode 可选：choice 轮次的内联设置内容（如工作流图片参数卡片），按 user round id 返回内容；返回非空时展示在助手文本与选项按钮之间
 */
export function buildChatThreadSection(
    messages: ChatMessageItem[],
    thinkings: ThinkingBlockState[],
    activeThinking: ThinkingBlockState | null,
    streamingText: { messageId: string; text: string } | null,
    toolCalls: ToolCallState[],
    renderResults: (data: Record<string, unknown>, round: { id: string; userText: string; attachments?: ChatAttachment[] }, call: ToolCallState) => React.ReactNode,
    renderPendingToolCall?: (call: ToolCallState) => React.ReactNode,
    choiceDisabledReasons?: Record<string, string>,
    renderChoiceSettings?: (roundId: string) => React.ReactNode,
): CreationThreadSection | null {
    if (!messages.length && !thinkings.length && !activeThinking && !streamingText) return null;
    const allThinkings = (activeThinking ? [...thinkings, activeThinking] : thinkings).filter((thinking) => thinking.text);

    // 将消息配对为 user → tool/assistant round
    const rounds: CreationThreadRound[] = [];
    let currentRoundId = "";
    let currentUserText = "";
    let currentUserStyles: ChatGenerationStyle[] | undefined;
    let currentUserAttachments: React.ReactNode = null;
    let currentRawAttachments: ChatAttachment[] | undefined;
    // 同轮多个工具结果（如首帧+尾帧并行生成）按消息ID累积，避免后一个结果覆盖前一个。
    let currentResultByCallId = new Map<string, React.ReactNode>();
    let currentAssistantText = "";
    let currentStatusText = "";
    let currentActivities: AgentActivityState[] = [];
    let currentAction: AgentAction | undefined;

    /** 当前 round 是否为待用户确认的 choice 轮：草案确认轮（含"确认生成"选项）或图片确认轮（含"用这些图片生成视频"选项）。
     *  两类轮次都可能在选项上方内联渲染设置卡片（图片参数 / 视频参数）。 */
    const isChoiceConfirmRound = (action?: AgentAction) => Boolean(action?.type === "choice"
        && action.options?.some((option) => option.value === "确认生成" || option.value === "用这些图片生成视频"));

    /** 将同轮累积的工具结果渲染为统一结果区，多结果并排展示。 */
    const buildResultContent = () => {
        const nodes = Array.from(currentResultByCallId.values());
        if (!nodes.length) return null;
        if (nodes.length === 1) return nodes[0];
        const compactMediaResults = nodes.every((node) => React.isValidElement<{ "data-result-layout"?: string }>(node) && node.props["data-result-layout"] === "compact");
        return React.createElement("div", { key: "combined-results", className: compactMediaResults ? "flex flex-wrap gap-3" : "grid gap-3 xl:grid-cols-2" }, ...nodes);
    };

    for (const msg of messages) {
        if (msg.role === "user") {
            if (currentUserText || currentActivities.length) {
                rounds.push(makeRound(currentRoundId, currentUserText, currentUserStyles, currentUserAttachments, currentActivities, currentStatusText, currentAssistantText, buildResultContent(), currentAction, choiceDisabledReasons, isChoiceConfirmRound(currentAction) ? renderChoiceSettings?.(currentRoundId) : null));
            }
            currentRoundId = msg.id;
            currentUserText = msg.text;
            currentUserStyles = msg.generationStyles;
            currentUserAttachments = renderUserAttachments(msg.attachments, msg.generationStyles, msg.skill);
            currentRawAttachments = msg.attachments;
            currentResultByCallId = new Map();
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
                currentResultByCallId.set(msg.id, renderPendingToolCall?.(call)
                    ?? React.createElement(LoaderCircle, { key: `loading-${msg.id}`, className: "size-5 animate-spin text-[var(--studio-muted)]" }));
            } else if (call?.status === "failed") {
                currentStatusText = `❌ ${call.resultMessage || "生成失败"}`;
            } else if (call?.status === "canceled") {
                currentStatusText = "已停止生成";
            } else if (call?.status === "success" && call.resultData) {
                const mediaNodes = renderResults(call.resultData, { id: currentRoundId, userText: currentUserText, attachments: currentRawAttachments }, call);
                if (mediaNodes) {
                    currentStatusText = "✅ 生成完成";
                    currentResultByCallId.set(msg.id, mediaNodes);
                } else {
                    currentStatusText = `✅ ${call.resultMessage || "完成"}`;
                }
            }
        } else if (msg.role === "error") {
            currentStatusText = `❌ ${msg.text}`;
        }
    }
    if (currentUserText || currentActivities.length) {
        rounds.push(makeRound(currentRoundId, currentUserText, currentUserStyles, currentUserAttachments, currentActivities, currentStatusText, currentAssistantText, buildResultContent(), currentAction, choiceDisabledReasons, isChoiceConfirmRound(currentAction) ? renderChoiceSettings?.(currentRoundId) : null));
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
    choiceDisabledReasons?: Record<string, string>,
    choiceSettingsContent?: React.ReactNode,
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
        ...(choiceDisabledReasons && Object.keys(choiceDisabledReasons).length ? { choiceDisabledReasons } : {}),
        ...(choiceSettingsContent != null ? { choiceSettingsContent } : {}),
    } as CreationThreadRound;
}

function renderUserAttachments(attachments?: ChatAttachment[], styles?: ChatGenerationStyle[], skill?: { id: number; name: string; targetType: string } | null): React.ReactNode {
    const visibleAttachments = attachments?.filter((attachment) => Boolean(attachment.url.trim())) || [];
    if (!visibleAttachments.length && !styles?.length && !skill) {
        return null;
    }
    const imageAttachments = visibleAttachments.filter((attachment) => !attachment.type || attachment.type.startsWith("image/"));
    const videoAttachments = visibleAttachments.filter((attachment) => attachment.type?.startsWith("video/"));

    return React.createElement(
        "div",
        { className: "flex flex-wrap gap-2" },
        skill ? React.createElement(
            "span",
            {
                key: `chat-skill-${skill.id}`,
                className: "inline-flex max-w-52 items-center gap-1.5 rounded-full border border-[var(--studio-primary-line)] bg-[var(--studio-primary-soft)] px-2.5 py-1 text-xs font-medium text-[var(--studio-ink)]",
                title: `技能：${skill.name}`,
            },
            React.createElement(BookOpenText, { className: "size-3.5 shrink-0 text-[var(--studio-action)]" }),
            React.createElement("span", { className: "truncate" }, skill.name),
        ) : null,
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
