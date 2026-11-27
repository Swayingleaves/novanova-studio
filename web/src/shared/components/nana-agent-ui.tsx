"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Button, Tooltip } from "antd";
import {
    ArrowUp,
    Check,
    CheckCircle2,
    ChevronDown,
    ChevronRight,
    CircleAlert,
    Copy,
    LoaderCircle,
    Sparkles,
    X,
} from "lucide-react";

import { useTranslation } from "@/features/locale/use-translation";
import { StreamingReplyBubble } from "@/features/generation/components/streaming-reply-bubble";
import { useCopyText } from "@/shared/hooks/use-copy-text";

/** 与画布 Nana助手一致的右上角运行状态胶囊。 */
export function NanaHeaderStatus({ active, label = "运行中" }: { active: boolean; label?: string }) {
    if (!active) return null;
    return (
        <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-normal text-emerald-500">
            <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>{label}</span>
        </span>
    );
}

/**
 * 与画布 Nana助手一致的对话气泡：
 * - 用户侧：圆角主色胶囊 + 悬停复制；
 * - 助手侧：复用 `StreamingReplyBubble`，新回复支持二阶弹簧平滑展开与逐片模糊上浮显影，历史消息以同款圆角 Markdown 气泡静态渲染。
 */
export function NanaChatBubble({
    role,
    text,
    animated = false,
    onHeightChange,
}: {
    role: "user" | "assistant";
    text: string;
    animated?: boolean;
    onHeightChange?: () => void;
}) {
    const translate = useTranslation();
    const copyText = useCopyText();
    const isUser = role === "user";
    const [entered, setEntered] = useState(!animated);

    useEffect(() => {
        if (!animated) {
            setEntered(true);
            return;
        }
        setEntered(false);
        const frame = requestAnimationFrame(() => {
            setEntered(true);
            onHeightChange?.();
        });
        return () => cancelAnimationFrame(frame);
    }, [animated, text, onHeightChange]);

    if (!text) return null;

    return (
        <div className={`group flex items-start gap-1 ${isUser ? "justify-end" : "justify-start"}`}>
            {isUser ? (
                <div
                    className="max-w-[calc(100%_-_2rem)] cursor-text select-text whitespace-pre-wrap break-words rounded-2xl rounded-br-md px-3.5 py-2.5 text-sm leading-relaxed"
                    style={{
                        background: "var(--studio-action)",
                        color: "var(--studio-action-foreground)",
                    }}
                >
                    {text}
                </div>
            ) : (
                <div
                    className={`min-w-0 max-w-[calc(100%_-_2rem)] transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
                        entered ? "translate-y-0 opacity-100" : "translate-y-2.5 opacity-0"
                    }`}
                >
                    <StreamingReplyBubble
                        animated={false}
                        text={text}
                        thinking={false}
                        onHeightChange={onHeightChange}
                    />
                </div>
            )}
            <Tooltip title={translate("canvas.copyMessage")}>
                <button
                    type="button"
                    className={`${isUser ? "order-first" : "order-last"} pointer-events-none mt-1 grid size-7 shrink-0 cursor-pointer place-items-center rounded-lg bg-[var(--studio-panel-solid)] text-[var(--studio-muted)]! opacity-0 outline-none transition-[color,background-color,opacity] duration-150 hover:text-[var(--studio-ink)]! group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 motion-reduce:transition-none`}
                    onClick={() => copyText(text, translate("canvas.messageCopied"))}
                    aria-label={translate("canvas.copyMessage")}
                >
                    <Copy className="size-3.5" />
                </button>
            </Tooltip>
        </div>
    );
}

export type NanaTraceStep = {
    id: string;
    label: string;
    status: "running" | "done" | "error";
};

/**
 * 与画布 `CanvasAgentThinkingRow` 一致的单行折叠式思考/步骤轨迹条，
 * 运行中搭配 `StreamingReplyBubble` 的扫光「思考中」胶囊实现统一对话动效。
 */
