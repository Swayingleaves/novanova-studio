import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocsShell } from "@/features/docs/docs-shell";
import { getDocPage, isLocale, locales } from "@/features/docs/docs";

export function generateStaticParams() { return locales.map((locale) => ({ locale })); }

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
    const { locale } = await params;
    if (!isLocale(locale)) return {};
    const page = getDocPage(locale, []);
    return pageMetadata(page, locale, []);
}

export default async function DocsLocalePage({ params }: { params: Promise<{ locale: string }> }) {
    const { locale } = await params;
    if (!isLocale(locale)) notFound();
    const page = getDocPage(locale, []);
    if (!page) notFound();
    return <DocsShell page={page} />;
}

function pageMetadata(page: ReturnType<typeof getDocPage>, locale: string, slug: string[]): Metadata {
    if (!page) return {};
    const url = `/docs/${locale}${slug.length ? `/${slug.join("/")}` : ""}`;
    const path = slug.length ? `/${slug.join("/")}` : "";
    return {
        title: page.title,
        description: page.description,
        alternates: {
            canonical: url,
            languages: { "zh-CN": `/docs/zh-cn${path}`, en: `/docs/en${path}` },
        },
    };
}
