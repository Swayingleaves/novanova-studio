"use client";
import { currentLanguageTag } from "@/features/locale/translate";

import { useTranslation } from "@/features/locale/use-translation";


import { App, Button, Input, Popover, Segmented, Tooltip } from "antd";
import type { TextAreaRef } from "antd/es/input/TextArea";
import { Fragment, useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { ArrowUp, Bot, LoaderCircle, Square, X } from "lucide-react";

import type { CreationComposerProps, CreationStyleOption } from "@/features/generation/components/creation-workspace-types";
import type { CreationMode } from "@/features/generation/lib/creation-mode-preference";
import { CreditCostDisplay } from "@/features/generation/constants/credits";
import { GenerationStyleCover, GenerationStyleMenu } from "@/features/generation/components/generation-style-picker";
import { filterGenerationStyles, MAX_GENERATION_STYLE_SELECTION_COUNT } from "@/features/generation/lib/generation-style-library";
import { getStyleCommandRange, parseGenerationStyleMessage, removeStyleCommand } from "@/features/generation/lib/style-command";
import { useSpaceBrand } from "@/features/team/use-space-brand";
import { ReferencePromptInput, type ReferencePromptInputHandle } from "@/features/generation/components/reference-prompt-input";

export function CreationComposer({
    agentLabel,
    value,
    placeholder,
    references,
    imageReferences,
    styleOptions,
    selectedStyles,
    styleLoading,
    styleError,
    selectedSkill,
    actions,
    creationMode,
    onCreationModeChange,
    chatModeLocked = false,
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
    onSkillRemove,
    onPasteImages,
    onSubmit,
    onStop,
    notice,
    embedded = false,
    headerExtra,
}: CreationComposerProps) {
    const translate = useTranslation();
    const brand = useSpaceBrand();
    const { message } = App.useApp();
    const inputRef = useRef<TextAreaRef>(null);
    const referenceInputRef = useRef<ReferencePromptInputHandle>(null);
    const focusedValueRef = useRef(false);
    const [styleMenuOpen, setStyleMenuOpenState] = useState(false);
    const [styleQuery, setStyleQuery] = useState("");
    const [styleCommand, setStyleCommand] = useState<{ start: number; end: number } | null>(null);
    const [highlightedStyleIndex, setHighlightedStyleIndex] = useState(0);
    const toolbarActions = actions.filter((action) => action.placement !== "submit");
    const submitActions = actions.filter((action) => action.placement === "submit");
    const requestActive = running || queued;
    const chatMode = creationMode === "chat";
    const availableStyles = styleOptions ?? [];
    const activeStyles: CreationStyleOption[] = chatMode ? [] : selectedStyles ?? [];
    const activeSkill = chatMode ? null : selectedSkill;
    const filteredStyles = useMemo(() => {
        return filterGenerationStyles(availableStyles, styleQuery);
    }, [availableStyles, styleQuery, translate.locale]);

    const focusInput = (start = value.length, end = start) => {
        if (imageReferences) {
            referenceInputRef.current?.focus();
            referenceInputRef.current?.setSelectionRange(start, end);
        } else {
            const textarea = inputRef.current?.resizableTextArea?.textArea;
            textarea?.focus();
            textarea?.setSelectionRange(start, end);
        }
    };

    useEffect(() => {
        if (!focusWhenValueSet || !value.trim() || focusedValueRef.current) return;
        focusedValueRef.current = true;
        requestAnimationFrame(() => focusInput());
    }, [focusWhenValueSet, value]);

    useEffect(() => {
        setHighlightedStyleIndex((current) => Math.min(current, Math.max(0, filteredStyles.length - 1)));
    }, [filteredStyles.length]);

    useEffect(() => {
        if (!chatMode) return;
        setStyleMenuOpenState(false);
        setStyleCommand(null);
        setStyleQuery("");
    }, [chatMode]);

    const updatePrompt = (nextValue: string, cursor: number) => {
        onChange(nextValue);
        const command = chatMode ? null : getStyleCommandRange(nextValue, cursor);
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
            message.info(translate("generation.styleAlreadySelected"));
            return;
        }
        onStyleSelect?.(style);
        if (styleCommand) {
            const nextValue = removeStyleCommand(value, styleCommand.start, styleCommand.end);
            onChange(nextValue);
            requestAnimationFrame(() => focusInput(styleCommand.start));
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
        requestAnimationFrame(() => focusInput());
    };

    const pasteStyleMessage = (pastedText: string) => {
        if (chatMode || !onStyleSelect) return false;
        const parsed = parseGenerationStyleMessage(pastedText, availableStyles);
        if (!parsed) return false;
        const textarea = inputRef.current?.resizableTextArea?.textArea;
        const selection = referenceInputRef.current?.getSelection();
        const start = selection?.start ?? textarea?.selectionStart ?? value.length;
        const end = selection?.end ?? textarea?.selectionEnd ?? start;
        const additions = parsed.styles.filter((style) => !activeStyles.some((selected) => selected.id === style.id));
        const remaining = Math.max(0, MAX_GENERATION_STYLE_SELECTION_COUNT - activeStyles.length);
        if (additions.length > remaining) {
            message.warning(translate("generation.selectUpToStyles", { value0: MAX_GENERATION_STYLE_SELECTION_COUNT }));
        }
        const nextValue = `${value.slice(0, start)}${parsed.prompt}${value.slice(end)}`;
        additions.slice(0, remaining).forEach((style) => onStyleSelect(style));
        onChange(nextValue);
        setStyleCommand(null);
        setStyleQuery("");
        closeStyleMenu();
        requestAnimationFrame(() => focusInput(start + parsed.prompt.length));
        return true;
    };

    const handlePaste = (event: ClipboardEvent) => {
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
    };

    const handleKeyDown = (event: KeyboardEvent) => {
        if (event.nativeEvent.isComposing) return;
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
            if (canSubmit && !requestActive) onSubmit();
        }
    };

    const renderAction = (action: CreationComposerProps["actions"][number]) => {
        // 设置摘要按「比例 · 分辨率 · 秒数」重排，并在最左侧补一个按真实比例绘制的小图标。
        const summary = action.className?.includes("creation-composer-action-settings") && action.label.includes("|") ? splitSettingsSummary(action.label) : null;
        const summaryText = summary ? summary.text : action.label;
        const button = (
            <Button
                size="small"
                data-tour={`composer-${action.key}`}
                className={["creation-composer-action", action.iconOnly ? "creation-composer-action-icon" : "", action.className].filter(Boolean).join(" ")}
                icon={summary ? <SettingsRatioGlyph ratio={summary.ratio} /> : action.icon}
                disabled={action.disabled}
                loading={action.loading}
                onClick={action.onClick}
                aria-label={action.iconOnly ? summaryText : undefined}
            >
                {action.iconOnly ? null : <span className="creation-composer-action-label">{summaryText}</span>}
            </Button>
        );
        const trigger = action.popoverContent ? (
            <Popover content={action.popoverContent} trigger="hover" placement="topLeft" mouseEnterDelay={0.1} mouseLeaveDelay={0.15}>
                {button}
            </Popover>
        ) : (
            <Tooltip title={summaryText}>{button}</Tooltip>
        );
        if (action.className?.includes("creation-composer-action-settings")) {
            return <div key={action.key} className="creation-composer-settings-slot">{trigger}</div>;
        }
        return <Fragment key={action.key}>{trigger}{action.trailing}</Fragment>;
    };

    return (
        <div className="creation-composer-band">
            <div className={`relative mx-auto w-full max-w-5xl${embedded ? "" : " lg:-left-4"}`}>
                <div className={`creation-composer-tray px-3 py-3 sm:px-4${compact ? " creation-composer-tray-compact" : ""}`}>
                    <div className="creation-composer-head">
                        <span className="inline-flex min-w-0 items-center gap-2">
                            <span className="inline-flex shrink-0 items-center gap-1.5">
                                <span className="inline-flex shrink-0 items-center gap-1" aria-hidden="true">
                                    <Bot className="size-3.5" strokeWidth={1.6} />
                                    <span className="size-1.5 rounded-full bg-[var(--studio-action)] shadow-[0_0_0_3px_var(--studio-primary-soft)]" />
                                </span>
                                <span className="sr-only">{translate("generation.agentReady")}</span>
                                <span className="truncate">{agentLabel ?? brand.agentName}</span>
                            </span>
                            {headerExtra}
                        </span>
                        <span>{queued ? translate("generation.queued") : running ? translate("generation.generating") : `${value.length} / 2000`}</span>
                    </div>
                    {notice}

                    {references.length || activeStyles.length || activeSkill ? (
                        <div className={`flex flex-wrap gap-2 overflow-hidden transition-all duration-200 ${compact ? "invisible mb-0 max-h-0 opacity-0" : "mb-3 max-h-56 opacity-100"}`}>
                            {activeSkill ? (
                                <div className="creation-composer-chip">
                                    <GenerationStyleCover style={activeSkill} className="size-5 shrink-0 overflow-hidden rounded-sm" />
                                    <span className="min-w-0 max-w-32 truncate text-xs font-medium text-[var(--studio-muted)]">{activeSkill.name}</span>
                                    <button type="button" className="creation-composer-chip-remove" onClick={onSkillRemove} aria-label={translate("generation.removeSkill", { value0: activeSkill.name })}>
                                        <X className="size-3.5" />
                                    </button>
                                </div>
                            ) : null}
                            {activeStyles.map((style) => (
                                <div key={`style-${style.id}`} className="creation-composer-chip">
                                    <GenerationStyleCover style={style} className="size-5 shrink-0 overflow-hidden rounded-sm" />
                                    <span className="min-w-0 max-w-32 truncate text-xs font-medium text-[var(--studio-muted)]">{style.name}</span>
                                    <button type="button" className="creation-composer-chip-remove" onClick={() => onStyleRemove?.(style.id)} aria-label={translate("generation.removeStyle", { value0: style.name })}>
                                        <X className="size-3.5" />
                                    </button>
                                </div>
                            ))}
                            {references.map((item) => (
                                <div key={item.id} className="creation-composer-chip">
                                    <div className="shrink-0">{item.preview}</div>
                                    <span className="min-w-0 max-w-32 truncate text-xs font-medium text-[var(--studio-muted)]">{item.label}</span>
                                    <button type="button" className="creation-composer-chip-remove" onClick={item.onRemove} aria-label={translate("generation.remove", { value0: item.label })}>
                                        <X className="size-3.5" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    ) : null}

                    <div className={`creation-composer-input-shell relative${compact ? " creation-composer-input-shell-compact" : ""}`}>
                        {imageReferences ? <ReferencePromptInput
                            ref={referenceInputRef}
                            value={value}
                            placeholder={placeholder}
                            images={imageReferences}
                            compact={compact}
                            onChange={updatePrompt}
                            onKeyDown={handleKeyDown}
                            onPaste={handlePaste}
                        /> : <Input.TextArea
                            ref={inputRef}
                            value={value}
                            autoSize={compact ? { minRows: 1, maxRows: 6 } : { minRows: 3, maxRows: 6 }}
                            placeholder={placeholder}
                            className="creation-composer-textarea"
                            onChange={(event) => updatePrompt(event.target.value, event.target.selectionStart ?? event.target.value.length)}
                            onPaste={handlePaste}
                            onKeyDown={handleKeyDown}
                        />}
                    </div>

                    <div className={`creation-composer-toolbar flex flex-nowrap items-center gap-2 overflow-hidden transition-all duration-200 ${compact ? "invisible mt-0 max-h-0 opacity-0" : embedded ? "mt-3 max-h-none opacity-100" : "mt-3 max-h-24 opacity-100"}`}>
                        <div className="creation-composer-toolbar-main">
                            <GenerationStyleMenu
                                styles={availableStyles}
                                selected={activeStyles}
                                loading={styleLoading}
                                error={styleError}
                                open={styleMenuOpen}
                                disabled={chatMode}
                                query={styleQuery}
                                highlightedIndex={highlightedStyleIndex}
                                placement="topLeft"
                                dataTour="composer-style"
                                onOpenChange={(open) => {
                                    if (open) openStyleMenu();
                                    else closeStyleMenu();
                                }}
                                onQueryChange={setStyleQuery}
                                onHighlightedIndexChange={setHighlightedStyleIndex}
                                onSelect={chooseStyle}
                            />
                            {toolbarActions.map(renderAction)}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                            <Tooltip title={requestActive ? translate("generation.modeSwitchLocked") : chatModeLocked ? translate("generation.skillMarketAgentOnly") : chatMode ? translate("generation.switchToAgentMode") : translate("generation.switchToChatMode")}>
                                <span className="inline-flex h-9 items-center" data-tour="composer-mode">
                                    <Segmented
                                        className="creation-composer-mode"
                                        value={chatMode && !chatModeLocked ? "chat" : "agent"}
                                        options={[
                                            { label: translate("generation.agentModeShort"), value: "agent" },
                                            { label: translate("generation.chatModeShort"), value: "chat", disabled: chatModeLocked },
                                        ]}
                                        disabled={requestActive}
                                        onChange={(value) => {
                                            if (chatModeLocked && value === "chat") return;
                                            onCreationModeChange?.(value as CreationMode);
                                        }}
                                    />
                                </span>
                            </Tooltip>
                            {submitActions.map(renderAction)}
                            {requestActive && onStop ? (
                                <Tooltip title={queued ? translate("generation.leaveQueue") : translate("generation.stopGeneration")}>
                                    <Button
                                        type="primary"
                                        size="small"
                                        className="creation-composer-submit"
                                        disabled={stopping}
                                        loading={stopping}
                                        onClick={onStop}
                                        aria-label={stopping ? translate("generation.stoppingGeneration") : queued ? translate("generation.leaveQueue") : translate("generation.stopGeneration")}
                                        icon={<Square className="size-3.5 fill-current" strokeWidth={2.2} />}
                                    />
                                </Tooltip>
                            ) : (
                                <button
                                    type="button"
                                    data-tour="creation-submit"
                                    className="creation-composer-submit-trigger creation-composer-submit-trigger-cost"
                                    disabled={!canSubmit || requestActive}
                                    onClick={onSubmit}
                                    aria-label={queued ? translate("generation.queued") : running ? translate("generation.generating") : creditCost === undefined ? translate("generation.generate") : creditCost === null ? translate("generation.quoteUnavailableForThisConfiguration") : translate("generation.generateCostsCredits", { value0: creditCost.toLocaleString(currentLanguageTag()) })}
                                >
                                    {queued || running ? (
                                        queued ? translate("generation.queued") : translate("generation.generating")
                                    ) : (
                                        <>
                                            {creditCost === undefined ? null : creditCost === null ? <span className="text-xs font-medium">{translate("generation.quoteUnavailable")}</span> : <CreditCostDisplay creditCost={creditCost} className="text-xs font-medium" />}
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

/**
 * 拆分设置摘要（如「720p|16:9|5s」），把比例段提到最前并改用「 · 」连接。
 * <p>
 * 图片摘要是「画质|清晰度|比例」，视频摘要是「清晰度|比例|秒数」，统一后按钮展示顺序一致。
 */
function splitSettingsSummary(label: string) {
    const segments = label.split("|").map((item) => item.trim()).filter(Boolean);
    const ratioIndex = segments.findIndex((item) => /^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(item));
    if (ratioIndex > 0) {
        const [ratio] = segments.splice(ratioIndex, 1);
        segments.unshift(ratio);
    }
    return { ratio: ratioIndex >= 0 ? segments[0] : "", text: segments.join(" · ") };
}

/** 按真实宽高比绘制设置摘要前的小图标，未识别到比例时退回 16:9。 */
function SettingsRatioGlyph({ ratio }: { ratio: string }) {
    const matched = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(ratio);
    const width = matched ? Number(matched[1]) : 16;
    const height = matched ? Number(matched[2]) : 9;
    const value = width / height;
    const boxWidth = value >= 1 ? 14 : Math.max(6, 14 * value);
    const boxHeight = value >= 1 ? Math.max(6, 14 / value) : 14;
    return (
        <span className="grid size-4 shrink-0 place-items-center" aria-hidden="true">
            <span className="rounded-[2px] border border-current opacity-70" style={{ width: boxWidth, height: boxHeight }} />
        </span>
    );
}
