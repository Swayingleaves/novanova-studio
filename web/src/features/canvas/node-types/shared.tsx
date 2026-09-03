"use client";

import { Handle, Position } from "@xyflow/react";
import { LoaderCircle, AlertTriangle, TriangleAlert } from "lucide-react";
import { forwardRef, useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type MouseEventHandler, type PointerEvent, type ReactNode, type WheelEvent } from "react";
import { CANVAS_CONNECTION_HANDLE_SIZE } from "../constants";
import type { CanvasNode } from "../types";
import { useNodeActions } from "./node-action-context";
import { useCanvasTheme } from "../components/canvas-theme-provider";

/** 共享加载状态组件 */
export function NodeLoading() {
    const t = useCanvasTheme();
    return (
        <div className="flex h-full w-full items-center justify-center gap-2" style={{ color: t.node.muted }}>
            <LoaderCircle className="size-5 animate-spin" />
            <span className="text-sm">生成中...</span>
        </div>
    );
}

/** 共享错误状态组件 */
export function NodeError({ node, onRetry }: { node: CanvasNode; onRetry?: (node: CanvasNode) => void }) {
    const t = useCanvasTheme();
    return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-3 text-center" style={{ color: t.node.muted }}>
            <AlertTriangle className="size-6 text-red-400" />
            <span className="text-xs text-red-400">{node.execution.errorMessage || "生成失败"}</span>
            {onRetry ? (
                <button type="button" className="mt-1 rounded-full border border-red-400/40 px-3 py-0.5 text-xs text-red-400 transition hover:bg-red-400/10" onClick={() => onRetry(node)}>
                    重试
                </button>
            ) : null}
        </div>
    );
}

/** 媒体节点下载提示：生成结果有时效，超时将无法下载 */
export function MediaDownloadHint() {
    return (
        <div className="group/media-download-hint pointer-events-auto absolute bottom-2 left-2 z-10">
            <span
                role="img"
                tabIndex={0}
                aria-label="请尽快下载生成结果，超时将无法下载"
                className="flex size-6 cursor-help items-center justify-center rounded-full text-amber-300 outline-none transition-colors hover:bg-black/70 focus-visible:bg-black/70 focus-visible:ring-2 focus-visible:ring-amber-300/80 motion-reduce:transition-none"
                style={{ background: "rgba(0,0,0,0.55)" }}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                onWheel={(event) => event.stopPropagation()}
            >
                <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
            </span>
            <span
                role="tooltip"
                aria-hidden="true"
                className="pointer-events-none absolute bottom-full left-0 mb-1.5 w-max max-w-56 -translate-y-1 text-[11px] leading-4 text-white opacity-0 transition-[opacity,transform] duration-150 group-hover/media-download-hint:translate-y-0 group-hover/media-download-hint:opacity-100 group-focus-within/media-download-hint:translate-y-0 group-focus-within/media-download-hint:opacity-100 motion-reduce:transition-none"
                style={{ background: "rgba(0,0,0,0.78)", padding: "5px 8px", borderRadius: 6 }}
            >
                请尽快下载生成结果，超时将无法下载
            </span>
        </div>
    );
}

/** 节点默认最小尺寸 */
export const NODE_MIN_WIDTH = 220;
export const NODE_MIN_HEIGHT = 160;

export const selectionBlue = "#8b5cf6";

type CanvasNodeTitleProps = {
    nodeId: string;
    title: string;
    defaultTitle: string;
    onTitleChange?: (nodeId: string, title: string) => void;
};

