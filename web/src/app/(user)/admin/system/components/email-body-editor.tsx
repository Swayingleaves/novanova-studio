"use client";

import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { App, Button, Dropdown, Input, Segmented, Tooltip, Upload } from "antd";
import { Bold, ChevronDown, Copy, Heading2, ImagePlus, Italic, List, ListOrdered, Redo2, Table2, Undo2 } from "lucide-react";
import { uploadImage } from "@/features/storage/services/image-storage";
import { useCopyRichText } from "@/shared/hooks/use-copy-rich-text";
import { emailEditorExtensions } from "./email-editor-extensions";
import styles from "./email-body-editor.module.css";

type EditorProperties = {
    value?: string;
    onChange?: (html: string) => void;
    onUploadingChange: (uploading: boolean) => void;
    disabled?: boolean;
};

/** 渲染邮件正文，支持富文本与 Markdown 输入，并统一输出可预览和发送的 HTML。 */
export function EmailBodyEditor({ value = "", onChange, onUploadingChange, disabled = false }: EditorProperties) {
    const { message } = App.useApp();
    const copyRichText = useCopyRichText();
    const [uploading, setUploading] = useState(false);
    const [inputMode, setInputMode] = useState<"richText" | "markdown">("richText");
    const [markdown, setMarkdown] = useState("");
    const uploadingReference = useRef(false);
    const editor = useEditor({
        extensions: emailEditorExtensions,
        content: value,
        immediatelyRender: false,
        shouldRerenderOnTransaction: true,
        editorProps: {
            attributes: { role: "textbox", "aria-label": "邮件正文", "aria-multiline": "true" },
            handlePaste: (_view, event): boolean => {
                const html = event.clipboardData?.getData("text/html") || "";
                if (!html || !new DOMParser().parseFromString(html, "text/html").querySelector('img[src^="data:"]')) return false;
                event.preventDefault();
                void insertPastedContent(html);
                return true;
            },
        },
        onUpdate: ({ editor: current }) => onChange?.(current.getHTML()),
    });

    useEffect(() => {
        if (editor && value !== editor.getHTML()) {
            editor.commands.setContent(value, { emitUpdate: false });
            if (inputMode === "markdown") setMarkdown(editor.getMarkdown());
        }
    }, [editor, value, inputMode]);

    useEffect(() => { editor?.setEditable(!disabled && !uploading); }, [editor, disabled, uploading]);

    const actions = [
        { label: "加粗", Icon: Bold, active: editor?.isActive("bold"), run: () => editor?.chain().focus().toggleBold().run() },
        { label: "斜体", Icon: Italic, active: editor?.isActive("italic"), run: () => editor?.chain().focus().toggleItalic().run() },
        { label: "小标题", Icon: Heading2, active: editor?.isActive("heading"), run: () => editor?.chain().focus().toggleHeading({ level: 2 }).run() },
        { label: "无序列表", Icon: List, active: editor?.isActive("bulletList"), run: () => editor?.chain().focus().toggleBulletList().run() },
        { label: "有序列表", Icon: ListOrdered, active: editor?.isActive("orderedList"), run: () => editor?.chain().focus().toggleOrderedList().run() },
        { label: "撤销", Icon: Undo2, run: () => editor?.chain().focus().undo().run() },
        { label: "重做", Icon: Redo2, run: () => editor?.chain().focus().redo().run() },
    ];
    const tableActive = editor?.isActive("table") ?? false;
    const tableActions = [
        { key: "addRowBefore", label: "上方插入行", onClick: () => editor?.chain().focus().addRowBefore().run() },
        { key: "addRowAfter", label: "下方插入行", onClick: () => editor?.chain().focus().addRowAfter().run() },
        { key: "addColumnBefore", label: "左侧插入列", onClick: () => editor?.chain().focus().addColumnBefore().run() },
        { key: "addColumnAfter", label: "右侧插入列", onClick: () => editor?.chain().focus().addColumnAfter().run() },
        { key: "deleteRow", label: "删除当前行", onClick: () => editor?.chain().focus().deleteRow().run() },
        { key: "deleteColumn", label: "删除当前列", onClick: () => editor?.chain().focus().deleteColumn().run() },
        { key: "deleteTable", label: "删除表格", danger: true, onClick: () => editor?.chain().focus().deleteTable().run() },
    ];

    /** 将已发送邮件的内嵌图片快照重新上传，再整体插入富文本，保留表格和段落顺序。 */
    const insertPastedContent = async (html: string) => {
        if (!editor || disabled || uploadingReference.current) return;
        uploadingReference.current = true;
        editor.setEditable(false);
        setUploading(true);
        onUploadingChange(true);
        try {
            const document = new DOMParser().parseFromString(html, "text/html");
            let imageCount = document.querySelectorAll("img").length;
            editor.state.doc.descendants(node => { if (node.type.name === "image") imageCount++; });
            editor.state.doc.nodesBetween(editor.state.selection.from, editor.state.selection.to, node => { if (node.type.name === "image") imageCount--; });
            if (imageCount > 10) throw new Error("单封邮件最多插入10张图片");
            const images = Array.from(document.querySelectorAll<HTMLImageElement>('img[src^="data:"]'));
            const files = await Promise.all(images.map(async image => {
                if (!/^data:image\/(png|jpeg|gif);base64,/i.test(image.src)) throw new Error("邮件图片只支持PNG、JPEG和GIF");
                const file = await (await fetch(image.src)).blob();
                if (file.size > 5 * 1024 * 1024) throw new Error("单张邮件图片不能超过5MB");
                return file;
            }));
            if (files.reduce((total, file) => total + file.size, 0) > 10 * 1024 * 1024) throw new Error("邮件图片总大小不能超过10MB");
            for (const [index, file] of files.entries()) {
                const image = await uploadImage(file);
                images[index].setAttribute("src", image.url);
                images[index].setAttribute("data-storage-key", image.storageKey);
            }
            if (!editor.isDestroyed) editor.chain().focus().insertContent(document.body.innerHTML).run();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "邮件内容粘贴失败，请重试");
        } finally {
            if (!editor.isDestroyed) editor.setEditable(!disabled);
            uploadingReference.current = false;
            setUploading(false);
            onUploadingChange(false);
        }
    };

    /** 校验并上传图片，在当前光标位置插入；上传完成前禁止提交邮件。 */
    const insertImage = async (file: File) => {
        if (!editor || uploadingReference.current || disabled) return false;
        if (!["image/png", "image/jpeg", "image/gif"].includes(file.type) || file.size > 5 * 1024 * 1024) {
            message.error("请选择5MB以内的PNG、JPEG或GIF图片");
            return false;
        }
        let imageCount = 0;
        editor.state.doc.descendants((node) => { if (node.type.name === "image") imageCount++; });
        if (imageCount >= 10) { message.error("单封邮件最多插入10张图片"); return false; }
        uploadingReference.current = true;
        editor.setEditable(false);
        setUploading(true);
        onUploadingChange(true);
        try {
            const image = await uploadImage(file);
            editor.chain().focus().insertContent({ type: "image", attrs: { src: image.url, alt: file.name, storageKey: image.storageKey } }).run();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "图片上传失败");
        } finally {
            if (!editor.isDestroyed) editor.setEditable(!disabled);
            uploadingReference.current = false;
            setUploading(false);
            onUploadingChange(false);
        }
        return false;
    };

    return (
        <div className={styles.editor}>
            <div className="flex flex-wrap items-center gap-1 border-b border-[var(--studio-line)] p-2" role="toolbar" aria-label="邮件排版">
                <Segmented<"richText" | "markdown"> aria-label="正文输入格式" size="small" value={inputMode} disabled={!editor || disabled || uploading}
                    options={[{ label: "富文本", value: "richText" }, { label: "Markdown", value: "markdown" }]}
                    onChange={mode => { if (mode === "markdown" && editor) setMarkdown(editor.getMarkdown()); setInputMode(mode); }} />
                {inputMode === "richText" && <>
                    {actions.map(({ label, Icon, active, run }) => (
                        <Tooltip key={label} title={label}>
                            <Button type="text" aria-label={label} aria-pressed={active} disabled={!editor || disabled || uploading}
                                style={active ? { color: "var(--studio-action)", background: "var(--studio-surface-hover)" } : undefined}
                                icon={<Icon size={16} aria-hidden="true" />} onClick={run} />
                        </Tooltip>
                    ))}
                    <Button type="text" icon={<Table2 size={16} aria-hidden="true" />} disabled={!editor || disabled || uploading || tableActive}
                        onClick={() => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>插入表格</Button>
                    <Dropdown trigger={["click"]} menu={{ items: tableActions }} disabled={!tableActive || disabled || uploading}>
                        <Button type="text" disabled={!tableActive || disabled || uploading}>表格操作<ChevronDown size={14} aria-hidden="true" /></Button>
                    </Dropdown>
                    <Upload accept="image/png,image/jpeg,image/gif" showUploadList={false} beforeUpload={insertImage} disabled={!editor || disabled || uploading}>
                        <Button type="text" icon={<ImagePlus size={16} aria-hidden="true" />} loading={uploading} disabled={!editor || disabled}>插入图片</Button>
                    </Upload>
                    <span className="px-2 text-xs text-[var(--studio-muted)]">最多10张，合计不超过10MB</span>
                </>}
                <Button type="text" icon={<Copy size={16} aria-hidden="true" />} disabled={!editor || editor.isEmpty || disabled || uploading}
                    onClick={() => editor && void copyRichText(editor.getHTML())}>复制邮件内容</Button>
            </div>
            {inputMode === "markdown" ? <Input.TextArea aria-label="Markdown 邮件正文" value={markdown} disabled={!editor || disabled || uploading}
                autoSize={{ minRows: 12, maxRows: 24 }} variant="borderless" className="font-mono!"
                placeholder="输入或粘贴 Markdown，支持标题、列表、链接、表格、引用和代码块"
                onChange={event => { setMarkdown(event.target.value); editor?.commands.setContent(event.target.value, { contentType: "markdown" }); }} />
                : <EditorContent editor={editor} />}
        </div>
    );
}
