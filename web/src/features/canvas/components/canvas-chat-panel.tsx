"use client";
import { useTranslation } from "@/features/locale/use-translation";


import { useCallback, useEffect, useRef, useState } from "react";
import { App, Tooltip } from "antd";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { AudioLines, Box, Boxes, Clapperboard, Copy, FileText, Image as ImageIcon, PanelRightClose, Plus, Square, Video } from "lucide-react";
import type { ThinkingBlockState } from "@/features/chat/types";
import { StreamingReplyBubble } from "@/features/generation/components/streaming-reply-bubble";
import { ModelPicker } from "@/features/settings/components/model-picker";
import { CreationSettingsModal } from "@/features/generation/components/creation-settings-modal";
import { ChoiceGroup } from "@/features/generation/components/creation-message-thread";
import { ASK_USER_MODEL_CONFIG, CONTINUE_AFTER_MODEL_CONFIG, MODEL_CONFIG_CONFIRMED_MESSAGE, choicesFromAgentActionTokens, stripAgentActionTokens } from "@/features/skill-market/lib/skill-prompt-actions";
import type { AiConfig } from "@/features/settings/stores/use-config-store";
import { useCopyText } from "@/shared/hooks/use-copy-text";
import type { CanvasTheme } from "@/shared/lib/canvas-theme";
import type { CanvasAssistantChoice, CanvasAssistantMessage, CanvasAssistantReference, CanvasNode } from "../types";
import type { GenerationStyleOption } from "@/services/api/server";
import { formatGroupedGenerationStyleMessage } from "@/features/generation/lib/style-command";
import { MAX_GENERATION_STYLE_SELECTION_COUNT } from "@/features/generation/lib/generation-style-library";
import { GenerationStyleChips, useGenerationStyles } from "@/features/generation/components/generation-style-picker";
import { isImageNode, isTextNode, isVideoNode } from "../domain/canvas-node";
import { buildCanvasAgentMentionMessage, formatCanvasAgentMentionDisplayText, readCanvasAgentMentionNodeIds } from "../utils/canvas-agent-mentions";
import { AgentChatComposer } from "./canvas-agent-chat-ui";
import { useCanvasTheme } from "./canvas-theme-provider";

const DEFAULT_PANEL_WIDTH = 380;
const MIN_PANEL_WIDTH = 320;
const MAX_PANEL_WIDTH = 720;
const MIN_CANVAS_WIDTH = 320;
const KEYBOARD_RESIZE_STEP = 24;

type CanvasChatPanelProps = {
    onCollapse: () => void;
    nodes: CanvasNode[];
    onNodeDropRef?: React.MutableRefObject<((nodeId: string) => void) | null>;
    messages: CanvasAssistantMessage[];
    completedThinkings?: ThinkingBlockState[];
    activeThinking?: ThinkingBlockState | null;
    onSend: (text: string, references?: CanvasAssistantReference[], generationStyleIds?: number[], generationStyles?: GenerationStyleOption[], agentText?: string) => void;
    onNewSession: () => void;
    onStop: () => void;
    isStreaming?: boolean;
    isQueued?: boolean;
    config: AiConfig;
    model: string;
    onModelChange: (model: string) => void;
    onImageModelChange: (model: string) => void;
    onVideoModelChange: (model: string) => void;
    onMissingConfig?: () => void;
    onUploadImage?: () => void;
    onUploadVideo?: () => void;
    initialPrompt?: string;
    sessionId?: string | null;
};

/**
 * 基于 assistant-ui 的画布 AI 对话面板
 * 承载画布内的对话、节点引用和模型选择交互
 */
