"use client";

import { memo, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { NodeResizer, type Node, type NodeProps } from "@xyflow/react";
import { CheckCircle2, Clapperboard, GripVertical, LoaderCircle, Play, Video, XCircle } from "lucide-react";

import { canComposeVideo, reorderVideoCompositionInputIds } from "../domain/video-composition";
import type { CanvasVideoCompositionNode, CanvasVideoNode } from "../types";
import { useCanvasTheme } from "../components/canvas-theme-provider";
import { useNodeActions } from "./node-action-context";
import { CanvasConnectionHandles, CanvasNodeTitle, NodeHoverSurface } from "./shared";

/** 画布视频合成节点。 */
export const VideoCompositionNode = memo(function VideoCompositionNode({ data, selected }: NodeProps<Node<CanvasVideoCompositionNode>>) {
    const actions = useNodeActions();
    const theme = useCanvasTheme();
    const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
    const [dragOverNodeId, setDragOverNodeId] = useState<string | null>(null);
    const cleanupDragRef = useRef<(() => void) | null>(null);
    const videoById = actions.videoNodesById || new Map<string, CanvasVideoNode>();
    const inputVideos = data.composition.inputVideoNodeIds.map((nodeId) => videoById.get(nodeId)).filter((node): node is CanvasVideoNode => Boolean(node));
    const canCompose = canComposeVideo(data, videoById);
    const isRunning = data.execution.phase === "running";
    const isFailed = data.execution.phase === "failed";
    const borderColor = selected ? theme.node.activeStroke : isFailed ? "#ef4444" : theme.node.stroke;

    useEffect(() => () => cleanupDragRef.current?.(), []);

    const startReorder = (event: ReactPointerEvent<HTMLButtonElement>, nodeId: string) => {
        if (isRunning || !data.composition.inputVideoNodeIds.includes(nodeId)) return;
        event.preventDefault();
        event.stopPropagation();
        cleanupDragRef.current?.();
        setDraggedNodeId(nodeId);
        setDragOverNodeId(nodeId);
        const previousUserSelect = document.body.style.userSelect;
        const previousCursor = document.body.style.cursor;
        document.body.style.userSelect = "none";
        document.body.style.cursor = "grabbing";
        let targetNodeId = nodeId;

        const updateTarget = (clientX: number, clientY: number) => {
            const target = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-video-composition-input-id]");
            const nextNodeId = target?.dataset.videoCompositionInputId;
            if (!nextNodeId || !data.composition.inputVideoNodeIds.includes(nextNodeId)) return;
            targetNodeId = nextNodeId;
            setDragOverNodeId(nextNodeId);
        };
        const finish = () => {
            document.body.style.userSelect = previousUserSelect;
            document.body.style.cursor = previousCursor;
            document.removeEventListener("pointermove", move);
            document.removeEventListener("pointerup", finish);
            document.removeEventListener("pointercancel", finish);
            cleanupDragRef.current = null;
            setDraggedNodeId(null);
            setDragOverNodeId(null);
            const nextIds = reorderVideoCompositionInputIds(data.composition.inputVideoNodeIds, nodeId, targetNodeId);
            if (nextIds !== data.composition.inputVideoNodeIds) actions.onVideoCompositionInputOrderChange?.(data.id, nextIds);
        };
        const move = (pointerEvent: PointerEvent) => updateTarget(pointerEvent.clientX, pointerEvent.clientY);
        document.addEventListener("pointermove", move);
        document.addEventListener("pointerup", finish, { once: true });
        document.addEventListener("pointercancel", finish, { once: true });
        cleanupDragRef.current = finish;
    };

    return (
        <>
            <NodeResizer
                minWidth={320}
                minHeight={300}
                isVisible={selected}
                lineStyle={{ borderColor: theme.node.activeStroke }}
                handleStyle={{ borderColor: theme.node.activeStroke, backgroundColor: theme.node.panel }}
                onResizeEnd={(_, params) => actions.onResize?.(data.id, params.width, params.height, { x: params.x, y: params.y })}
            />
            <NodeHoverSurface
                nodeId={data.id}
                className="relative flex select-none flex-col overflow-visible rounded-2xl border-2"
                style={{ width: "100%", height: "100%", background: theme.node.fill, borderColor, boxShadow: selected ? `0 0 0 1px ${theme.node.activeStroke}55` : undefined }}
            >
                <CanvasNodeTitle nodeId={data.id} title={data.title} defaultTitle="合成视频" onTitleChange={actions.onTitleChange} />
                <div className="flex items-center justify-between gap-3 border-b px-3 py-2.5" style={{ borderColor: theme.node.stroke }}>
                    <span className="inline-flex min-w-0 items-center gap-2 text-sm font-semibold" style={{ color: theme.node.text }}>
                        <Clapperboard className="size-4 shrink-0" style={{ color: theme.node.activeStroke }} />
                        <span className="truncate">合成视频</span>
                    </span>
                    <CompositionStatus node={data} valid={canCompose} />
                </div>

                <div className="thin-scrollbar min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2" data-canvas-no-zoom onPointerDown={(event) => event.stopPropagation()}>
                    {inputVideos.length ? (
                        inputVideos.map((video, index) => (
                            <VideoInputRow
                                key={video.id}
                                video={video}
                                index={index}
                                dragging={draggedNodeId === video.id}
                                dragOver={dragOverNodeId === video.id && draggedNodeId !== video.id}
                                disabled={isRunning}
                                onDragStart={startReorder}
                                onPreview={() => actions.onViewVideo(video)}
                            />
                        ))
                    ) : (
                        <div className="flex h-28 flex-col items-center justify-center gap-2 px-4 text-center text-xs" style={{ color: theme.node.placeholder }}>
                            <Video className="size-5 opacity-50" />
                            <span>从视频节点拖出连线后，视频会按接入顺序显示在这里</span>
                        </div>
                    )}
                </div>

                {isFailed && data.execution.errorMessage ? (
                    <div className="border-t px-3 py-2 text-xs text-red-400" style={{ borderColor: theme.node.stroke }}>
                        {data.execution.errorMessage}
                    </div>
                ) : null}

                <div className="border-t p-2" style={{ borderColor: theme.node.stroke }}>
                    <button
                        type="button"
                        className="nodrag nopan flex h-9 w-full items-center justify-center gap-2 rounded-lg text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-45"
                        style={{ background: theme.node.activeStroke, color: theme.node.panel }}
                        disabled={!canCompose || isRunning}
                        title={isRunning ? "正在合成视频" : canCompose ? "合成视频" : "至少需要2段已完成且已保存的视频"}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                            event.stopPropagation();
                            actions.onComposeVideo?.(data);
                        }}
                    >
                        {isRunning ? <LoaderCircle className="size-4 animate-spin" /> : <Clapperboard className="size-4" />}
                        {isRunning ? `合成中 ${Math.max(0, data.execution.progress || 0)}%` : "合成"}
                    </button>
                </div>
                <CanvasConnectionHandles />
            </NodeHoverSurface>
        </>
    );
});

