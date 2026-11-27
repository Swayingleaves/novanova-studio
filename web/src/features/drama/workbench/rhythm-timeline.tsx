"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "@/features/locale/use-translation";
import type { DramaMedia } from "@/services/api/drama";
import { formatShotNumber, resolveShotThumbnail, shotDisplayTitle, type TimedDramaShot } from "../lib/shot-utils";
import { SafeThumbImage } from "./safe-thumb";

/** 格式化为 MM:SS（例如 00:00、01:25、08:20）。 */
function formatMinutesSeconds(seconds: number): string {
    const safe = Math.max(0, Math.round(seconds));
    const minutes = Math.floor(safe / 60);
    const remain = safe % 60;
    return `${String(minutes).padStart(2, "0")}:${String(remain).padStart(2, "0")}`;
}

/** 底部通栏「分镜节奏」时间轴：连续时间刻度标尺 + 带缩略图的镜头块轨道 + 可折叠收起。 */
export function DramaRhythmTimeline({
    shots,
    totalSeconds,
    selectedShotRef,
    onSelectShot,
    hasAnyVisual,
    mediaByKey,
}: {
    shots: TimedDramaShot[];
    totalSeconds: number;
    selectedShotRef: string;
    onSelectShot: (ref: string) => void;
    hasAnyVisual: boolean;
    mediaByKey: Record<string, DramaMedia | undefined>;
}) {
    const translate = useTranslation();
    const [collapsed, setCollapsed] = useState(false);

    return (
        <footer className="flex shrink-0 flex-col border-t border-[var(--studio-line)] bg-[var(--studio-rail)] px-4 py-2.5">
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                    <span className="text-xs font-semibold text-[var(--studio-ink)]">
                        {translate("drama.rhythmTimelineTitle")}
                    </span>
                    <span className="text-xs tabular-nums text-[var(--studio-muted)]">
                        总时长 {formatMinutesSeconds(totalSeconds)}
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    <span className="hidden text-[11px] text-[var(--studio-faint)] sm:inline">
                        {translate(hasAnyVisual ? "drama.rhythmTimelineHint" : "drama.rhythmTimelinePreviewHint")}
                    </span>
                    {collapsed ? (
                        <button
                            type="button"
                            aria-label="展开分镜节奏"
                            onClick={() => setCollapsed(false)}
                            className="inline-flex size-6 items-center justify-center rounded-md border border-[var(--studio-line)] bg-[var(--studio-surface)] text-[var(--studio-muted)]! hover:border-[var(--studio-line-strong)] hover:text-[var(--studio-ink)]!"
                        >
                            <ChevronUp className="size-3.5" />
                        </button>
                    ) : null}
                </div>
            </div>

            {!collapsed ? (
                <div className="mt-2 overflow-x-auto pb-0.5">
                    {shots.length === 0 ? (
                        <div className="flex h-12 w-full items-center justify-center rounded-lg border border-dashed border-[var(--studio-line)] text-xs text-[var(--studio-faint)]">
                            {translate("drama.noShotsYet")}
                        </div>
                    ) : (
                        <div className="flex min-w-max flex-col">
                            {/* 时间刻度标尺行 */}
                            <div className="flex items-end">
                                {shots.map((shot) => {
                                    const active = selectedShotRef === shot.ref;
                                    const widthPx = Math.max(132, Math.min(220, shot.durationSeconds * 16));
                                    return (
                                        <div
                                            key={`tick-${shot.id || shot.ref}`}
                                            style={{ flexGrow: shot.durationSeconds, flexBasis: `${widthPx}px`, minWidth: `${widthPx}px` }}
                                            className="relative flex flex-col items-start pr-2"
                                        >
                                            <span
                                                className={`text-[11px] tabular-nums leading-none ${
                                                    active ? "font-semibold text-[var(--studio-ink)]" : "text-[var(--studio-faint)]"
                                                }`}
                                            >
                                                {formatMinutesSeconds(shot.startSec)}
                                            </span>
                                            <div className="relative mt-1.5 flex h-2 w-full items-end">
                                                <span
                                                    className={`h-1.5 w-px ${
                                                        active ? "bg-[var(--studio-action)]" : "bg-[var(--studio-line-strong)]"
                                                    }`}
                                                />
                                                <span
                                                    className={`h-px flex-1 ${
                                                        active ? "bg-[var(--studio-action)]" : "bg-[var(--studio-line)]"
                                                    }`}
                                                />
                                                {active ? (
                                                    <span
                                                        aria-hidden="true"
                                                        className="absolute -bottom-0.5 left-0 -translate-x-1/2 border-x-4 border-b-[5px] border-x-transparent border-b-[var(--studio-action)]"
                                                    />
                                                ) : null}
                                            </div>
                                        </div>
                                    );
                                })}
                                <div className="flex w-11 shrink-0 flex-col items-end">
                                    <span className="text-[11px] tabular-nums leading-none text-[var(--studio-faint)]">
                                        {formatMinutesSeconds(totalSeconds)}
                                    </span>
                                    <div className="mt-1.5 flex h-2 w-full items-end justify-end">
                                        <span className="h-px flex-1 bg-[var(--studio-line)]" />
                                        <span className="h-1.5 w-px bg-[var(--studio-line-strong)]" />
                                    </div>
                                </div>
                            </div>

                            {/* 镜头块轨道凹槽 */}
                            <div className="mt-1.5 flex items-center gap-1.5 rounded-xl border border-[var(--studio-line)] bg-[var(--studio-page)]/70 p-1.5">
                                {shots.map((shot) => {
                                    const active = selectedShotRef === shot.ref;
                                    const thumb = resolveShotThumbnail(shot.ref, mediaByKey);
                                    const widthPx = Math.max(126, Math.min(214, shot.durationSeconds * 16));
                                    return (
                                        <button
                                            key={shot.id || shot.ref}
                                            type="button"
                                            style={{
                                                flexGrow: shot.durationSeconds,
                                                flexBasis: `${widthPx}px`,
                                                minWidth: `${widthPx}px`,
                                                ...(active
                                                    ? {
                                                        background: "color-mix(in srgb, var(--studio-action) 16%, var(--studio-surface-raised))",
                                                        borderColor: "var(--studio-action)",
                                                    }
                                                    : undefined),
                                            }}
                                            onClick={() => onSelectShot(shot.ref)}
                                            className={`group flex h-10 items-center gap-2 overflow-hidden rounded-lg border px-1.5 text-left transition-colors ${
                                                active
                                                    ? "text-[var(--studio-ink)]!"
                                                    : "border-[var(--studio-line)] bg-[var(--studio-surface-raised)] text-[var(--studio-text)]! hover:border-[var(--studio-line-strong)] hover:bg-[var(--studio-surface-hover)] hover:text-[var(--studio-ink)]!"
                                            }`}
                                        >
                                            <span className="relative h-7 w-11 shrink-0 overflow-hidden rounded border border-[var(--studio-line)] bg-[var(--studio-page)]">
                                                {thumb.kind === "video" ? (
                                                    <video
                                                        src={thumb.url}
                                                        muted
                                                        playsInline
                                                        preload="metadata"
                                                        className="pointer-events-none size-full object-cover"
                                                    />
                                                ) : (
                                                    <SafeThumbImage src={thumb.kind === "image" ? thumb.url : undefined} fallbackLabel={shot.ref} />
                                                )}
                                            </span>
                                            <span className="flex min-w-0 flex-1 items-center gap-1.5 text-xs!">
                                                <span className={`shrink-0 tabular-nums ${active ? "font-semibold text-[var(--studio-ink)]!" : "text-[var(--studio-muted)]!"}`}>
                                                    {formatShotNumber(shot.index)}
                                                </span>
                                                <span className="truncate font-medium">{shotDisplayTitle(shot, shot.index)}</span>
                                            </span>
                                        </button>
                                    );
                                })}

                                <button
                                    type="button"
                                    aria-label="收起分镜节奏"
                                    onClick={() => setCollapsed(true)}
                                    className="inline-flex h-10 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-raised)] text-[var(--studio-muted)]! transition-colors hover:border-[var(--studio-line-strong)] hover:bg-[var(--studio-surface-hover)] hover:text-[var(--studio-ink)]!"
                                >
                                    <ChevronDown className="size-4" />
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            ) : null}
        </footer>
    );
}
