"use client";

import Link from "next/link";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { DocsCopyButton } from "./docs-code";
import type { Locale } from "./docs";

export function DocsMarkdown({ locale, content, basePath = [] }: { locale: Locale; content: string; basePath?: string[] }) {
    return <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={createMarkdownComponents(locale, basePath)}>{content}</ReactMarkdown>;
}

function createMarkdownComponents(locale: Locale, basePath: string[]): Components {
    return {
        h1: ({ children }) => <h1 id={String(children).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")}>{children}</h1>,
        h2: ({ children }) => <h2 id={String(children).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")}>{children}</h2>,
        a: ({ href, children }) => <Link href={resolveMarkdownHref(locale, basePath, href)}>{children}</Link>,
        pre: ({ children }) => <div className="docs-code-block"><DocsCopyButton code={extractCode(children)} />{children}</div>,
        code: ({ className, children }) => <code className={className}>{children}</code>,
    };
}

function resolveMarkdownHref(locale: Locale, basePath: string[], href?: string): string {
    if (!href || (!href.startsWith("./") && !href.startsWith("../"))) return href || "#";
    const match = href.match(/^([^?#]*)(.*)$/);
    const pathname = match?.[1] || "";
    const suffix = match?.[2] || "";
    const segments = [...basePath];
    for (const segment of pathname.split("/")) {
        if (!segment || segment === ".") continue;
        if (segment === "..") segments.pop();
        else segments.push(segment);
    }
    return `/docs/${locale}/${segments.join("/")}${suffix}`;
}

function extractCode(children: React.ReactNode): string {
    if (typeof children === "string") return children.replace(/\n$/, "");
    if (Array.isArray(children)) return children.map((child) => extractCode(child)).join("");
    if (children && typeof children === "object" && "props" in children) return extractCode((children as { props?: { children?: React.ReactNode } }).props?.children);
    return "";
}
