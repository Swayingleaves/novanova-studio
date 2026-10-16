
"use client";

import { useTranslation } from "@/features/locale/use-translation";
import { Check } from "lucide-react";

type RecentReferenceImagePickerProps = {
    urls: string[];
    selectedUrls: string[];
    disabled?: boolean;
    onSelect: (url: string) => void;
};

export function RecentReferenceImagePicker({ urls, selectedUrls, disabled = false, onSelect }: RecentReferenceImagePickerProps) {
    const translate = useTranslation();
    const selectedUrlSet = new Set(selectedUrls);
    return (
        <div className="w-[300px] p-2">
            <div className="mb-2 px-1 text-xs font-medium text-[var(--studio-muted)]">{translate("generation.recentUploads")}</div>
            {urls.length ? (
                <div className="grid grid-cols-5 gap-2">
                    {urls.map((url) => {
                        const selected = selectedUrlSet.has(url);
                        return (
                            <button
                                key={url}
                                type="button"
                                className="relative aspect-square overflow-hidden rounded-md border border-[var(--studio-line)] bg-[var(--studio-surface)] transition hover:border-[var(--studio-action)] disabled:cursor-not-allowed disabled:opacity-50"
                                disabled={disabled || selected}
                                title={selected ? translate("generation.addedAsReference") : translate("generation.addReferenceImage")}
                                aria-label={selected ? translate("generation.addedAsReference") : translate("generation.addReferenceImage")}
                                onClick={() => onSelect(url)}
                            >
                                <img src={url} alt={translate("generation.recentReferenceImages")} className="size-full object-cover" loading="lazy" />
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
                <div className="grid h-24 place-items-center text-xs text-[var(--studio-muted)]">{translate("generation.noRecentReferenceImages")}</div>
            )}
        </div>
    );
}
