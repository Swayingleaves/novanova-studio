"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Button, Tooltip } from "antd";
import { ArrowUp, ImagePlus, LoaderCircle, X } from "lucide-react";

import { canvasThemes } from "@/shared/lib/canvas-theme";
import type { CanvasAgentChatAttachment } from "../domain/canvas-agent-message";
import { isImageNode } from "../domain/canvas-node";
import type { CanvasNode } from "../types";
import type { GenerationStyleOption } from "@/services/api/server";
import { GenerationStyleChips, GenerationStyleMenu } from "@/features/generation/components/generation-style-picker";
import { getStyleCommandRange, parseGenerationStyleMessage, parseGroupedGenerationStyleMessage, removeStyleCommand } from "@/features/generation/lib/style-command";

type CanvasTheme = (typeof canvasThemes)[keyof typeof canvasThemes];

type AgentChatComposerProps = {
    prompt: string;
    attachments?: CanvasAgentChatAttachment[];
    disabled?: boolean;
    sending?: boolean;
    placeholder: string;
    theme: CanvasTheme;
    onPromptChange: (value: string) => void;
    onSubmit: () => void;
    onAddFiles?: (files: FileList | File[] | null) => void | Promise<void>;
    onRemoveAttachment?: (id: string) => void;
    left?: ReactNode;
    droppedNodes?: CanvasNode[];
    onDroppedNodeRemove?: (nodeId: string) => void;
    styleOptions?: GenerationStyleOption[];
    selectedStyles?: GenerationStyleOption[];
    styleLoading?: boolean;
    styleError?: string | null;
    onStyleSelect?: (style: GenerationStyleOption) => void;
    onStyleRemove?: (id: number) => void;
    onStyleLimit?: () => void;
};

export function AgentChatComposer({ prompt, attachments = [], disabled, sending, placeholder, theme, onPromptChange, onSubmit, onAddFiles, onRemoveAttachment, left, droppedNodes = [], onDroppedNodeRemove, styleOptions = [], selectedStyles = [], styleLoading = false, styleError, onStyleSelect, onStyleRemove, onStyleLimit }: AgentChatComposerProps) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [styleMenuOpen, setStyleMenuOpen] = useState(false);
    const [styleCommand, setStyleCommand] = useState<{ start: number; end: number } | null>(null);
    const [styleQuery, setStyleQuery] = useState("");

    useEffect(() => {
        const missingNodeIds = droppedNodes.map((node) => node.id).filter((nodeId) => !containsToken(prompt, nodeId));
        if (missingNodeIds.length === 0) return;
        onPromptChange([prompt.trim(), ...missingNodeIds].filter(Boolean).join(" "));
    }, [droppedNodes, onPromptChange, prompt]);

    const removeNode = (nodeId: string) => {
        onPromptChange(removeToken(prompt, nodeId));
        onDroppedNodeRemove?.(nodeId);
    };
    const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
        event.preventDefault();
        if (!disabled && !sending && (prompt.trim() || attachments.length)) onSubmit();
    };
    const canSubmit = !disabled && !sending && Boolean(prompt.trim() || attachments.length);
    const updatePrompt = (value: string, cursor: number) => {
        onPromptChange(value);
        const command = getStyleCommandRange(value, cursor);
        setStyleCommand(command ? { start: command.start, end: command.end } : null);
        setStyleQuery(command?.query || "");
        setStyleMenuOpen(Boolean(command));
    };
    const chooseStyle = (style: GenerationStyleOption) => {
        if (selectedStyles.some((item) => item.id === style.id)) {
            setStyleMenuOpen(false);
            return;
        }
        if (selectedStyles.length >= 3) {
            onStyleLimit?.();
            return;
        }
        onStyleSelect?.(style);
        const next = styleCommand ? removeStyleCommand(prompt, styleCommand.start, styleCommand.end) : prompt;
        onPromptChange(next);
        setStyleCommand(null);
        setStyleQuery("");
        setStyleMenuOpen(false);
    };

    return (
        <div className="px-2 pb-2 pt-2" onWheelCapture={(event) => event.stopPropagation()}>
            <div className="rounded-2xl border p-3 shadow-lg" style={{ background: theme.toolbar.panel, borderColor: theme.node.stroke }}>
                {selectedStyles.length ? <GenerationStyleChips styles={selectedStyles} onRemove={(id) => onStyleRemove?.(id)} className="mb-2" /> : null}
                {droppedNodes.length ? <NodeReferenceList nodes={droppedNodes} theme={theme} onRemove={removeNode} /> : null}
                {attachments.length ? <AttachmentList attachments={attachments} theme={theme} onRemove={onRemoveAttachment} /> : null}
                <textarea
                    autoFocus
                    value={prompt}
                    disabled={disabled}
                    rows={4}
                    placeholder={placeholder}
                    className="thin-scrollbar max-h-36 min-h-20 w-full resize-none bg-transparent px-1 py-1 text-sm leading-5 outline-none"
                    style={{ color: theme.node.text }}
                    onChange={(event) => updatePrompt(event.target.value, event.target.selectionStart ?? event.target.value.length)}
                    onKeyDown={(event) => {
                        if (styleMenuOpen) {
                            if (event.key === "Escape") { event.preventDefault(); setStyleMenuOpen(false); setStyleCommand(null); return; }
                        }
                        handleKeyDown(event);
                    }}
                    onPaste={(event) => {
                        const pastedText = event.clipboardData.getData("text/plain");
                        const parsed = parseGroupedGenerationStyleMessage(pastedText, styleOptions) || parseGenerationStyleMessage(pastedText, styleOptions);
                        if (parsed && onStyleSelect) {
                            event.preventDefault();
                            const additions = parsed.styles.filter((style) => !selectedStyles.some((selected) => selected.id === style.id));
                            const remaining = Math.max(0, 3 - selectedStyles.length);
                            if (additions.length > remaining) onStyleLimit?.();
                            additions.slice(0, remaining).forEach((style) => onStyleSelect(style as GenerationStyleOption));
                            onPromptChange(parsed.prompt);
                            setStyleMenuOpen(false);
                            setStyleCommand(null);
                            return;
                        }
                        if (!onAddFiles) return;
                        const images = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
                        if (!images.length) return;
                        event.preventDefault();
                        void onAddFiles(images);
                    }}
                />
                <div className="mt-2 flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1">
                        {onAddFiles ? <><input ref={fileInputRef} hidden type="file" accept="image/*" multiple onChange={(event) => { void onAddFiles(event.target.files); event.target.value = ""; }} /><Tooltip title="上传图片"><Button type="text" shape="circle" disabled={sending} icon={<ImagePlus className="size-4" />} style={{ color: theme.node.muted }} onClick={() => fileInputRef.current?.click()} /></Tooltip></> : null}
                        <GenerationStyleMenu styles={styleOptions} selected={selectedStyles} loading={styleLoading} error={styleError} open={styleMenuOpen} onToggle={() => setStyleMenuOpen((value) => !value)} onSelect={chooseStyle} query={styleQuery} onQueryChange={setStyleQuery} grouped />
                        {left}
                    </div>
                    <Button type="primary" shape="circle" disabled={!canSubmit} icon={sending ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowUp className="size-4" />} onClick={onSubmit} aria-label="发送" />
                </div>
            </div>
        </div>
    );
}