export function CanvasChatPanel({
    onCollapse,
    nodes,
    onNodeDropRef,
    messages,
    completedThinkings = [],
    activeThinking = null,
    onSend,
    onNewSession,
    onStop,
    isStreaming = false,
    isQueued = false,
    config,
    model,
    onModelChange,
    onImageModelChange,
    onVideoModelChange,
    onMissingConfig,
    onUploadImage,
    onUploadVideo,
    initialPrompt = "",
    sessionId = null,
}: CanvasChatPanelProps) {
    const translate = useTranslation();
    const theme = useCanvasTheme();
    const { message } = App.useApp();
    const copyText = useCopyText();
    const scrollRef = useRef<HTMLDivElement>(null);
    const stopResizeRef = useRef<() => void>(() => undefined);
    const [prompt, setPrompt] = useState("");
    const initialPromptAppliedRef = useRef(false);
    const [droppedNodeIds, setDroppedNodeIds] = useState<Set<string>>(new Set());
    const [selectedStyles, setSelectedStyles] = useState<GenerationStyleOption[]>([]);
    const previousSessionIdRef = useRef(sessionId);
    const styleCatalog = useGenerationStyles();
    const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH);
    const [isResizing, setIsResizing] = useState(false);
    const [modelSettingsOpen, setModelSettingsOpen] = useState(false);
    const [modelSettingsMessageId, setModelSettingsMessageId] = useState<string | null>(null);
    const [modelConfigContinueMessageId, setModelConfigContinueMessageId] = useState<string | null>(null);
    const actionableMessageId = latestUnansweredAssistantId(messages);
    const droppedNodes = nodes.filter((node) => droppedNodeIds.has(node.id));

    useEffect(() => {
        if (initialPromptAppliedRef.current || !initialPrompt) return;
        initialPromptAppliedRef.current = true;
        setPrompt(initialPrompt);
    }, [initialPrompt]);

    useEffect(() => {
        if (previousSessionIdRef.current === sessionId) return;
        previousSessionIdRef.current = sessionId;
        setPrompt("");
        setDroppedNodeIds(new Set());
        setSelectedStyles([]);
        setModelSettingsOpen(false);
        setModelSettingsMessageId(null);
        setModelConfigContinueMessageId(null);
    }, [sessionId]);

    const handleSend = useCallback(
        (text: string) => {
            const agentText = text.trim();
            if (!agentText) return;
            const mentionedNodes = readCanvasAgentMentionNodeIds(agentText, nodes).map((nodeId) => nodes.find((node) => node.id === nodeId)).filter((node): node is CanvasNode => Boolean(node));
            const referenceList = [...droppedNodes, ...mentionedNodes].map(nodeToReference).filter((item): item is CanvasAssistantReference => Boolean(item));
            const references = Array.from(new Map(referenceList.map((reference) => [reference.id, reference])).values());
            setModelConfigContinueMessageId(null);
            onSend(
                formatCanvasAgentMentionDisplayText(agentText, nodes),
                references,
                selectedStyles.map((style) => style.id),
                selectedStyles,
                buildCanvasAgentMentionMessage(agentText, nodes),
            );
            setPrompt("");
            setDroppedNodeIds(new Set());
            setSelectedStyles([]);
        },
        [droppedNodes, nodes, onSend, selectedStyles],
    );

    const handleNewSession = useCallback(() => {
        onNewSession();
        setPrompt("");
        setDroppedNodeIds(new Set());
        setSelectedStyles([]);
    }, [onNewSession]);

    useEffect(() => {
        if (!onNodeDropRef) return;
        onNodeDropRef.current = (nodeId: string) => {
            setDroppedNodeIds((prev) => new Set(prev).add(nodeId));
        };
        return () => {
            onNodeDropRef.current = null;
        };
    }, [onNodeDropRef]);

    const scrollToBottom = useCallback(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, []);

    // 自动滚动到底部
    useEffect(() => {
        scrollToBottom();
    }, [activeThinking, completedThinkings, messages, isQueued, isStreaming, scrollToBottom]);

    const requestActive = isStreaming || isQueued;
    const lastMessage = messages.at(-1);
    const liveReplyMessage = requestActive && lastMessage && lastMessage.role !== "user" ? lastMessage : null;
    const staticMessages = liveReplyMessage ? messages.slice(0, -1) : messages;
    const latestUserMessageId = messages.findLast((item) => item.role === "user")?.id || "live-reply";
    const assistantBubbleBg = `color-mix(in srgb, ${theme.node.text} 6%, ${theme.node.panel})`;
    const liveReplyText = liveReplyMessage
        ? (() => {
              const baseText = liveReplyMessage.role === "assistant" ? stripAgentActionTokens(liveReplyMessage.text) : liveReplyMessage.text;
              return liveReplyMessage.role === "system" && liveReplyMessage.meta && !baseText.includes(liveReplyMessage.meta)
                  ? `${baseText}\n${liveReplyMessage.meta}`
                  : baseText;
          })()
        : "";

    useEffect(() => {
        const handleWindowResize = () => setPanelWidth((current) => clampPanelWidth(current));
        handleWindowResize();
        window.addEventListener("resize", handleWindowResize);
        return () => {
            window.removeEventListener("resize", handleWindowResize);
            stopResizeRef.current();
        };
    }, []);

    const startResize = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
        if (event.button !== 0) return;
        event.preventDefault();
        stopResizeRef.current();
        const previousCursor = document.body.style.cursor;
        const previousUserSelect = document.body.style.userSelect;

        const move = (pointerEvent: PointerEvent) => {
            setPanelWidth(clampPanelWidth(window.innerWidth - pointerEvent.clientX));
        };
        const stop = () => {
            setIsResizing(false);
            document.body.style.cursor = previousCursor;
            document.body.style.userSelect = previousUserSelect;
            document.removeEventListener("pointermove", move);
            document.removeEventListener("pointerup", stop);
            document.removeEventListener("pointercancel", stop);
            stopResizeRef.current = () => undefined;
        };

        setIsResizing(true);
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
        document.addEventListener("pointermove", move);
        document.addEventListener("pointerup", stop);
        document.addEventListener("pointercancel", stop);
        stopResizeRef.current = stop;
    }, []);

    const resizeWithKeyboard = useCallback((event: React.KeyboardEvent<HTMLButtonElement>) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const delta = event.key === "ArrowLeft" ? KEYBOARD_RESIZE_STEP : -KEYBOARD_RESIZE_STEP;
        setPanelWidth((current) => clampPanelWidth(current + delta));
    }, []);

    return (
        <div
            data-agent-panel
            className={`relative flex h-full shrink-0 flex-col ${isResizing ? "select-none" : "transition-[width] duration-150 ease-out motion-reduce:transition-none"}`}
            style={{ width: panelWidth, background: theme.node.panel, borderLeft: `1px solid ${theme.toolbar.border}`, color: theme.node.text }}
        >
            <button
                type="button"
                className="group absolute inset-y-0 left-0 z-40 w-3 -translate-x-1/2 cursor-col-resize touch-none outline-none"
                onPointerDown={startResize}
                onKeyDown={resizeWithKeyboard}
                onDoubleClick={() => setPanelWidth(clampPanelWidth(DEFAULT_PANEL_WIDTH))}
                role="separator"
                aria-orientation="vertical"
                aria-label={translate("canvas.resizeCanvasAgent")}
                aria-valuemin={MIN_PANEL_WIDTH}
                aria-valuemax={Math.round(getPanelMaximumWidth())}
                aria-valuenow={Math.round(panelWidth)}
                title={translate("canvas.dragToResizeDoubleClickToReset")}
            >
                <span
                    className="absolute left-1/2 top-1/2 h-12 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-0 transition-opacity group-hover:opacity-60 group-focus-visible:opacity-80 group-active:opacity-100"
                    style={{ background: theme.node.muted }}
                />
            </button>
            {/* 标题栏 */}
            <div className="flex items-center justify-between px-4 py-3 text-sm font-medium shrink-0" style={{ borderBottom: `1px solid ${theme.toolbar.border}` }}>
                <span>{translate("canvas.canvasAgent")}</span>
                <div className="flex items-center gap-1">
                    {requestActive ? (
                        <button type="button" className="grid size-7 place-items-center rounded-lg opacity-55 transition hover:opacity-100" onClick={onStop} title={isQueued ? translate("canvas.leaveQueue") : translate("canvas.stopGeneration")} aria-label={isQueued ? translate("canvas.leaveQueue") : translate("canvas.stopGeneration")}>
                            <Square className="size-3.5" />
                        </button>
                    ) : null}
                    <button
                        type="button"
                        className="grid size-7 place-items-center rounded-lg opacity-55 transition hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-25"
                        onClick={handleNewSession}
                        disabled={requestActive}
                        title={translate("canvas.newConversation")}
                        aria-label={translate("canvas.newConversation")}
                    >
                        <Plus className="size-4" />
                    </button>
                    <button type="button" className="grid size-7 place-items-center rounded-lg opacity-55 transition hover:opacity-100" onClick={onCollapse} title={translate("canvas.collapseCanvasAgent")} aria-label={translate("canvas.collapseCanvasAgent")}>
                        <PanelRightClose className="size-4" />
                    </button>
                </div>
            </div>

            {/* 消息列表 */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
                <div className="flex flex-col gap-3">
                    {staticMessages.length === 0 && !requestActive ? (
                        <div className="py-12 text-center text-sm" style={{ color: theme.node.placeholder }}>
                            {translate("canvas.sendAMessageToStartChatting")}</div>
                    ) : (
                        staticMessages.map((msg) => {
                            const baseText = msg.role === "assistant" ? stripAgentActionTokens(msg.text) : msg.text;
                            const visibleText = msg.role === "system" && msg.meta && !baseText.includes(msg.meta)
                                ? `${baseText}\n${msg.meta}`
                                : baseText;
                            const choices = msg.id === actionableMessageId ? messageActionChoices(msg, modelConfigContinueMessageId) : [];
                            return (
                                <div key={msg.id} className="space-y-1.5">
                                    {visibleText ? (
                                        <ChatBubble
                                            role={msg.role === "user" ? "user" : "assistant"}
                                            text={visibleText}
                                            references={msg.references}
                                            nodes={nodes}
                                            theme={theme}
                                            assistantBubbleBg={assistantBubbleBg}
                                            onCopy={() => copyText(formatGroupedGenerationStyleMessage(visibleText, msg.generationStyles), translate("canvas.messageCopied"))}
                                        />
                                    ) : null}
                                    {choices.length ? (
                                        <ChoiceGroup
                                            options={choices}
                                            onReply={(value) => handleSend(value)}
                                            onOpenModelSettings={() => {
                                                setModelConfigContinueMessageId(null);
                                                setModelSettingsMessageId(msg.id);
                                                setModelSettingsOpen(true);
                                            }}
                                            onUpload={onUploadImage}
                                            onUploadVideo={onUploadVideo}
                                        />
                                    ) : null}
                                    {msg.generationStyles?.length ? <GenerationStyleChips styles={msg.generationStyles.map((style) => ({ ...style, coverUrl: "", category: "" }))} /> : null}
                                    {msg.references?.length ? <MessageReferences references={msg.references} theme={theme} /> : null}
                                </div>
                            );
                        })
                    )}
                    {requestActive ? (
                        <div key={`live-${latestUserMessageId}`} className="space-y-1.5">
                            <StreamingReplyBubble
                                animated
                                text={liveReplyText}
                                thinking={!liveReplyText}
                                thinkingLabel={translate("chat.thinking")}
                                bubbleBackground={assistantBubbleBg}
                                bubbleTextColor={theme.node.text}
                                onHeightChange={scrollToBottom}
                            />
                        </div>
                    ) : null}
                </div>
            </div>

            {/* 输入框 */}
            <div className="shrink-0" style={{ borderTop: `1px solid ${theme.toolbar.border}` }}>
                <AgentChatComposer
                    prompt={prompt}
                    sending={requestActive}
                    placeholder={translate("canvas.typeAMessageEnterToSend")}
                    theme={theme}
                    onPromptChange={setPrompt}
                    onSubmit={() => handleSend(prompt)}
                    styleOptions={styleCatalog.styles}
                    selectedStyles={selectedStyles}
                    styleLoading={styleCatalog.loading}
                    styleError={styleCatalog.error}
                    onStyleSelect={(style) => setSelectedStyles([style])}
                    onStyleRemove={(id) => setSelectedStyles((current) => current.filter((style) => style.id !== id))}
                    onStyleLimit={() => message.warning(translate("canvas.selectUpToStyles", { value0: MAX_GENERATION_STYLE_SELECTION_COUNT }))}
                    droppedNodes={droppedNodes}
                    nodes={nodes}
                    onDroppedNodeRemove={(nodeId) => {
                        setDroppedNodeIds((prev) => {
                            const next = new Set(prev);
                            next.delete(nodeId);
                            return next;
                        });
                    }}
                    left={<ModelPicker config={config} value={model} onChange={onModelChange} capability="text" className="h-8 max-w-full" placeholder={translate("canvas.selectTextModel")} onMissingConfig={onMissingConfig} />}
                />
            </div>
            <CreationSettingsModal open={modelSettingsOpen} title={translate("canvas.modelSettings")} onClose={() => {
                setModelSettingsOpen(false);
                setModelConfigContinueMessageId(modelSettingsMessageId);
            }}>
                <div className="space-y-4">
                    <div>
                        <label className="mb-1.5 block text-sm font-semibold">{translate("canvas.selectTextModel")}</label>
                        <ModelPicker config={config} value={model} onChange={onModelChange} capability="text" fullWidth placeholder={translate("canvas.selectTextModel")} onMissingConfig={onMissingConfig} />
                    </div>
                    <div>
                        <label className="mb-1.5 block text-sm font-semibold">{translate("canvas.imageModel")}</label>
                        <ModelPicker config={config} value={config.imageModel} onChange={onImageModelChange} capability="image" fullWidth />
                    </div>
                    <div>
                        <label className="mb-1.5 block text-sm font-semibold">{translate("canvas.videoModel")}</label>
                        <ModelPicker config={config} value={config.videoModel} onChange={onVideoModelChange} capability="video" fullWidth />
                    </div>
                </div>
            </CreationSettingsModal>
        </div>
    );
}

