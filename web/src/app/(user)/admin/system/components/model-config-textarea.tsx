"use client";

import { Button, Input, Modal, Tooltip } from "antd";
import type { TextAreaRef } from "antd/es/input/TextArea";
import { Maximize2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useTranslation } from "@/features/locale/use-translation";
import { SkillPromptMentionEditor, type SkillPromptMentionEditorHandle } from "@/features/skill-market/components/skill-prompt-mention-editor";

/** 原生滚动条宽度，只在浏览器端测量一次。 */
let nativeScrollbarWidthCache: number | null = null;
function nativeScrollbarWidth() {
    if (nativeScrollbarWidthCache !== null) return nativeScrollbarWidthCache;
    const probe = document.createElement("div");
    probe.style.cssText = "position:absolute;top:-9999px;width:100px;height:100px;overflow:scroll";
    document.body.appendChild(probe);
    nativeScrollbarWidthCache = probe.offsetWidth - probe.clientWidth;
    probe.remove();
    return nativeScrollbarWidthCache;
}

type ModelConfigTextAreaProps = {
    /** 弹窗标题，通常由字段名称与能力/模式名称组成。 */
    title: string;
    value?: string;
    onChange?: (value: string) => void;
    placeholder?: string;
    /** JSON 示例类内容使用等宽字体。 */
    mono?: boolean;
    /** 行内输入框的行数范围。 */
    minRows?: number;
    maxRows?: number;
    /** 可插入的模板占位符，行内与放大弹窗内都能插入。 */
    placeholders?: readonly { label: string; value: string }[];
    /** 输入 @ 时可选的技能动作。只有流程提示词传入，模型配置框不显示。 */
    mentions?: readonly { label: string; token: string }[];
};

/**
 * 自定义模型配置里的长文本输入框。
 *
 * 小窗口里的多行输入只能反复滚动，因此右上角提供放大按钮，在弹窗里一次性编辑完整内容。
 * 流程提示词传入 mentions 后，@ 在光标处列出动作，并把已写入的标识显示成含义。
 *
 * @param props 字段值、变更回调与输入框外观配置
 * @return 带放大编辑弹窗的多行输入框
 */
export function ModelConfigTextArea({ title, value = "", onChange, placeholder, mono, minRows = 2, maxRows = 6, placeholders, mentions }: ModelConfigTextAreaProps) {
    const translate = useTranslation();
    const [open, setOpen] = useState(false);
    // 原生滚动条会盖住并拦截它上方的元素，所以放大按钮要避开滚动条占用的宽度。
    const [scrollbarWidth, setScrollbarWidth] = useState(0);
    useEffect(() => setScrollbarWidth(nativeScrollbarWidth()), []);
    const inlineRef = useRef<TextAreaRef | null>(null);
    const modalRef = useRef<TextAreaRef | null>(null);
    const inlineEditorRef = useRef<SkillPromptMentionEditorHandle | null>(null);
    const modalEditorRef = useRef<SkillPromptMentionEditorHandle | null>(null);
    const textAreaClassName = mono ? "font-mono text-xs" : undefined;
    const useMentions = Boolean(mentions?.length);
    const insertPlaceholder = (source: "inline" | "modal", placeholderValue: string) => {
        if (useMentions) {
            (source === "modal" ? modalEditorRef : inlineEditorRef).current?.insert(placeholderValue);
            return;
        }
        const textArea = (source === "modal" ? modalRef : inlineRef).current?.resizableTextArea?.textArea;
        const start = textArea?.selectionStart ?? value.length;
        const end = textArea?.selectionEnd ?? value.length;
        onChange?.(value.slice(0, start) + placeholderValue + value.slice(end));
        requestAnimationFrame(() => {
            textArea?.setSelectionRange(start + placeholderValue.length, start + placeholderValue.length);
            textArea?.focus();
        });
    };
    const placeholderRow = (source: "inline" | "modal") =>
        placeholders?.length ? (
            <div className="mb-1 flex flex-wrap items-center gap-1">
                <span className="text-xs text-[var(--studio-muted)]">{translate("appShell.insertPlaceholder")}</span>
                {placeholders.map((option) => (
                    <Button key={option.value} size="small" className="!px-1.5 font-mono text-[11px]" onClick={() => insertPlaceholder(source, option.value)}>
                        {option.label}
                    </Button>
                ))}
            </div>
        ) : null;
    const mentionEditor = (source: "inline" | "modal") => (
        <SkillPromptMentionEditor
            ref={source === "modal" ? modalEditorRef : inlineEditorRef}
            value={value}
            mentions={mentions ?? []}
            placeholder={placeholder}
            minHeight={source === "inline" ? `${Math.max(minRows, 2) * 22}px` : "58vh"}
            maxHeight={source === "inline" ? `${Math.max(maxRows, minRows) * 22}px` : "58vh"}
            autoFocus={source === "modal"}
            contentPaddingRight={source === "inline" ? 36 : 12}
            onChange={(next) => onChange?.(next)}
        />
    );
    const plainEditor = (source: "inline" | "modal") => (
        <Input.TextArea
            ref={source === "modal" ? modalRef : inlineRef}
            autoFocus={source === "modal"}
            value={value}
            autoSize={source === "inline" ? { minRows, maxRows } : undefined}
            spellCheck={false}
            placeholder={placeholder}
            className={source === "inline" ? `!pr-9 ${textAreaClassName || ""}` : textAreaClassName}
            style={source === "inline" ? { scrollbarGutter: "stable" } : { height: "58vh" }}
            onChange={(event) => onChange?.(event.target.value)}
        />
    );
    return (
        <>
            <div>
                {placeholderRow("inline")}
                <div className="relative">
                    {useMentions ? mentionEditor("inline") : plainEditor("inline")}
                    <Tooltip title={translate("appShell.expandEditor")}>
                        <Button
                            type="text"
                            size="small"
                            aria-label={translate("appShell.expandEditor")}
                            className="!absolute top-1 !z-10 !h-6 !w-6 !min-w-0 !p-0 text-[var(--studio-muted)] hover:!text-[var(--studio-ink)]"
                            style={{ right: scrollbarWidth + 4 }}
                            icon={<Maximize2 className="size-3.5" />}
                            onClick={() => setOpen(true)}
                        />
                    </Tooltip>
                </div>
            </div>
            <Modal
                open={open}
                centered
                width={920}
                zIndex={1300}
                title={title}
                destroyOnHidden
                onCancel={() => setOpen(false)}
                footer={<Button type="primary" onClick={() => setOpen(false)}>{translate("appShell.done")}</Button>}
            >
                {placeholderRow("modal")}
                {useMentions ? mentionEditor("modal") : plainEditor("modal")}
            </Modal>
        </>
    );
}
