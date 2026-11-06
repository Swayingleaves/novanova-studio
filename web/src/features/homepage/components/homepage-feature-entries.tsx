"use client";

import { navigationTools } from "@/shared/constants/navigation-tools";
import Link from "@/shared/lib/team-navigation";
import { useTranslation } from "@/features/locale/use-translation";

const featureEntries = [
    { slug: "image", labelKey: "page.imageCreation", image: "/homepage/feature-image.jpg" },
    { slug: "video", labelKey: "page.videoCreation", image: "/homepage/feature-video.jpg" },
    { slug: "canvas", labelKey: "common.infiniteCanvas", image: "/homepage/feature-canvas.jpg" },
    { slug: "script", labelKey: "common.scriptCreation", image: "/homepage/feature-script.jpg" },
    { slug: "comic-drama", labelKey: "common.comicDramaCreation", image: "/homepage/feature-comic.jpg" },
] as const;

export function HomepageFeatureEntries() {
    const translate = useTranslation();
    return (
        <section className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" aria-label={translate("page.featureEntries")}>
            {featureEntries.map((entry) => {
                const tool = navigationTools.find((item) => item.slug === entry.slug);
                return (
                    <Link key={entry.slug} href={`/${entry.slug}`} className="group relative block aspect-[16/10] overflow-hidden rounded-xl bg-[var(--studio-media)]">
                        <img src={entry.image} alt="" className={`absolute inset-0 size-full object-cover transition duration-500 group-hover:scale-[1.04] motion-reduce:transition-none ${entry.slug === "comic-drama" ? "object-top" : ""}`} />
                        <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/80 via-black/35 to-transparent px-3 pb-2.5 pt-8">
                            <span className="truncate text-sm font-medium text-white">{translate(entry.labelKey)}</span>
                            {tool?.isNew ? <span className="shrink-0 text-[10px] font-bold tracking-wide text-[var(--studio-new)]">NEW</span> : null}
                        </span>
                    </Link>
                );
            })}
        </section>
    );
}
