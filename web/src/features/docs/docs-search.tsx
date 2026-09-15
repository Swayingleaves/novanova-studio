"use client";

import Link from "next/link";
import { Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { Locale, SearchEntry } from "./docs";

export function DocsSearch({ entries, locale, placeholder }: { entries: SearchEntry[]; locale: Locale; placeholder: string }) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const english = locale === "en";
    const labels = english
        ? { empty: "Search titles, descriptions, and page content", noResults: "No matching documents", resultCount: (count: number) => `${count} matching documents` }
        : { empty: "搜索标题、说明和正文内容", noResults: "未找到匹配文档", resultCount: (count: number) => `找到 ${count} 篇相关文档` };
    const results = useMemo(() => {
        const normalized = query.trim().toLocaleLowerCase();
        if (!normalized) return [];
        return entries.filter((entry) => `${entry.title} ${entry.description} ${entry.text}`.toLocaleLowerCase().includes(normalized)).slice(0, 8);
    }, [entries, query]);

    const close = () => {
        setOpen(false);
        setQuery("");
    };

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setOpen(true); } if (event.key === "Escape") close(); };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, []);

    return <>
        <button type="button" className="docs-header-button" onClick={() => setOpen(true)} aria-label={placeholder}><Search className="size-4" aria-hidden="true" /><span className="hidden sm:inline">{placeholder}</span><kbd className="hidden rounded border border-[var(--studio-line)] px-1.5 py-0.5 text-[10px] text-[var(--studio-faint)] sm:inline">Ctrl K</kbd></button>
        {/* 弹层必须 portal 到 body：header 有 backdrop-filter，会让 position: fixed 的包含块变成 header（仅 64px 高），弹层会被压成 0 高而不可见 */}
        {open ? createPortal(<div className="docs-search-backdrop" role="presentation" onMouseDown={close}><div className="docs-search-dialog" role="dialog" aria-modal="true" aria-label={placeholder} onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-center gap-3 border-b border-[var(--studio-line)] px-4"><Search className="size-5 shrink-0 text-[var(--studio-muted)]" aria-hidden="true" /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={placeholder} className="h-14 min-w-0 flex-1 bg-transparent text-base text-[var(--studio-ink)] outline-none placeholder:text-[var(--studio-faint)]" aria-label={placeholder} /><button type="button" className="docs-icon-button" aria-label={english ? "Close search" : "关闭搜索"} onClick={close}><X className="size-4" aria-hidden="true" /></button></div>
            <div className="docs-search-results" aria-live="polite">{!query ? <p className="docs-search-empty">{labels.empty}</p> : !results.length ? <p className="docs-search-empty">{labels.noResults}</p> : <><div className="docs-search-count">{labels.resultCount(results.length)}</div>{results.map((entry) => <Link key={entry.slug.join("/") || "index"} href={`/docs/${entry.locale}${entry.slug.length ? `/${entry.slug.join("/")}` : ""}`} className="docs-search-result" onClick={close}><div className="docs-search-result-title">{entry.title}</div><div className="docs-search-result-description">{entry.description}</div><div className="docs-search-result-snippet">{getSnippet(entry, query)}</div></Link>)}</>}</div>
        </div></div>, document.body) : null}
    </>;
}

function getSnippet(entry: SearchEntry, query: string): string {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const text = entry.text || entry.description || entry.title;
    const matchIndex = text.toLocaleLowerCase().indexOf(normalizedQuery);
    const start = Math.max(0, matchIndex < 0 ? 0 : matchIndex - 36);
    const snippet = text.slice(start, start + 120).trim();
    return `${start > 0 ? "…" : ""}${snippet}${start + 120 < text.length ? "…" : ""}`;
}
