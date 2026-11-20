"use client";

import { useTranslation } from "@/features/locale/use-translation";

export const dramaAspectRatios = ["9:16", "16:9", "1:1", "3:4", "4:3", "21:9"] as const;

export function dramaAspectRatio(value: string | undefined) {
    return (dramaAspectRatios as readonly string[]).includes(value || "") ? value || "9:16" : "9:16";
}

export function DramaAspectPicker({ value, disabled, onChange }: { value: string; disabled?: boolean; onChange: (value: string) => void }) {
    const translate = useTranslation();
    const selected = dramaAspectRatio(value);
    return (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={translate("drama.aspectRatio")}>
            {dramaAspectRatios.map((ratio) => {
                const active = selected === ratio;
                return (
                    <button
                        key={ratio}
                        type="button"
                        disabled={disabled}
                        aria-pressed={active}
                        style={active ? { background: "var(--studio-action)", borderColor: "var(--studio-action)", color: "var(--studio-action-foreground)" } : undefined}
                        className={`rounded-full border px-2.5 py-1 text-xs font-medium tabular-nums disabled:opacity-50 ${active ? "" : "border-[var(--studio-line-strong)] bg-[var(--studio-surface)] text-[var(--studio-ink)] hover:border-[var(--studio-action)] hover:bg-[var(--studio-primary-soft)]"}`}
                        onClick={() => onChange(ratio)}
                    >
                        {ratio}
                    </button>
                );
            })}
        </div>
    );
}
