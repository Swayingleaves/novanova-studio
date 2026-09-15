"use client";

import { memo, useState, useRef, useEffect, useCallback, type MouseEvent as ReactMouseEvent } from "react";
import { NodeResizer, type NodeProps, type Node } from "@xyflow/react";
import type { CanvasTextNode } from "../types";
import { useNodeActions } from "./node-action-context";
import { CanvasConnectionHandles, CanvasNodeTitle, NodeError, NodeHoverSurface, NodeLoading } from "./shared";
import { useCanvasTheme } from "../components/canvas-theme-provider";

export const TextNode = memo(function TextNode({ data, selected }: NodeProps<Node<CanvasTextNode>>) {
    const actions = useNodeActions();
    const theme = useCanvasTheme();
    const [editing, setEditing] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const pointerDownRef = useRef<{ x: number; y: number } | null>(null);
    const fontSize = data.content.fontSize;
    const borderColor = selected ? theme.node.activeStroke : theme.node.stroke;
    const [localContent, setLocalContent] = useState(data.content.text);
    // 生成中且还没有内容时显示加载态（文本增量会陆续写入，有内容后直接展示进度文本）
    const isLoading = data.execution.phase === "running" && !localContent;
    // 生成失败且没有内容时展示失败原因，避免留下一个看不出状态的空白节点
    const showsError = data.execution.phase === "failed" && !localContent;

    // Sync external content changes (when not editing)
    useEffect(() => {
        if (!editing) setLocalContent(data.content.text);
    }, [data.content.text, editing]);

    // 点击节点正文直接进入编辑：正文只在节点内修改，不与下方 AI 对话框同步
    const handleContentClick = useCallback(
        (event: ReactMouseEvent<HTMLDivElement>) => {
            const origin = pointerDownRef.current;
            pointerDownRef.current = null;
            // 拖动节点结束后浏览器仍会派发 click，按位移阈值排除，避免拖拽后误进入编辑
            if (origin && (Math.abs(event.clientX - origin.x) > 4 || Math.abs(event.clientY - origin.y) > 4)) return;
            event.preventDefault();
            event.stopPropagation();
            actions.onEditText(data);
            setEditing(true);
        },
        [actions, data],
    );

    useEffect(() => {
        if (editing) {
            const ta = textareaRef.current;
            ta?.focus();
            ta?.setSelectionRange(ta.value.length, ta.value.length);
        }
    }, [editing]);

    useEffect(() => {
        if (!actions.textEditRequestVersion || actions.textEditingNodeId !== data.id) return;
        setEditing(true);
    }, [actions.textEditingNodeId, actions.textEditRequestVersion, data.id]);

    // Click outside to stop editing
    useEffect(() => {
        if (!editing) return;
        const handlePointerDown = (e: PointerEvent) => {
            if (e.target instanceof Node && textareaRef.current?.contains(e.target)) return;
            setEditing(false);
        };
        window.addEventListener("pointerdown", handlePointerDown, true);
        return () => window.removeEventListener("pointerdown", handlePointerDown, true);
    }, [editing]);

    const textStyle = {
        fontSize: `${fontSize}px`,
        lineHeight: `${Math.round(fontSize * 1.65)}px`,
        color: theme.node.text,
    };

    return (
        <>
            <NodeResizer
                minWidth={220}
                minHeight={80}
                isVisible={selected}
                lineStyle={{ borderColor: theme.node.activeStroke }}
                handleStyle={{ borderColor: theme.node.activeStroke, backgroundColor: theme.node.panel }}
                onResizeEnd={(_, params) => {
                    actions.onResize?.(data.id, params.width, params.height, { x: params.x, y: params.y });
                }}
            />
            <NodeHoverSurface
                nodeId={data.id}
                className="relative flex select-none flex-col rounded-3xl border-2"
                style={{
                    width: "100%",
                    height: "100%",
                    background: theme.node.panel,
                    borderColor,
                    boxShadow: selected ? `0 0 0 1px ${theme.node.activeStroke}55` : undefined,
                }}
            >
                <CanvasNodeTitle nodeId={data.id} title={data.title} defaultTitle="文本" onTitleChange={actions.onTitleChange} />
                {editing ? (
                    <textarea
                        ref={textareaRef}
                        className="nodrag nopan nowheel h-full w-full resize-none overflow-y-auto whitespace-pre-wrap break-words border-none bg-transparent p-4 outline-none"
                        style={textStyle}
                        value={localContent}
                        onChange={(e) => {
                            const nextContent = e.target.value;
                            setLocalContent(nextContent);
                            actions.onContentChange?.(data.id, nextContent);
                        }}
                        onBlur={() => setEditing(false)}
                        onKeyDown={(e) => {
                            if (e.key === "Escape") setEditing(false);
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
                    />
                ) : (
                    <div
                        className="flex h-full min-h-0 w-full flex-col overflow-hidden"
                        onPointerDown={(e) => {
                            pointerDownRef.current = { x: e.clientX, y: e.clientY };
                        }}
                        // 生成中不进入编辑态：否则内容回填会因编辑态被跳过，节点又会显示为空
                        onClick={isLoading ? undefined : handleContentClick}
                        onWheel={(e) => e.stopPropagation()}
                    >
                        {isLoading ? (
                            <NodeLoading />
                        ) : showsError ? (
                            <NodeError node={data} />
                        ) : (
                            <div className="h-full w-full cursor-text overflow-y-auto whitespace-pre-wrap break-words p-4" style={textStyle}>
                                {localContent || <span style={{ color: theme.node.placeholder }}>点击编辑文字</span>}
                            </div>
                        )}
                    </div>
                )}
                <CanvasConnectionHandles />
            </NodeHoverSurface>
        </>
    );
});