/** 合成节点中的单个视频输入行。 */
function VideoInputRow({
    video,
    index,
    dragging,
    dragOver,
    disabled,
    onDragStart,
    onPreview,
}: {
    video: CanvasVideoNode;
    index: number;
    dragging: boolean;
    dragOver: boolean;
    disabled: boolean;
    onDragStart: (event: ReactPointerEvent<HTMLButtonElement>, nodeId: string) => void;
    onPreview: () => void;
}) {
    const theme = useCanvasTheme();
    const status = videoStatus(video);
    return (
        <div
            className="nodrag nopan flex min-w-0 items-center gap-2 rounded-lg border p-1.5 transition"
            data-video-composition-input-id={video.id}
            style={{
                borderColor: dragOver ? theme.node.activeStroke : theme.node.stroke,
                background: dragOver ? `${theme.node.activeStroke}14` : theme.node.panel,
                opacity: dragging ? 0.55 : 1,
            }}
        >
            <button
                type="button"
                className="grid size-6 shrink-0 place-items-center rounded text-xs disabled:cursor-not-allowed disabled:opacity-35"
                style={{ color: theme.node.muted }}
                disabled={disabled}
                title={disabled ? "合成中不能调整顺序" : "拖动调整合成顺序"}
                aria-label={`拖动第${index + 1}段视频调整合成顺序`}
                onPointerDown={(event) => onDragStart(event, video.id)}
            >
                <GripVertical className="size-4" />
            </button>
            <button
                type="button"
                className="relative h-10 w-16 shrink-0 overflow-hidden rounded bg-black"
                title="放大查看视频"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                    event.stopPropagation();
                    onPreview();
                }}
            >
                {video.content.source ? <video src={video.content.source} className="pointer-events-none h-full w-full object-cover" muted preload="metadata" playsInline /> : <Video className="absolute inset-0 m-auto size-4 text-white/65" />}
                <Play className="pointer-events-none absolute inset-0 m-auto size-3.5 text-white drop-shadow" />
            </button>
            <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium" style={{ color: theme.node.text }}>
                    {index + 1}. {video.title || "视频"}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[11px]" style={{ color: status.color }}>
                    {status.icon}
                    <span>{status.label}</span>
                    {video.content.durationMilliseconds ? <span style={{ color: theme.node.muted }}>{formatDuration(video.content.durationMilliseconds)}</span> : null}
                </div>
            </div>
        </div>
    );
}

/** 合成节点状态标签。 */
function CompositionStatus({ node, valid }: { node: CanvasVideoCompositionNode; valid: boolean }) {
    const theme = useCanvasTheme();
    if (node.execution.phase === "running")
        return (
            <span className="inline-flex shrink-0 items-center gap-1 text-[11px]" style={{ color: theme.node.activeStroke }}>
                <LoaderCircle className="size-3 animate-spin" />
                处理中
            </span>
        );
    if (node.execution.phase === "failed")
        return (
            <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-red-400">
                <XCircle className="size-3" />
                失败
            </span>
        );
    if (node.execution.phase === "succeeded")
        return (
            <span className="inline-flex shrink-0 items-center gap-1 text-[11px]" style={{ color: theme.node.activeStroke }}>
                <CheckCircle2 className="size-3" />
                已完成
            </span>
        );
    return (
        <span className="text-[11px]" style={{ color: valid ? theme.node.activeStroke : theme.node.muted }}>
            {valid ? "可合成" : "待补齐"}
        </span>
    );
}

/** 视频输入的展示状态。 */
function videoStatus(video: CanvasVideoNode) {
    if (video.execution.phase === "succeeded" && video.content.storageKey) return { label: "已就绪", color: "#16a34a", icon: <CheckCircle2 className="size-3" /> };
    if (video.execution.phase === "running") return { label: "生成中", color: "#2563eb", icon: <LoaderCircle className="size-3 animate-spin" /> };
    if (video.execution.phase === "failed") return { label: "生成失败", color: "#ef4444", icon: <XCircle className="size-3" /> };
    return { label: video.content.storageKey ? "待完成" : "未保存", color: "#6b7280", icon: <Video className="size-3" /> };
}

/** 格式化视频时长。 */
function formatDuration(milliseconds: number): string {
    const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes ? `${minutes}:${String(seconds).padStart(2, "0")}` : `${seconds} 秒`;
}