function latestUnansweredAssistantId(messages: CanvasAssistantMessage[]): string | null {
    let assistantId: string | null = null;
    for (const message of messages) {
        if (message.role === "user") assistantId = null;
        if (message.role === "assistant") assistantId = message.id;
    }
    return assistantId;
}

function messageActionChoices(message: CanvasAssistantMessage, continueMessageId: string | null): CanvasAssistantChoice[] {
    const structured = message.action?.type === "choice" ? message.action.options || [] : [];
    const choices = structured.length ? structured : choicesFromAgentActionTokens(message.text);
    if (message.id !== continueMessageId) return choices;
    return choices.map((choice) => choice.action === ASK_USER_MODEL_CONFIG
        ? { ...choice, action: CONTINUE_AFTER_MODEL_CONFIG, value: MODEL_CONFIG_CONFIRMED_MESSAGE }
        : choice);
}

function clampPanelWidth(width: number) {
    return Math.min(getPanelMaximumWidth(), Math.max(MIN_PANEL_WIDTH, width));
}

function getPanelMaximumWidth() {
    return typeof window === "undefined" ? MAX_PANEL_WIDTH : Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, window.innerWidth - MIN_CANVAS_WIDTH));
}

function MessageReferences({ references, theme }: { references: CanvasAssistantReference[]; theme: CanvasTheme }) {
    return (
        <div className="flex max-w-[90%] flex-wrap gap-1.5">
            {references.map((item) => (
                <AssistantReferenceChip key={item.id} item={item} theme={theme} />
            ))}
        </div>
    );
}

