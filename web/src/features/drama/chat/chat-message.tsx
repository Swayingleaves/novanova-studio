"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Copy, RotateCcw, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "@/features/locale/use-translation";
import { useCopyText } from "@/shared/hooks/use-copy-text";
import type { ServerAgentSessionHistoryMessage } from "@/services/api/server";
import type { DramaStage, DramaWorkspace } from "@/services/api/drama";
import { dramaStageMeta } from "../stage-meta";
import { DramaMediaCard, DramaStageCard, parseDramaMeta } from "./stage-card";

/** 对话时间行：今天只显示时分，昨天带前缀，更早带日期。 */
function chatTime(value: string | null | undefined, translate: ReturnType<typeof useTranslation>) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const now = new Date();
    const clock = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
    if (date.toDateString() === now.toDateString()) return clock;
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) return `${translate("drama.yesterday")} ${clock}`;
    return `${date.getMonth() + 1}/${date.getDate()} ${clock}`;
}

export function DramaChatMessage({
    message,
    workspace,
    busy,
    streaming = false,
    revealing = false,
    showSuggestions = false,
    onView,
    onRegenerate,
    onUndo,
    onSuggest,
}: {
    message: ServerAgentSessionHistoryMessage;
    workspace: DramaWorkspace | null;
    busy: boolean;
    streaming?: boolean;
    /** 思考刚结束时，从胶囊里的那个点扩成整条消息。 */
    revealing?: boolean;
    showSuggestions?: boolean;
    onView: (stage: DramaStage, versionId?: string) => void;
    onRegenerate?: () => void;
    onUndo?: (versionId: string) => void;
    onSuggest: (text: string) => void;
}) {
    const translate = useTranslation();
    const copy = useCopyText();
    const [revealRadius, setRevealRadius] = useState<number | null>(revealing ? 6 : null);
    useEffect(() => {
        if (!revealing) {
            return;
        }
        // 等上面那行胶囊塌完（200ms），消息正好顶到胶囊原来的位置，圆圈再从同一个点扩散；
        // 扩满后去掉裁剪，避免超长回复被裁在圆外。
        const grow = window.setTimeout(() => setRevealRadius(2400), 180);
        const clear = window.setTimeout(() => setRevealRadius(null), 980);
        return () => {
            window.clearTimeout(grow);
            window.clearTimeout(clear);
        };
    }, [revealing]);

    if (message.role === "user") {
        return (
            <div className="flex justify-end">
                <p className="max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-[var(--studio-action)] px-3.5 py-2.5 text-sm leading-6 text-[var(--studio-action-foreground)]">
                    {message.text}
                </p>
            </div>
        );
    }

    const meta = parseDramaMeta(message.meta);
    const stage = (meta?.stage || workspace?.project.currentStage || "plan") as DramaStage;
    const identity = dramaStageMeta[stage] || dramaStageMeta.plan;
    const Icon = identity.icon;
    const version = meta?.versionId ? (workspace?.versions || []).find((item) => item.id === meta.versionId) : undefined;
    const canUndo = Boolean(onUndo && meta?.kind === "stage" && version && version.confirmationStatus === "pending");
    const suggestions = showSuggestions && !busy ? identity.suggestions : [];
    const stamp = chatTime(message.createdAt, translate);

    return (
        <article
            className="flex gap-2.5"
            style={revealRadius === null ? undefined : {
                clipPath: `circle(${revealRadius}px at 74px 20px)`,
                transition: "clip-path 420ms cubic-bezier(0.22, 1, 0.36, 1)",
            }}
        >
            <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-[var(--studio-primary-soft)] text-[var(--studio-action-emphasis)]">
                <Icon className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
                <header className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-medium text-[var(--studio-ink)]">{translate(identity.agentKey)}</span>
                    {streaming || !stamp ? null : <span className="text-xs text-[var(--studio-faint)]">· {stamp}</span>}
                </header>
                {message.text ? (
                    <div className={`mt-1 text-sm leading-6 text-[var(--studio-ink)] ${streaming ? "[&>div>p:last-child]:after:ml-0.5 [&>div>p:last-child]:after:inline-block [&>div>p:last-child]:after:h-3.5 [&>div>p:last-child]:after:w-[3px] [&>div>p:last-child]:after:animate-pulse [&>div>p:last-child]:after:bg-[var(--studio-action)] [&>div>p:last-child]:after:align-middle [&>div>p:last-child]:after:content-['']" : ""}`}>
                        <div className="prose prose-sm max-w-none break-words">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.text}</ReactMarkdown>
                        </div>
                    </div>
                ) : null}
                {meta?.kind === "stage" ? <DramaStageCard meta={meta} workspace={workspace} onView={onView} /> : null}
                {meta?.kind === "media" || meta?.kind === "media-done" ? <DramaMediaCard meta={meta} workspace={workspace} onView={onView} /> : null}
                {streaming ? null : (
                    <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-[var(--studio-muted)]">
                        {meta?.kind === "stage" ? (
                            <button type="button" className="text-xs! text-[var(--studio-muted)]! hover:text-[var(--studio-ink)]!" onClick={() => onView(stage, meta.versionId)}>
                                {translate("drama.view")}
                            </button>
                        ) : null}
                        {onRegenerate && !busy ? (
                            <button type="button" className="inline-flex items-center gap-1 text-xs! text-[var(--studio-muted)]! hover:text-[var(--studio-ink)]!" onClick={onRegenerate}>
                                <RotateCcw className="size-3" aria-hidden="true" />
                                {translate("drama.regenerate")}
                            </button>
                        ) : null}
                        <button type="button" className="inline-flex items-center gap-1 text-xs! text-[var(--studio-muted)]! hover:text-[var(--studio-ink)]!" onClick={() => copy(message.text)}>
                            <Copy className="size-3" aria-hidden="true" />
                            {translate("drama.copy")}
                        </button>
                        {canUndo && meta?.versionId ? (
                            <button type="button" className="inline-flex items-center gap-1 text-xs! text-[var(--studio-muted)]! hover:text-[var(--studio-danger)]!" onClick={() => onUndo?.(meta.versionId as string)}>
                                <Undo2 className="size-3" aria-hidden="true" />
                                {translate("drama.undo")}
                            </button>
                        ) : null}
                    </div>
                )}
                {suggestions.length ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                        {suggestions.map((key) => (
                            <button
                                key={key}
                                type="button"
                                disabled={busy}
                                className="rounded-full border border-[var(--studio-line-strong)] bg-[var(--studio-surface)] px-2.5 py-1 text-xs! text-[var(--studio-text)]! hover:border-[var(--studio-action)] hover:bg-[var(--studio-primary-soft)] disabled:opacity-50"
                                onClick={() => onSuggest(translate(key))}
                            >
                                {translate(key)}
                            </button>
                        ))}
                    </div>
                ) : null}
            </div>
        </article>
    );
}
