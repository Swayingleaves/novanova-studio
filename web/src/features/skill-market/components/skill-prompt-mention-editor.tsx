"use client";

import { forwardRef, useEffect, useId, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import CodeMirror, { Decoration, EditorView, StateField, WidgetType, minimalSetup, type DecorationSet, type ReactCodeMirrorRef } from "@uiw/react-codemirror";

import { filterSkillPromptActions, readSkillPromptMention } from "@/features/skill-market/lib/skill-prompt-actions";

export type SkillPromptMention = { label: string; token: string };

export type SkillPromptMentionEditorHandle = {
    focus: () => void;
    insert: (text: string) => void;
};

type SkillPromptMentionEditorProps = {
    value: string;
    mentions: readonly SkillPromptMention[];
    placeholder?: string;
    minHeight: string;
    maxHeight: string;
    autoFocus?: boolean;
    /** 给右上角放大按钮留出的内边距。 */
    contentPaddingRight?: number;
    onChange: (value: string) => void;
};

type MentionCommand = { query: string; start: number; end: number };

/** 文档仍保存 @ask_user_model_config，编辑器里显示动作含义。 */
class ActionMentionWidget extends WidgetType {
    constructor(private readonly label: string, private readonly token: string) {
        super();
    }

    eq(other: ActionMentionWidget) {
        return this.label === other.label && this.token === other.token;
    }

    toDOM() {
        const chip = document.createElement("span");
        chip.className = "inline-flex items-center rounded-sm bg-[var(--studio-surface-hover)] px-1 text-[var(--studio-action)] align-baseline whitespace-nowrap";
        chip.textContent = `@${this.label}`;
        return chip;
    }

    ignoreEvent() {
        return false;
    }
}

function actionMentionExtension(mentions: readonly SkillPromptMention[]) {
    const labels = new Map(mentions.map((mention) => [mention.token, mention.label]));
    const alternatives = [...labels.keys()].sort((first, second) => second.length - first.length).map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const decorate = (value: string) => {
        if (!alternatives.length) return Decoration.none;
        const pattern = new RegExp(`@(${alternatives.join("|")})(?![A-Za-z0-9_])`, "g");
        const ranges = Array.from(value.matchAll(pattern)).flatMap((match) => {
            const label = labels.get(match[1]);
            if (!label || match.index == null) return [];
            return [Decoration.replace({ widget: new ActionMentionWidget(label, match[1]) }).range(match.index, match.index + match[0].length)];
        });
        return Decoration.set(ranges);
    };
    return StateField.define<DecorationSet>({
        create: (state) => decorate(state.doc.toString()),
        update: (decorations, transaction) => (transaction.docChanged ? decorate(transaction.newDoc.toString()) : decorations),
        provide: (field) => [EditorView.decorations.from(field), EditorView.atomicRanges.of((view) => view.state.field(field))],
    });
}

function placeMenu(coords: { left: number; top: number; bottom: number }, optionCount: number) {
    const width = Math.min(304, window.innerWidth - 16);
    const left = Math.max(8, Math.min(coords.left, window.innerWidth - width - 8));
    const height = Math.min(240, optionCount * 40 + 8);
    const below = coords.bottom + 6;
    const top = below + height > window.innerHeight - 8 ? Math.max(8, coords.top - height - 6) : below;
    return { left, top, width };
}

const editingExtensions = minimalSetup({ highlightSpecialChars: false, syntaxHighlighting: false });

/**
 * 流程提示词编辑器。输入 @ 时在光标后列出动作，选定后以含义芯片显示，保存文本仍是动作标识。
 */
export const SkillPromptMentionEditor = forwardRef<SkillPromptMentionEditorHandle, SkillPromptMentionEditorProps>(function SkillPromptMentionEditor({
    value,
    mentions,
    placeholder,
    minHeight,
    maxHeight,
    autoFocus,
    contentPaddingRight = 12,
    onChange,
}, ref) {
    const editorRef = useRef<ReactCodeMirrorRef>(null);
    const viewRef = useRef<EditorView | null>(null);
    const commandRef = useRef<MentionCommand | null>(null);
    const mentionsRef = useRef(mentions);
    const refreshRef = useRef<(view: EditorView) => void>(() => {});
    const listId = useId();
    const [command, setCommand] = useState<MentionCommand | null>(null);
    const [menuPos, setMenuPos] = useState<{ left: number; top: number; width: number } | null>(null);
    const [highlightedIndex, setHighlightedIndex] = useState(0);
    const [viewReady, setViewReady] = useState(false);
    const mentionKey = mentions.map((mention) => `${mention.token}\0${mention.label}`).join("\n");
    mentionsRef.current = mentions;
    const extensions = useMemo(
        () => [
            EditorView.theme({
                "&": { backgroundColor: "transparent", color: "var(--studio-ink)", fontSize: "14px" },
                "&.cm-focused": { outline: "none" },
                ".cm-scroller": { fontFamily: "inherit", lineHeight: "22px" },
                ".cm-content": { padding: `4px ${contentPaddingRight}px 4px 11px`, caretColor: "var(--studio-ink)" },
                ".cm-line": { padding: "0" },
                ".cm-placeholder": { color: "var(--studio-faint)" },
                ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { background: "var(--studio-primary-soft)" },
                ".cm-cursor": { borderLeftColor: "var(--studio-ink)" },
            }),
            EditorView.lineWrapping,
            editingExtensions,
            actionMentionExtension(mentionsRef.current),
        ],
        [contentPaddingRight, mentionKey],
    );
    const options = command ? filterSkillPromptActions(mentions, command.query) : [];
    const activeIndex = Math.min(highlightedIndex, Math.max(0, options.length - 1));

    useEffect(() => {
        if (menuPos && options.length) document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
    }, [activeIndex, listId, menuPos, options.length]);

    const refresh = (view: EditorView) => {
        const selection = view.state.selection.main;
        const next = selection.empty && view.hasFocus && !view.composing
            ? readSkillPromptMention(view.state.doc.toString(), selection.head, mentionsRef.current.map((mention) => mention.token))
            : null;
        const previous = commandRef.current;
        const changed = previous?.start !== next?.start || previous?.query !== next?.query || (previous === null) !== (next === null);
        if (changed) {
            commandRef.current = next;
            setCommand(next);
            setHighlightedIndex(0);
        }
        if (!next) {
            setMenuPos(null);
            return;
        }
        const choices = filterSkillPromptActions(mentionsRef.current, next.query);
        const coords = choices.length ? view.coordsAtPos(selection.head) : null;
        setMenuPos(coords ? placeMenu(coords, choices.length) : null);
    };
    refreshRef.current = refresh;

    useEffect(() => {
        const view = viewRef.current;
        if (!view) return;
        const onScroll = () => refreshRef.current(view);
        view.scrollDOM.addEventListener("scroll", onScroll, { passive: true });
        window.addEventListener("scroll", onScroll, true);
        window.addEventListener("resize", onScroll);
        return () => {
            view.scrollDOM.removeEventListener("scroll", onScroll);
            window.removeEventListener("scroll", onScroll, true);
            window.removeEventListener("resize", onScroll);
        };
    }, [viewReady]);

    useImperativeHandle(ref, () => ({
        focus: () => viewRef.current?.focus(),
        insert: (text: string) => {
            const view = viewRef.current;
            if (!view) return;
            const { from, to } = view.state.selection.main;
            view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
            view.focus();
        },
    }), []);

    const choose = (token: string) => {
        const view = viewRef.current;
        const current = commandRef.current;
        if (!view || !current) return;
        const insert = `@${token}`;
        view.dispatch({ changes: { from: current.start, to: current.end, insert }, selection: { anchor: current.start + insert.length }, userEvent: "input.complete" });
        commandRef.current = null;
        setCommand(null);
        setMenuPos(null);
        view.focus();
    };

    const onKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
        const current = commandRef.current;
        const choices = current ? filterSkillPromptActions(mentionsRef.current, current.query) : [];
        if (!current || !choices.length || event.nativeEvent.isComposing || viewRef.current?.composing) return;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            event.stopPropagation();
            setHighlightedIndex((index) => {
                const currentIndex = Math.min(index, choices.length - 1);
                return event.key === "ArrowDown" ? (currentIndex + 1) % choices.length : (currentIndex - 1 + choices.length) % choices.length;
            });
        } else if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
            event.preventDefault();
            event.stopPropagation();
            choose(choices[Math.min(highlightedIndex, choices.length - 1)].token);
        } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            commandRef.current = null;
            setCommand(null);
            setMenuPos(null);
        }
    };

    return (
        <div
            className="overflow-hidden rounded-md border border-[var(--studio-line)] bg-[var(--studio-surface)] focus-within:border-[var(--studio-primary)]"
            onBlur={() => {
                commandRef.current = null;
                setCommand(null);
                setMenuPos(null);
            }}
            onKeyDownCapture={onKeyDownCapture}
        >
            <CodeMirror
                ref={editorRef}
                value={value}
                placeholder={placeholder}
                minHeight={minHeight}
                maxHeight={maxHeight}
                autoFocus={autoFocus}
                theme="none"
                basicSetup={false}
                indentWithTab={false}
                extensions={extensions}
                onCreateEditor={(view) => {
                    viewRef.current = view;
                    setViewReady(true);
                }}
                onChange={(next) => onChange(next)}
                onUpdate={(update) => {
                    if (!update.docChanged && !update.selectionSet && !update.geometryChanged && !update.focusChanged) return;
                    refresh(update.view);
                }}
            />
            {menuPos && options.length ? createPortal(
                <div id={listId} role="listbox" className="max-h-60 overflow-y-auto rounded-md border border-[var(--studio-line)] bg-[var(--studio-surface)] py-1 shadow-lg" style={{ position: "fixed", left: menuPos.left, top: menuPos.top, width: menuPos.width, zIndex: 2000 }}>
                    {options.map((option, index) => (
                        <button
                            id={`${listId}-${index}`}
                            key={option.token}
                            type="button"
                            role="option"
                            tabIndex={-1}
                            aria-selected={index === activeIndex}
                            className={`block min-h-10 w-full px-3 py-1.5 text-left text-sm text-[var(--studio-ink)] ${index === activeIndex ? "bg-[var(--studio-surface-hover)]" : "hover:bg-[var(--studio-surface-hover)]"}`}
                            onMouseDown={(event) => {
                                event.preventDefault();
                                choose(option.token);
                            }}
                            onMouseEnter={() => setHighlightedIndex(index)}
                        >
                            @{option.label}
                        </button>
                    ))}
                </div>,
                document.body,
            ) : null}
        </div>
    );
});
