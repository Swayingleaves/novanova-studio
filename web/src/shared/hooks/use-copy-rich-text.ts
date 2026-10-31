"use client";

import { App } from "antd";

/** 将富文本及纯文本同时写入剪贴板，让目标编辑器保留表格和文字排版。 */
export function useCopyRichText() {
    const { message } = App.useApp();

    return async (html: string) => {
        try {
            const document = new DOMParser().parseFromString(html, "text/html");
            await navigator.clipboard.write([new ClipboardItem({
                "text/html": new Blob([html], { type: "text/html" }),
                "text/plain": new Blob([document.body.textContent || ""], { type: "text/plain" }),
            })]);
            message.success("邮件内容已复制，可粘贴到新建邮件的编辑正文中");
        } catch {
            message.error("复制失败，请检查浏览器剪贴板权限后重试");
        }
    };
}
