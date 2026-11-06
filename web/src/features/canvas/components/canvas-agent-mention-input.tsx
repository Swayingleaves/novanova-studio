"use client";

import { useEffect, useId, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import CodeMirror, { Decoration, EditorState, EditorView, StateField, WidgetType, minimalSetup, type DecorationSet, type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { AudioLines, Boxes, Clapperboard, FileText, Image as ImageIcon, Video } from "lucide-react";

import { translateMessage as translate } from "@/features/locale/translate";
import type { CanvasTheme } from "@/shared/lib/canvas-theme";
import { filterCanvasAgentMentionCandidates, readCanvasAgentMentionCommand, type CanvasAgentMentionCandidate } from "../utils/canvas-agent-mentions";

type CanvasAgentMentionInputProps = {
    value: string;
    placeholder: string;
    theme: CanvasTheme;
    candidates: CanvasAgentMentionCandidate[];
    disabled?: boolean;
    onChange: (value: string, cursor: number) => void;
    onKeyDown: (event: KeyboardEvent) => void;
    onPaste: (event: ClipboardEvent) => void;
};

const editingExtensions = minimalSetup({ highlightSpecialChars: false, syntaxHighlighting: false });

/** 画布 Agent 输入框内的节点引用芯片；输入框文本仍保存真实节点ID。 */
class AgentMentionWidget extends WidgetType {
    constructor(
        private readonly candidate: CanvasAgentMentionCandidate,
        private readonly theme: CanvasTheme,
    ) {
        super();
    }

    eq(other: AgentMentionWidget) {
        return other.candidate.id === this.candidate.id && other.candidate.title === this.candidate.title && other.candidate.previewUrl === this.candidate.previewUrl;
    }

    toDOM() {
        const chip = document.createElement("span");
        chip.dataset.mentionNodeId = this.candidate.id;
        chip.title = `${this.candidate.kindLabel}：${this.candidate.title}`;
        chip.style.cssText = `display:inline-flex;align-items:center;gap:4px;max-width:180px;margin:0 2px;padding:2px 6px;border-radius:6px;background:${this.theme.toolbar.activeBg};color:${this.theme.toolbar.activeText};font-size:13px;line-height:1.35;vertical-align:middle;white-space:nowrap;overflow:hidden;`;
        const preview = mentionPreviewElement(this.candidate);
        if (preview) chip.append(preview);
        const label = document.createElement("span");
        label.textContent = `@${this.candidate.title}`;
        label.style.cssText = "overflow:hidden;text-overflow:ellipsis;";
        chip.append(label);
        return chip;
    }

    ignoreEvent() {
        return false;
    }
}

/** 生成引用芯片内的缩略图；图片和视频节点展示封面，其余类型不展示缩略图。 */
function mentionPreviewElement(candidate: CanvasAgentMentionCandidate) {
    if (!candidate.previewUrl) return null;
    if (candidate.kind === "video") {
        const wrapper = document.createElement("span");
        wrapper.style.cssText = "position:relative;display:block;width:16px;height:16px;border-radius:3px;overflow:hidden;flex-shrink:0;";
        const video = document.createElement("video");
        video.src = candidate.previewUrl;
        video.muted = true;
        video.playsInline = true;
        video.preload = "metadata";
        video.style.cssText = "display:block;width:16px;height:16px;object-fit:cover;background:#000;";
        const marker = document.createElement("span");
        marker.textContent = "▶";
        marker.style.cssText = "position:absolute;inset:0;display:grid;place-items:center;color:#fff;font-size:7px;pointer-events:none;";
        wrapper.append(video, marker);
        return wrapper;
    }
    const image = document.createElement("img");
    image.src = candidate.previewUrl;
    image.alt = "";
    image.draggable = false;
    image.style.cssText = "display:block;width:16px;height:16px;border-radius:3px;object-fit:cover;flex-shrink:0;";
    return image;
}

/** 为已知节点ID生成原子引用芯片，保证光标移动和删除按整段引用处理。 */
function mentionDecorationExtension(getCandidates: () => CanvasAgentMentionCandidate[], theme: CanvasTheme) {
    const decorate = (value: string) => {
        const candidateById = new Map(getCandidates().map((candidate) => [candidate.id, candidate]));
        const ids = [...candidateById.keys()].sort((first, second) => second.length - first.length);
        if (!ids.length) return Decoration.none;
        const pattern = new RegExp(`@(${ids.map(escapeRegExp).join("|")})`, "g");
        const ranges = Array.from(value.matchAll(pattern), (match) => {
            const candidate = candidateById.get(match[1]);
            return candidate ? Decoration.replace({ widget: new AgentMentionWidget(candidate, theme) }).range(match.index, match.index + match[0].length) : null;
        }).filter((range): range is NonNullable<typeof range> => Boolean(range));
        return Decoration.set(ranges, true);
    };
    return StateField.define<DecorationSet>({
        create: (state) => decorate(state.doc.toString()),
        update: (decorations, transaction) => (transaction.docChanged ? decorate(transaction.newDoc.toString()) : decorations),
        provide: (field) => [EditorView.decorations.from(field), EditorView.atomicRanges.of((view) => view.state.field(field))],
    });
}

/** 按当前画布主题生成编辑器主题，保持与 Agent 面板背景和文字一致。 */
function editorTheme(theme: CanvasTheme) {
    return EditorView.theme({
        "&": { backgroundColor: "transparent", color: theme.node.text, fontSize: "14px" },
        "&.cm-focused": { outline: "none" },
        ".cm-editor": { backgroundColor: "transparent" },
        ".cm-scroller": { fontFamily: "inherit", lineHeight: "1.25rem", maxHeight: "9rem", overflowY: "auto" },
        ".cm-content": { minHeight: "5rem", padding: "4px", caretColor: theme.node.text, overflowWrap: "anywhere" },
        ".cm-placeholder": { color: theme.node.placeholder },
        ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { background: theme.toolbar.activeBg },
        ".cm-cursor": { borderLeftColor: theme.node.text },
    });
}

/** 画布 Agent 输入框：支持 @ 搜索画布节点、引用芯片和原有提示词编辑交互。 */
export function CanvasAgentMentionInput({ value, placeholder, theme, candidates, disabled, onChange, onKeyDown, onPaste }: CanvasAgentMentionInputProps) {
    const editorRef = useRef<ReactCodeMirrorRef>(null);
    const listId = useId();
    const [command, setCommand] = useState<ReturnType<typeof readCanvasAgentMentionCommand>>(null);
    const [highlightedIndex, setHighlightedIndex] = useState(0);
    const candidateIds = useMemo(() => new Set(candidates.map((candidate) => candidate.id)), [candidates]);
    const filteredCandidates = useMemo(() => filterCanvasAgentMentionCandidates(candidates, command?.query ?? ""), [candidates, command?.query]);
    const activeIndex = Math.min(highlightedIndex, Math.max(0, filteredCandidates.length - 1));
    // 节点列表会随画布更新频繁变化，引用芯片改从 ref 读取，避免重建编辑器扩展打断输入。
    const candidatesRef = useRef(candidates);
    candidatesRef.current = candidates;
    const extensions = useMemo(() => [editorTheme(theme), EditorView.lineWrapping, editingExtensions, mentionDecorationExtension(() => candidatesRef.current, theme), EditorView.domEventHandlers({ blur: () => setCommand(null) })], [theme]);

    useEffect(() => {
        if (command) document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
    }, [activeIndex, command, listId]);

    const closeMentionMenu = () => {
        setCommand(null);
        setHighlightedIndex(0);
    };

    const chooseMention = (candidate: CanvasAgentMentionCandidate) => {
        const view = editorRef.current?.view;
        if (!view || !command) return;
        const insert = `@${candidate.id}`;
        view.dispatch({ changes: { from: command.start, to: command.end, insert }, selection: { anchor: command.start + insert.length }, userEvent: "input.complete" });
        closeMentionMenu();
        view.focus();
    };

    const handleKeyDownCapture = (event: KeyboardEvent) => {
        if (event.nativeEvent.isComposing || editorRef.current?.view?.composing) return;
        if (command && !event.shiftKey) {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                event.stopPropagation();
                const offset = event.key === "ArrowDown" ? 1 : -1;
                setHighlightedIndex(Math.max(0, Math.min(filteredCandidates.length - 1, activeIndex + offset)));
                return;
            }
            if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                closeMentionMenu();
                return;
            }
            if (event.key === "Enter") {
                const candidate = filteredCandidates[activeIndex];
                if (candidate) {
                    event.preventDefault();
                    event.stopPropagation();
                    chooseMention(candidate);
                    return;
                }
                closeMentionMenu();
            }
        }
        onKeyDown(event);
        if (event.defaultPrevented) event.stopPropagation();
    };

    return (
        <div
            className="relative min-w-0"
            onKeyDownCapture={handleKeyDownCapture}
            onPasteCapture={(event) => {
                onPaste(event);
                if (event.defaultPrevented) event.stopPropagation();
            }}
        >
            <CodeMirror
                ref={editorRef}
                value={value}
                placeholder={placeholder}
                theme="none"
                basicSetup={false}
                indentWithTab={false}
                autoFocus
                editable={!disabled}
                extensions={extensions}
                aria-label={placeholder}
                onChange={(nextValue, update) => onChange(nextValue, update.state.selection.main.head)}
                onUpdate={(update) => {
                    if (!update.docChanged && !update.selectionSet) return;
                    const selection = update.state.selection.main;
                    setCommand(selection.empty && update.view.hasFocus && !update.view.composing ? readCanvasAgentMentionCommand(update.state.doc.toString(), selection.head, candidateIds) : null);
                    setHighlightedIndex(0);
                    if (!update.view.hasFocus) closeMentionMenu();
                }}
            />
            {command ? (
                <div
                    className="absolute bottom-full left-0 right-0 z-50 mb-2 overflow-hidden rounded-xl border shadow-2xl"
                    style={{ background: theme.node.panel, borderColor: theme.node.stroke }}
                    role="listbox"
                    aria-label={translate("canvas.referenceCanvasAsset")}
                >
                    <div className="px-2.5 pb-1 pt-2 text-[11px] font-medium" style={{ color: theme.node.muted }}>
                        {translate("canvas.referenceCanvasAsset")}
                    </div>
                    <div className="thin-scrollbar max-h-56 overflow-y-auto pb-1">
                        {filteredCandidates.length ? (
                            filteredCandidates.map((candidate, index) => {
                                const Icon =
                                    candidate.kind === "audio" ? AudioLines : candidate.kind === "image" ? ImageIcon : candidate.kind === "text" ? FileText : candidate.kind === "video" ? Video : candidate.kind === "storyboard" ? Clapperboard : Boxes;
                                return (
                                    <button
                                        id={`${listId}-${index}`}
                                        key={candidate.id}
                                        type="button"
                                        role="option"
                                        aria-selected={index === activeIndex}
                                        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm"
                                        style={{ background: index === activeIndex ? theme.toolbar.itemHover : "transparent", color: theme.node.text }}
                                        onMouseDown={(event) => event.preventDefault()}
                                        onMouseEnter={() => setHighlightedIndex(index)}
                                        onClick={() => chooseMention(candidate)}
                                    >
                                        <span className="grid size-7 shrink-0 place-items-center overflow-hidden rounded-md border" style={{ borderColor: theme.node.stroke, background: theme.node.fill, color: theme.node.muted }}>
                                            {candidate.kind === "image" && candidate.previewUrl ? (
                                                <img src={candidate.previewUrl} alt="" className="size-full object-cover" />
                                            ) : candidate.kind === "video" && candidate.previewUrl ? (
                                                <span className="relative block size-full">
                                                    <video src={candidate.previewUrl} className="size-full object-cover" muted preload="metadata" />
                                                    <span className="pointer-events-none absolute inset-0 grid place-items-center text-[7px] text-white">▶</span>
                                                </span>
                                            ) : (
                                                <Icon className="size-3.5" />
                                            )}
                                        </span>
                                        <span className="min-w-0 flex-1 truncate">{candidate.title}</span>
                                        {candidate.title === candidate.kindLabel ? null : (
                                            <span className="shrink-0 text-[11px]" style={{ color: theme.node.muted }}>
                                                {candidate.kindLabel}
                                            </span>
                                        )}
                                    </button>
                                );
                            })
                        ) : (
                            <p className="px-2 py-4 text-center text-xs" style={{ color: theme.node.muted }}>
                                {translate("canvas.noMatchingCanvasAssets")}
                            </p>
                        )}
                    </div>
                </div>
            ) : null}
        </div>
    );
}

/** 转义正则表达式字面量。 */
function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
