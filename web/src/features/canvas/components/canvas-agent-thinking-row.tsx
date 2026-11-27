"use client";

import { useState } from "react";
import { CheckCircle2, ChevronRight, LoaderCircle, Sparkles, XCircle } from "lucide-react";
import type { CanvasAssistantTraceStep, CanvasAssistantTraceThinking } from "../types";
import { useCanvasTheme } from "./canvas-theme-provider";

type CanvasAgentThinkingRowProps = {
    thinkings: CanvasAssistantTraceThinking[];
    steps?: CanvasAssistantTraceStep[];
    active?: boolean;
};

/**
 * 单行折叠式思考与工具步骤轨迹条。
 * 默认展示最新思考首行摘要与步数统计，点击展开查看完整推理和操作详情。
 */
export function CanvasAgentThinkingRow({ thinkings, steps = [], active = false }: CanvasAgentThinkingRowProps) {
    const theme = useCanvasTheme();
    const [expanded, setExpanded] = useState(false);

    const visibleThinkings = thinkings.filter((item) => item.text.trim().length > 0);
    if (!active && visibleThinkings.length === 0 && steps.length === 0) {
        return null;
    }

    const latestThinking = visibleThinkings.at(-1);
    const previewText = latestThinking
        ? latestThinking.text.replace(/\s+/g, " ").trim()
        : steps.at(-1)?.label || "";

    const summaryParts: string[] = [];
    if (steps.length > 0) summaryParts.push(`${steps.length} 步操作`);
    if (visibleThinkings.length > 0) summaryParts.push(`${visibleThinkings.length} 段思考`);
    const summaryText = summaryParts.join(" · ");

    return (
        <div className="my-1 text-xs">
            <button
                type="button"
                onClick={() => setExpanded((current) => !current)}
                className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left transition-colors hover:opacity-95"
                style={{
                    color: theme.node.muted,
                    background: expanded ? `color-mix(in srgb, ${theme.node.text} 5%, transparent)` : "transparent",
                }}
            >
                <span
                    className={`grid size-5 shrink-0 place-items-center rounded-full ${active ? "border" : ""}`}
                    style={{
                        borderColor: active ? `color-mix(in srgb, ${theme.node.text} 24%, transparent)` : "transparent",
                        color: active ? theme.node.text : theme.node.muted,
                    }}
                >
                    <Sparkles className={`size-3 ${active ? "animate-pulse" : ""}`} />
                </span>
                <span className="shrink-0 font-medium" style={{ color: active ? theme.node.text : theme.node.muted }}>
                    {active ? "正在思考" : "思考过程"}
                </span>
                {previewText ? (
                    <span className="min-w-0 flex-1 truncate opacity-75">
                        {previewText}
                    </span>
                ) : (
                    <span className="min-w-0 flex-1" />
                )}
                {summaryText ? (
                    <span className="shrink-0 whitespace-nowrap opacity-70">{summaryText}</span>
                ) : null}
                <ChevronRight
                    className={`size-3.5 shrink-0 opacity-70 transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
                />
            </button>

            {expanded ? (
                <div
                    className="mt-1 space-y-2 rounded-xl border px-3 py-2.5 text-xs leading-5"
                    style={{
                        background: `color-mix(in srgb, ${theme.node.text} 4%, ${theme.node.panel})`,
                        borderColor: theme.toolbar.border,
                        color: theme.node.muted,
                    }}
                >
                    {visibleThinkings.map((item, index) => (
                        <div key={item.id || index} className="space-y-1">
                            {visibleThinkings.length > 1 || item.durationMs > 0 ? (
                                <div className="flex items-center justify-between text-[11px] opacity-70">
                                    <span>思考 {index + 1}</span>
                                    {item.durationMs > 0 ? <span>{(item.durationMs / 1000).toFixed(1)}s</span> : null}
                                </div>
                            ) : null}
                            <p className="whitespace-pre-wrap break-words">{item.text.trim()}</p>
                        </div>
                    ))}
                    {steps.length > 0 ? (
                        <div className="space-y-1 border-t pt-2" style={{ borderColor: theme.toolbar.border }}>
                            {steps.map((step) => (
                                <div key={step.callId} className="flex items-center gap-2">
                                    {step.status === "running" ? (
                                        <LoaderCircle className="size-3.5 shrink-0 animate-spin text-blue-500" />
                                    ) : step.status === "error" ? (
                                        <XCircle className="size-3.5 shrink-0 text-red-500" />
                                    ) : (
                                        <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />
                                    )}
                                    <span className="truncate" style={{ color: theme.node.text }}>
                                        {step.label}
                                    </span>
                                </div>
                            ))}
                        </div>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}
