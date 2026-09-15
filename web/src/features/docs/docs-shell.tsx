import Link from "next/link";
import { ArrowLeft, BookOpen, Languages } from "lucide-react";
import { GitHubLink } from "@/features/app-shell/components/github-link";
import { DocsSearch } from "./docs-search";
import { getAllDocPages, getDocGroups, getSearchEntries, toDocHref, translatedHref, type DocPage } from "./docs";
import { DocsMarkdown } from "./docs-markdown";
import { DocsMobileNav } from "./docs-mobile-nav";

export function DocsShell({ page }: { page: DocPage }) {
    const pages = getAllDocPages(page.locale);
    const groups = getDocGroups(page.locale);
    const index = pages.findIndex((item) => item.slug.join("/") === page.slug.join("/"));
    const previous = index > 0 ? pages[index - 1] : null;
    const next = index >= 0 && index < pages.length - 1 ? pages[index + 1] : null;
    return <div className="docs-shell"><a className="docs-skip-link" href="#main-content">{page.locale === "zh-cn" ? "跳到正文" : "Skip to content"}</a>
        <header className="docs-header"><Link href={toDocHref(page.locale, [])} className="docs-brand"><img src="/logo/novanovastudio.svg" alt="" aria-hidden="true" /><span>Novanova <strong>Docs</strong></span></Link><nav className="docs-header-actions"><DocsSearch entries={getSearchEntries(page.locale)} locale={page.locale} placeholder={page.locale === "zh-cn" ? "搜索文档" : "Search docs"} /><Link href={translatedHref(page.locale, page.slug)} className="docs-icon-button" hrefLang={page.locale === "zh-cn" ? "en" : "zh-CN"} aria-label={page.locale === "zh-cn" ? "English" : "中文"} title={page.locale === "zh-cn" ? "English" : "中文"}><Languages className="size-4" aria-hidden="true" /></Link><GitHubLink className="docs-icon-button size-10 rounded-lg" /><Link href="/" className="docs-header-button"><ArrowLeft className="size-4" aria-hidden="true" /><span className="hidden md:inline">{page.locale === "zh-cn" ? "返回工作台" : "Back to studio"}</span></Link></nav></header>
        <DocsMobileNav pages={pages} groups={groups} current={page.slug.join("/")} />
        <div className="docs-layout"><aside className="docs-sidebar"><div className="docs-sidebar-title"><BookOpen className="size-4" />{page.locale === "zh-cn" ? "使用指南" : "Guides"}</div><Link href={toDocHref(page.locale, [])} className={`docs-sidebar-link ${page.slug.length === 0 ? "docs-sidebar-link-active" : ""}`}>{page.locale === "zh-cn" ? "文档总览" : "Overview"}</Link>{groups.map((group) => <section key={group.key} className="docs-sidebar-group"><div className="docs-sidebar-group-title">{group.title}</div>{group.pages.map((item) => <Link key={item.slug.join("/")} href={toDocHref(page.locale, item.slug)} className={`docs-sidebar-link ${item.slug.join("/") === page.slug.join("/") ? "docs-sidebar-link-active" : ""}`}>{item.title}</Link>)}</section>)}</aside><main id="main-content" className="docs-main"><article className="docs-article"><div className="docs-breadcrumb"><Link href={toDocHref(page.locale, [])}>{page.locale === "zh-cn" ? "文档" : "Docs"}</Link><span>/</span><span>{page.title}</span></div><DocsMarkdown locale={page.locale} basePath={page.slug.slice(0, -1)} content={page.content} /><div className="docs-pager">{previous ? <Link href={toDocHref(page.locale, previous.slug)}><span>← {page.locale === "zh-cn" ? "上一篇" : "Previous"}</span><strong>{previous.title}</strong></Link> : <span />}{next ? <Link href={toDocHref(page.locale, next.slug)} className="text-right"><span>{page.locale === "zh-cn" ? "下一篇" : "Next"} →</span><strong>{next.title}</strong></Link> : <span />}</div></article><aside className="docs-toc"><div>{page.locale === "zh-cn" ? "本页目录" : "On this page"}</div>{page.content.split("\n").filter((line) => /^## /.test(line)).map((line) => { const title = line.slice(3); return <a key={title} href={`#${title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")}`}>{title}</a>; })}</aside></main></div>
    </div>;
}
