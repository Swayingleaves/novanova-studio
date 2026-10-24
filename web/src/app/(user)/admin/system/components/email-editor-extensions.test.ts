import assert from "node:assert/strict";
import test from "node:test";
import { MarkdownManager } from "@tiptap/markdown";
import type { JSONContent } from "@tiptap/react";
import { emailEditorExtensions } from "./email-editor-extensions";

/** 从解析结果中收集指定节点，验证实际文档结构而非 Markdown 文本特征。 */
function nodesOfType(document: JSONContent, type: string): JSONContent[] {
    return [...(document.type === type ? [document] : []), ...(document.content || []).flatMap(node => nodesOfType(node, type))];
}

test("Markdown 邮件解析标题、列表、引用、代码和链接", () => {
    const manager = new MarkdownManager({ extensions: emailEditorExtensions });
    const document = manager.parse([
        "# 一级标题", "## 二级标题", "### 三级标题", "#### 四级标题", "##### 五级标题", "###### 六级标题", "",
        "正文 **加粗**、*斜体*、~~删除线~~、`行内代码`与[更新链接](https://example.com/updates)。", "",
        "- 第一项", "- 第二项", "", "1. 第一步", "2. 第二步", "", "> 引用说明", "",
        "```html", "<div>", "  内容", "</div>", "```", "", "---",
    ].join("\n"));

    assert.deepEqual(nodesOfType(document, "heading").map(node => node.attrs?.level), [1, 2, 3, 4, 5, 6]);
    assert.equal(nodesOfType(document, "bulletList").length, 1);
    assert.equal(nodesOfType(document, "orderedList").length, 1);
    assert.equal(nodesOfType(document, "listItem").length, 4);
    assert.equal(nodesOfType(document, "blockquote").length, 1);
    assert.equal(nodesOfType(document, "horizontalRule").length, 1);
    const text = nodesOfType(document, "text");
    for (const mark of ["bold", "italic", "strike", "code"]) assert.ok(text.some(node => node.marks?.some(item => item.type === mark)));
    assert.ok(text.some(node => node.marks?.some(item => item.type === "link" && item.attrs?.href === "https://example.com/updates")));
    assert.equal(nodesOfType(document, "codeBlock")[0].content?.[0].text, "<div>\n  内容\n</div>");
});

test("Markdown 表格在解析和重新编辑后保留单元格与行内格式", () => {
    const manager = new MarkdownManager({ extensions: emailEditorExtensions });
    const document = manager.parse("| 项目 | 内容 |\n| --- | --- |\n| **功能** | Markdown \\| 富文本 |\n| 链接 | [文档](https://example.com) |");
    const restored = manager.parse(manager.serialize(document));

    assert.equal(nodesOfType(restored, "table").length, 1);
    assert.equal(nodesOfType(restored, "tableRow").length, 3);
    assert.equal(nodesOfType(restored, "tableHeader").length, 2);
    assert.equal(nodesOfType(restored, "tableCell").length, 4);
    assert.ok(nodesOfType(restored, "text").some(node => node.text === "功能" && node.marks?.some(mark => mark.type === "bold")));
    assert.ok(nodesOfType(restored, "text").some(node => node.text === "Markdown | 富文本"));
});