function NodeReferenceList({ nodes, theme, onRemove }: { nodes: CanvasNode[]; theme: CanvasTheme; onRemove: (nodeId: string) => void }) {
    return <div className="mb-2 flex flex-wrap gap-2">{nodes.map((node) => <span key={node.id} className="inline-flex max-w-full items-center gap-2 rounded-lg border px-2 py-1 text-xs" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>{isImageNode(node) && node.content.source ? <img src={node.content.source} alt="" className="size-6 rounded object-cover" /> : null}<span className="max-w-36 truncate">{node.title || node.id}</span><button type="button" aria-label={`移除 ${node.title || node.id}`} onClick={() => onRemove(node.id)}><X className="size-3" /></button></span>)}</div>;
}

function AttachmentList({ attachments, theme, onRemove }: { attachments: CanvasAgentChatAttachment[]; theme: CanvasTheme; onRemove?: (id: string) => void }) {
    return <div className="mb-2 flex gap-2 overflow-x-auto">{attachments.map((attachment) => <div key={attachment.id} className="group relative size-14 shrink-0 overflow-hidden rounded-lg border" style={{ borderColor: theme.node.stroke }}><img src={attachment.url} alt={attachment.name} className="size-full object-cover" />{onRemove ? <button type="button" className="absolute right-1 top-1 grid size-5 place-items-center rounded-full opacity-0 group-hover:opacity-100" style={{ background: theme.toolbar.panel }} onClick={() => onRemove(attachment.id)} aria-label="移除图片"><X className="size-3" /></button> : null}</div>)}</div>;
}

function containsToken(value: string, token: string): boolean {
    return value.split(/\s+/).includes(token);
}

function removeToken(value: string, token: string): string {
    return value.split(/\s+/).filter((item) => item && item !== token).join(" ");
}
