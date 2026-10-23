"use client";

import { forwardRef, useEffect, useId, useImperativeHandle, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { Popover } from "antd";
import CodeMirror, { Compartment, Decoration, EditorState, EditorView, ExternalChange, StateField, Transaction, WidgetType, minimalSetup, type DecorationSet, type ReactCodeMirrorRef } from "@uiw/react-codemirror";

import { useTranslation } from "@/features/locale/use-translation";
import { imageMentionPattern, readImageMentionCommand, type PromptImageReference } from "@/features/generation/lib/image-reference-mentions";

export type ReferencePromptInputHandle = {
    focus: () => void;
    getSelection: () => { start: number; end: number };
    setSelectionRange: (start: number, end: number) => void;
};

type ReferencePromptInputProps = {
    value: string;
    placeholder: string;
    images: PromptImageReference[];
    compact?: boolean;
    onChange: (value: string, cursor: number) => void;
    onKeyDown: (event: KeyboardEvent) => void;
    onPaste: (event: ClipboardEvent) => void;
};

/** 用不可拆分的行内缩略图展示图片引用，文档仍然保存可直接提交的纯文本。 */
class ImageReferenceWidget extends WidgetType {
    constructor(private readonly image: PromptImageReference) {
        super();
    }

    eq(other: ImageReferenceWidget) {
        return this.image.id === other.image.id && this.image.label === other.image.label && this.image.previewUrl === other.image.previewUrl;
    }

    toDOM() {
        const chip = document.createElement("span");
        chip.className = "inline-flex items-center gap-1 rounded-sm bg-[var(--studio-surface-hover)] px-1 text-[var(--studio-action)] align-baseline whitespace-nowrap";
        chip.setAttribute("data-reference-id", this.image.id);
        chip.title = this.image.name;
        const thumbnail = document.createElement("img");
        thumbnail.src = this.image.previewUrl;
        thumbnail.alt = "";
        thumbnail.width = 20;
        thumbnail.height = 20;
        thumbnail.draggable = false;
        thumbnail.className = "inline-block size-5 rounded-xs object-cover align-middle";
        chip.append(thumbnail, document.createTextNode(`@${this.image.label}`));
        return chip;
    }

    ignoreEvent() {
        return false;
    }
}

/** 为已知图片编号生成装饰与原子范围，交由编辑器统一处理光标、删除和撤销。 */
function imageReferenceExtension(images: PromptImageReference[]) {
    const imagesByLabel = new Map(images.map((image) => [image.label, image]));
    const pattern = imageMentionPattern([...imagesByLabel.keys()]);
    const decorate = (value: string) =>
        Decoration.set(pattern ? Array.from(value.matchAll(pattern), (match) => Decoration.replace({ widget: new ImageReferenceWidget(imagesByLabel.get(match[1])!) }).range(match.index!, match.index! + match[0].length)) : []);
    const references = StateField.define<DecorationSet>({
        create: (state) => decorate(state.doc.toString()),
        update: (decorations, transaction) => (transaction.docChanged ? decorate(transaction.newDoc.toString()) : decorations),
        provide: (field) => [EditorView.decorations.from(field), EditorView.atomicRanges.of((view) => view.state.field(field))],
    });
    return references;
}

const promptTheme = EditorView.theme({
    "&": { backgroundColor: "transparent", color: "var(--studio-ink)", fontSize: "15px" },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": { fontFamily: "inherit", lineHeight: "1.75", overflowY: "auto" },
    ".cm-content": { padding: "0", caretColor: "var(--studio-ink)", overflowWrap: "anywhere" },
    ".cm-line": { padding: "0" },
    ".cm-placeholder": { color: "var(--studio-faint)" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { background: "var(--studio-primary-soft)" },
    ".cm-cursor": { borderLeftColor: "var(--studio-ink)" },
});

const editingExtensions = minimalSetup({ highlightSpecialChars: false, syntaxHighlighting: false });
const externalPromptChanges = EditorState.transactionExtender.of((transaction) => (transaction.annotation(ExternalChange) ? { annotations: Transaction.addToHistory.of(false) } : null));

/** 支持 @ 图片选择的提示词输入框，复用 CodeMirror 的编辑和历史记录能力。 */
export const ReferencePromptInput = forwardRef<ReferencePromptInputHandle, ReferencePromptInputProps>(function ReferencePromptInput({ value, placeholder, images, compact, onChange, onKeyDown, onPaste }, ref) {
    const translate = useTranslation();
    const editorRef = useRef<ReactCodeMirrorRef>(null);
    const previousImagesRef = useRef(images);
    const editingCompartment = useMemo(() => new Compartment(), []);
    const listId = useId();
    const [command, setCommand] = useState<ReturnType<typeof readImageMentionCommand>>(null);
    const [highlightedIndex, setHighlightedIndex] = useState(0);
    const candidates = images.filter((image) => !image.disabled && `${image.label} ${image.name}`.toLocaleLowerCase().includes((command?.query ?? "").toLocaleLowerCase()));
    const activeIndex = Math.min(highlightedIndex, Math.max(0, candidates.length - 1));
    const extensions = useMemo(() => [promptTheme, EditorView.lineWrapping, externalPromptChanges, editingCompartment.of(editingExtensions), imageReferenceExtension(images)], [images, editingCompartment]);
    const accessibleExtensions = useMemo(
        () => [
            ...extensions,
            EditorView.contentAttributes.of({
                "aria-label": translate("generation.videoPrompt"),
                "aria-autocomplete": "list",
                "aria-haspopup": "listbox",
                ...(command ? { "aria-controls": listId, ...(candidates.length ? { "aria-activedescendant": `${listId}-${activeIndex}` } : {}) } : {}),
            }),
        ],
        [extensions, command, candidates.length, listId, activeIndex, translate.locale],
    );

    useEffect(() => {
        if (command) document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
    }, [activeIndex, command?.query, listId]);

    useEffect(() => {
        const previous = previousImagesRef.current;
        previousImagesRef.current = images;
        const labels = new Map(images.map((image) => [image.id, image.label]));
        const view = editorRef.current?.view;
        if (!view || !previous.some((image) => labels.get(image.id) !== image.label)) return;
        // 素材删除或重新编号后清空旧历史，防止撤销恢复已失效或指向其他图片的编号。
        view.dispatch({ effects: editingCompartment.reconfigure([]) });
        view.dispatch({ effects: editingCompartment.reconfigure(editingExtensions) });
    }, [images, editingCompartment]);

    useImperativeHandle(
        ref,
        () => ({
            focus: () => editorRef.current?.view?.focus(),
            getSelection: () => {
                const selection = editorRef.current?.view?.state.selection.main;
                return { start: selection?.from ?? value.length, end: selection?.to ?? value.length };
            },
            setSelectionRange: (start, end) => editorRef.current?.view?.dispatch({ selection: { anchor: start, head: end }, scrollIntoView: true }),
        }),
        [value.length],
    );

    const chooseImage = (image: PromptImageReference) => {
        const view = editorRef.current?.view;
        if (!view || !command) return;
        const insert = `@${image.label}`;
        view.dispatch({ changes: { from: command.start, to: command.end, insert }, selection: { anchor: command.start + insert.length }, userEvent: "input.complete" });
        setCommand(null);
        view.focus();
    };

    return (
        <Popover
            open={command !== null}
            trigger={[]}
            placement="topLeft"
            content={
                <div id={listId} role="listbox" aria-label={translate("generation.uploadedImages")} className="max-h-60 w-[min(19rem,calc(100vw-64px))] overflow-y-auto">
                    <div className="px-2 pb-2 text-xs text-[var(--studio-muted)]">{translate("generation.uploadedImages")}</div>
                    {candidates.length ? (
                        candidates.map((image, index) => (
                            <button
                                id={`${listId}-${index}`}
                                key={image.id}
                                type="button"
                                role="option"
                                tabIndex={-1}
                                aria-selected={index === activeIndex}
                                className={`flex min-h-12 w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[var(--studio-ink)] ${index === activeIndex ? "bg-[var(--studio-surface-hover)]" : "hover:bg-[var(--studio-surface-hover)]"}`}
                                onMouseDown={(event) => event.preventDefault()}
                                onMouseEnter={() => setHighlightedIndex(index)}
                                onClick={() => chooseImage(image)}
                            >
                                <img src={image.previewUrl} alt="" width={36} height={36} className="size-9 shrink-0 rounded-sm object-cover" />
                                <span className="min-w-0 flex-1">
                                    <span className="block text-sm font-medium">@{image.label}</span>
                                    <span className="block truncate text-xs text-[var(--studio-muted)]">{image.name}</span>
                                </span>
                            </button>
                        ))
                    ) : (
                        <p className="px-2 py-3 text-sm text-[var(--studio-muted)]">{translate(images.some((image) => !image.disabled) ? "generation.noMatchingImages" : "generation.uploadImagesToMention")}</p>
                    )}
                </div>
            }
        >
            <div
                className="min-w-0"
                onBlur={() => setCommand(null)}
                onPasteCapture={(event) => {
                    onPaste(event);
                    if (event.defaultPrevented) event.stopPropagation();
                }}
                onKeyDownCapture={(event) => {
                    if (event.nativeEvent.isComposing || editorRef.current?.view?.composing) return;
                    if (command && ["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(event.key) && !event.shiftKey) {
                        event.preventDefault();
                        event.stopPropagation();
                        if (event.key === "Escape") setCommand(null);
                        else if (event.key === "Enter") {
                            if (candidates[activeIndex]) chooseImage(candidates[activeIndex]);
                        } else setHighlightedIndex(Math.max(0, Math.min(candidates.length - 1, activeIndex + (event.key === "ArrowDown" ? 1 : -1))));
                        return;
                    }
                    onKeyDown(event);
                    if (event.defaultPrevented) event.stopPropagation();
                }}
            >
                <CodeMirror
                    ref={editorRef}
                    value={value}
                    placeholder={placeholder}
                    minHeight={compact ? "26px" : "79px"}
                    maxHeight="158px"
                    theme="none"
                    basicSetup={false}
                    indentWithTab={false}
                    extensions={accessibleExtensions}
                    onChange={(nextValue, update) => onChange(nextValue, update.state.selection.main.head)}
                    onUpdate={(update) => {
                        if (!update.docChanged && !update.selectionSet) return;
                        const selection = update.state.selection.main;
                        // 完整图片标签已显示为原子芯片，移动光标到芯片后无需再次弹出菜单。
                        setCommand(
                            selection.empty && update.view.hasFocus && !update.view.composing
                                ? readImageMentionCommand(
                                      update.state.doc.toString(),
                                      selection.head,
                                      images.map((image) => image.label),
                                  )
                                : null,
                        );
                        setHighlightedIndex(0);
                    }}
                    aria-label={translate("generation.videoPrompt")}
                />
            </div>
        </Popover>
    );
});