function ReferenceKindIcon({ kind, className = "size-3.5 shrink-0" }: { kind?: string; className?: string }) {
    const Icon = kind === "image"
        ? ImageIcon
        : kind === "video"
          ? Video
          : kind === "audio"
            ? AudioLines
            : kind === "storyboard"
              ? Clapperboard
              : kind === "directorDesk"
                ? Box
                : kind === "background"
                  ? Boxes
                  : FileText;
    return <Icon className={className} aria-hidden="true" />;
}

function AssistantReferenceChip({ item, theme }: { item: CanvasAssistantReference; theme: CanvasTheme }) {
    const [failedUrl, setFailedUrl] = useState<string | null>(null);
    const showImage = Boolean(item.dataUrl) && item.type === "image" && failedUrl !== item.dataUrl;
    return (
        <div className="inline-flex h-8 max-w-[150px] shrink-0 items-center gap-1.5 rounded-lg text-sm" style={{ color: theme.node.text }} title={item.title}>
            {showImage ? (
                <img src={item.dataUrl} alt="" className="size-8 rounded-lg object-cover" onError={() => setFailedUrl(item.dataUrl || null)} />
            ) : (
                <span className="grid size-8 place-items-center rounded-lg border" style={{ background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.muted }}>
                    <ReferenceKindIcon kind={item.type} className="size-4" />
                </span>
            )}
        </div>
    );
}

