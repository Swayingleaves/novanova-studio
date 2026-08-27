"use client";

import { App, Button, Input, Popover, Tooltip } from "antd";
import type { TextAreaRef } from "antd/es/input/TextArea";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Bot, LoaderCircle, Sparkles, Square, X } from "lucide-react";

import type { CreationComposerProps } from "@/features/generation/components/creation-workspace-types";
import { CreditCostDisplay } from "@/features/generation/constants/credits";
import { GenerationStyleCover, GenerationStyleMenu } from "@/features/generation/components/generation-style-picker";
import { filterGenerationStyles, GENERATION_STYLE_SELECTION_LIMIT_MESSAGE, MAX_GENERATION_STYLE_SELECTION_COUNT } from "@/features/generation/lib/generation-style-library";
import { getStyleCommandRange, parseGenerationStyleMessage, removeStyleCommand } from "@/features/generation/lib/style-command";
import type { SkillOption } from "@/services/api/server";

export function CreationComposer({
    agentLabel = "Novanova Agent",
    value,
    placeholder,
    references,
    styleOptions,
    selectedStyles,
    styleLoading,
    styleError,
    skillOptions,
    selectedSkill,
    skillLoading,
    skillError,
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
    onSkillSelect,
    onSkillRemove,
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
    const [skillMenuOpen, setSkillMenuOpen] = useState(false);
    const toolbarActions = actions.filter((action) => action.placement !== "submit");
    const submitActions = actions.filter((action) => action.placement === "submit");
    const requestActive = running || queued;
    const availableStyles = styleOptions ?? [];
    const activeStyles = selectedStyles ?? [];
    const availableSkills = skillOptions ?? [];
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

    const renderAction = (action: CreationComposerProps["actions"][number]) => {
        const button = (
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
        );
        if (action.popoverContent) {
            return (
                <Popover key={action.key} content={action.popoverContent} trigger="hover" placement="topLeft" mouseEnterDelay={0.1} mouseLeaveDelay={0.15}>
                    {button}
                </Popover>
            );
        }
        return <Tooltip key={action.key} title={action.label}>{button}</Tooltip>;
    };

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
                    {references.length || activeStyles.length || selectedSkill ? (
                        <div className={`flex flex-wrap gap-2 overflow-hidden transition-all duration-200 ${compact ? "invisible mb-0 max-h-0 opacity-0" : "mb-3 max-h-56 opacity-100"}`}>
                            {selectedSkill ? (
                                <div className="creation-composer-chip">
                                    <GenerationStyleCover style={selectedSkill} className="size-5 shrink-0 overflow-hidden rounded-sm" />
                                    <span className="min-w-0 max-w-32 truncate text-xs font-medium text-[var(--studio-muted)]">{selectedSkill.name}</span>
                                    <button type="button" className="creation-composer-chip-remove" onClick={onSkillRemove} aria-label={`移除技能${selectedSkill.name}`}>
                                        <X className="size-3.5" />
                                    </button>
                                </div>
                            ) : null}
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
                            onSelect={chooseStyle}
                        />
                        <SkillMenu
                            skills={availableSkills}
                            selectedSkill={selectedSkill}
                            loading={skillLoading}
                            error={skillError}
                            open={skillMenuOpen}
                            onOpenChange={setSkillMenuOpen}
                            onSelect={onSkillSelect}
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
                                    aria-label={queued ? "排队中" : running ? "生成中" : creditCost === null ? "当前配置无法报价" : `生成，当前会消耗 ${creditCost.toLocaleString()} 积分`}
                                >
                                    {queued || running ? (
                                        queued ? "排队中" : "生成中"
                                    ) : (
                                        <>
                                            {creditCost === null ? <span className="text-xs font-medium">不可报价</span> : <CreditCostDisplay creditCost={creditCost} className="text-xs font-medium" />}
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

/** 技能选择浮层，参照风格库 Popover 交互样式。 */
function SkillMenu({
    skills,
    selectedSkill,
    loading,
    error,
    open,
    onOpenChange,
    onSelect,
}: {
    skills: SkillOption[];
    selectedSkill?: SkillOption | null;
    loading?: boolean;
    error?: string | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSelect?: (skill: SkillOption) => void;
}) {
    const content = (
        <div className="w-[min(24rem,calc(100vw-24px))] p-1" role="dialog" aria-label="技能列表">
            <div className="flex items-center justify-between gap-3 px-2 pb-2 pt-1">
                <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-[var(--studio-ink)]">
                    <Sparkles className="size-4 shrink-0 text-[var(--studio-action)]" />
                    <span>技能</span>
                </div>
            </div>
            {loading ? (
                <div className="flex min-h-28 flex-col items-center justify-center gap-2 text-xs text-[var(--studio-muted)]">
                    <LoaderCircle className="size-5 animate-spin" />
                    <span>技能加载中</span>
                </div>
            ) : error ? (
                <div className="flex min-h-28 flex-col items-center justify-center gap-2 text-xs text-[var(--studio-muted)]">
                    <X className="size-5" />
                    <span>{error}</span>
                </div>
            ) : skills.length ? (
                <div className="thin-scrollbar max-h-[min(24rem,calc(100vh-190px))] overflow-y-auto pr-1">
                    {skills.map((skill) => {
                        const isSelected = selectedSkill?.id === skill.id;
                        return (
                            <button
                                key={skill.id}
                                type="button"
                                className={`mb-1 flex w-full items-start gap-3 rounded-md border px-3 py-2 text-left transition ${isSelected ? "border-[var(--studio-action)] bg-[var(--studio-primary-soft)]" : "border-[var(--studio-line)] bg-[var(--studio-surface)] hover:border-[var(--studio-line-strong)] hover:bg-[var(--studio-surface-hover)]"}`}
                                onClick={() => {
                                    onSelect?.(skill);
                                    onOpenChange(false);
                                }}
                            >
                                <GenerationStyleCover style={skill} className="h-16 w-12 shrink-0 overflow-hidden rounded-md" />
                                <span className="min-w-0 flex-1">
                                    <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-[var(--studio-ink)]">
                                        <span className="truncate">{skill.name}</span>
                                    </span>
                                    {skill.description ? <span className="line-clamp-2 text-xs leading-5 text-[var(--studio-muted)]">{skill.description}</span> : null}
                                </span>
                            </button>
                        );
                    })}
                </div>
            ) : (
                <div className="flex min-h-28 flex-col items-center justify-center gap-2 text-xs text-[var(--studio-muted)]">
                    <Sparkles className="size-5" />
                    <span>暂无可用技能</span>
                </div>
            )}
        </div>
    );
    return (
        <Popover
            open={open}
            trigger="click"
            placement="topLeft"
            arrow={false}
            autoAdjustOverflow
            getPopupContainer={() => document.body}
            destroyOnHidden
            content={content}
            onOpenChange={onOpenChange}
            styles={{
                root: { filter: "none" },
                container: { padding: 8, background: "var(--studio-surface)", border: "1px solid var(--studio-line)", borderRadius: 8, boxShadow: "var(--studio-shadow)" },
            }}
        >
            <span className="inline-flex">
                <Tooltip title={selectedSkill ? `已选择技能：${selectedSkill.name}` : "选择技能"}>
                    <Button size="small" className="creation-composer-action" icon={<Sparkles className="size-3.5" />} aria-expanded={open} aria-haspopup="dialog">
                        技能
                    </Button>
                </Tooltip>
            </span>
        </Popover>
    );
}
