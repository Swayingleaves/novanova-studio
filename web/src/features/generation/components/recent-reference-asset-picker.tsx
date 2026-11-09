"use client";

import { useTranslation } from "@/features/locale/use-translation";
import type { RecentReferenceAsset } from "@/features/generation/lib/recent-reference-assets";
import { useMediaUrl } from "@/shared/hooks/use-media-url";
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
                    {assets.map((asset) => (
                        <RecentReferenceAssetButton key={asset.storageKey || asset.url} asset={asset} selectedUrlSet={selectedUrlSet} disabled={disabled} onSelect={onSelect} />
                    ))}
                </div>
            ) : (
                <div className="grid h-24 place-items-center text-xs text-[var(--studio-muted)]">{translate("generation.noRecentReferenceAssets")}</div>
            )}
        </div>
    );
}

/** 单个「最近上传」：有存储标识时先换取当前临时地址，避免直接渲染已过期的签名地址。 */
function RecentReferenceAssetButton({ asset, selectedUrlSet, disabled, onSelect }: { asset: RecentReferenceAsset; selectedUrlSet: Set<string>; disabled: boolean; onSelect: (asset: RecentReferenceAsset) => void }) {
    const translate = useTranslation();
    const { url, onError } = useMediaUrl({ storageKey: asset.storageKey, url: asset.url, kind: asset.kind === "image" ? "image" : "media" });
    const selected = selectedUrlSet.has(url) || selectedUrlSet.has(asset.url);
    const isVideo = asset.kind === "video";
    const actionLabel = selected ? translate(isVideo ? "generation.addedAsReferenceVideo" : "generation.addedAsReference") : translate(isVideo ? "generation.addReferenceVideo" : "generation.addReferenceImage");
    return (
        <button
            type="button"
            className="relative aspect-square overflow-hidden rounded-md border border-[var(--studio-line)] bg-[var(--studio-surface)] transition hover:border-[var(--studio-action)] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={disabled || selected}
            title={actionLabel}
            aria-label={actionLabel}
            onClick={() => onSelect({ ...asset, url })}
        >
            {isVideo ? (
                <>
                    {/* 加 #t=0.1 让浏览器直接取首帧当封面，否则只加载元数据时是黑块。 */}
                    <video src={url.includes("#") ? url : `${url}#t=0.1`} className="size-full object-cover" muted playsInline preload="metadata" onError={onError} />
                    <span className="pointer-events-none absolute bottom-1 left-1 grid size-4 place-items-center rounded-full bg-black/55 text-white">
                        <Play className="size-2.5" fill="currentColor" />
                    </span>
                </>
            ) : (
                <img src={url} alt={translate("generation.recentReferenceAssets")} className="size-full object-cover" loading="lazy" onError={onError} />
            )}
            {selected ? (
                <span className="absolute inset-0 grid place-items-center bg-black/45 text-white">
                    <Check className="size-4" strokeWidth={2.5} />
                </span>
            ) : null}
        </button>
    );
}
