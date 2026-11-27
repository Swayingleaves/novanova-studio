"use client";

import { useState } from "react";
import { Check, CheckCircle2, ChevronDown, CircleAlert, LoaderCircle, MapPin, RotateCcw, X } from "lucide-react";
import type { CanvasAgentBatchItem, CanvasAgentBatchItemStatus, CanvasAgentBatchState } from "../types";
import { useCanvasTheme } from "./canvas-theme-provider";

type CanvasAgentPlanTimelineProps = {
    plan: CanvasAgentBatchState;
    onFocusNode?: (nodeId: string) => void;
    onRetryItem?: (item: CanvasAgentBatchItem) => void;
};

/**
 * 跟在对话里的任务执行时间线。
 * 运行中逐条展开；全部结束后自动收成一行摘要，有失败项时保持展开。
 */
export function CanvasAgentPlanTimeline({ plan, onFocusNode, onRetryItem }: CanvasAgentPlanTimelineProps) {
    const theme = useCanvasTheme();
    const [manualExpanded, setManualExpanded] = useState<boolean | null>(null);
    const running = plan.status === "running";
    const doneCount = plan.items.filter((item) => item.status === "done").length;
    const failedCount = plan.items.filter((item) => item.status === "failed").length;
    const expanded = manualExpanded ?? (running || failedCount > 0);
    const elapsed = plan.startedAt && plan.finishedAt ? formatElapsed(plan.finishedAt - plan.startedAt) : null;
    const surface = `color-mix(in srgb, ${theme.node.text} 3%, ${theme.node.panel})`;
    const title = running
        ? "执行计划"
        : plan.status === "failed"
          ? (failedCount > 0 ? `完成 ${doneCount} 项 · ${failedCount} 项失败` : "执行失败")
          : plan.status === "canceled"
            ? `已停止 · 完成 ${doneCount} 项`
            : `已完成 ${plan.items.length} 项`;

    const headerIcon = running
        ? <LoaderCircle className="size-3.5 animate-spin" style={{ color: theme.node.muted }} />
        : plan.status === "failed"
          ? <CircleAlert className="size-3.5" style={{ color: "#ef4444" }} />
          : plan.status === "canceled"
            ? <CircleAlert className="size-3.5" style={{ color: theme.node.muted }} />
            : <CheckCircle2 className="size-3.5" style={{ color: "#22c55e" }} />;

    function statusColor(status: CanvasAgentBatchItemStatus) {
        if (status === "running") return "#3b82f6";
        if (status === "failed") return "#ef4444";
        return theme.node.muted;
    }

    function itemIcon(status: CanvasAgentBatchItemStatus) {
        if (status === "done") return <Check className="size-2" strokeWidth={3.5} color="#fff" />;
        if (status === "failed") return <X className="size-2" strokeWidth={3.5} color="#fff" />;
        if (status === "running") return <LoaderCircle className="size-3 animate-spin" style={{ color: "#3b82f6" }} />;
        if (status === "canceled") return <span className="h-px w-1.5 rounded" style={{ background: theme.node.muted }} />;
        return <span className="size-[7px] rounded-full border" style={{ borderColor: theme.node.muted, opacity: 0.6 }} />;
    }

    return (
        <div
            className="rounded-xl border text-xs"
            style={{ borderColor: theme.toolbar.border, background: surface, color: theme.node.text }}
        >
            <button
                type="button"
                onClick={() => setManualExpanded(!expanded)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left"
                aria-expanded={expanded}
            >
                <span className="grid size-3.5 shrink-0 place-items-center">{headerIcon}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
                <span className="shrink-0 text-[11px]" style={{ color: theme.node.muted }}>
                    {running ? `${doneCount}/${plan.items.length}` : elapsed}
                </span>
                <ChevronDown
                    className={`size-3.5 shrink-0 transition-transform duration-150 ${expanded ? "rotate-180" : ""}`}
                    style={{ color: theme.node.muted }}
                />
            </button>

            {expanded ? (
                <div className="relative px-3 pb-2">
                    {plan.items.length > 1 ? (
                        <span className="absolute bottom-3 left-[18px] top-2 w-px" style={{ background: theme.toolbar.border }} aria-hidden />
                    ) : null}
                    {plan.items.map((item) => {
                        const { name, meta } = splitItemLabel(item.label);
                        const nodeId = item.nodeId;
                        const failed = item.status === "failed";
                        const retryable = Boolean(onRetryItem) && (failed || item.status === "done");
                        return (
                            <div
                                key={`${item.index}-${item.taskId || item.callId || item.label}`}
                                className="group/step relative flex items-center gap-2 py-[3px]"
                            >
                                <span
                                    className="relative z-10 grid size-[13px] shrink-0 place-items-center rounded-full"
                                    style={{
                                        background: failed ? "#ef4444" : item.status === "done" ? "#22c55e" : surface,
                                    }}
                                >
                                    {itemIcon(item.status)}
                                </span>
                                <span
                                    className="min-w-0 flex-1 truncate"
                                    style={{ color: failed ? "#ef4444" : theme.node.text }}
                                    title={`${name}${meta ? ` · ${meta}` : ""}`}
                                >
                                    {name}
                                    {meta ? <span style={{ color: theme.node.muted }}> · {meta}</span> : null}
                                </span>
                                <span className="w-9 shrink-0 text-right text-[11px]" style={{ color: statusColor(item.status) }}>
                                    {statusLabel(item.status)}
                                </span>
                                {onFocusNode && nodeId ? (
                                    <button
                                        type="button"
                                        onClick={() => onFocusNode(nodeId)}
                                        className="grid size-5 shrink-0 place-items-center rounded opacity-0 transition group-hover/step:opacity-70 hover:opacity-100 focus-visible:opacity-100"
                                        style={{ color: theme.node.muted }}
                                        title="在画布定位"
                                        aria-label={`在画布定位 ${name}`}
                                    >
                                        <MapPin className="size-3" />
                                    </button>
                                ) : null}
                                {retryable ? (
                                    <button
                                        type="button"
                                        onClick={() => onRetryItem?.(item)}
                                        className={`grid size-5 shrink-0 place-items-center rounded transition hover:opacity-100 ${failed ? "opacity-70" : "opacity-0 group-hover/step:opacity-70"}`}
                                        style={{ color: theme.node.muted }}
                                        title="重跑这一项"
                                        aria-label={`重跑 ${name}`}
                                    >
                                        <RotateCcw className="size-3" />
                                    </button>
                                ) : null}
                            </div>
                        );
                    })}
                </div>
            ) : null}
        </div>
    );
}

function statusLabel(status: CanvasAgentBatchItemStatus): string {
    switch (status) {
        case "done":
            return "已完成";
        case "running":
            return "生成中";
        case "failed":
            return "失败";
        case "canceled":
            return "已停止";
        default:
            return "等待中";
    }
}

/** 把工具调用生成的「正在调用图片生成工具（16:9 / 标准质量）」拆成任务名和参数说明。 */
function splitItemLabel(label: string): { name: string; meta: string } {
    const clean = label.trim().replace(/^正在/, "").replace(/…$/, "").trim();
    const match = clean.match(/^(.+?)（([^（）]+)）$/);
    return match ? { name: match[1].trim(), meta: match[2].trim() } : { name: clean, meta: "" };
}

function formatElapsed(durationMs: number): string {
    const seconds = Math.max(1, Math.round(durationMs / 1000));
    if (seconds < 60) return `${seconds} 秒`;
    return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}
