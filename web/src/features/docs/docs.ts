import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";

export const locales = ["zh-cn", "en"] as const;
export type Locale = (typeof locales)[number];

export type DocPage = {
    locale: Locale;
    slug: string[];
    title: string;
    description: string;
    content: string;
};

export type SearchEntry = Pick<DocPage, "locale" | "slug" | "title" | "description"> & { text: string };

export type DocGroup = {
    key: string;
    title: string;
    pages: DocPage[];
};

const groupDefinitions = [
    { key: "getting-started", titles: { "zh-cn": "快速开始", en: "Getting started" }, order: ["project-introduction", "docker-start", "local-development"] },
    { key: "using-studio", titles: { "zh-cn": "使用本项目", en: "Using Novanova Studio" }, order: ["workspace", "image-generation", "video-generation", "canvas", "assets", "prompt-library", "admin", "system-configuration", "theme", "announcements", "profile"] },
    { key: "troubleshooting", titles: { "zh-cn": "问题与解决", en: "Troubleshooting" }, order: ["faq"] },
] as const;

const docsRoot = path.resolve(process.cwd(), "../docs");

export function isLocale(value: string): value is Locale {
    return locales.includes(value as Locale);
}

export function localeFromAcceptLanguage(header: string | null | undefined): Locale {
    const languages = (header || "").toLowerCase().split(",").map((part) => ({ tag: part.split(";")[0].trim(), weight: Number(part.match(/q=([0-9.]+)/)?.[1] || 1) })).filter((item) => item.tag);
    languages.sort((left, right) => right.weight - left.weight);
    for (const language of languages) {
        if (language.weight <= 0) continue;
        if (language.tag === "zh" || language.tag.startsWith("zh-")) return "zh-cn";
        if (language.tag === "en" || language.tag.startsWith("en-")) return "en";
    }
    return "zh-cn";
}

export function getAllDocPages(locale: Locale): DocPage[] {
    return collectMarkdownFiles(path.join(docsRoot, locale)).map((filePath) => readDocPage(locale, filePath)).sort(compareDocPages);
}

export function getDocGroups(locale: Locale): DocGroup[] {
    const pages = getAllDocPages(locale).filter((page) => page.slug.length > 0);
    return groupDefinitions.map((definition) => ({ key: definition.key, title: definition.titles[locale], pages: pages.filter((page) => page.slug[0] === definition.key).sort((left, right) => (definition.order as readonly string[]).indexOf(left.slug[1] || "") - (definition.order as readonly string[]).indexOf(right.slug[1] || "")) })).filter((group) => group.pages.length > 0);
}

export function getDocPage(locale: Locale, slug: string[]): DocPage | null {
    const relative = slug.length ? `${slug.join("/")}.mdx` : "index.mdx";
    const filePath = path.join(docsRoot, locale, relative);
    if (!filePath.startsWith(path.join(docsRoot, locale)) || !fs.existsSync(filePath)) return null;
    return readDocPage(locale, filePath);
}

export function getSearchEntries(locale: Locale): SearchEntry[] {
    return getAllDocPages(locale).map((page) => ({ ...page, text: page.content.replace(/[#*_>`\[\]()]/g, " ").replace(/\s+/g, " ").trim() }));
}

export function toDocHref(locale: Locale, slug: string[]): string {
    return `/docs/${locale}${slug.length ? `/${slug.join("/")}` : ""}`;
}

export function translatedHref(locale: Locale, slug: string[]): string {
    return toDocHref(locale === "zh-cn" ? "en" : "zh-cn", slug);
}

function collectMarkdownFiles(directory: string): string[] {
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) return collectMarkdownFiles(fullPath);
        return entry.name.endsWith(".mdx") || entry.name.endsWith(".md") ? [fullPath] : [];
    });
}

function readDocPage(locale: Locale, filePath: string): DocPage {
    const source = fs.readFileSync(filePath, "utf8");
    const { data, content } = parseFrontmatter(source);
    const relative = path.relative(path.join(docsRoot, locale), filePath).replace(/\\/g, "/").replace(/\.(mdx|md)$/, "");
    const slug = relative === "index" ? [] : relative.split("/");
    return { locale, slug, title: String(data.title || slug.at(-1) || "Novanova Studio"), description: String(data.description || ""), content };
}

function parseFrontmatter(source: string): { data: Record<string, unknown>; content: string } {
    if (!source.startsWith("---")) return { data: {}, content: source };
    const end = source.indexOf("\n---", 3);
    if (end < 0) return { data: {}, content: source };
    return { data: (parse(source.slice(3, end)) || {}) as Record<string, unknown>, content: source.slice(end + 4).trimStart() };
}

function compareDocPages(left: DocPage, right: DocPage): number {
    if (!left.slug.length || !right.slug.length) return left.slug.length - right.slug.length;
    const leftGroup = groupDefinitions.findIndex((definition) => definition.key === left.slug[0]);
    const rightGroup = groupDefinitions.findIndex((definition) => definition.key === right.slug[0]);
    if (leftGroup !== rightGroup) return leftGroup - rightGroup;
    const definition = groupDefinitions[leftGroup];
    const leftOrder = definition ? (definition.order as readonly string[]).indexOf(left.slug[1] || "") : -1;
    const rightOrder = definition ? (definition.order as readonly string[]).indexOf(right.slug[1] || "") : -1;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return left.slug.join("/").localeCompare(right.slug.join("/"));
}
