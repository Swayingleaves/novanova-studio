"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { App, Tooltip } from "antd";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { Copy, PanelRightClose, Plus, Square } from "lucide-react";
import { ThinkingBlock } from "@/features/chat";
import type { ThinkingBlockState } from "@/features/chat/types";
import { ModelPicker } from "@/features/settings/components/model-picker";
import type { AiConfig } from "@/features/settings/stores/use-config-store";
import { useCopyText } from "@/shared/hooks/use-copy-text";
import type { CanvasTheme } from "@/shared/lib/canvas-theme";
import type { CanvasAssistantMessage, CanvasAssistantReference, CanvasNode } from "../types";
import type { GenerationStyleOption } from "@/services/api/server";
import { formatGroupedGenerationStyleMessage } from "@/features/generation/lib/style-command";
import { GENERATION_STYLE_SELECTION_LIMIT_MESSAGE, MAX_GENERATION_STYLE_SELECTION_COUNT } from "@/features/generation/lib/generation-style-library";
import { GenerationStyleChips, useGenerationStyles } from "@/features/generation/components/generation-style-picker";
import { isImageNode, isTextNode, isVideoNode } from "../domain/canvas-node";
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
    onSend: (text: string, references?: CanvasAssistantReference[], generationStyleIds?: number[], generationStyles?: GenerationStyleOption[]) => void;
    onNewSession: () => void;
    onStop: () => void;
    isStreaming?: boolean;
    isQueued?: boolean;
    config: AiConfig;
    model: string;
    onModelChange: (model: string) => void;
    onMissingConfig?: () => void;
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
    onMissingConfig,
    initialPrompt = "",
    sessionId = null,
}: CanvasChatPanelProps) {
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
    }, [sessionId]);

    const handleSend = useCallback(
        (text: string) => {
            if (!text.trim()) return;
            const references = droppedNodes.map(nodeToReference).filter((item): item is CanvasAssistantReference => Boolean(item));
            onSend(
                text.trim(),
                references,
                selectedStyles.map((style) => style.id),
                selectedStyles,
            );
            setPrompt("");
            setDroppedNodeIds(new Set());
            setSelectedStyles([]);
        },
        [droppedNodes, onSend, selectedStyles],
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

    // 自动滚动到底部
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [activeThinking, completedThinkings, messages, isQueued, isStreaming]);

    const requestActive = isStreaming || isQueued;

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
                aria-label="调整画布Agent宽度"
                aria-valuemin={MIN_PANEL_WIDTH}
                aria-valuemax={Math.round(getPanelMaximumWidth())}
                aria-valuenow={Math.round(panelWidth)}
                title="拖动调整宽度，双击恢复默认"
            >
                <span
                    className="absolute left-1/2 top-1/2 h-12 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-0 transition-opacity group-hover:opacity-60 group-focus-visible:opacity-80 group-active:opacity-100"
                    style={{ background: theme.node.muted }}
                />
            </button>
            {/* 标题栏 */}
            <div className="flex items-center justify-between px-4 py-3 text-sm font-medium shrink-0" style={{ borderBottom: `1px solid ${theme.toolbar.border}` }}>
                <span>画布Agent</span>
                <div className="flex items-center gap-1">
                    {requestActive ? (
                        <button type="button" className="grid size-7 place-items-center rounded-lg opacity-55 transition hover:opacity-100" onClick={onStop} title={isQueued ? "取消排队" : "停止生成"} aria-label={isQueued ? "取消排队" : "停止生成"}>
                            <Square className="size-3.5" />
                        </button>
                    ) : null}
                    <button
                        type="button"
                        className="grid size-7 place-items-center rounded-lg opacity-55 transition hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-25"
                        onClick={handleNewSession}
                        disabled={requestActive}
                        title="新对话"
                        aria-label="新对话"
                    >
                        <Plus className="size-4" />
                    </button>
                    <button type="button" className="grid size-7 place-items-center rounded-lg opacity-55 transition hover:opacity-100" onClick={onCollapse} title="收起画布Agent" aria-label="收起画布Agent">
                        <PanelRightClose className="size-4" />
                    </button>
                </div>
            </div>

            {/* 消息列表 */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
                <div className="flex flex-col gap-3">
                    {messages.length === 0 ? (
                        <div className="py-12 text-center text-sm" style={{ color: theme.node.placeholder }}>
                            发送消息开始与 AI 对话
                        </div>
                    ) : (
                        messages.map((msg) => (
                            <div key={msg.id} className="space-y-1.5">
                                <ChatBubble role={msg.role as "user" | "assistant"} text={msg.text} theme={theme} onCopy={() => copyText(formatGroupedGenerationStyleMessage(msg.text, msg.generationStyles), "消息已复制")} />
                                {msg.generationStyles?.length ? <GenerationStyleChips styles={msg.generationStyles.map((style) => ({ ...style, coverUrl: "", category: "" }))} /> : null}
                                {msg.references?.length ? <MessageReferences references={msg.references} theme={theme} /> : null}
                            </div>
                        ))
                    )}
                    {[...completedThinkings, ...(activeThinking ? [activeThinking] : [])]
                        .filter((thinking) => thinking.text)
                        .map((thinking) => (
                            <ThinkingBlock
                                key={thinking.id}
                                block={thinking}
                                streaming={activeThinking?.id === thinking.id}
                                appearance={{
                                    text: theme.node.text,
                                    muted: theme.node.muted,
                                    background: theme.toolbar.itemHover,
                                    border: theme.toolbar.border,
                                }}
                            />
                        ))}
                    {requestActive ? (
                        <div className="text-xs" style={{ color: theme.node.muted }}>
                            <span className="inline-block animate-pulse">● {isQueued ? "排队中..." : "生成中..."}</span>
                        </div>
                    ) : null}
                </div>
            </div>

            {/* 输入框 */}
            <div className="shrink-0" style={{ borderTop: `1px solid ${theme.toolbar.border}` }}>
                <AgentChatComposer
                    prompt={prompt}
                    sending={requestActive}
                    placeholder="输入消息，Enter 发送..."
                    theme={theme}
                    onPromptChange={setPrompt}
                    onSubmit={() => handleSend(prompt)}
                    styleOptions={styleCatalog.styles}
                    selectedStyles={selectedStyles}
                    styleLoading={styleCatalog.loading}
                    styleError={styleCatalog.error}
                    onStyleSelect={(style) => setSelectedStyles((current) => (current.some((item) => item.id === style.id) || current.length >= MAX_GENERATION_STYLE_SELECTION_COUNT ? current : [...current, style]))}
                    onStyleRemove={(id) => setSelectedStyles((current) => current.filter((style) => style.id !== id))}
                    onStyleLimit={() => message.warning(GENERATION_STYLE_SELECTION_LIMIT_MESSAGE)}
                    droppedNodes={droppedNodes}
                    onDroppedNodeRemove={(nodeId) => {
                        setDroppedNodeIds((prev) => {
                            const next = new Set(prev);
                            next.delete(nodeId);
                            return next;
                        });
                    }}
                    left={<ModelPicker config={config} value={model} onChange={onModelChange} capability="text" className="h-8 max-w-full" placeholder="选择文本模型" onMissingConfig={onMissingConfig} />}
                />
            </div>
        </div>
    );
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