/** 画布节点名称，默认常显，悬停后切换为可编辑输入框。 */
export function CanvasNodeTitle({ nodeId, title, defaultTitle, onTitleChange }: CanvasNodeTitleProps) {
    const theme = useCanvasTheme();
    const inputRef = useRef<HTMLInputElement>(null);
    const cancelRef = useRef(false);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(title || defaultTitle);

    useEffect(() => {
        if (!editing) setDraft(title || defaultTitle);
    }, [defaultTitle, editing, title]);

    useEffect(() => {
        if (!editing) cancelRef.current = false;
    }, [editing]);

    useEffect(() => {
        if (!editing) return;
        inputRef.current?.focus();
        inputRef.current?.select();
    }, [editing]);

    const cancel = useCallback(() => {
        cancelRef.current = true;
        setDraft(title || defaultTitle);
        setEditing(false);
    }, [defaultTitle, title]);

    const save = useCallback(() => {
        const nextTitle = draft.trim() || title.trim() || defaultTitle;
        onTitleChange?.(nodeId, nextTitle);
        setDraft(nextTitle);
        setEditing(false);
    }, [defaultTitle, draft, nodeId, onTitleChange, title]);

    const stopCanvasEvent = (event: MouseEvent | PointerEvent | WheelEvent) => {
        event.stopPropagation();
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        event.stopPropagation();
        if (event.key === "Escape") {
            event.preventDefault();
            cancel();
        } else if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            save();
        }
    };

    return (
        <div
            className="nodrag nopan nowheel pointer-events-auto absolute left-0 top-0 z-[65] max-w-[calc(100%-1.5rem)]"
            data-canvas-no-zoom
            style={{ transform: "translateY(calc(-100% - 8px))" }}
            onDoubleClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setEditing(true);
            }}
            onMouseDown={stopCanvasEvent}
            onPointerDown={stopCanvasEvent}
            onWheel={stopCanvasEvent}
        >
            {editing ? (
                <input
                    ref={inputRef}
                    value={draft}
                    aria-label="节点名称"
                    className="nodrag nopan nowheel h-7 w-40 max-w-full rounded-md border px-2 text-xs font-medium outline-none transition-colors focus-visible:ring-2 motion-reduce:transition-none"
                    style={{ background: theme.node.panel, borderColor: theme.node.activeStroke, color: theme.node.text, outlineColor: theme.node.activeStroke }}
                    onChange={(event) => setDraft(event.target.value)}
                    onBlur={() => {
                        if (cancelRef.current) {
                            cancelRef.current = false;
                            return;
                        }
                        save();
                    }}
                    onKeyDown={handleKeyDown}
                    onMouseDown={stopCanvasEvent}
                    onPointerDown={stopCanvasEvent}
                    onWheel={stopCanvasEvent}
                />
            ) : (
                <span className="block max-w-40 cursor-text truncate px-1 py-1 text-xs font-medium" title={`${title || defaultTitle}，双击编辑节点名称`} style={{ color: theme.node.text, textShadow: "0 1px 3px rgba(0,0,0,.55)" }}>
                    {title || defaultTitle}
                </span>
            )}
        </div>
    );
}

const connectionHandlePositions = [Position.Left, Position.Right] as const;
const connectionHandleIds: Record<(typeof connectionHandlePositions)[number], string> = {
    [Position.Left]: "left",
    [Position.Right]: "right",
};

/**
 * 画布节点左右两侧通用连接点。
 * <p>
 * 配合 React Flow 的 Loose 连接模式，每侧都可以发起或接收连线。
 *
 * @return React.ReactElement 节点连接点元素
 */
export function CanvasConnectionHandles() {
    const theme = useCanvasTheme();
    const connectionHandleStyle = {
        width: CANVAS_CONNECTION_HANDLE_SIZE,
        height: CANVAS_CONNECTION_HANDLE_SIZE,
        background: theme.node.panel,
        border: `2px solid ${theme.node.activeStroke}`,
    };

    return (
        <>
            {connectionHandlePositions.map((position) => (
                <Handle key={position} id={connectionHandleIds[position]} type="source" position={position} className="!opacity-0 transition-opacity duration-150 group-hover:!opacity-100 motion-reduce:transition-none" style={connectionHandleStyle} />
            ))}
        </>
    );
}

/**
 * React Flow 节点的 hover 热区，用于恢复页面级节点快捷工具栏。
 */
type NodeHoverSurfaceProps = {
    nodeId: string;
    className?: string;
    style?: CSSProperties;
    onMouseEnter?: MouseEventHandler<HTMLDivElement>;
    onMouseLeave?: MouseEventHandler<HTMLDivElement>;
    onDoubleClick?: MouseEventHandler<HTMLDivElement>;
    children: ReactNode;
};

export const NodeHoverSurface = forwardRef<HTMLDivElement, NodeHoverSurfaceProps>(function NodeHoverSurface({ nodeId, className, style, onMouseEnter, onMouseLeave, onDoubleClick, children }, ref) {
    const actions = useNodeActions();

    return (
        <div
            ref={ref}
            className={`group ${className ?? ""}`}
            style={style}
            onMouseEnter={(event) => {
                actions.onKeepToolbar?.(nodeId);
                onMouseEnter?.(event);
            }}
            onMouseLeave={(event) => {
                actions.onHideToolbar?.();
                onMouseLeave?.(event);
            }}
            onDoubleClick={onDoubleClick}
        >
            {children}
        </div>
    );
});
