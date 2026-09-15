import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocsShell } from "@/features/docs/docs-shell";
import { getAllDocPages, getDocPage, isLocale, locales } from "@/features/docs/docs";

export function generateStaticParams() { return locales.flatMap((locale) => getAllDocPages(locale).filter((page) => page.slug.length).map((page) => ({ locale, slug: page.slug }))); }

export async function generateMetadata({ params }: { params: Promise<{ locale: string; slug: string[] }> }): Promise<Metadata> {
    const { locale, slug } = await params;
    const page = isLocale(locale) ? getDocPage(locale, slug) : null;
    if (!page) return {};
    const path = `/docs/${locale}/${slug.join("/")}`;
    return { title: page.title, description: page.description, alternates: { canonical: path, languages: { "zh-CN": `/docs/zh-cn/${slug.join("/")}`, en: `/docs/en/${slug.join("/")}` } } };
}

export default async function DocsPage({ params }: { params: Promise<{ locale: string; slug: string[] }> }) {
    const { locale, slug } = await params;
    if (!isLocale(locale)) notFound();
    const page = getDocPage(locale, slug);
    if (!page) notFound();
    return <DocsShell page={page} />;
}
