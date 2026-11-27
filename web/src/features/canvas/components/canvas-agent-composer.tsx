"use client";
import { useTranslation } from "@/features/locale/use-translation";

import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from "react";
import { Button, Popover, Tooltip } from "antd";
import { ArrowUp, Boxes, Check, ListPlus, Plus, ShieldCheck, SlidersHorizontal, Square, X } from "lucide-react";

import { canvasThemes } from "@/shared/lib/canvas-theme";
import type { CanvasAgentChatAttachment } from "../domain/canvas-agent-message";
import { isImageNode } from "../domain/canvas-node";
import type { CanvasNode } from "../types";
import { buildCanvasAgentMentionCandidates } from "../utils/canvas-agent-mentions";
import { CanvasAgentMentionInput } from "./canvas-agent-mention-input";
import type { GenerationStyleOption } from "@/services/api/server";
import { GenerationStyleChips, GenerationStyleMenu } from "@/features/generation/components/generation-style-picker";
import { filterGenerationStyles, MAX_GENERATION_STYLE_SELECTION_COUNT } from "@/features/generation/lib/generation-style-library";
import { getStyleCommandRange, parseGenerationStyleMessage, parseGroupedGenerationStyleMessage, removeStyleCommand } from "@/features/generation/lib/style-command";

type CanvasTheme = (typeof canvasThemes)[keyof typeof canvasThemes];

export type CanvasAgentSkillOption = {
    id: string;
    name: string;
    description?: string;
    targetType?: string;
};

type AgentChatComposerProps = {
    prompt: string;
    attachments?: CanvasAgentChatAttachment[];
    disabled?: boolean;
    sending?: boolean;
    placeholder: string;
    theme: CanvasTheme;
    onPromptChange: (value: string) => void;
    onSubmit: () => void;
    onStop?: () => void;
    onQueueSubmit?: () => void;
    onAddFiles?: (files: FileList | File[] | null) => void | Promise<void>;
    onRemoveAttachment?: (id: string) => void;
    left?: ReactNode;
    droppedNodes?: CanvasNode[];
    selectedNodes?: CanvasNode[];
    nodes?: CanvasNode[];
    onDroppedNodeRemove?: (nodeId: string) => void;
    styleOptions?: GenerationStyleOption[];
    selectedStyles?: GenerationStyleOption[];
    styleLoading?: boolean;
    styleError?: string | null;
    onStyleSelect?: (style: GenerationStyleOption) => void;
    onStyleRemove?: (id: number) => void;
    onStyleLimit?: () => void;
    approvalMode?: "auto" | "manual";
    onApprovalModeChange?: (mode: "auto" | "manual") => void;
    agentMode?: "agent" | "chat";
    onAgentModeChange?: (mode: "agent" | "chat") => void;
    skillOptions?: CanvasAgentSkillOption[];
    selectedSkill?: CanvasAgentSkillOption | null;
    onSkillSelect?: (skill: CanvasAgentSkillOption | null) => void;
    contextUsagePercent?: number;
};

