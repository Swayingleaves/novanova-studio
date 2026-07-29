"use client";

import { Button, Input, Tooltip } from "antd";
import type { TextAreaRef } from "antd/es/input/TextArea";
import { useEffect, useRef } from "react";
import { ArrowUp, Bot, Square, X } from "lucide-react";

import type { CreationComposerProps } from "@/features/generation/components/creation-workspace-types";
import { CreditCostDisplay } from "@/features/generation/constants/credits";

export function CreationComposer({ agentLabel = "Novanova Agent", value, placeholder, references, actions, running, canSubmit, creditCost, compact, focusWhenValueSet, stopping, onChange, onPasteImages, onSubmit, onStop }: CreationComposerProps) {
    const inputRef = useRef<TextAreaRef>(null);
    const focusedValueRef = useRef(false);
    const toolbarActions = actions.filter((action) => action.placement !== "submit");
    const submitActions = actions.filter((action) => action.placement === "submit");

    useEffect(() => {
        if (!focusWhenValueSet || !value.trim() || focusedValueRef.current) return;
        focusedValueRef.current = true;
        requestAnimationFrame(() => inputRef.current?.focus({ cursor: "end" }));
    }, [focusWhenValueSet, value]);

    const renderAction = (action: CreationComposerProps["actions"][number]) => (
        <Tooltip key={action.key} title={action.label}>
            <Button
                size="small"
                className={`creation-composer-action${action.iconOnly ? " creation-composer-action-icon" : ""}`}
                icon={action.icon}
                disabled={action.disabled}
                loading={action.loading}
                onClick={action.onClick}
                aria-label={action.iconOnly ? action.label : undefined}
            >
                {action.iconOnly ? null : action.label}
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
                        <span>{value.length} / 2000</span>
                    </div>
                    {references.length ? (
                        <div className={`flex flex-wrap gap-2 overflow-hidden transition-all duration-200 ${compact ? "invisible mb-0 max-h-0 opacity-0" : "mb-3 max-h-56 opacity-100"}`}>
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

                    <div className={`creation-composer-input-shell${compact ? " creation-composer-input-shell-compact" : ""}`}>
                        <Input.TextArea
                            ref={inputRef}
                            value={value}
                            autoSize={compact ? { minRows: 1, maxRows: 6 } : { minRows: 3, maxRows: 6 }}
                            placeholder={placeholder}
                            className="creation-composer-textarea"
                            onChange={(event) => onChange(event.target.value)}
                            onPaste={(event) => {
                                const images = Array.from(event.clipboardData.items)
                                    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
                                    .map((item) => item.getAsFile())
                                    .filter((file): file is File => file !== null);
                                if (!images.length || !onPasteImages) return;
                                event.preventDefault();
                                onPasteImages(images);
                            }}
                            onKeyDown={(event) => {
                                if (event.key === "Enter" && !event.shiftKey) {
                                    event.preventDefault();
                                    if (canSubmit && !running) {
                                        onSubmit();
                                    }
                                }
                            }}
                        />
                    </div>

                    <div className={`creation-composer-toolbar flex flex-wrap items-center gap-2 overflow-hidden transition-all duration-200 ${compact ? "invisible mt-0 max-h-0 opacity-0" : "mt-3 max-h-24 opacity-100"}`}>
                        {toolbarActions.map(renderAction)}
                        <div className="flex-1" />
                        <div className="flex shrink-0 items-center gap-2">
                            {submitActions.map(renderAction)}
                            {running && onStop ? (
                                <Tooltip title="停止生成">
                                    <Button
                                        type="primary"
                                        size="small"
                                        className="creation-composer-submit"
                                        disabled={stopping}
                                        loading={stopping}
                                        onClick={onStop}
                                        aria-label={stopping ? "正在停止生成" : "停止生成"}
                                        icon={<Square className="size-3.5 fill-current" strokeWidth={2.2} />}
                                    />
                                </Tooltip>
                            ) : (
                                <button
                                    type="button"
                                    className="creation-composer-submit-trigger creation-composer-submit-trigger-cost"
                                    disabled={!canSubmit || running}
                                    onClick={onSubmit}
                                    aria-label={running ? "生成中" : `生成，当前会消耗 ${creditCost.toLocaleString()} 积分`}
                                >
                                    {running ? (
                                        "生成中"
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
