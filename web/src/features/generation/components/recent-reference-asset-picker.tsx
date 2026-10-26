"use client";

import { useTranslation } from "@/features/locale/use-translation";
import type { RecentReferenceAsset } from "@/features/generation/lib/recent-reference-assets";
import { Check, Play } from "lucide-react";

type RecentReferenceAssetPickerProps = {
    assets: RecentReferenceAsset[];
    selectedUrls: string[];
    disabled?: boolean;
    onSelect: (asset: RecentReferenceAsset) => void;
};

export function RecentReferenceAssetPicker({ assets, selectedUrls, disabled = false, onSelect }: RecentReferenceAssetPickerProps) {
    const translate = useTranslation();
    const selectedUrlSet = new Set(selectedUrls);
    return (
        <div className="w-[300px] p-2">
            <div className="mb-2 px-1 text-xs font-medium text-[var(--studio-muted)]">{translate("generation.recentUploads")}</div>
            {assets.length ? (
                <div className="grid grid-cols-5 gap-2">
                    {assets.map((asset) => {
                        const selected = selectedUrlSet.has(asset.url);
                        const isVideo = asset.kind === "video";
                        const actionLabel = selected ? translate(isVideo ? "generation.addedAsReferenceVideo" : "generation.addedAsReference") : translate(isVideo ? "generation.addReferenceVideo" : "generation.addReferenceImage");
                        return (
                            <button
                                key={asset.url}
                                type="button"
                                className="relative aspect-square overflow-hidden rounded-md border border-[var(--studio-line)] bg-[var(--studio-surface)] transition hover:border-[var(--studio-action)] disabled:cursor-not-allowed disabled:opacity-50"
                                disabled={disabled || selected}
                                title={actionLabel}
                                aria-label={actionLabel}
                                onClick={() => onSelect(asset)}
                            >
                                {isVideo ? (
                                    <>
                                        {/* 加 #t=0.1 让浏览器直接取首帧当封面，否则只加载元数据时是黑块。 */}
                                        <video src={asset.url.includes("#") ? asset.url : `${asset.url}#t=0.1`} className="size-full object-cover" muted playsInline preload="metadata" />
                                        <span className="pointer-events-none absolute bottom-1 left-1 grid size-4 place-items-center rounded-full bg-black/55 text-white">
                                            <Play className="size-2.5" fill="currentColor" />
                                        </span>
                                    </>
                                ) : (
                                    <img src={asset.url} alt={translate("generation.recentReferenceAssets")} className="size-full object-cover" loading="lazy" />
                                )}
                                {selected ? (
                                    <span className="absolute inset-0 grid place-items-center bg-black/45 text-white">
                                        <Check className="size-4" strokeWidth={2.5} />
                                    </span>
                                ) : null}
                            </button>
                        );
                    })}
                </div>
            ) : (
                <div className="grid h-24 place-items-center text-xs text-[var(--studio-muted)]">{translate("generation.noRecentReferenceAssets")}</div>
            )}
        </div>
    );
}