export function NanaThinkingRow({
    active = false,
    title,
    preview,
    steps = [],
    thinkingLabel = "思考中",
    showBubble = false,
}: {
    active?: boolean;
    title?: string;
    preview?: string;
    steps?: NanaTraceStep[];
    thinkingLabel?: string;
    showBubble?: boolean;
}) {
    const [expanded, setExpanded] = useState(false);
    if (!active && !preview && steps.length === 0) return null;

    const heading = title || (active ? "正在思考" : "思考过程");
    const summaryText = steps.length > 0 ? `${steps.length} 步操作` : "";

    return (
        <div className="space-y-1.5">
            <div className="my-0.5 text-xs">
                <button
                    type="button"
                    onClick={() => steps.length > 0 && setExpanded((current) => !current)}
                    className={`flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left text-xs! text-[var(--studio-muted)]! transition-colors ${
                        steps.length > 0 ? "cursor-pointer hover:bg-[color-mix(in_srgb,var(--studio-ink)_5%,transparent)]" : "cursor-default"
                    } ${expanded ? "bg-[color-mix(in_srgb,var(--studio-ink)_5%,transparent)]" : ""}`}
                >
                    <span
                        className={`grid size-5 shrink-0 place-items-center rounded-full ${
                            active
                                ? "border border-[color-mix(in_srgb,var(--studio-ink)_24%,transparent)] text-[var(--studio-ink)]"
                                : "text-[var(--studio-muted)]"
                        }`}
                    >
                        <Sparkles className={`size-3 ${active ? "animate-pulse" : ""}`} />
                    </span>
                    <span className={`shrink-0 font-medium ${active ? "text-[var(--studio-ink)]" : "text-[var(--studio-muted)]"}`}>
                        {heading}
                    </span>
                    {preview ? (
                        <span className="min-w-0 flex-1 truncate opacity-75">{preview}</span>
                    ) : (
                        <span className="min-w-0 flex-1" />
                    )}
                    {summaryText ? (
                        <span className="shrink-0 whitespace-nowrap opacity-70">{summaryText}</span>
                    ) : null}
                    {steps.length > 0 ? (
                        <ChevronRight
                            className={`size-3.5 shrink-0 opacity-70 transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
                        />
                    ) : null}
                </button>

                {expanded && steps.length > 0 ? (
                    <div className="mt-1 space-y-1.5 rounded-xl border border-[var(--studio-line)] bg-[color-mix(in_srgb,var(--studio-ink)_4%,var(--studio-panel-solid))] px-3 py-2.5 text-xs leading-5 text-[var(--studio-muted)]">
                        {steps.map((step) => (
                            <div key={step.id} className="flex items-center gap-2">
                                {step.status === "running" ? (
                                    <LoaderCircle className="size-3.5 shrink-0 animate-spin text-blue-500" />
                                ) : step.status === "error" ? (
                                    <X className="size-3.5 shrink-0 text-red-500" />
                                ) : (
                                    <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />
                                )}
                                <span className="truncate text-[var(--studio-ink)]">{step.label}</span>
                            </div>
                        ))}
                    </div>
                ) : null}
            </div>

            {active && showBubble ? (
                <StreamingReplyBubble animated thinking text="" thinkingLabel={thinkingLabel} />
            ) : null}
        </div>
    );
}

export type NanaTaskItemStatus = "pending" | "running" | "done" | "failed" | "warning";

export type NanaTaskItem = {
    id: string;
    name: string;
    meta?: string;
    status: NanaTaskItemStatus;
    statusText?: string;
    actions?: ReactNode;
};

/**
 * 与画布 `CanvasAgentPlanTimeline` 一致的折叠式任务执行时间线卡片：
 * 适用于展示已应用的镜头修改、待确认草稿任务或批处理步骤。
 */
export function NanaTaskTimeline({
    title,
    status,
    summary,
    items,
    defaultExpanded = true,
    footer,
}: {
    title: string;
    status: "running" | "done" | "failed" | "warning";
    summary?: string;
    items: NanaTaskItem[];
    defaultExpanded?: boolean;
    footer?: ReactNode;
}) {
    const [expanded, setExpanded] = useState(defaultExpanded);

    const headerIcon =
        status === "running" ? (
            <LoaderCircle className="size-3.5 animate-spin text-[var(--studio-muted)]" />
        ) : status === "failed" ? (
            <CircleAlert className="size-3.5 text-red-500" />
        ) : status === "warning" ? (
            <CircleAlert className="size-3.5 text-amber-500" />
        ) : (
            <CheckCircle2 className="size-3.5 text-emerald-500" />
        );

    const itemBadge = (itemStatus: NanaTaskItemStatus) => {
        if (itemStatus === "done") {
            return (
                <span className="relative z-10 grid size-[13px] shrink-0 place-items-center rounded-full bg-emerald-500">
                    <Check className="size-2 text-white" strokeWidth={3.5} />
                </span>
            );
        }
        if (itemStatus === "failed") {
            return (
                <span className="relative z-10 grid size-[13px] shrink-0 place-items-center rounded-full bg-red-500">
                    <X className="size-2 text-white" strokeWidth={3.5} />
                </span>
            );
        }
        if (itemStatus === "warning") {
            return (
                <span className="relative z-10 grid size-[13px] shrink-0 place-items-center rounded-full bg-amber-500">
                    <span className="size-1.5 rounded-full bg-white" />
                </span>
            );
        }
        if (itemStatus === "running") {
            return (
                <span className="relative z-10 grid size-[13px] shrink-0 place-items-center rounded-full bg-[var(--studio-panel-solid)]">
                    <LoaderCircle className="size-3 animate-spin text-blue-500" />
                </span>
            );
        }
        return (
            <span className="relative z-10 grid size-[13px] shrink-0 place-items-center rounded-full bg-[var(--studio-panel-solid)]">
                <span className="size-[7px] rounded-full border border-[var(--studio-muted)] opacity-60" />
            </span>
        );
    };

    const statusTextColor = (itemStatus: NanaTaskItemStatus) => {
        if (itemStatus === "running") return "text-blue-500";
        if (itemStatus === "failed") return "text-red-500";
        if (itemStatus === "warning") return "text-amber-500";
        if (itemStatus === "done") return "text-emerald-600";
        return "text-[var(--studio-muted)]";
    };

    return (
        <div className="mr-6 rounded-xl border border-[var(--studio-line)] bg-[color-mix(in_srgb,var(--studio-ink)_3%,var(--studio-panel-solid))] text-xs text-[var(--studio-ink)]">
            <button
                type="button"
                onClick={() => setExpanded((current) => !current)}
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-xs! text-[var(--studio-ink)]!"
                aria-expanded={expanded}
            >
                <span className="grid size-3.5 shrink-0 place-items-center">{headerIcon}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
                {summary ? <span className="shrink-0 text-[11px] text-[var(--studio-muted)]">{summary}</span> : null}
                <ChevronDown
                    className={`size-3.5 shrink-0 text-[var(--studio-muted)] transition-transform duration-150 ${expanded ? "rotate-180" : ""}`}
                />
            </button>

            {expanded ? (
                <div className="relative px-3 pb-2.5">
                    {items.length > 1 ? (
                        <span
                            className="absolute bottom-3 left-[18px] top-2 w-px bg-[var(--studio-line)]"
                            aria-hidden
                        />
                    ) : null}
                    {items.map((item) => (
                        <div key={item.id} className="relative flex items-center gap-2 py-[3px]">
                            {itemBadge(item.status)}
                            <span
                                className={`min-w-0 flex-1 truncate ${item.status === "failed" ? "text-red-500" : "text-[var(--studio-ink)]"}`}
                                title={`${item.name}${item.meta ? ` · ${item.meta}` : ""}`}
                            >
                                {item.name}
                                {item.meta ? <span className="text-[var(--studio-muted)]"> · {item.meta}</span> : null}
                            </span>
                            {item.statusText ? (
                                <span className={`shrink-0 text-[11px] ${statusTextColor(item.status)}`}>
                                    {item.statusText}
                                </span>
                            ) : null}
                            {item.actions ? <div className="flex shrink-0 items-center gap-1">{item.actions}</div> : null}
                        </div>
                    ))}
                    {footer ? <div className="mt-2 flex items-center justify-end gap-1.5 border-t border-[var(--studio-line)] pt-2">{footer}</div> : null}
                </div>
            ) : null}
        </div>
    );
}

/**
 * 与画布 `pendingApproval` 审批卡片一致的待确认动作建议卡片：
 * - `pending`（默认）：暖琥珀色细边框与柔和底色，突出仍需确认执行的下一步操作；
 * - `done`：中性边框与绿色对勾，用于已写入或对应板块已生成完成的历史卡片。
 */
export function NanaApprovalCard({
    title,
    tag,
    badge,
    description,
    warning,
    variant = "pending",
    actions,
}: {
    title: string;
    tag?: string;
    badge?: string;
    description?: string;
    warning?: string;
    variant?: "pending" | "done";
    actions: ReactNode;
}) {
    const isDone = variant === "done";
    return (
        <section
            className="mr-6 rounded-xl border p-3 text-xs text-[var(--studio-ink)]"
            style={
                isDone
                    ? {
                          borderColor: "var(--studio-line)",
                          background: "color-mix(in srgb, var(--studio-ink) 3%, var(--studio-panel-solid))",
                      }
                    : {
                          borderColor: "color-mix(in srgb, #f59e0b 40%, var(--studio-line))",
                          background: "color-mix(in srgb, #f59e0b 7%, var(--studio-panel-solid))",
                      }
            }
        >
            <div className="flex items-start justify-between gap-2">
                <div
                    className={`flex min-w-0 flex-wrap items-center gap-1.5 font-medium ${
                        isDone ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"
                    }`}
                >
                    {isDone ? <CheckCircle2 className="size-4 shrink-0" /> : <CircleAlert className="size-4 shrink-0" />}
                    <span className="truncate">{title}</span>
                    {tag ? (
                        <span className="rounded bg-[var(--studio-panel-solid)]/80 px-1.5 py-0.5 text-[10px] font-normal text-[var(--studio-muted)]">
                            {tag}
                        </span>
                    ) : null}
                </div>
                {badge ? <span className="shrink-0 text-[11px] font-medium text-[var(--studio-muted)]">{badge}</span> : null}
            </div>
            {description ? <p className="mt-1.5 whitespace-pre-line leading-5 text-[var(--studio-text)] opacity-90">{description}</p> : null}
            {warning ? <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">{warning}</p> : null}
            <div className="mt-2.5 flex justify-end gap-1.5">{actions}</div>
        </section>
    );
}

/** 与画布 `ContextUsageRing` 一致的会话上下文占用环形指示器。 */
function NanaContextUsageRing({ percent }: { percent: number }) {
    const clamped = Math.min(100, Math.max(0, Math.round(percent)));
    const radius = 6;
    const circumference = 2 * Math.PI * radius;
    const dashOffset = circumference * (1 - clamped / 100);
    return (
        <Tooltip title={clamped >= 80 ? `当前会话上下文占用约 ${clamped}%，建议开启新对话释放上下文` : `当前会话上下文占用约 ${clamped}%`}>
            <span className="inline-flex shrink-0 items-center gap-1 px-1 text-[11px] tabular-nums text-[var(--studio-muted)]">
                <svg width="16" height="16" viewBox="0 0 16 16" className="-rotate-90" aria-hidden="true">
                    <circle cx="8" cy="8" r={radius} fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2" />
                    <circle
                        cx="8"
                        cy="8"
                        r={radius}
                        fill="none"
                        stroke={clamped >= 80 ? "#f59e0b" : "currentColor"}
                        strokeWidth="2"
                        strokeDasharray={circumference}
                        strokeDashoffset={dashOffset}
                        strokeLinecap="round"
                    />
                </svg>
                <span>{clamped}%</span>
            </span>
        </Tooltip>
    );
}

/**
 * 与画布 `AgentChatComposer` 一致的底部圆角输入卡片容器：
 * 顶部上下文胶囊、无边框输入区、底部左侧快捷工具胶囊 + 右侧内联模型选择器、上下文占用环与圆形发送按钮。
 */
export function NanaComposerShell({
    topBar,
    extraBar,
    value,
    placeholder,
    disabled,
    sending,
    canSubmit,
    leftControls,
    rightControls,
    contextUsagePercent,
    submitIcon,
    submitLabel,
    onChange,
    onSubmit,
}: {
    topBar?: ReactNode;
    extraBar?: ReactNode;
    value: string;
    placeholder: string;
    disabled?: boolean;
    sending?: boolean;
    canSubmit: boolean;
    leftControls?: ReactNode;
    rightControls?: ReactNode;
    contextUsagePercent?: number;
    submitIcon?: ReactNode;
    submitLabel?: string;
    onChange: (value: string) => void;
    onSubmit: () => void;
}) {
    const translate = useTranslation();
    return (
        <div className="shrink-0 border-t border-[var(--studio-line)] px-2 pb-2 pt-2">
            <div className="rounded-2xl border border-[var(--studio-line-strong)] bg-[var(--studio-panel-solid)] p-3 shadow-lg transition-colors focus-within:border-[var(--studio-primary-line)]">
                {topBar ? <div className="mb-2 flex flex-wrap items-center gap-1.5">{topBar}</div> : null}
                {extraBar ? <div className="mb-2">{extraBar}</div> : null}

                <textarea
                    rows={2}
                    value={value}
                    disabled={disabled}
                    onChange={(event) => onChange(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                            event.preventDefault();
                            if (canSubmit && !sending) onSubmit();
                        }
                    }}
                    placeholder={placeholder}
                    className="w-full resize-none bg-transparent text-sm leading-6 text-[var(--studio-ink)] outline-none placeholder:text-[var(--studio-faint)] disabled:opacity-60"
                />

                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-1">{leftControls}</div>
                    <div className="flex shrink-0 items-center gap-1.5">
                        {rightControls}
                        {typeof contextUsagePercent === "number" ? <NanaContextUsageRing percent={contextUsagePercent} /> : null}
                        <Button
                            type="primary"
                            shape="circle"
                            size="small"
                            loading={sending}
                            disabled={!canSubmit}
                            icon={submitIcon ?? <ArrowUp className="size-4" />}
                            onClick={onSubmit}
                            aria-label={submitLabel || translate("canvas.send")}
                            title={submitLabel || translate("canvas.send")}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
