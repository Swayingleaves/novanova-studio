"use client";

import { useState } from "react";
import { Button, Input } from "antd";
import { Check, Copy, RotateCcw, Undo2 } from "lucide-react";
import { StreamingReplyBubble } from "@/features/generation/components/streaming-reply-bubble";
import { useTranslation } from "@/features/locale/use-translation";
import { useCopyText } from "@/shared/hooks/use-copy-text";
import type { ServerAgentSessionHistoryMessage } from "@/services/api/server";
import type { DramaStage, DramaWorkspace } from "@/services/api/drama";
import { dramaStageMeta } from "../stage-meta";
import { DramaMediaCard, DramaStageCard, parseDramaMeta, type DramaMessageChoice } from "./stage-card";

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
    thinking = false,
    showSuggestions = false,
    onHeightChange,
    onView,
    onRegenerate,
    onUndo,
    onSuggest,
    onSelectChoice,
}: {
    message: ServerAgentSessionHistoryMessage;
    workspace: DramaWorkspace | null;
    busy: boolean;
    streaming?: boolean;
    thinking?: boolean;
    showSuggestions?: boolean;
    onHeightChange?: () => void;
    onView: (stage: DramaStage, versionId?: string) => void;
    onRegenerate?: () => void;
    onUndo?: (versionId: string) => void;
    onSuggest: (text: string) => void;
    onSelectChoice?: (text: string) => void;
}) {
    const translate = useTranslation();
    const copy = useCopyText();

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
    const choices = Array.isArray(meta?.choices)
        ? meta.choices.filter((item): item is DramaMessageChoice => Boolean(item && (item.label || item.customInput)))
        : [];
    const showChoices = showSuggestions && !busy && !streaming && choices.length > 0;
    const suggestions = showSuggestions && !busy && !choices.length ? identity.suggestions : [];
    const stamp = chatTime(message.createdAt, translate);

    return (
        <article className="flex gap-2.5">
            <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-[var(--studio-primary-soft)] text-[var(--studio-action-emphasis)]">
                <Icon className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
                <header className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-medium text-[var(--studio-ink)]">{translate(identity.agentKey)}</span>
                    {streaming || !stamp ? null : <span className="text-xs text-[var(--studio-faint)]">· {stamp}</span>}
                </header>
                {streaming ? (
                    <div className="mt-1.5">
                        <StreamingReplyBubble
                            animated
                            text={message.text}
                            thinking={thinking}
                            thinkingLabel={translate("chat.thinking")}
                            onHeightChange={onHeightChange}
                        />
                    </div>
                ) : message.text ? (
                    <div className="mt-1.5">
                        <StreamingReplyBubble animated={false} text={message.text} />
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
                {showChoices ? (
                    <DramaChoiceList
                        choices={choices}
                        multiple={Boolean(meta?.multiple)}
                        disabled={busy}
                        onSubmit={(text) => (onSelectChoice || onSuggest)(text)}
                    />
                ) : null}
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

/** 竖向单选/多选选项列表：默认单选框样式，multiple 为 true 时切换为复选框。 */
function DramaChoiceList({
    choices,
    multiple,
    disabled,
    onSubmit,
}: {
    choices: DramaMessageChoice[];
    multiple: boolean;
    disabled: boolean;
    onSubmit: (text: string) => void;
}) {
    const [selected, setSelected] = useState<number[]>([]);
    const [customActive, setCustomActive] = useState(false);
    const [customText, setCustomText] = useState("");

    const submitCustom = () => {
        const value = customText.trim();
        if (!value || disabled) return;
        onSubmit(value);
    };

    const submitMultiple = () => {
        if (disabled) return;
        const picked = selected
            .map((index) => choices[index])
            .filter((item): item is DramaMessageChoice => Boolean(item && !item.customInput))
            .map((item) => (item.value || item.label).trim())
            .filter(Boolean);
        if (customActive && customText.trim()) {
            picked.push(customText.trim());
        }
        if (!picked.length) return;
        onSubmit(picked.join("、"));
    };

    const handleOptionClick = (index: number, item: DramaMessageChoice) => {
        if (disabled) return;
        if (multiple) {
            if (item.customInput) {
                setCustomActive((value) => !value);
                return;
            }
            setSelected((prev) => (prev.includes(index) ? prev.filter((value) => value !== index) : [...prev, index]));
            return;
        }
        if (item.customInput) {
            setSelected([index]);
            setCustomActive(true);
            return;
        }
        setSelected([index]);
        setCustomActive(false);
        const payload = (item.value || item.label).trim();
        if (payload) onSubmit(payload);
    };

    const canSubmitMultiple = selected.some((index) => !choices[index]?.customInput) || (customActive && Boolean(customText.trim()));

    return (
        <div className="mt-2.5 flex flex-col gap-2" role={multiple ? "group" : "radiogroup"}>
            {choices.map((item, index) => {
                const isSelected = item.customInput ? customActive : selected.includes(index);
                return (
                    <div key={`${item.label}-${index}`} className="flex flex-col gap-1.5">
                        <button
                            type="button"
                            role={multiple ? "checkbox" : "radio"}
                            aria-checked={isSelected}
                            disabled={disabled}
                            onClick={() => handleOptionClick(index, item)}
                            className={`flex w-full items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors disabled:opacity-50 ${
                                isSelected
                                    ? "border-[var(--studio-action)] bg-[var(--studio-primary-soft)]"
                                    : "border-[var(--studio-line-strong)] bg-[var(--studio-surface)] hover:border-[var(--studio-action)] hover:bg-[var(--studio-surface-hover)]"
                            }`}
                        >
                            {multiple ? (
                                <span
                                    aria-hidden="true"
                                    className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded border transition-colors ${
                                        isSelected
                                            ? "border-[var(--studio-action)] bg-[var(--studio-action)] text-[var(--studio-action-foreground)]"
                                            : "border-[var(--studio-line-strong)] bg-transparent"
                                    }`}
                                >
                                    {isSelected ? <Check className="size-3" /> : null}
                                </span>
                            ) : (
                                <span
                                    aria-hidden="true"
                                    className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border transition-colors ${
                                        isSelected ? "border-[var(--studio-action)]" : "border-[var(--studio-line-strong)]"
                                    }`}
                                >
                                    {isSelected ? <span className="size-2 rounded-full bg-[var(--studio-action)]" /> : null}
                                </span>
                            )}
                            <span className="min-w-0 flex-1">
                                <span className="block text-xs! font-medium leading-5 text-[var(--studio-ink)]!">
                                    {item.label}
                                </span>
                                {item.description ? (
                                    <span className="mt-0.5 block text-[11px]! leading-4 text-[var(--studio-muted)]!">
                                        {item.description}
                                    </span>
                                ) : null}
                            </span>
                        </button>
                        {item.customInput && customActive ? (
                            <div className="flex items-center gap-2 pl-6">
                                <Input
                                    size="small"
                                    autoFocus
                                    disabled={disabled}
                                    value={customText}
                                    placeholder={item.placeholder || "请输入自定义内容"}
                                    onChange={(event) => setCustomText(event.target.value)}
                                    onPressEnter={() => {
                                        if (multiple) submitMultiple();
                                        else submitCustom();
                                    }}
                                />
                                {!multiple ? (
                                    <Button type="primary" size="small" disabled={disabled || !customText.trim()} onClick={submitCustom}>
                                        确定
                                    </Button>
                                ) : null}
                            </div>
                        ) : null}
                    </div>
                );
            })}
            {multiple ? (
                <div className="pt-0.5">
                    <Button type="primary" size="small" disabled={disabled || !canSubmitMultiple} onClick={submitMultiple}>
                        确认选择
                    </Button>
                </div>
            ) : null}
        </div>
    );
}
