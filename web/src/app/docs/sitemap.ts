import type { MetadataRoute } from "next";
import { getAllDocPages, toDocHref, locales } from "@/features/docs/docs";

export default function sitemap(): MetadataRoute.Sitemap {
    return locales.flatMap((locale) => getAllDocPages(locale).map((page) => ({ url: toDocHref(locale, page.slug), changeFrequency: "monthly" as const, priority: page.slug.length ? 0.7 : 1 })));
}
