"use client";

import { memo, useLayoutEffect, useRef, useState } from "react";
import { NodeResizer, useUpdateNodeInternals, type NodeProps, type Node } from "@xyflow/react";
import { AlertTriangle, ChevronRight, Image as ImageIcon, Images, LoaderCircle, Sparkles } from "lucide-react";
import type { CanvasImageNode } from "../types";
import { type BatchImagePreview, useNodeActions } from "./node-action-context";
import { CanvasConnectionHandles, CanvasNodeTitle, MediaDownloadHint, NodeHoverSurface } from "./shared";
import { useCanvasTheme } from "../components/canvas-theme-provider";

const BATCH_COLLAPSE_TRANSITION_MS = 260;

export const ImageNode = memo(function ImageNode({ data, selected }: NodeProps<Node<CanvasImageNode>>) {
    const actions = useNodeActions();
    const theme = useCanvasTheme();
    const updateNodeInternals = useUpdateNodeInternals();
    const hasContent = Boolean(data.content.source);
    const isLoading = data.execution.phase === "running";
    const isError = data.execution.phase === "failed";
    const borderColor = selected ? theme.node.activeStroke : isError ? "#ef4444" : theme.node.stroke;
    const batchRootId = data.grouping.rootId;
    const batchAnimationPhase = batchRootId && (actions.batchOpeningRootIds?.has(batchRootId) ? "opening" : actions.batchCollapsingRootIds?.has(batchRootId) ? "collapsing" : null);
    const batchCardStackTransform = actions.batchCardStackTransformsByNodeId?.get(data.id) || "scale(0.94)";
    const isBatchTransitioning = data.grouping.isRoot && (actions.batchOpeningRootIds?.has(data.id) || actions.batchCollapsingRootIds?.has(data.id));
    const batchSurfaceRef = useRef<HTMLDivElement>(null);
    const previousBatchExpandedRef = useRef(data.grouping.expanded);
    const [showCollapsedBatchStack, setShowCollapsedBatchStack] = useState(() => !data.grouping.expanded);

    useLayoutEffect(() => {
        const wasExpanded = previousBatchExpandedRef.current;
        previousBatchExpandedRef.current = data.grouping.expanded;
        if (data.grouping.expanded || !wasExpanded) {
            setShowCollapsedBatchStack(!data.grouping.expanded);
            return;
        }

        const prefersReducedMotion = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (prefersReducedMotion) {
            setShowCollapsedBatchStack(true);
            return;
        }

        setShowCollapsedBatchStack(false);
        const timeoutId = window.setTimeout(() => setShowCollapsedBatchStack(true), BATCH_COLLAPSE_TRANSITION_MS);
        return () => window.clearTimeout(timeoutId);
    }, [data.grouping.expanded]);

    useLayoutEffect(() => {
        const surface = batchSurfaceRef.current;
        const prefersReducedMotion = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (!surface || !batchAnimationPhase) return;
        if (prefersReducedMotion) {
            updateNodeInternals(data.id);
            return;
        }
        const animation = surface.animate(
            batchAnimationPhase === "opening"
                ? [
                      { opacity: 0, transform: batchCardStackTransform },
                      { opacity: 1, transform: "scale(1)" },
                  ]
                : [
                      { opacity: 1, transform: "scale(1)" },
                      { opacity: 0, transform: batchCardStackTransform },
                  ],
            {
                duration: batchAnimationPhase === "opening" ? 260 : 220,
                easing: "cubic-bezier(0.22, 1, 0.36, 1)",
                fill: "both",
            },
        );
        // 固定结束帧，避免隐藏节点前取消动画导致样式短暂回到首帧。
        void animation.finished
            .then(() => {
                animation.commitStyles();
                animation.cancel();
                updateNodeInternals(data.id);
            })
            .catch(() => undefined);
        return () => animation.cancel();
    }, [batchAnimationPhase, batchCardStackTransform, data.id, updateNodeInternals]);

    if (data.grouping.isRoot) {
        const totalCount = Math.max(1, data.generation.count);
        const progress = Math.max(0, Math.min(100, data.execution.progress || 0));
        const completedCount = Math.min(totalCount, Math.round((progress / 100) * totalCount));
        const batchImagePreviews = actions.batchImagePreviewsByRootId?.get(data.id) || [];
        const statusText = isError ? data.execution.errorMessage || "生成失败" : data.execution.phase === "succeeded" ? `已完成 ${totalCount}/${totalCount}` : `生成中 ${completedCount}/${totalCount}`;

        return (
            <>
                <NodeResizer
                    minWidth={280}
                    minHeight={180}
                    keepAspectRatio={false}
                    isVisible={selected}
                    lineStyle={{ borderColor: theme.node.activeStroke }}
                    handleStyle={{ borderColor: theme.node.activeStroke, backgroundColor: theme.node.panel }}
                    onResizeEnd={(_, params) => {
                        actions.onResize?.(data.id, params.width, params.height, { x: params.x, y: params.y });
                    }}
                />
                <NodeHoverSurface
                    nodeId={data.id}
                    className="relative flex select-none flex-col overflow-visible rounded-2xl border"
                    style={{
                        width: "100%",
                        height: "100%",
                        background: theme.node.panel,
                        borderColor,
                        boxShadow: selected ? `0 0 0 1px ${theme.node.activeStroke}55` : undefined,
                    }}
                >
                    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[inherit] p-4">
                        <CanvasNodeTitle nodeId={data.id} title={data.title} defaultTitle="图像" onTitleChange={actions.onTitleChange} />
                        <div className="flex items-center justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-2.5">
                                <span className="grid size-8 shrink-0 place-items-center rounded-lg" style={{ background: theme.node.fill, color: theme.node.activeStroke }}>
                                    <Sparkles className="size-4" />
                                </span>
                                <div className="min-w-0">
                                    <div className="truncate text-sm font-semibold" style={{ color: theme.node.text }}>
                                        图片生成
                                    </div>
                                    <div className="mt-0.5 flex items-center gap-1.5 text-[11px]" style={{ color: theme.node.muted }}>
                                        <Images className="size-3" />
                                        {totalCount} 张结果
                                    </div>
                                </div>
                            </div>
                            <span className="max-w-[130px] truncate text-[11px] font-medium" style={{ color: isError ? "#ef4444" : theme.node.muted }} title={statusText}>
                                {statusText}
                            </span>
                        </div>

                        <p className="mt-3 line-clamp-3 min-h-0 flex-1 text-xs leading-5" style={{ color: data.generation.prompt ? theme.node.text : theme.node.placeholder }}>
                            {data.generation.prompt || "等待输入图片生成提示词"}
                        </p>

                        <div className="mt-3 grid grid-cols-[44px_minmax(0,1fr)] gap-x-3 gap-y-1.5 border-t pt-3 text-[11px]" style={{ borderColor: theme.node.stroke }}>
                            <span style={{ color: theme.node.muted }}>模型</span>
                            <span className="truncate text-right" style={{ color: theme.node.text }}>
                                {data.generation.model || "未配置"}
                            </span>
                            <span style={{ color: theme.node.muted }}>尺寸</span>
                            <span className="text-right" style={{ color: theme.node.text }}>
                                {data.generation.size || "自动"}
                            </span>
                        </div>

                        <div className="mt-3 h-1 overflow-hidden rounded-full" style={{ background: theme.node.fill }} role="progressbar" aria-label="图片生成进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
                            <div className="h-full rounded-full transition-[width] duration-200" style={{ width: `${progress}%`, background: isError ? "#ef4444" : theme.node.activeStroke }} />
                        </div>
                    </div>
                    {data.grouping.childIds.length ? (
                        <button
                            type="button"
                            className="nodrag nopan absolute right-0 top-1/2 z-20 grid size-8 translate-x-[calc(100%+16px)] -translate-y-1/2 place-items-center rounded-lg border transition-colors disabled:cursor-default disabled:opacity-60"
                            style={{ color: theme.node.muted, background: theme.node.panel, borderColor: theme.node.stroke }}
                            disabled={isBatchTransitioning}
                            aria-label={data.grouping.expanded ? "折叠生成结果" : "展开生成结果"}
                            aria-expanded={data.grouping.expanded}
                            title={data.grouping.expanded ? "折叠生成结果" : "展开生成结果"}
                            onPointerDown={(event) => event.stopPropagation()}
                            onMouseDown={(event) => event.stopPropagation()}
                            onMouseEnter={(event) => {
                                event.currentTarget.style.background = theme.node.fill;
                                event.currentTarget.style.color = theme.node.text;
                            }}
                            onMouseLeave={(event) => {
                                event.currentTarget.style.background = theme.node.panel;
                                event.currentTarget.style.color = theme.node.muted;
                            }}
                            onClick={(event) => {
                                event.stopPropagation();
                                actions.onToggleBatch?.(data.id);
                            }}
                        >
                            <ChevronRight className={`size-4 transition-transform duration-200 motion-reduce:transition-none ${data.grouping.expanded ? "rotate-180" : ""}`} />
                        </button>
                    ) : null}
                    <CanvasConnectionHandles />
                    {!data.grouping.expanded && showCollapsedBatchStack && !isBatchTransitioning ? <CollapsedBatchImageStack previews={batchImagePreviews} theme={theme} /> : null}
                </NodeHoverSurface>
            </>
        );
    }

    return (
        <>
            <NodeResizer
                minWidth={220}
                minHeight={160}
                keepAspectRatio={!data.frame.freeResize}
                isVisible={selected}
                lineStyle={{ borderColor: theme.node.activeStroke }}
                handleStyle={{ borderColor: theme.node.activeStroke, backgroundColor: theme.node.panel }}
                onResizeEnd={(_, params) => {
                    actions.onResize?.(data.id, params.width, params.height, { x: params.x, y: params.y });
                }}
            />
            <NodeHoverSurface nodeId={data.id} className="relative h-full w-full select-none">
                <div
                    ref={batchSurfaceRef}
                    className="relative flex h-full w-full flex-col rounded-3xl border-2"
                    style={{
                        background: hasContent ? "transparent" : theme.node.fill,
                        borderColor,
                        transformOrigin: "center center",
                        boxShadow: selected ? `0 0 0 1px ${theme.node.activeStroke}55` : undefined,
                    }}
                >
                    <CanvasNodeTitle nodeId={data.id} title={data.title} defaultTitle="图像" onTitleChange={actions.onTitleChange} />
                    <div className="flex h-full w-full overflow-hidden rounded-[inherit]">
                        {isLoading ? (
                            <div className="flex h-full w-full items-center justify-center gap-2" style={{ color: theme.node.muted }}>
                                <LoaderCircle className="size-5 animate-spin" />
                                <span className="text-sm">生成中...</span>
                            </div>
                        ) : isError ? (
                            <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-3 text-center" style={{ color: theme.node.muted }}>
                                <AlertTriangle className="size-6 text-red-400" />
                                <span className="text-xs text-red-400">{data.execution.errorMessage || "生成失败"}</span>
                            </div>
                        ) : hasContent ? (
                            <div className="relative h-full w-full">
                                <img src={data.content.source} alt={data.title || ""} className="h-full w-full object-contain" draggable={false} />
                                <MediaDownloadHint />
                            </div>
                        ) : (
                            <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-sm" style={{ color: theme.node.placeholder }}>
                                <ImageIcon className="size-7 opacity-35" />
                                <span>空图片节点</span>
                            </div>
                        )}
                    </div>
                </div>
                <div className={batchAnimationPhase ? "pointer-events-none opacity-0" : undefined}>
                    <CanvasConnectionHandles />
                </div>
            </NodeHoverSurface>
        </>
    );
});

