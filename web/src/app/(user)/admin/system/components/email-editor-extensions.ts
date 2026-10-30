import { generateHTML, type Extensions } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { Table, TableKit } from "@tiptap/extension-table";
import { Markdown } from "@tiptap/markdown";

/** 图片在 Markdown 中保留上传标识，切换编辑模式后仍可生成邮件附件。 */
const EmailImage = Image.extend({
    addAttributes() {
        return {
            ...this.parent?.(),
            storageKey: {
                default: null,
                parseHTML: (element: HTMLElement) => element.getAttribute("data-storage-key"),
                renderHTML: (attributes: Record<string, unknown>) => ({ "data-storage-key": attributes.storageKey }),
            },
        };
    },
    renderMarkdown: node => `<div>${generateHTML({ type: "doc", content: [node] }, emailEditorExtensions)}</div>`,
});

/** Markdown 简单表格沿用官方序列化，合并单元格及复杂内容保留为 HTML 表格。 */
const EmailTable = Table.extend({
    renderMarkdown(node, helpers, context) {
        const complex = !node.content?.[0]?.content?.every(cell => cell.type === "tableHeader")
            || node.content.some(row => row.content?.some(cell => cell.attrs?.colspan > 1 || cell.attrs?.rowspan > 1
                || cell.content?.length !== 1 || cell.content[0].type !== "paragraph"
                || cell.content[0].content?.some(child => child.type !== "text" && child.type !== "hardBreak")));
        return complex ? generateHTML({ type: "doc", content: [node] }, emailEditorExtensions) : this.parent!(node, helpers, context);
    },
});

/** 邮件统一使用同一套富文本结构解析 HTML 与 Markdown，预览和发送都输出 HTML。 */
export const emailEditorExtensions: Extensions = [
    StarterKit.configure({ link: { openOnClick: false, protocols: ["https", "http", "mailto"] } }),
    EmailImage.configure({ allowBase64: false }),
    TableKit.configure({ table: false }),
    EmailTable,
    Markdown.configure({ markedOptions: { gfm: true } }),
];