function nodeToReference(node: CanvasNode): CanvasAssistantReference {
    if (isImageNode(node)) {
        return { id: node.id, type: node.kind, title: node.title.trim() || "图片", dataUrl: node.content.source || undefined, storageKey: node.content.storageKey, objectStorage: node.content.objectStorage };
    }
    if (isTextNode(node)) {
        return { id: node.id, type: node.kind, title: node.title.trim() || "文本", text: node.content.text };
    }
    if (isVideoNode(node)) {
        return { id: node.id, type: node.kind, title: node.title.trim() || "视频", dataUrl: node.content.source || undefined, text: node.generation.prompt || node.title };
    }
    return { id: node.id, type: node.kind, title: node.title.trim() || node.kind };
}

type MentionVisual = {
    label: string;
    kind: string;
    previewUrl?: string;
};

function inferKindFromMentionLabel(label: string): string {
    if (/图片|图像|设定图|image/i.test(label)) return "image";
    if (/视频|video/i.test(label)) return "video";
    if (/音频|音乐|audio/i.test(label)) return "audio";
    if (/分镜|storyboard/i.test(label)) return "storyboard";
    if (/导演台|director/i.test(label)) return "directorDesk";
    return "text";
}

function escapeMentionRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function InlineMentionChip({ mention }: { mention: MentionVisual }) {
    const [failedUrl, setFailedUrl] = useState<string | null>(null);
    const showPreview = Boolean(mention.previewUrl) && mention.kind === "image" && failedUrl !== mention.previewUrl;
    return (
        <span
            className="mx-0.5 inline-flex items-center gap-1 rounded-md bg-white/20 px-1.5 py-0.5 text-[13px] font-medium leading-5 text-white align-baseline"
            title={mention.label}
        >
            {showPreview ? (
                <img
                    src={mention.previewUrl}
                    alt=""
                    draggable={false}
                    className="size-3.5 shrink-0 rounded-[3px] object-cover"
                    onError={() => setFailedUrl(mention.previewUrl || null)}
                />
            ) : (
                <ReferenceKindIcon kind={mention.kind} className="size-3.5 shrink-0 opacity-90" />
            )}
            <span>{`@${mention.label}`}</span>
        </span>
    );
}

