"use client";

import Link from "next/link";
import { Menu, X } from "lucide-react";
import { useState } from "react";
import type { DocGroup, DocPage } from "./docs";

export function DocsMobileNav({ pages, groups, current }: { pages: DocPage[]; groups: DocGroup[]; current: string }) {
    const [open, setOpen] = useState(false);
    const english = pages[0]?.locale === "en";
    const label = english ? "Documentation" : "文档目录";
    return <>
        <button type="button" className="docs-mobile-bar" aria-expanded={open} aria-controls="docs-mobile-menu" onClick={() => setOpen(true)}><Menu className="size-4" />{label}</button>
        {open ? <div className="docs-mobile-backdrop" role="presentation" onMouseDown={() => setOpen(false)}><aside id="docs-mobile-menu" className="docs-mobile-menu" role="dialog" aria-modal="true" aria-label={label} onMouseDown={(event) => event.stopPropagation()}><div className="flex items-center justify-between border-b border-[var(--studio-line)] pb-3"><strong>{label}</strong><button type="button" className="docs-icon-button" aria-label={english ? "Close menu" : "关闭目录"} onClick={() => setOpen(false)}><X className="size-4" /></button></div><Link href={`/docs/${pages[0]?.locale || "zh-cn"}`} className={`docs-sidebar-link ${current === "" ? "docs-sidebar-link-active" : ""}`} onClick={() => setOpen(false)}>{english ? "Overview" : "文档总览"}</Link>{groups.map((group) => <section key={group.key} className="docs-sidebar-group"><div className="docs-sidebar-group-title">{group.title}</div>{group.pages.map((page) => <Link key={page.slug.join("/")} href={`/docs/${page.locale}/${page.slug.join("/")}`} className={`docs-sidebar-link ${page.slug.join("/") === current ? "docs-sidebar-link-active" : ""}`} onClick={() => setOpen(false)}>{page.title}</Link>)}</section>)}</aside></div> : null}
    </>;
}