function AssistantReferenceChip({ item, theme }: { item: CanvasAssistantReference; theme: CanvasTheme }) {
    const text = (item.text || item.title).replace(/\s+/g, " ").trim().slice(0, 1) || "文";
    return (
        <div className="inline-flex h-8 max-w-[150px] shrink-0 items-center gap-1.5 rounded-lg text-sm" style={{ color: theme.node.text }}>
            {item.dataUrl ? (
                <img src={item.dataUrl} alt="" className="size-8 rounded-lg object-cover" />
            ) : (
                <span className="grid size-8 place-items-center rounded-lg border text-sm font-medium" style={{ background: theme.node.panel, borderColor: theme.node.activeStroke }}>
                    {text}
                </span>
            )}
        </div>
    );
}

function nodeToReference(node: CanvasNode): CanvasAssistantReference | null {
    if (isImageNode(node) && node.content.source) {
        return { id: node.id, type: node.kind, title: node.title, dataUrl: node.content.source, storageKey: node.content.storageKey, objectStorage: node.content.objectStorage };
    }
    if (isTextNode(node) && node.content.text) {
        return { id: node.id, type: node.kind, title: node.title, text: node.content.text };
    }
    if (isVideoNode(node) && node.content.source) {
        return { id: node.id, type: node.kind, title: node.title, text: node.generation.prompt || node.title };
    }
    return null;
}

function ChatBubble({ role, text, theme, onCopy }: { role: "user" | "assistant"; text: string; theme: CanvasTheme; onCopy: () => void }) {
    const isUser = role === "user";
    return (
        <div className={`group flex items-start gap-1 ${isUser ? "justify-end" : "justify-start"}`}>
            <div
                className={`max-w-[calc(100%_-_2rem)] cursor-text select-text rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed break-words ${isUser ? "rounded-br-md" : "rounded-bl-md"}`}
                style={{
                    background: isUser ? "#2f80ff" : theme.node.fill,
                    color: isUser ? "#fff" : theme.node.text,
                    border: isUser ? "none" : `1px solid ${theme.node.stroke}`,
                }}
            >
                {isUser ? <span className="whitespace-pre-wrap">{text}</span> : <AssistantMarkdownContent text={text} theme={theme} />}
            </div>
            <Tooltip title="复制消息">
                <button
                    type="button"
                    className={`${isUser ? "order-first" : "order-last"} mt-1 grid size-7 shrink-0 place-items-center rounded-lg opacity-0 pointer-events-none outline-none transition-[color,background-color,opacity] duration-150 group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto focus-visible:opacity-100 focus-visible:ring-2 motion-reduce:transition-none`}
                    style={{ color: theme.node.muted, background: theme.toolbar.panel }}
                    onClick={onCopy}
                    aria-label="复制消息"
                >
                    <Copy className="size-3.5" />
                </button>
            </Tooltip>
        </div>
    );
}

function AssistantMarkdownContent({ text, theme }: { text: string; theme: CanvasTheme }) {
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
                {text}
            </ReactMarkdown>
        </div>
    );
}