/** 将画布用户消息里的 @节点引用 渲染为带节点类型图标或缩略图的行内芯片。 */
function UserMentionContent({ text, references, nodes }: { text: string; references?: CanvasAssistantReference[]; nodes: CanvasNode[] }) {
    const visualsByLabel = new Map<string, MentionVisual>();
    for (const ref of references || []) {
        const label = ref.title.trim();
        if (label && !visualsByLabel.has(label)) {
            visualsByLabel.set(label, { label, kind: ref.type, previewUrl: ref.dataUrl });
        }
    }
    for (const node of nodes) {
        const label = node.title.trim();
        if (label && !visualsByLabel.has(label)) {
            const previewUrl = isImageNode(node) || isVideoNode(node) ? node.content.source || undefined : undefined;
            visualsByLabel.set(label, { label, kind: node.kind, previewUrl });
        }
    }

    const knownLabels = [...visualsByLabel.keys()].sort((a, b) => b.length - a.length);
    const fallbackLabels = ["图片节点", "视频节点", "文本节点", "音频节点", "分镜脚本", "图片", "图像", "视频", "文本", "音频", "分镜"];
    const allLabels = [...new Set([...knownLabels, ...fallbackLabels])].sort((a, b) => b.length - a.length);
    const pattern = new RegExp(`@(${allLabels.map(escapeMentionRegExp).join("|")})`, "g");

    const parts: React.ReactNode[] = [];
    let cursor = 0;
    for (const match of text.matchAll(pattern)) {
        const index = match.index ?? 0;
        if (index > cursor) {
            parts.push(text.slice(cursor, index));
        }
        const label = match[1];
        const visual = visualsByLabel.get(label) || { label, kind: inferKindFromMentionLabel(label) };
        parts.push(<InlineMentionChip key={`${label}-${index}`} mention={visual} />);
        cursor = index + match[0].length;
    }
    if (!parts.length) {
        return <span className="whitespace-pre-wrap">{text}</span>;
    }
    if (cursor < text.length) {
        parts.push(text.slice(cursor));
    }
    return <span className="whitespace-pre-wrap">{parts}</span>;
}

