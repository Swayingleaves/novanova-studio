"use client";

import { Button, Dropdown, Input } from "antd";
import { ArrowUp, AtSign, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "@/features/locale/use-translation";
import type { ServerAgentSessionHistoryMessage } from "@/services/api/server";
import { dramaStages, type DramaStage, type DramaWorkspace } from "@/services/api/drama";
import { DramaChatMessage } from "../chat/chat-message";
import { parseDramaMeta } from "../chat/stage-card";
import { dramaStageMeta } from "../stage-meta";
import { formatShotNumber, shotDisplayTitle, type TimedDramaShot } from "../lib/shot-utils";

/** 右侧 AI 创作协作面板：5 步进度条 + 对话流 + @镜头引用输入框。 */
export function DramaAgentSidebar({
    workspace,
    messages,
    streaming,
    busy,
    sending,
    stopping,
    taskStatus,
    taskMessage,
    viewedStage,
    shots,
    draft,
    canConfirm,
    onDraftChange,
    onSend,
    onStop,
    onViewStage,
    onRegenerate,
    onUndo,
}: {
    workspace: DramaWorkspace;
    messages: ServerAgentSessionHistoryMessage[];
    streaming: { id: string; text: string } | null;
    busy: boolean;
    sending: boolean;
    stopping: boolean;
    taskStatus: string;
    taskMessage: string;
    viewedStage: DramaStage;
    shots: TimedDramaShot[];
    draft: string;
    canConfirm: boolean;
    onDraftChange: (value: string) => void;
    onSend: (override?: string) => void;
    onStop: () => void;
    onViewStage: (stage: DramaStage, versionId?: string) => void;
    onRegenerate: (index: number) => void;
    onUndo: (versionId: string) => void;
}) {
    const translate = useTranslation();
    const listRef = useRef<HTMLDivElement>(null);
    const [tasksOpen, setTasksOpen] = useState(false);

    const project = workspace.project;
    const currentIndex = Math.max(0, dramaStages.indexOf(project.currentStage));
    const isCompleted = project.status === "completed";
    const showLiveBubble = Boolean(busy || sending || streaming);
    const lastAssistantIndex = messages.reduce((found, item, index) => (item.role === "assistant" ? index : found), -1);

    const scrollToBottom = useCallback(() => {
        const element = listRef.current;
        if (element) element.scrollTop = element.scrollHeight;
    }, []);

    useEffect(() => {
        scrollToBottom();
    }, [messages, busy, sending, streaming?.text, scrollToBottom]);

    const onDraftKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
        event.preventDefault();
        onSend();
    };

    const insertShotMention = (shot: TimedDramaShot) => {
        const token = `@镜头${formatShotNumber(shot.index)}(${shot.ref}) `;
        onDraftChange(draft ? `${draft.trimEnd()} ${token}` : token);
    };

    return (
        <aside className="flex min-h-0 flex-1 flex-col border-l border-[var(--studio-line)] bg-[var(--studio-rail)]">
            <div className="shrink-0 border-b border-[var(--studio-line)] px-3.5 py-2.5">
                <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-semibold text-[var(--studio-ink)]">{translate("drama.creationProgress")}</span>
                    <span className="tabular-nums text-[var(--studio-muted)]">
                        {isCompleted
                            ? translate("drama.progressDone", { total: dramaStages.length })
                            : translate("drama.progressIncomplete", { current: currentIndex + 1, total: dramaStages.length })}
                    </span>
                </div>
                <ol className="mt-2.5 grid grid-cols-4 gap-2" aria-label={translate("drama.creationProgress")}>
                    {dramaStages.map((stage, index) => {
                        const stageVersions = (workspace.versions || []).filter((item) => item.stage === stage);
                        const latestVersion = stageVersions.sort((left, right) => right.versionNumber - left.versionNumber)[0];
                        const isDone = isCompleted || index < currentIndex || latestVersion?.confirmationStatus === "confirmed";
                        const isCurrent = !isCompleted && index === currentIndex && !isDone;
                        const isViewing = viewedStage === stage;
                        // 已完成 100%，当前进行中按是否已产出待确认版本显示 60% / 25%，未开始 0%。
                        const fillPercent = isDone ? 100 : isCurrent ? (latestVersion ? 60 : 25) : 0;

                        return (
                            <li key={stage} className="min-w-0">
                                <button
                                    type="button"
                                    onClick={() => onViewStage(stage)}
                                    className="group flex w-full flex-col gap-1.5 text-left"
                                >
                                    <span
                                        style={isCurrent ? { color: "var(--studio-action)" } : undefined}
                                        className={`truncate text-[11px]! transition-colors ${
                                            isCurrent
                                                ? "font-semibold"
                                                : isDone
                                                    ? isViewing
                                                        ? "font-semibold text-[var(--studio-ink)]!"
                                                        : "font-medium text-[var(--studio-text)]! group-hover:text-[var(--studio-ink)]!"
                                                    : isViewing
                                                        ? "font-medium text-[var(--studio-ink)]!"
                                                        : "text-[var(--studio-faint)]! group-hover:text-[var(--studio-muted)]!"
                                        }`}
                                    >
                                        {translate(dramaStageMeta[stage].label)}
                                    </span>
                                    <span
                                        className="relative block w-full overflow-hidden"
                                        style={{ height: 5, borderRadius: 999, background: "var(--studio-line)" }}
                                    >
                                        {fillPercent > 0 ? (
                                            <span
                                                className="block transition-all duration-300"
                                                style={{ height: "100%", width: `${fillPercent}%`, borderRadius: 999, background: "var(--studio-action)" }}
                                            />
                                        ) : null}
                                    </span>
                                </button>
                            </li>
                        );
                    })}
                </ol>
            </div>

            <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-3.5 pb-6 pt-3.5">
                {messages.length === 0 && !showLiveBubble ? (
                    <div className="flex h-full min-h-36 items-center justify-center">
                        <p className="max-w-xs text-center text-xs leading-6 text-[var(--studio-muted)]">
                            {translate("drama.noMessages")}
                        </p>
                    </div>
                ) : (
                    <div className="flex flex-col gap-4">
                        {messages.map((item, index) => {
                            if (streaming && item.id === streaming.id) return null;
                            const kind = parseDramaMeta(item.meta)?.kind;
                            const canRegenerate = index === lastAssistantIndex && (kind === "stage" || kind === "answer" || !kind);
                            return (
                                <DramaChatMessage
                                    key={item.id}
                                    message={item}
                                    workspace={workspace}
                                    busy={busy}
                                    showSuggestions={!busy && !streaming && index === lastAssistantIndex}
                                    onView={onViewStage}
                                    onRegenerate={canRegenerate ? () => onRegenerate(index) : undefined}
                                    onUndo={onUndo}
                                    onSuggest={onDraftChange}
                                    onSelectChoice={(text) => onSend(text)}
                                />
                            );
                        })}
                        {showLiveBubble ? (
                            <DramaChatMessage
                                message={{ id: streaming?.id || "live-reply", role: "assistant", text: streaming?.text || "", meta: null, createdAt: null }}
                                workspace={workspace}
                                busy={busy}
                                streaming
                                thinking={!streaming?.text}
                                onHeightChange={scrollToBottom}
                                onView={onViewStage}
                                onSuggest={onDraftChange}
                            />
                        ) : null}
                    </div>
                )}
            </div>

            <div className="shrink-0 border-t border-[var(--studio-line)] p-3">
                {canConfirm && project.currentStage === "shot" ? (
                    <div className="mb-2.5 rounded-lg border border-[color-mix(in_srgb,var(--studio-action)_32%,transparent)] bg-[color-mix(in_srgb,var(--studio-action)_10%,var(--studio-surface))] px-3 py-2 text-xs leading-5 text-[var(--studio-text)]">
                        {translate("drama.storyboardReadyGuide")}
                    </div>
                ) : null}

                <div className="rounded-xl border border-[var(--studio-line-strong)] bg-[var(--studio-surface)] p-2 focus-within:border-[var(--studio-action)]">
                    <Input.TextArea
                        variant="borderless"
                        autoSize={{ minRows: 2, maxRows: 5 }}
                        maxLength={4000}
                        disabled={busy}
                        value={draft}
                        placeholder={project.currentStage === "shot" ? translate("drama.chatPlaceholderShot") : translate("drama.messagePlaceholder")}
                        onChange={(event) => onDraftChange(event.target.value)}
                        onKeyDown={onDraftKeyDown}
                    />
                    <div className="flex items-center justify-between gap-2 px-1 pt-1">
                        <div className="flex min-w-0 items-center gap-1.5">
                            {shots.length > 0 ? (
                                <Dropdown
                                    trigger={["click"]}
                                    menu={{
                                        items: shots.map((shot) => ({
                                            key: shot.ref,
                                            label: `${formatShotNumber(shot.index)} ${shotDisplayTitle(shot, shot.index)}`,
                                            onClick: () => insertShotMention(shot),
                                        })),
                                    }}
                                >
                                    <button
                                        type="button"
                                        aria-label={translate("drama.insertShotRef")}
                                        className="inline-flex size-6 items-center justify-center rounded-md text-[var(--studio-muted)]! hover:bg-[var(--studio-surface-hover)] hover:text-[var(--studio-ink)]!"
                                    >
                                        <AtSign className="size-3.5" />
                                    </button>
                                </Dropdown>
                            ) : null}
                            <button
                                type="button"
                                className="inline-flex min-w-0 items-center gap-1.5 text-[11px]! text-[var(--studio-muted)]! hover:text-[var(--studio-ink)]!"
                                onClick={() => setTasksOpen((open) => !open)}
                            >
                                <span className={`size-1.5 shrink-0 rounded-full ${statusDot(taskStatus)}`} />
                                <span className="truncate">{statusText(translate, taskStatus)}</span>
                            </button>
                        </div>

                        {busy ? (
                            <Button
                                type="primary"
                                shape="circle"
                                size="small"
                                aria-label={translate("drama.stop")}
                                icon={<Square className="size-2.5 fill-current" aria-hidden="true" />}
                                loading={stopping}
                                onClick={onStop}
                            />
                        ) : (
                            <Button
                                type="primary"
                                shape="circle"
                                size="small"
                                aria-label={translate("drama.send")}
                                icon={<ArrowUp className="size-3.5" />}
                                disabled={!draft.trim()}
                                loading={sending}
                                onClick={() => onSend()}
                            />
                        )}
                    </div>
                    {tasksOpen ? (
                        <p className="px-1 pt-2 text-[11px] leading-5 text-[var(--studio-muted)]">
                            {taskMessage || translate("drama.noTaskDetail")}
                        </p>
                    ) : null}
                </div>
            </div>
        </aside>
    );
}

function statusText(translate: ReturnType<typeof useTranslation>, status: string) {
    if (status === "queued") return translate("drama.statusQueued");
    if (status === "running") return translate("drama.statusRunning");
    if (status === "failed") return translate("drama.statusFailed");
    if (status === "interrupted") return translate("drama.statusInterrupted");
    if (status === "canceled") return translate("drama.statusCanceled");
    return translate("drama.statusIdle");
}

function statusDot(status: string) {
    if (status === "queued" || status === "running") return "bg-[var(--studio-info)]";
    if (status === "failed") return "bg-[var(--studio-danger)]";
    if (status === "interrupted" || status === "canceled") return "bg-[var(--studio-warning)]";
    return "bg-[var(--studio-line-strong)]";
}
