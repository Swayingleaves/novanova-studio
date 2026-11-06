"use client";

import { Plus } from "lucide-react";

import { openHomepageCanvasStarter } from "@/features/homepage/lib/homepage-navigation";
import { useTranslation } from "@/features/locale/use-translation";

const templates = [
    { starter: "video", labelKey: "page.videoCanvasTemplate", image: "/homepage/canvas-template-video.jpg" },
    { starter: "image", labelKey: "page.imageCanvasTemplate", image: "/homepage/canvas-template-image.jpg" },
] as const;

export function HomepageCanvasStarter() {
    const translate = useTranslation();
    return (
        <div className="mx-auto mt-8 grid w-full max-w-5xl grid-cols-1 gap-4 sm:grid-cols-[minmax(0,0.86fr)_minmax(0,1.07fr)_minmax(0,1.07fr)]" role="group" aria-label={translate("page.canvasStarter")}>
            <button
                type="button"
                className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-2xl border border-[var(--studio-line)] bg-[var(--studio-surface)] text-[var(--studio-ink)] transition hover:border-[var(--studio-action)]"
                style={{ backgroundImage: "radial-gradient(circle, var(--studio-line-strong) 1px, transparent 1px)", backgroundSize: "16px 16px" }}
                onClick={() => openHomepageCanvasStarter("blank")}
            >
                <span className="grid size-11 place-items-center rounded-xl bg-[var(--studio-surface-raised)] shadow-[var(--studio-shadow)]">
                    <Plus className="size-5" strokeWidth={1.8} aria-hidden="true" />
                </span>
                <span className="text-sm">{translate("page.newCanvas")}</span>
            </button>
            {templates.map((template) => (
                <button
                    key={template.starter}
                    type="button"
                    className="group relative min-h-48 overflow-hidden rounded-2xl p-4 text-left text-white"
                    onClick={() => openHomepageCanvasStarter(template.starter)}
                >
                    <img src={template.image} alt="" className="absolute inset-0 size-full object-cover transition duration-300 group-hover:scale-[1.03]" />
                    <span className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/10 to-black/30" />
                    <span className="relative z-10 inline-flex rounded-md bg-black/40 px-2 py-0.5 text-xs backdrop-blur-sm">{translate("page.canvasTemplate")}</span>
                    <span className="absolute bottom-4 left-4 z-10 text-base font-medium">{translate(template.labelKey)}</span>
                </button>
            ))}
        </div>
    );
}
