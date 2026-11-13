"use client";

import { useState } from "react";

import { HomepageCanvasStarter } from "@/features/homepage/components/homepage-canvas-starter";
import { HomepageFeatureEntries } from "@/features/homepage/components/homepage-feature-entries";
import { HomepageGenerationComposer } from "@/features/homepage/components/homepage-generation-composer";
import type { HomepageCreationTarget } from "@/features/homepage/lib/homepage-navigation";
import { useTranslation } from "@/features/locale/use-translation";
import { FantasticShow } from "@/features/shared-work/components/fantastic-show";
import { useSpaceBrand } from "@/features/team/use-space-brand";

const icpRecordNumber = process.env.NEXT_PUBLIC_ICP_RECORD_NUMBER?.trim();
const nanaFont = { fontFamily: '"Nana Fredoka", "Novanova Bricolage", sans-serif' } as const;

function renderGreeting(text: string) {
    const start = text.toLowerCase().indexOf("nana");
    if (start < 0) return text;
    return (
        <>
            {text.slice(0, start)}
            <span style={nanaFont} className="inline-block px-[0.04em] align-baseline text-[1.12em] leading-none font-medium">
                {text.slice(start, start + 4)}
            </span>
            {text.slice(start + 4)}
        </>
    );
}

export default function IndexPage() {
    const translate = useTranslation();
    const [prompt, setPrompt] = useState("");
    const [entry, setEntry] = useState<"generate" | "canvas">("generate");
    const [creationTarget, setCreationTarget] = useState<Exclude<HomepageCreationTarget, "canvas">>("image");
    const brand = useSpaceBrand();
    const teamIntroduction = brand.isTeam ? brand.introduction.trim() : "";

    return (
        <main className="studio-page h-full overflow-y-auto">
            <div className="mx-auto w-full max-w-[1480px] px-4 pb-10 pt-16 md:px-8">
                <div className="mx-auto w-full max-w-[860px]">
                    <h1 className="flex flex-wrap items-center justify-center gap-3 text-center text-[clamp(28px,3vw,40px)] font-medium tracking-tight text-[var(--studio-ink)]">
                        <img src={brand.logoUrl} alt="" aria-hidden="true" className="size-10 shrink-0 object-contain sm:size-12" />
                        <span>{renderGreeting(translate("page.greeting"))}</span>
                    </h1>
                    {teamIntroduction ? <p className="mx-auto mt-3 max-w-xl wrap-anywhere whitespace-pre-wrap text-center text-sm leading-6 text-[var(--studio-muted)]">{teamIntroduction}</p> : null}
                    <div className="mt-5 flex justify-center" role="group" aria-label={translate("page.creationEntry")}>
                        <div className="relative grid grid-cols-2 rounded-full bg-[var(--studio-surface)] p-1">
                            {/* 选中底块单独一层，切换时横向滑过去；按钮本身只做文字颜色过渡。 */}
                            <span
                                aria-hidden="true"
                                className={`pointer-events-none absolute inset-y-1 left-1 w-[calc(50%_-_0.25rem)] rounded-full bg-[var(--studio-action)] transition-transform duration-300 ease-out motion-reduce:transition-none ${entry === "canvas" ? "translate-x-full" : ""}`}
                            />
                            {(["generate", "canvas"] as const).map((value) => (
                                <button
                                    key={value}
                                    type="button"
                                    aria-pressed={entry === value}
                                    className={`relative z-10 rounded-full px-5 py-1.5 text-sm transition-colors duration-300 motion-reduce:transition-none ${entry === value ? "font-medium text-[var(--studio-action-foreground)]!" : "text-[var(--studio-muted)] hover:text-[var(--studio-action)]"}`}
                                    onClick={() => setEntry(value)}
                                >
                                    {translate(value === "generate" ? "page.generate" : "page.canvas")}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="homepage-entry-swap" data-entry={entry}>
                    {entry === "canvas" ? <HomepageCanvasStarter /> : (
                        <div className="mx-auto mt-6 w-full max-w-5xl">
                            <HomepageGenerationComposer prompt={prompt} onPromptChange={setPrompt} target={creationTarget} onTargetChange={setCreationTarget} />
                        </div>
                    )}
                </div>

                <HomepageFeatureEntries />
                <FantasticShow />

                <footer className="mt-10 flex flex-col gap-2 border-t border-[var(--studio-line)] pt-4 text-[10px] text-[var(--studio-faint)] sm:flex-row sm:items-center sm:justify-between">
                    <span className={brand.isTeam ? "wrap-anywhere" : undefined}>{brand.name}</span>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        {icpRecordNumber ? (
                            <a href="https://beian.miit.gov.cn/" target="_blank" rel="noreferrer" className="transition hover:text-[var(--studio-muted)]">
                                {icpRecordNumber}
                            </a>
                        ) : null}
                        <span>© 2026 All rights reserved</span>
                    </div>
                </footer>
            </div>
        </main>
    );
}