export function AgentChatComposer({
    prompt,
    attachments = [],
    disabled,
    sending,
    placeholder,
    theme,
    onPromptChange,
    onSubmit,
    onStop,
    onQueueSubmit,
    onAddFiles,
    onRemoveAttachment,
    left,
    droppedNodes = [],
    selectedNodes = [],
    nodes = [],
    onDroppedNodeRemove,
    styleOptions = [],
    selectedStyles = [],
    styleLoading = false,
    styleError,
    onStyleSelect,
    onStyleRemove,
    onStyleLimit,
    approvalMode = "auto",
    onApprovalModeChange,
    agentMode = "agent",
    onAgentModeChange,
    skillOptions = [],
    selectedSkill = null,
    onSkillSelect,
    contextUsagePercent,
}: AgentChatComposerProps) {
    const translate = useTranslation();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [styleMenuOpen, setStyleMenuOpen] = useState(false);
    const [styleCommand, setStyleCommand] = useState<{ start: number; end: number } | null>(null);
    const [styleQuery, setStyleQuery] = useState("");
    const [highlightedStyleIndex, setHighlightedStyleIndex] = useState(0);
    const [skillMenuOpen, setSkillMenuOpen] = useState(false);
    const [skillQuery, setSkillQuery] = useState("");
    const filteredStyles = useMemo(() => filterGenerationStyles(styleOptions, styleQuery), [styleOptions, styleQuery, translate.locale]);
    const filteredSkills = useMemo(() => {
        const keyword = skillQuery.trim().toLowerCase();
        if (!keyword) return skillOptions;
        return skillOptions.filter((item) => item.name.toLowerCase().includes(keyword) || (item.description || "").toLowerCase().includes(keyword));
    }, [skillOptions, skillQuery]);
    const mentionCandidates = useMemo(() => buildCanvasAgentMentionCandidates(nodes), [nodes]);

    useEffect(() => {
        const missingNodeIds = droppedNodes.map((node) => node.id).filter((nodeId) => !containsToken(prompt, nodeId));
        if (missingNodeIds.length === 0) return;
        onPromptChange([prompt.trim(), ...missingNodeIds].filter(Boolean).join(" "));
    }, [droppedNodes, onPromptChange, prompt]);

    const removeNode = (nodeId: string) => {
        onPromptChange(removeToken(prompt, nodeId));
        onDroppedNodeRemove?.(nodeId);
    };

    const hasContent = Boolean(prompt.trim() || attachments.length);
    const canSubmitIdle = !disabled && !sending && hasContent;
    const canQueue = Boolean(sending && onQueueSubmit && hasContent);

    const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
        event.preventDefault();
        if (sending) {
            if (canQueue) onQueueSubmit?.();
            return;
        }
        if (canSubmitIdle) onSubmit();
    };

    const updatePrompt = (value: string, cursor: number) => {
        onPromptChange(value);
        // 支持中文顿号「、」唤起技能选择
        const beforeCursor = value.slice(0, cursor);
        const skillMatch = beforeCursor.match(/(?:^|\s)、([^\s、]*)$/);
        if (skillMatch && skillOptions.length > 0) {
            setSkillQuery(skillMatch[1] || "");
            setSkillMenuOpen(true);
            closeStyleMenu();
            return;
        }
        const command = getStyleCommandRange(value, cursor);
        setStyleCommand(command ? { start: command.start, end: command.end } : null);
        setStyleQuery(command?.query || "");
        setStyleMenuOpen(Boolean(command));
    };

    const closeStyleMenu = () => {
        setStyleMenuOpen(false);
        setStyleCommand(null);
        setStyleQuery("");
        setHighlightedStyleIndex(0);
    };

    const chooseStyle = (style: GenerationStyleOption) => {
        if (selectedStyles.some((item) => item.id === style.id)) {
            closeStyleMenu();
            return;
        }
        onStyleSelect?.(style);
        const next = styleCommand ? removeStyleCommand(prompt, styleCommand.start, styleCommand.end) : prompt;
        onPromptChange(next);
        setStyleCommand(null);
        setStyleQuery("");
        closeStyleMenu();
    };

    const chooseSkill = (skill: CanvasAgentSkillOption) => {
        onSkillSelect?.(selectedSkill?.id === skill.id ? null : skill);
        // 若通过顿号触发，移除触发词
        const cleaned = prompt.replace(/(?:^|\s)、[^\s、]*$/, "").trimStart();
        if (cleaned !== prompt) onPromptChange(cleaned);
        setSkillMenuOpen(false);
        setSkillQuery("");
    };

    const handleInputKeyDown = (event: KeyboardEvent) => {
        if (styleMenuOpen) {
            if (event.key === "ArrowDown") {
                event.preventDefault();
                setHighlightedStyleIndex((value) => Math.min(value + 1, Math.max(0, filteredStyles.length - 1)));
                return;
            }
            if (event.key === "ArrowUp") {
                event.preventDefault();
                setHighlightedStyleIndex((value) => Math.max(value - 1, 0));
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
        if (skillMenuOpen && event.key === "Escape") {
            event.preventDefault();
            setSkillMenuOpen(false);
            setSkillQuery("");
            return;
        }
        handleKeyDown(event);
    };

    const handlePaste = (event: ClipboardEvent) => {
        const pastedText = event.clipboardData.getData("text/plain");
        const parsed = parseGroupedGenerationStyleMessage(pastedText, styleOptions) || parseGenerationStyleMessage(pastedText, styleOptions);
        if (parsed && onStyleSelect) {
            event.preventDefault();
            const additions = parsed.styles.filter((style) => !selectedStyles.some((selected) => selected.id === style.id));
            const remaining = Math.max(0, MAX_GENERATION_STYLE_SELECTION_COUNT - selectedStyles.length);
            if (additions.length > remaining) onStyleLimit?.();
            additions.slice(0, remaining).forEach((style) => onStyleSelect(style as GenerationStyleOption));
            onPromptChange(parsed.prompt);
            closeStyleMenu();
            return;
        }
        if (!onAddFiles) return;
        const images = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
        if (!images.length) return;
        event.preventDefault();
        void onAddFiles(images);
    };

    const skillPopoverContent = (
        <div className="w-64 max-h-64 overflow-y-auto py-1">
            {selectedSkill ? (
                <button
                    type="button"
                    onClick={() => {
                        onSkillSelect?.(null);
                        setSkillMenuOpen(false);
                    }}
                    className="mb-1 flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs! opacity-75 hover:opacity-100"
                    style={{ color: theme.node.muted }}
                >
                    <span>取消当前技能包</span>
                    <X className="size-3.5" />
                </button>
            ) : null}
            {filteredSkills.length === 0 ? (
                <div className="px-2.5 py-4 text-center text-xs opacity-60">暂无可用技能包</div>
            ) : (
                filteredSkills.map((skill) => {
                    const active = selectedSkill?.id === skill.id;
                    return (
                        <button
                            key={skill.id}
                            type="button"
                            onClick={() => chooseSkill(skill)}
                            className="flex w-full items-start justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-xs! transition-colors"
                            style={{
                                background: active ? `color-mix(in srgb, ${theme.node.text} 10%, transparent)` : "transparent",
                                color: theme.node.text,
                            }}
                        >
                            <div className="min-w-0 flex-1">
                                <div className="truncate font-medium">{skill.name}</div>
                                {skill.description ? <div className="mt-0.5 line-clamp-1 opacity-65">{skill.description}</div> : null}
                            </div>
                            {active ? <Check className="mt-0.5 size-3.5 shrink-0" /> : null}
                        </button>
                    );
                })
            )}
        </div>
    );

    const approvalActive = approvalMode === "manual";
    const clampedUsage = typeof contextUsagePercent === "number" ? Math.min(100, Math.max(0, Math.round(contextUsagePercent))) : null;

    return (
        <div className="px-2 pb-2 pt-2" onWheelCapture={(event) => event.stopPropagation()}>
            <div className="rounded-2xl border p-3 shadow-lg" style={{ background: theme.toolbar.panel, borderColor: theme.node.stroke }}>
                {/* 顶部画布选中节点上下文胶囊 */}
                <div className="mb-2 flex flex-wrap items-center gap-1.5">
                    {selectedNodes.length > 0 ? (
                        selectedNodes.slice(0, 4).map((node) => (
                            <span
                                key={node.id}
                                className="inline-flex max-w-[160px] items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px]"
                                style={{
                                    borderColor: theme.toolbar.border,
                                    background: `color-mix(in srgb, ${theme.node.text} 7%, transparent)`,
                                    color: theme.node.text,
                                }}
                                title={node.title || node.id}
                            >
                                <Boxes className="size-3 shrink-0 opacity-70" />
                                <span className="truncate">{node.title || node.id}</span>
                            </span>
                        ))
                    ) : (
                        <span
                            className="inline-flex items-center gap-1 rounded-md border border-dashed px-2 py-0.5 text-[11px]"
                            style={{ borderColor: theme.toolbar.border, color: theme.node.muted }}
                        >
                            <Boxes className="size-3 opacity-70" />
                            <span>未选中节点</span>
                        </span>
                    )}
                    {selectedNodes.length > 4 ? (
                        <span className="text-[11px]" style={{ color: theme.node.muted }}>
                            +{selectedNodes.length - 4}
                        </span>
                    ) : null}
                    {selectedSkill ? (
                        <span
                            className="inline-flex max-w-[180px] items-center gap-1 rounded-md px-2 py-0.5 text-[11px]"
                            style={{
                                background: "color-mix(in srgb, #f59e0b 16%, transparent)",
                                color: "#f59e0b",
                            }}
                        >
                            <span className="truncate">技能: {selectedSkill.name}</span>
                            <button
                                type="button"
                                onClick={() => onSkillSelect?.(null)}
                                className="opacity-75 hover:opacity-100"
                                aria-label="移除技能包"
                            >
                                <X className="size-3" />
                            </button>
                        </span>
                    ) : null}
                </div>

                {selectedStyles.length ? <GenerationStyleChips styles={selectedStyles} onRemove={(id) => onStyleRemove?.(id)} className="mb-2" /> : null}
                {droppedNodes.length ? <NodeReferenceList nodes={droppedNodes} theme={theme} onRemove={removeNode} /> : null}
                {attachments.length ? <AttachmentList attachments={attachments} theme={theme} onRemove={onRemoveAttachment} /> : null}

                <CanvasAgentMentionInput
                    value={prompt}
                    disabled={disabled}
                    placeholder={placeholder}
                    theme={theme}
                    candidates={mentionCandidates}
                    onChange={updatePrompt}
                    onKeyDown={handleInputKeyDown}
                    onPaste={handlePaste}
                />

                {/* 底部控制栏 */}
                <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-1">
                        {onAddFiles ? (
                            <>
                                <input
                                    ref={fileInputRef}
                                    hidden
                                    type="file"
                                    accept="image/*"
                                    multiple
                                    onChange={(event) => {
                                        void onAddFiles(event.target.files);
                                        event.target.value = "";
                                    }}
                                />
                                <Tooltip title={translate("canvas.uploadImage")}>
                                    <Button type="text" shape="circle" size="small" icon={<Plus className="size-4" />} style={{ color: theme.node.muted }} onClick={() => fileInputRef.current?.click()} />
                                </Tooltip>
                            </>
                        ) : null}

                        {onApprovalModeChange ? (
                            <Tooltip title={approvalActive ? "已开启审批：高成本操作前将先征求你的确认" : "开启审批：在执行批量生成或删除前先确认"}>
                                <button
                                    type="button"
                                    onClick={() => onApprovalModeChange(approvalActive ? "auto" : "manual")}
                                    className="inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs! transition-colors"
                                    style={{
                                        borderColor: approvalActive ? "color-mix(in srgb, #f59e0b 45%, transparent)" : "transparent",
                                        background: approvalActive ? "color-mix(in srgb, #f59e0b 16%, transparent)" : "transparent",
                                        color: approvalActive ? "#f59e0b" : theme.node.muted,
                                    }}
                                >
                                    <ShieldCheck className="size-3.5" />
                                    <span>审批</span>
                                </button>
                            </Tooltip>
                        ) : null}

                        {onSkillSelect ? (
                            <Popover
                                open={skillMenuOpen}
                                onOpenChange={setSkillMenuOpen}
                                trigger="click"
                                placement="topLeft"
                                content={skillPopoverContent}
                            >
                                <button
                                    type="button"
                                    className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-xs! transition-opacity hover:opacity-100 opacity-80"
                                    style={{
                                        color: selectedSkill ? theme.node.text : theme.node.muted,
                                        background: selectedSkill ? `color-mix(in srgb, ${theme.node.text} 10%, transparent)` : "transparent",
                                    }}
                                >
                                    <Boxes className="size-3.5" />
                                    <span>技能</span>
                                </button>
                            </Popover>
                        ) : null}

                        {onAgentModeChange ? (
                            <Tooltip title={agentMode === "agent" ? "默认规划模式：Agent 自动拆解与编排任务" : "直出模式：跳过规划直接生成"}>
                                <button
                                    type="button"
                                    onClick={() => onAgentModeChange(agentMode === "agent" ? "chat" : "agent")}
                                    className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-xs! transition-opacity hover:opacity-100 opacity-80"
                                    style={{ color: theme.node.muted }}
                                >
                                    <SlidersHorizontal className="size-3.5" />
                                    <span>{agentMode === "agent" ? "默认" : "直出"}</span>
                                </button>
                            </Tooltip>
                        ) : null}

                        <GenerationStyleMenu
                            styles={styleOptions}
                            selected={selectedStyles}
                            loading={styleLoading}
                            error={styleError}
                            open={styleMenuOpen}
                            query={styleQuery}
                            highlightedIndex={highlightedStyleIndex}
                            grouped
                            placement="topLeft"
                            onOpenChange={(open) => {
                                if (open) {
                                    setStyleCommand(null);
                                    setStyleQuery("");
                                    setHighlightedStyleIndex(0);
                                    setStyleMenuOpen(true);
                                } else {
                                    closeStyleMenu();
                                }
                            }}
                            onQueryChange={setStyleQuery}
                            onHighlightedIndexChange={setHighlightedStyleIndex}
                            onSelect={chooseStyle}
                        />
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                        {left}
                        {clampedUsage !== null ? <ContextUsageRing percent={clampedUsage} theme={theme} /> : null}
                        {sending ? (
                            <>
                                {onStop ? (
                                    <Tooltip title={translate("canvas.stopGeneration")}>
                                        <button
                                            type="button"
                                            onClick={onStop}
                                            className="grid size-7 place-items-center rounded-lg border transition hover:opacity-90"
                                            style={{
                                                borderColor: theme.toolbar.border,
                                                background: `color-mix(in srgb, ${theme.node.text} 6%, transparent)`,
                                            }}
                                            aria-label={translate("canvas.stopGeneration")}
                                        >
                                            <Square className="size-3 fill-red-500 text-red-500" />
                                        </button>
                                    </Tooltip>
                                ) : null}
                                {onQueueSubmit ? (
                                    <button
                                        type="button"
                                        disabled={!canQueue}
                                        onClick={onQueueSubmit}
                                        className="inline-flex h-7 items-center gap-1 rounded-lg border px-2 text-xs! transition disabled:cursor-not-allowed disabled:opacity-40"
                                        style={{
                                            borderColor: theme.toolbar.border,
                                            background: `color-mix(in srgb, ${theme.node.text} 8%, transparent)`,
                                            color: theme.node.text,
                                        }}
                                    >
                                        <ListPlus className="size-3.5" />
                                        <span>排队</span>
                                    </button>
                                ) : null}
                            </>
                        ) : (
                            <Button
                                type="primary"
                                shape="circle"
                                size="small"
                                disabled={!canSubmitIdle}
                                icon={<ArrowUp className="size-4" />}
                                onClick={onSubmit}
                                aria-label={translate("canvas.send")}
                            />
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

function ContextUsageRing({ percent, theme }: { percent: number; theme: CanvasTheme }) {
    const radius = 6;
    const circumference = 2 * Math.PI * radius;
    const dashOffset = circumference * (1 - percent / 100);
    return (
        <Tooltip title={`当前会话上下文占用约 ${percent}%`}>
            <span className="inline-flex items-center gap-1 px-1 text-[11px]" style={{ color: theme.node.muted }}>
                <svg width="16" height="16" viewBox="0 0 16 16" className="-rotate-90">
                    <circle cx="8" cy="8" r={radius} fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2" />
                    <circle
                        cx="8"
                        cy="8"
                        r={radius}
                        fill="none"
                        stroke={percent >= 80 ? "#f59e0b" : "currentColor"}
                        strokeWidth="2"
                        strokeDasharray={circumference}
                        strokeDashoffset={dashOffset}
                        strokeLinecap="round"
                    />
                </svg>
                <span>{percent}%</span>
            </span>
        </Tooltip>
    );
}

function NodeReferenceList({ nodes, theme, onRemove }: { nodes: CanvasNode[]; theme: CanvasTheme; onRemove: (nodeId: string) => void }) {
    const translate = useTranslation();
    return (
        <div className="mb-2 flex flex-wrap gap-2">
            {nodes.map((node) => (
                <span key={node.id} className="inline-flex max-w-full items-center gap-2 rounded-lg border px-2 py-1 text-xs" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
                    {isImageNode(node) && node.content.source ? <img src={node.content.source} alt="" className="size-6 rounded object-cover" /> : null}
                    <span className="max-w-36 truncate">{node.title || node.id}</span>
                    <button type="button" aria-label={translate("canvas.remove", { value0: node.title || node.id })} onClick={() => onRemove(node.id)}>
                        <X className="size-3" />
                    </button>
                </span>
            ))}
        </div>
    );
}

function AttachmentList({ attachments, theme, onRemove }: { attachments: CanvasAgentChatAttachment[]; theme: CanvasTheme; onRemove?: (id: string) => void }) {
    const translate = useTranslation();
    return (
        <div className="mb-2 flex gap-2 overflow-x-auto">
            {attachments.map((attachment) => (
                <div key={attachment.id} className="group relative size-14 shrink-0 overflow-hidden rounded-lg border" style={{ borderColor: theme.node.stroke }}>
                    <img src={attachment.url} alt={attachment.name} className="size-full object-cover" />
                    {onRemove ? (
                        <button
                            type="button"
                            className="absolute right-1 top-1 grid size-5 place-items-center rounded-full opacity-0 group-hover:opacity-100"
                            style={{ background: theme.toolbar.panel }}
                            onClick={() => onRemove(attachment.id)}
                            aria-label={translate("canvas.removeImage")}
                        >
                            <X className="size-3" />
                        </button>
                    ) : null}
                </div>
            ))}
        </div>
    );
}

function containsToken(value: string, token: string): boolean {
    return value.split(/\s+/).includes(token);
}

function removeToken(value: string, token: string): string {
    return value
        .split(/\s+/)
        .filter((item) => item && item !== token)
        .join(" ");
}
