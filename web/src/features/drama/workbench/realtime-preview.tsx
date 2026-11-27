"use client";

import { Button } from "antd";
import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "@/features/locale/use-translation";
import type { DramaMedia } from "@/services/api/drama";
import { formatShotNumber, formatTimecode, shotDisplayTitle, type TimedDramaShot } from "../lib/shot-utils";
import { SafeThumbImage } from "./safe-thumb";

/** 中栏「实时预览」视图：按顺序连播各镜视频或首帧，并与选中镜头联动。 */
export function DramaRealtimePreview({
    shots,
    totalSeconds,
    selectedShotRef,
    onSelectShot,
    mediaByKey,
}: {
    shots: TimedDramaShot[];
    totalSeconds: number;
    selectedShotRef: string;
    onSelectShot: (ref: string) => void;
    mediaByKey: Record<string, DramaMedia | undefined>;
}) {
    const translate = useTranslation();
    const [playing, setPlaying] = useState(false);
    const videoRef = useRef<HTMLVideoElement | null>(null);

    const currentIndex = Math.max(0, shots.findIndex((item) => item.ref === selectedShotRef));
    const current = shots[currentIndex] || shots[0];
    const videoMedia = current ? mediaByKey[`shot-video:${current.ref}`] : undefined;
    const firstMedia = current ? mediaByKey[`shot-first:${current.ref}`] : undefined;
    const hasVideo = videoMedia?.status === "success" && Boolean(videoMedia.url);
    const hasImage = firstMedia?.status === "success" && Boolean(firstMedia.url);

    useEffect(() => {
        if (!playing || !current) return;
        if (hasVideo && videoRef.current) {
            void videoRef.current.play().catch(() => setPlaying(false));
            return;
        }
        const timer = window.setTimeout(() => {
            if (currentIndex + 1 < shots.length) {
                onSelectShot(shots[currentIndex + 1].ref);
            } else {
                setPlaying(false);
            }
        }, Math.max(1, current.durationSeconds) * 1000);
        return () => window.clearTimeout(timer);
    }, [current, currentIndex, hasVideo, onSelectShot, playing, shots]);

    useEffect(() => {
        if (!playing && videoRef.current && !videoRef.current.paused) {
            videoRef.current.pause();
        }
    }, [playing]);

    if (!current) {
        return (
            <div className="flex flex-1 items-center justify-center p-8 text-sm text-[var(--studio-muted)]">
                {translate("drama.noShotsYet")}
            </div>
        );
    }

    const goPrev = () => {
        if (currentIndex > 0) onSelectShot(shots[currentIndex - 1].ref);
    };
    const goNext = () => {
        if (currentIndex + 1 < shots.length) onSelectShot(shots[currentIndex + 1].ref);
    };

    return (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-between gap-4 overflow-y-auto p-6">
            <div className="relative flex w-full max-w-3xl flex-1 items-center justify-center overflow-hidden rounded-lg border border-[var(--studio-line)] bg-[var(--studio-page)]">
                {hasVideo ? (
                    <video
                        ref={videoRef}
                        key={videoMedia?.url}
                        src={videoMedia?.url}
                        playsInline
                        controls={false}
                        onEnded={() => {
                            if (playing && currentIndex + 1 < shots.length) onSelectShot(shots[currentIndex + 1].ref);
                            else setPlaying(false);
                        }}
                        className="max-h-[58dvh] w-full object-contain"
                    />
                ) : hasImage ? (
                    <SafeThumbImage src={firstMedia?.url} alt={shotDisplayTitle(current, current.index)} className="max-h-[58dvh] w-full object-contain" />
                ) : (
                    <div className="flex max-w-md flex-col items-center gap-2 px-6 py-16 text-center">
                        <span className="text-xs font-semibold tabular-nums text-[var(--studio-action)]">
                            {formatShotNumber(current.index)} · {current.ref}
                        </span>
                        <p className="text-sm font-medium text-[var(--studio-ink)]">{shotDisplayTitle(current, current.index)}</p>
                        <p className="text-xs leading-6 text-[var(--studio-muted)]">{current.picture}</p>
                        <p className="mt-2 text-[11px] text-[var(--studio-faint)]">{translate("drama.previewFallbackHint")}</p>
                    </div>
                )}

                {current.dialogue ? (
                    <div className="pointer-events-none absolute inset-x-6 bottom-4 flex justify-center">
                        <p className="max-w-xl rounded-md bg-black/70 px-3.5 py-1.5 text-center text-xs leading-5 text-white">
                            {current.dialogue}
                        </p>
                    </div>
                ) : null}
            </div>

            <div className="flex w-full max-w-3xl flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface)] px-4 py-2.5">
                <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-[var(--studio-ink)]">
                        {formatShotNumber(current.index)} {shotDisplayTitle(current, current.index)}
                    </p>
                    <p className="text-[11px] tabular-nums text-[var(--studio-muted)]">
                        {formatTimecode(current.startSec)} – {formatTimecode(current.endSec)} / {formatTimecode(totalSeconds)}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button size="small" icon={<SkipBack className="size-3.5" />} disabled={currentIndex <= 0} onClick={goPrev} aria-label={translate("drama.prevShot")} />
                    <Button
                        type="primary"
                        size="small"
                        icon={playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                        onClick={() => setPlaying((value) => !value)}
                    >
                        {translate(playing ? "drama.pausePreview" : "drama.playPreview")}
                    </Button>
                    <Button size="small" icon={<SkipForward className="size-3.5" />} disabled={currentIndex + 1 >= shots.length} onClick={goNext} aria-label={translate("drama.nextShot")} />
                </div>
            </div>
        </div>
    );
}
