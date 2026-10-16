"use client";
import { translateMessage as translate } from "@/features/locale/translate";
import { useTranslation } from "@/features/locale/use-translation";


import { Tooltip } from "antd";
import { Check, ChevronDown, ChevronRight, Circle, CircleX, LoaderCircle, Minus, Square } from "lucide-react";
import { useEffect, useState } from "react";

import type { AgentActivityState, AgentActivityStatus } from "@/features/chat/types";

type AgentActivityTimelineProps = {
    activities: AgentActivityState[];
};

const createStatusLabels = (translator: typeof translate = translate): Record<AgentActivityStatus, string> => ({
    get pending() { return translator("generation.waiting"); },
    get running() { return translator("generation.running"); },
    get success() { return translator("generation.completed"); },
    get failed() { return translator("generation.executionFailed"); },
    get canceled() { return translator("generation.stopped"); },
    get skipped() { return translator("generation.skipped"); },
});

/** 展示当前对话轮次中的 Agent 计划、准备和工具执行轨迹。 */
export function AgentActivityTimeline({ activities }: AgentActivityTimelineProps) {
    const translate = useTranslation();
    const hasRunningActivity = activities.some((activity) => activity.status === "running" || activity.status === "pending");
    const [collapsed, setCollapsed] = useState(false);

    useEffect(() => {
        if (hasRunningActivity) {
            setCollapsed(false);
        }
    }, [hasRunningActivity]);

    const summary = hasRunningActivity
        ? translate("generation.running")
        : activities.some((activity) => activity.status === "failed")
          ? translate("generation.executionFailed")
          : activities.some((activity) => activity.status === "canceled")
            ? translate("generation.stopped")
            : translate("generation.completed");

    return (
        <div className="max-w-3xl py-1" aria-label={translate("generation.agentExecution")} aria-live="polite">
            <button
                type="button"
                className="mb-2 flex min-h-7 w-full items-center gap-1.5 text-left text-[11px] font-semibold text-[var(--studio-muted)] transition-colors hover:text-[var(--studio-ink)]"
                aria-expanded={!collapsed}
                onClick={() => setCollapsed((value) => !value)}
            >
                {collapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                <span>{translate("generation.execution")}</span>
                <span className="font-normal">{summary}{translate("generation.total")}{activities.length} {translate("generation.steps")}</span>
            </button>
            {!collapsed ? (
                <ol className="space-y-1.5">
                    {activities.map((activity, index) => (
                        <li key={activity.id} className="relative flex min-h-8 items-start gap-3">
                            {index < activities.length - 1 ? (
                                <span className="absolute left-[11px] top-6 h-[calc(100%+2px)] w-px bg-[var(--studio-line)]" aria-hidden="true" />
                            ) : null}
                            <ActivityStatusIcon status={activity.status} />
                            <div className="min-w-0 flex-1 pb-1 pt-0.5 sm:flex sm:items-baseline sm:gap-2">
                                <div className="break-words text-xs font-medium text-[var(--studio-ink)] sm:max-w-[42%] sm:shrink-0">{activity.title}</div>
                                {activity.description ? (
                                    <div className="mt-0.5 min-w-0 break-words text-[11px] leading-5 text-[var(--studio-muted)] sm:mt-0">
                                        {activity.description}
                                    </div>
                                ) : null}
                            </div>
                        </li>
                    ))}
                </ol>
            ) : null}
        </div>
    );
}

function ActivityStatusIcon({ status }: { status: AgentActivityStatus }) {
    const translate = useTranslation();
    const iconClassName = "size-3.5";
    const icon = status === "running"
        ? <LoaderCircle className={`${iconClassName} motion-safe:animate-spin`} />
        : status === "success"
          ? <Check className={iconClassName} />
          : status === "failed"
            ? <CircleX className={iconClassName} />
            : status === "canceled"
              ? <Square className={iconClassName} />
              : status === "skipped"
                ? <Minus className={iconClassName} />
                : <Circle className={iconClassName} />;
    const colorClassName = status === "failed"
        ? "border-red-300/70 bg-red-50 text-red-600 dark:border-red-800 dark:bg-red-950/50 dark:text-red-300"
        : status === "success"
          ? "border-emerald-300/70 bg-emerald-50 text-emerald-600 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
          : "border-[var(--studio-line)] bg-[var(--studio-panel-solid)] text-[var(--studio-muted)]";
    return (
        <Tooltip title={createStatusLabels(translate)[status]}>
            <span className={`relative z-[1] grid size-6 shrink-0 place-items-center rounded-full border ${colorClassName}`} aria-label={createStatusLabels(translate)[status]}>
                {icon}
            </span>
        </Tooltip>
    );
}