function CollapsedBatchImageStack({ previews, theme }: { previews: BatchImagePreview[]; theme: ReturnType<typeof useCanvasTheme> }) {
    const stackRef = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        const stack = stackRef.current;
        const prefersReducedMotion = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (!stack || prefersReducedMotion) return;
        const animation = stack.animate(
            [
                { opacity: 0, transform: "translateY(-8px) scale(0.96)" },
                { opacity: 1, transform: "translateY(0) scale(1)" },
            ],
            { duration: 180, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "both" },
        );
        return () => animation.cancel();
    }, []);

    if (!previews.length) return null;
    return (
        <div ref={stackRef} aria-hidden className="pointer-events-none absolute left-[calc(100%+64px)] top-[calc(50%-40px)] h-20 w-32">
            {previews.slice(0, 3).map((preview, index) => (
                <span
                    key={preview.id}
                    className="absolute left-0 top-0 block h-[72px] w-28 overflow-hidden rounded-md border"
                    style={{
                        transform: `translate(${index * 7}px, ${index * 4}px) rotate(${index * 2 - 2}deg)`,
                        zIndex: index,
                        background: theme.node.fill,
                        borderColor: theme.node.stroke,
                    }}
                >
                    <img src={preview.source} alt="" className="h-full w-full object-contain" draggable={false} />
                </span>
            ))}
        </div>
    );
}
