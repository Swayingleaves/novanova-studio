"use client";

import { App, Button, Input, Tooltip } from "antd";
import type { TextAreaRef } from "antd/es/input/TextArea";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Bot, Square, X } from "lucide-react";

import type { CreationComposerProps } from "@/features/generation/components/creation-workspace-types";
import { CreditCostDisplay } from "@/features/generation/constants/credits";
import { GenerationStyleCover, GenerationStyleMenu } from "@/features/generation/components/generation-style-picker";
import { filterGenerationStyles, GENERATION_STYLE_SELECTION_LIMIT_MESSAGE, MAX_GENERATION_STYLE_SELECTION_COUNT } from "@/features/generation/lib/generation-style-library";
import { getStyleCommandRange, parseGenerationStyleMessage, removeStyleCommand } from "@/features/generation/lib/style-command";

export function CreationComposer({
    agentLabel = "Novanova Agent",
    value,
    placeholder,
    references,
    styleOptions,
    selectedStyles,
    styleLoading,
    styleError,
    actions,
    running,
    queued = false,
    canSubmit,
    creditCost,
    compact,
    focusWhenValueSet,
    stopping,
    onChange,
    onStyleSelect,
    onStyleRemove,
    onPasteImages,
    onSubmit,
    onStop,
}: CreationComposerProps) {
    const { message } = App.useApp();
    const inputRef = useRef<TextAreaRef>(null);
    const focusedValueRef = useRef(false);
    const [styleMenuOpen, setStyleMenuOpenState] = useState(false);
    const [styleQuery, setStyleQuery] = useState("");
    const [styleCommand, setStyleCommand] = useState<{ start: number; end: number } | null>(null);
    const [highlightedStyleIndex, setHighlightedStyleIndex] = useState(0);
    const toolbarActions = actions.filter((action) => action.placement !== "submit");
    const submitActions = actions.filter((action) => action.placement === "submit");
    const requestActive = running || queued;
    const availableStyles = styleOptions ?? [];
    const activeStyles = selectedStyles ?? [];
    const filteredStyles = useMemo(() => {
        return filterGenerationStyles(availableStyles, styleQuery);
    }, [availableStyles, styleQuery]);

    useEffect(() => {
        if (!focusWhenValueSet || !value.trim() || focusedValueRef.current) return;
        focusedValueRef.current = true;
        requestAnimationFrame(() => inputRef.current?.focus({ cursor: "end" }));
    }, [focusWhenValueSet, value]);

    useEffect(() => {
        setHighlightedStyleIndex((current) => Math.min(current, Math.max(0, filteredStyles.length - 1)));
    }, [filteredStyles.length]);

    const updatePrompt = (nextValue: string, cursor: number) => {
        onChange(nextValue);
        const command = getStyleCommandRange(nextValue, cursor);
        if (!command) {
            setStyleCommand(null);
            closeStyleMenu();
            return;
        }
        setStyleCommand({ start: command.start, end: command.end });
        setStyleQuery(command.query);
        setStyleMenuOpenState(true);
    };

    const chooseStyle = (style: NonNullable<CreationComposerProps["styleOptions"]>[number]) => {
        if (activeStyles.some((selected) => selected.id === style.id)) {
            message.info("该风格已选择");
            return;
        }
        if (activeStyles.length >= MAX_GENERATION_STYLE_SELECTION_COUNT) {
            message.warning(GENERATION_STYLE_SELECTION_LIMIT_MESSAGE);
            return;
        }
        onStyleSelect?.(style);
        if (styleCommand) {
            const nextValue = removeStyleCommand(value, styleCommand.start, styleCommand.end);
            onChange(nextValue);
            requestAnimationFrame(() => {
                const textarea = inputRef.current?.resizableTextArea?.textArea;
                textarea?.focus();
                textarea?.setSelectionRange(styleCommand.start, styleCommand.start);
            });
        }
        setStyleCommand(null);
        setStyleQuery("");
        closeStyleMenu();
    };

    const closeStyleMenu = () => {
        setStyleMenuOpenState(false);
        setStyleCommand(null);
        setStyleQuery("");
        setHighlightedStyleIndex(0);
    };
    const openStyleMenu = () => {
        setStyleCommand(null);
        setStyleQuery("");
        setHighlightedStyleIndex(0);
        setStyleMenuOpenState(true);
        requestAnimationFrame(() => inputRef.current?.focus({ cursor: "end" }));
    };

    const pasteStyleMessage = (pastedText: string) => {
        if (!onStyleSelect) return false;
        const parsed = parseGenerationStyleMessage(pastedText, availableStyles);
        if (!parsed) return false;
        const textarea = inputRef.current?.resizableTextArea?.textArea;
        const start = textarea?.selectionStart ?? value.length;
        const end = textarea?.selectionEnd ?? start;
        const additions = parsed.styles.filter((style) => !activeStyles.some((selected) => selected.id === style.id));
        const remaining = Math.max(0, MAX_GENERATION_STYLE_SELECTION_COUNT - activeStyles.length);
        if (additions.length > remaining) {
            message.warning(GENERATION_STYLE_SELECTION_LIMIT_MESSAGE);
        }
        const nextValue = `${value.slice(0, start)}${parsed.prompt}${value.slice(end)}`;
        additions.slice(0, remaining).forEach((style) => onStyleSelect(style));
        onChange(nextValue);
        setStyleCommand(null);
        setStyleQuery("");
        closeStyleMenu();
        requestAnimationFrame(() => {
            const nextTextarea = inputRef.current?.resizableTextArea?.textArea;
            const cursor = start + parsed.prompt.length;
            nextTextarea?.focus();
            nextTextarea?.setSelectionRange(cursor, cursor);
        });
        return true;
    };

    const renderAction = (action: CreationComposerProps["actions"][number]) => (
        <Tooltip key={action.key} title={action.label}>
            <Button
                size="small"
                className={["creation-composer-action", action.iconOnly ? "creation-composer-action-icon" : "", action.className].filter(Boolean).join(" ")}
                icon={action.icon}
                disabled={action.disabled}
                loading={action.loading}
                onClick={action.onClick}
                aria-label={action.iconOnly ? action.label : undefined}
            >
                {action.iconOnly ? null : <span className="creation-composer-action-label">{action.label}</span>}
            </Button>
        </Tooltip>
    );

    return (
        <div className="creation-composer-band">
            <div className="relative mx-auto w-full max-w-5xl lg:-left-4">
                <div className={`creation-composer-tray px-3 py-3 sm:px-4${compact ? " creation-composer-tray-compact" : ""}`}>
                    <div className="creation-composer-head">
                        <span className="inline-flex min-w-0 items-center gap-1.5">
                            <span className="inline-flex shrink-0 items-center gap-1" aria-hidden="true">
                                <Bot className="size-3.5" strokeWidth={1.6} />
                                <span className="size-1.5 rounded-full bg-[var(--studio-action)] shadow-[0_0_0_3px_var(--studio-primary-soft)]" />
                            </span>
                            <span className="sr-only">Agent 已就绪</span>
                            <span className="truncate">{agentLabel}</span>
                        </span>
                        <span>{queued ? "排队中" : running ? "生成中" : `${value.length} / 2000`}</span>
                    </div>
                    {references.length || activeStyles.length ? (
                        <div className={`flex flex-wrap gap-2 overflow-hidden transition-all duration-200 ${compact ? "invisible mb-0 max-h-0 opacity-0" : "mb-3 max-h-56 opacity-100"}`}>
                            {activeStyles.map((style) => (
                                <div key={`style-${style.id}`} className="creation-composer-chip">
                                    <GenerationStyleCover style={style} className="size-5 shrink-0 overflow-hidden rounded-sm" />
                                    <span className="min-w-0 max-w-32 truncate text-xs font-medium text-[var(--studio-muted)]">{style.name}</span>
                                    <button type="button" className="creation-composer-chip-remove" onClick={() => onStyleRemove?.(style.id)} aria-label={`移除风格${style.name}`}>
                                        <X className="size-3.5" />
                                    </button>
                                </div>
                            ))}
                            {references.map((item) => (
                                <div key={item.id} className="creation-composer-chip">
                                    <div className="shrink-0">{item.preview}</div>
                                    <span className="min-w-0 max-w-32 truncate text-xs font-medium text-[var(--studio-muted)]">{item.label}</span>
                                    <button type="button" className="creation-composer-chip-remove" onClick={item.onRemove} aria-label={`移除${item.label}`}>
                                        <X className="size-3.5" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    ) : null}

                    <div className={`creation-composer-input-shell relative${compact ? " creation-composer-input-shell-compact" : ""}`}>
                        <Input.TextArea
                            ref={inputRef}
                            value={value}
                            autoSize={compact ? { minRows: 1, maxRows: 6 } : { minRows: 3, maxRows: 6 }}
                            placeholder={placeholder}
                            className="creation-composer-textarea"
                            onChange={(event) => updatePrompt(event.target.value, event.target.selectionStart ?? event.target.value.length)}
                            onPaste={(event) => {
                                const pastedText = event.clipboardData.getData("text/plain");
                                if (pasteStyleMessage(pastedText)) {
                                    event.preventDefault();
                                    return;
                                }
                                const images = Array.from(event.clipboardData.items)
                                    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
                                    .map((item) => item.getAsFile())
                                    .filter((file): file is File => file !== null);
                                if (!images.length || !onPasteImages) return;
                                event.preventDefault();
                                onPasteImages(images);
                            }}
                            onKeyDown={(event) => {
                                if (styleMenuOpen) {
                                    if (event.key === "ArrowDown") {
                                        event.preventDefault();
                                        setHighlightedStyleIndex((current) => Math.min(current + 1, Math.max(0, filteredStyles.length - 1)));
                                        return;
                                    }
                                    if (event.key === "ArrowUp") {
                                        event.preventDefault();
                                        setHighlightedStyleIndex((current) => Math.max(0, current - 1));
                                        return;
                                    }
                                    if (event.key === "Enter" && !event.shiftKey) {
                                        event.preventDefault();
                                        const style = filteredStyles[highlightedStyleIndex];
                                        if (style) chooseStyle(style);
                                        return;
                                    }
                                    if (event.key === "Escape") {
                                        event.preventDefault();
                                        closeStyleMenu();
                                        return;
                                    }
                                }
                                if (event.key === "Enter" && !event.shiftKey) {
                                    event.preventDefault();
                                    if (canSubmit && !requestActive) {
                                        onSubmit();
                                    }
                                }
                            }}
                        />
                    </div>

                    <div className={`creation-composer-toolbar flex flex-wrap items-center gap-2 overflow-hidden transition-all duration-200 ${compact ? "invisible mt-0 max-h-0 opacity-0" : "mt-3 max-h-24 opacity-100"}`}>
                        <GenerationStyleMenu
                            styles={availableStyles}
                            selected={activeStyles}
                            loading={styleLoading}
                            error={styleError}
                            open={styleMenuOpen}
                            query={styleQuery}
                            highlightedIndex={highlightedStyleIndex}
                            placement="topLeft"
                            onOpenChange={(open) => {
                                if (open) openStyleMenu();
                                else closeStyleMenu();
                            }}
                            onQueryChange={setStyleQuery}
                            onHighlightedIndexChange={setHighlightedStyleIndex}
                            onSelectionLimit={() => message.warning(GENERATION_STYLE_SELECTION_LIMIT_MESSAGE)}
                            onSelect={chooseStyle}
                        />
                        {toolbarActions.map(renderAction)}
                        <div className="flex-1" />
                        <div className="flex shrink-0 items-center gap-2">
                            {submitActions.map(renderAction)}
                            {requestActive && onStop ? (
                                <Tooltip title={queued ? "取消排队" : "停止生成"}>
                                    <Button
                                        type="primary"
                                        size="small"
                                        className="creation-composer-submit"
                                        disabled={stopping}
                                        loading={stopping}
                                        onClick={onStop}
                                        aria-label={stopping ? "正在停止生成" : queued ? "取消排队" : "停止生成"}
                                        icon={<Square className="size-3.5 fill-current" strokeWidth={2.2} />}
                                    />
                                </Tooltip>
                            ) : (
                                <button
                                    type="button"
                                    className="creation-composer-submit-trigger creation-composer-submit-trigger-cost"
                                    disabled={!canSubmit || requestActive}
                                    onClick={onSubmit}
                                    aria-label={queued ? "排队中" : running ? "生成中" : `生成，当前会消耗 ${creditCost.toLocaleString()} 积分`}
                                >
                                    {queued || running ? (
                                        queued ? "排队中" : "生成中"
                                    ) : (
                                        <>
                                            <CreditCostDisplay creditCost={creditCost} className="text-xs font-medium" />
                                            <ArrowUp className="size-[18px] shrink-0" strokeWidth={2.1} />
                                        </>
                                    )}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