function ChatBubble({
    role,
    text,
    references,
    nodes,
    theme,
    assistantBubbleBg,
    onCopy,
}: {
    role: "user" | "assistant";
    text: string;
    references?: CanvasAssistantReference[];
    nodes: CanvasNode[];
    theme: CanvasTheme;
    assistantBubbleBg: string;
    onCopy: () => void;
}) {
    const translate = useTranslation();
    const isUser = role === "user";
    return (
        <div className={`group flex items-start gap-1 ${isUser ? "justify-end" : "justify-start"}`}>
            <div
                className={`max-w-[calc(100%_-_2rem)] cursor-text select-text text-sm break-words ${isUser ? "rounded-2xl rounded-br-md px-3.5 py-2.5 leading-relaxed" : "rounded-[20px] px-4 py-2.5 leading-6"}`}
                style={{
                    background: isUser ? "#2f80ff" : assistantBubbleBg,
                    color: isUser ? "#fff" : theme.node.text,
                }}
            >
                {isUser ? <UserMentionContent text={text} references={references} nodes={nodes} /> : <AssistantMarkdownContent text={text} theme={theme} />}
            </div>
            <Tooltip title={translate("canvas.copyMessage")}>
                <button
                    type="button"
                    className={`${isUser ? "order-first" : "order-last"} mt-1 grid size-7 shrink-0 place-items-center rounded-lg opacity-0 pointer-events-none outline-none transition-[color,background-color,opacity] duration-150 group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto focus-visible:opacity-100 focus-visible:ring-2 motion-reduce:transition-none`}
                    style={{ color: theme.node.muted, background: theme.toolbar.panel }}
                    onClick={onCopy}
                    aria-label={translate("canvas.copyMessage")}
                >
                    <Copy className="size-3.5" />
                </button>
            </Tooltip>
        </div>
    );
}

function AssistantMarkdownContent({ text, theme }: { text: string; theme: CanvasTheme }) {
    const markdownText = text.replace(/\r\n/g, "\n").replace(/\n/g, "  \n");
    return (
        <div className="min-w-0 text-left">
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
                components={{
                    a: ({ href, children }) => (
                        <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2" style={{ color: "#2f80ff" }}>
                            {children}
                        </a>
                    ),
                    blockquote: ({ children }) => (
                        <blockquote className="my-2 border-l-4 py-0.5 pl-3" style={{ borderColor: theme.node.muted, color: theme.node.muted }}>
                            {children}
                        </blockquote>
                    ),
                    code: ({ className, children, ...props }) => {
                        const isInline = !className;
                        const language = className?.replace("language-", "") || "";
                        if (isInline) {
                            return (
                                <code className="rounded px-1 py-0.5 text-[12px]" style={{ background: theme.toolbar.panel, color: theme.node.text }} {...props}>
                                    {children}
                                </code>
                            );
                        }
                        return (
                            <div className="my-2 overflow-hidden rounded-lg border text-[12px] leading-5" style={{ borderColor: theme.node.stroke }}>
                                {language ? (
                                    <div className="px-3 py-1 text-[11px]" style={{ background: theme.toolbar.panel, color: theme.node.muted, borderBottom: `1px solid ${theme.node.stroke}` }}>
                                        {language}
                                    </div>
                                ) : null}
                                <pre className="thin-scrollbar overflow-x-auto p-3" style={{ background: theme.toolbar.panel, color: theme.node.text, margin: 0 }}>
                                    <code className={className} {...props}>
                                        {children}
                                    </code>
                                </pre>
                            </div>
                        );
                    },
                    h1: ({ children }) => <h1 className="mb-2 mt-1 text-lg font-semibold">{children}</h1>,
                    h2: ({ children }) => <h2 className="mb-2 mt-1 text-base font-semibold">{children}</h2>,
                    h3: ({ children }) => <h3 className="mb-1.5 mt-1 text-sm font-semibold">{children}</h3>,
                    hr: () => <hr className="my-3" style={{ borderColor: theme.node.stroke }} />,
                    li: ({ children }) => <li className="my-0.5 pl-1">{children}</li>,
                    ol: ({ children }) => <ol className="my-2 list-decimal pl-5">{children}</ol>,
                    p: ({ children }) => <p className="my-1.5 leading-6">{children}</p>,
                    pre: ({ children }) => <>{children}</>,
                    table: ({ children }) => (
                        <div className="thin-scrollbar my-2 overflow-x-auto">
                            <table className="w-full border-collapse text-left text-xs">{children}</table>
                        </div>
                    ),
                    td: ({ children }) => (
                        <td className="border px-2 py-1.5 align-top" style={{ borderColor: theme.node.stroke }}>
                            {children}
                        </td>
                    ),
                    th: ({ children }) => (
                        <th className="border px-2 py-1.5 align-top font-medium" style={{ borderColor: theme.node.stroke, background: theme.toolbar.panel }}>
                            {children}
                        </th>
                    ),
                    ul: ({ children }) => <ul className="my-2 list-disc pl-5">{children}</ul>,
                }}
            >
                {markdownText}
            </ReactMarkdown>
        </div>
    );
}
