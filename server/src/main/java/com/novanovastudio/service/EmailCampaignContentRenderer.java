package com.novanovastudio.service;

import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.safety.Cleaner;
import org.jsoup.safety.Safelist;

/**
 * 统一清理并排版群发邮件，预览与发送共用适合邮件客户端的内联样式和表格属性。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-24 23:59
 */
public final class EmailCampaignContentRenderer {
    /** 禁止实例化无状态的邮件排版工具。 */
    private EmailCampaignContentRenderer() { }

    /**
     * 清理编辑器内容并补齐邮件客户端需要的排版，禁止透传任意样式和事件属性。
     * @param bodyHtml 编辑器的 HTML 正文
     * @return 清理并排版后的正文文档，保留图片媒体标识供归属校验
     */
    public static Document clean(String bodyHtml) {
        Safelist allowed = Safelist.basicWithImages()
                .addTags("h1", "h2", "h3", "h4", "h5", "h6", "s", "hr", "table", "thead", "tbody", "tfoot", "tr", "th", "td")
                .addAttributes("th", "colspan", "rowspan").addAttributes("td", "colspan", "rowspan")
                .addAttributes("img", "data-storage-key").removeAttributes("img", "width", "height")
                .addEnforcedAttribute("a", "rel", "noopener noreferrer");
        Document document = new Cleaner(allowed).clean(Jsoup.parseBodyFragment(bodyHtml));
        document.outputSettings().prettyPrint(false);
        // 表格同时提供传统 HTML 属性和内联样式，不依赖网页预览的全局 CSS。
        document.select("table").attr("width", "100%").attr("border", "1").attr("cellpadding", "0").attr("cellspacing", "0")
                .attr("style", "display:table;width:100%;border-collapse:collapse;border-spacing:0;table-layout:fixed;margin:12px 0;border:1px solid #d1d5db");
        document.select("thead").attr("style", "display:table-header-group");
        document.select("tbody").attr("style", "display:table-row-group");
        document.select("tfoot").attr("style", "display:table-footer-group");
        document.select("tr").attr("style", "display:table-row");
        document.select("th,td").attr("valign", "top")
                .attr("style", "display:table-cell;border:1px solid #d1d5db;padding:8px 12px;vertical-align:top;overflow-wrap:anywhere;word-break:break-word");
        document.select("th").attr("align", "left").attr("bgcolor", "#f3f4f6")
                .forEach(element -> element.attr("style", element.attr("style") + ";background-color:#f3f4f6;color:#111827;text-align:left;font-weight:bold"));
        document.select("p").attr("style", "margin:0 0 12px;line-height:1.75");
        document.select("td > p:last-child,th > p:last-child").attr("style", "margin:0;line-height:1.75");
        for (int level = 1; level <= 6; level++) {
            int size = switch (level) { case 1 -> 24; case 2 -> 20; case 3 -> 18; default -> 16; };
            document.select("h" + level).attr("style", "margin:16px 0 12px;font-size:" + size + "px;line-height:1.4;font-weight:bold");
        }
        document.select("ul,ol").attr("style", "margin:12px 0;padding-left:24px");
        document.select("li").attr("style", "margin:0 0 8px;line-height:1.75");
        document.select("pre").attr("style", "white-space:pre-wrap;overflow-wrap:anywhere;background-color:#f3f4f6;color:#111827;padding:12px");
        document.select("code").attr("style", "font-family:monospace");
        document.select("blockquote").attr("style", "margin:12px 0;padding-left:16px;border-left:3px solid #d1d5db");
        document.select("hr").attr("style", "margin:16px 0;border:0;border-top:1px solid #d1d5db");
        document.select("img").attr("style", "display:block;max-width:100%;height:auto");
        document.select("a").attr("style", "color:#2563eb;text-decoration:underline;word-break:break-word");
        return document;
    }

    /**
     * 给安全正文添加邮件布局；预览和发送必须使用同一份结果。
     * @param bodyHtml 已完成安全清理与图片处理的正文
     * @return 含完整文档和内联样式的邮件 HTML
     */
    public static String render(String bodyHtml) {
        return "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"></head>"
                + "<body style=\"margin:0;padding:20px;background-color:#ffffff;color:#111827;font:14px/1.75 Arial,sans-serif\">"
                + "<div style=\"width:100%;max-width:720px;margin:0 auto;font-family:Arial,sans-serif;font-size:14px;line-height:1.75;overflow-wrap:anywhere\">"
                + bodyHtml + "</div></body></html>";
    }
}
