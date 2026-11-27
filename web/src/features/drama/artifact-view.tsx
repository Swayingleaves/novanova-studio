"use client";

import { Button, InputNumber } from "antd";
import { LoaderCircle, Play, Square } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "@/features/locale/use-translation";
import { ResultDetailDialog, type ResultDetail } from "@/features/generation/components/result-detail-dialog";
import { downloadMedia } from "@/features/storage/services/media-download";
import type { DramaMedia, DramaStage, DramaVersion } from "@/services/api/drama";
import { dramaStageMeta } from "./stage-meta";
import { DramaAspectPicker } from "./aspect-ratio";
import { RequeryFailedTaskButton } from "@/features/ai-task/requery-failed-task-button";

type Row = Record<string, unknown>;

function rows(value: unknown): Row[] {
    return Array.isArray(value) ? value.filter((item): item is Row => Boolean(item) && typeof item === "object") : [];
}

function text(value: unknown) {
    return typeof value === "string" ? value : value == null ? "" : String(value);
}

function Field({ label, value, content, plain = false, className = "" }: { label: string; value: string; content?: ReactNode; plain?: boolean; className?: string }) {
    if (!value) return null;
    return (
        <div className={`${plain ? "" : "rounded-xl border border-[var(--studio-line)] bg-[var(--studio-surface)] px-4 py-3"} ${className}`}>
            <p className="text-xs font-medium text-[var(--studio-faint)]">{label}</p>
            <div className={`whitespace-pre-wrap text-sm leading-6 ${plain ? "mt-1 text-[var(--studio-text)]" : "mt-1.5 text-[var(--studio-ink)]"}`}>{content ?? value}</div>
        </div>
    );
}

function ZoomableMedia({ kind, url, storageKey, className }: { kind: "image" | "video"; url: string; storageKey?: string; className: string }) {
    const [detail, setDetail] = useState<ResultDetail | null>(null);
    const fileName = kind === "video" ? "drama-video.mp4" : "drama-image.png";
    const key = storageKey || undefined;
    return (
        <>
            <button type="button" className="relative block w-full cursor-zoom-in border-0 bg-transparent p-0" onClick={() => setDetail({
                media: { kind, url, storageKey: key },
                onDownload: () => downloadMedia({ storageKey: key, url }, fileName),
            })}>
                {kind === "image" ? <img src={url} alt="" className={`block ${className}`} /> : <video className={`pointer-events-none block ${className}`} src={url} muted playsInline preload="metadata" />}
                {kind === "video" ? (
                    <span className="pointer-events-none absolute inset-0 grid place-items-center">
                        <span className="grid size-10 place-items-center rounded-full bg-black/55 text-white">
                            <Play className="size-4 fill-current" aria-hidden="true" />
                        </span>
                    </span>
                ) : null}
            </button>
            <ResultDetailDialog detail={detail} onClose={() => setDetail(null)} />
        </>
    );
}

function refsOf(value: unknown) {
    return rows(value).map((item) => text(item.ref)).filter(Boolean);
}

function EmptyStage() {
    const translate = useTranslation();
    return <div className="studio-empty px-6 py-12 text-center text-sm">{translate("drama.noVersion")}</div>;
}

function SkeletonBar({ className = "" }: { className?: string }) {
    return <div className={`studio-skeleton min-h-0! ${className}`} aria-hidden="true" />;
}

/** 各阶段 AI 生成时的骨架屏加载动画，布局与真实产物卡片保持一致。 */
function StageSkeleton({ stage }: { stage: DramaStage }) {
    const translate = useTranslation();
    const stageLabel = translate(dramaStageMeta[stage].label);
    return (
        <div className="flex flex-col gap-4" role="status" aria-live="polite" aria-label={`AI 正在生成${stageLabel}`}>
            <div className="flex items-center gap-2 text-xs font-medium text-[var(--studio-muted)]">
                <LoaderCircle className="size-3.5 animate-spin text-[var(--studio-action)]" aria-hidden="true" />
                <span>AI 正在生成{stageLabel}…</span>
            </div>
            {stage === "plan" ? (
                <div className="grid gap-3 md:grid-cols-2">
                    {[0, 1].map((index) => (
                        <div key={index} className="rounded-xl border border-[var(--studio-line)] bg-[var(--studio-surface)] px-4 py-3.5">
                            <SkeletonBar className="h-3 w-16 rounded" />
                            <SkeletonBar className="mt-2.5 h-4 w-3/4 rounded" />
                        </div>
                    ))}
                    {[0, 1].map((index) => (
                        <div key={index} className="rounded-xl border border-[var(--studio-line)] bg-[var(--studio-surface)] px-4 py-3.5 md:col-span-2">
                            <SkeletonBar className="h-3 w-20 rounded" />
                            <SkeletonBar className="mt-2.5 h-3.5 w-full rounded" />
                            <SkeletonBar className="mt-2 h-3.5 w-5/6 rounded" />
                            <SkeletonBar className="mt-2 h-3.5 w-2/3 rounded" />
                        </div>
                    ))}
                </div>
            ) : stage === "script" ? (
                <div className="flex flex-col gap-4">
                    <div className="rounded-xl border border-[var(--studio-line)] bg-[var(--studio-surface)] px-4 py-3.5">
                        <SkeletonBar className="h-3 w-16 rounded" />
                        <SkeletonBar className="mt-2.5 h-3.5 w-full rounded" />
                        <SkeletonBar className="mt-2 h-3.5 w-4/5 rounded" />
                    </div>
                    {[0, 1, 2].map((index) => (
                        <article key={index} className="rounded-xl border border-[var(--studio-line)] bg-[var(--studio-surface)] p-4">
                            <div className="flex items-center gap-3">
                                <SkeletonBar className="size-6 shrink-0 rounded-full!" />
                                <SkeletonBar className="h-4 w-48 rounded" />
                            </div>
                            <SkeletonBar className="mt-3.5 h-3.5 w-full rounded" />
                            <SkeletonBar className="mt-2 h-3.5 w-11/12 rounded" />
                            <div className="mt-3.5 flex flex-col gap-2">
                                <SkeletonBar className="h-9 w-full rounded-lg" />
                                <SkeletonBar className="h-9 w-5/6 rounded-lg" />
                            </div>
                        </article>
                    ))}
                </div>
            ) : stage === "cast" ? (
                <div className="flex flex-col gap-6">
                    <section className="flex flex-col gap-3">
                        <SkeletonBar className="h-4 w-20 rounded" />
                        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                            {[0, 1, 2, 3].map((index) => (
                                <article key={index} className="overflow-hidden rounded-xl border border-[var(--studio-line)] bg-[var(--studio-surface)]">
                                    <div className="studio-skeleton studio-skeleton-media aspect-[3/2] w-full" aria-hidden="true" />
                                    <div className="flex flex-col gap-2.5 p-4">
                                        <SkeletonBar className="h-4 w-24 rounded" />
                                        <SkeletonBar className="h-3 w-full rounded" />
                                        <SkeletonBar className="h-3 w-5/6 rounded" />
                                        <SkeletonBar className="h-3 w-2/3 rounded" />
                                    </div>
                                </article>
                            ))}
                        </div>
                    </section>
                    <section className="flex flex-col gap-3">
                        <SkeletonBar className="h-4 w-20 rounded" />
                        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                            {[0, 1].map((index) => (
                                <article key={index} className="overflow-hidden rounded-xl border border-[var(--studio-line)] bg-[var(--studio-surface)]">
                                    <div className="studio-skeleton studio-skeleton-media aspect-video w-full" aria-hidden="true" />
                                    <div className="flex flex-col gap-2.5 p-4">
                                        <SkeletonBar className="h-4 w-28 rounded" />
                                        <SkeletonBar className="h-3 w-full rounded" />
                                        <SkeletonBar className="h-3 w-3/4 rounded" />
                                    </div>
                                </article>
                            ))}
                        </div>
                    </section>
                </div>
            ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {[0, 1, 2].map((index) => (
                        <article key={index} className="flex flex-col overflow-hidden rounded-xl border border-[var(--studio-line)] bg-[var(--studio-surface)]">
                            <div className="flex items-center gap-2 border-b border-[var(--studio-line)] px-4 py-3">
                                <SkeletonBar className="size-6 shrink-0 rounded-full!" />
                                <SkeletonBar className="h-3.5 w-10 rounded" />
                                <SkeletonBar className="h-5 w-16 rounded-full!" />
                                <SkeletonBar className="ml-auto h-3.5 w-10 rounded" />
                            </div>
                            <div className="grid grid-cols-2 gap-2.5 p-3">
                                <div className="flex flex-col gap-1.5">
                                    <SkeletonBar className="h-3 w-10 rounded" />
                                    <div className="studio-skeleton aspect-video w-full rounded-xl" aria-hidden="true" />
                                </div>
                                <div className="flex flex-col gap-1.5">
                                    <SkeletonBar className="h-3 w-10 rounded" />
                                    <div className="studio-skeleton aspect-video w-full rounded-xl" aria-hidden="true" />
                                </div>
                            </div>
                            <div className="flex flex-col gap-2 px-4 pb-3">
                                <SkeletonBar className="h-3 w-12 rounded" />
                                <SkeletonBar className="h-3.5 w-full rounded" />
                                <SkeletonBar className="h-3.5 w-5/6 rounded" />
                                <SkeletonBar className="mt-1 h-3 w-16 rounded" />
                                <SkeletonBar className="h-3.5 w-full rounded" />
                                <SkeletonBar className="h-3.5 w-3/4 rounded" />
                            </div>
                            <div className="px-3 pb-3">
                                <div className="studio-skeleton aspect-video w-full rounded-xl" aria-hidden="true" />
                            </div>
                        </article>
                    ))}
                </div>
            )}
        </div>
    );
}

function MediaFrame({
    media,
    kind,
    targetKey,
    pending,
    aspect,
    bare = false,
    onGenerate,
    onStop,
    onRequeried,
    stoppingTaskId = "",
}: {
    media: DramaMedia | undefined;
    kind: "image" | "video";
    targetKey: string;
    pending: boolean;
    aspect: string;
    bare?: boolean;
    onGenerate?: (targetKey: string) => void;
    onStop?: (media: DramaMedia) => void;
    onRequeried?: () => void;
    stoppingTaskId?: string;
}) {
    const translate = useTranslation();
    const queued = media?.status === "pending" || media?.status === "running";
    const running = pending || queued;
    const ready = media?.status === "success" && Boolean(media.url);
    const failed = media?.status === "failed" || media?.status === "canceled";
    const canStop = queued && Boolean(media?.taskId) && Boolean(onStop);
    const stopping = Boolean(media?.taskId) && media?.taskId === stoppingTaskId;
    return (
        <div className={`relative ${bare ? "bg-[var(--studio-media)]" : "overflow-hidden rounded-xl border border-[var(--studio-line)] bg-[var(--studio-media)]"}`}>
            {ready && kind === "image" ? <ZoomableMedia kind="image" url={media?.url || ""} storageKey={media?.storageKey} className={`${aspect} w-full object-cover`} /> : null}
            {ready && kind === "video" ? <ZoomableMedia kind="video" url={media?.url || ""} storageKey={media?.storageKey} className={`${aspect} w-full bg-black object-cover`} /> : null}
            {queued && (media?.progress || 0) > 0 ? (
                <span className="pointer-events-none absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium tabular-nums text-white">{media?.progress}%</span>
            ) : null}
            {!ready && running ? (
                <div className={`${aspect} w-full`} role="status" aria-label={media?.status === "pending" ? translate("drama.mediaQueued") : translate("drama.mediaRunning")}>
                    <div className="studio-skeleton studio-skeleton-media h-full w-full" aria-hidden="true" />
                </div>
            ) : null}
            {!ready && !running ? (
                <div className={`${aspect} grid w-full place-items-center px-4 text-center text-xs leading-5 text-[var(--studio-muted)]`}>
                    {failed ? (media?.errorMessage || translate("drama.statusFailed")) : kind === "video" ? translate("drama.noVideoYet") : translate("drama.noImageYet")}
                    {media?.status === "failed" ? <div className="mt-2"><RequeryFailedTaskButton taskId={media.taskId} onRestarted={() => onRequeried?.()} /></div> : null}
                </div>
            ) : null}
            {onGenerate ? (
                <div className="flex justify-end border-t border-[var(--studio-line)] bg-[var(--studio-surface)] px-3 py-2">
                    {canStop ? (
                        <button
                            type="button"
                            disabled={stopping}
                            aria-label={translate("drama.stop")}
                            onClick={() => media && onStop?.(media)}
                            className="inline-flex h-6 items-center gap-1.5 rounded-full bg-[var(--studio-surface-hover)] px-2.5 text-xs font-medium text-[var(--studio-muted)] transition-colors hover:bg-[color-mix(in_srgb,var(--studio-danger)_14%,transparent)] hover:text-[var(--studio-danger)] disabled:cursor-progress disabled:opacity-60"
                        >
                            {stopping ? <LoaderCircle className="size-3 animate-spin" aria-hidden="true" /> : <Square className="size-2.5 fill-current" aria-hidden="true" />}
                            {translate("drama.stop")}
                        </button>
                    ) : (
                        <Button size="small" type={ready ? "default" : "primary"} loading={running} disabled={running} onClick={() => onGenerate(targetKey)}>
                            {targetKey.startsWith("shot-first:") ? translate("drama.generateFirstFrame") : targetKey.startsWith("shot-last:") ? translate("drama.generateLastFrame") : kind === "video" ? translate("drama.generateVideo") : translate("drama.generateImage")}
                        </Button>
                    )}
                </div>
            ) : null}
        </div>
    );
}

export function DramaArtifact({
    stage,
    version,
    generating = false,
    durationSeconds,
    durationDisabled,
    onDuration,
    aspectRatio = "9:16",
    onAspect,
    mediaByKey = {},
    pendingKeys = [],
    shotRefs = [],
    shotDurations = {},
    onGenerate,
    onStop,
    onRequeried,
    stoppingTaskId = "",
}: {
    stage: DramaStage;
    version: DramaVersion | undefined;
    generating?: boolean;
    durationSeconds: number;
    durationDisabled: boolean;
    onDuration: (seconds: number) => void;
    aspectRatio?: string;
    onAspect?: (ratio: string) => void;
    mediaByKey?: Record<string, DramaMedia | undefined>;
    pendingKeys?: string[];
    shotRefs?: string[];
    shotDurations?: Record<string, number>;
    onGenerate?: (targetKey: string) => void;
    onStop?: (media: DramaMedia) => void;
    onRequeried?: () => void;
    stoppingTaskId?: string;
}) {
    const translate = useTranslation();
    const content = version?.content || {};
    const [seconds, setSeconds] = useState(durationSeconds);
    useEffect(() => setSeconds(durationSeconds), [durationSeconds]);
    if (stage === "plan") {
        return (
            <div className="flex flex-col gap-4">
                <label className="flex flex-col gap-2 rounded-xl border border-[var(--studio-line)] bg-[var(--studio-surface)] px-4 py-3 text-sm text-[var(--studio-ink)] sm:flex-row sm:items-center sm:justify-between">
                    <span>
                        <span className="font-medium">{translate("drama.duration")}</span>
                        <span className="mt-1 block text-xs font-normal leading-5 text-[var(--studio-muted)]">{translate("drama.durationHint")}</span>
                    </span>
                    <InputNumber className="w-28" min={15} max={180} suffix={translate("drama.secondUnit")} value={seconds} disabled={durationDisabled} onChange={(value) => value && setSeconds(value)} onBlur={() => { if (seconds !== durationSeconds) onDuration(seconds); }} />
                </label>
                <div className="rounded-xl border border-[var(--studio-line)] bg-[var(--studio-surface)] px-4 py-3">
                    <p className="text-sm font-medium text-[var(--studio-ink)]">{translate("drama.aspectRatio")}</p>
                    <p className="mt-1 text-xs leading-5 text-[var(--studio-muted)]">{translate("drama.aspectHint")}</p>
                    <div className="mt-3"><DramaAspectPicker value={aspectRatio} disabled={durationDisabled || !onAspect} onChange={(ratio) => onAspect?.(ratio)} /></div>
                </div>
                {version ? (
                    <div className={`grid gap-3 md:grid-cols-2 ${generating ? "pointer-events-none opacity-60 transition-opacity" : ""}`}>
                        {generating ? (
                            <div className="flex items-center gap-2 text-xs font-medium text-[var(--studio-muted)] md:col-span-2" role="status">
                                <LoaderCircle className="size-3.5 animate-spin text-[var(--studio-action)]" aria-hidden="true" />
                                <span>AI 正在更新{translate(dramaStageMeta[stage].label)}…</span>
                            </div>
                        ) : null}
                        <Field label={translate("drama.genre")} value={text(content.genre)} />
                        <Field label={translate("drama.style")} value={text(content.style)} />
                        <Field className="md:col-span-2" label={translate("drama.understanding")} value={text(content.understanding)} />
                        <Field className="md:col-span-2" label={translate("drama.storyDirection")} value={text(content.storyDirection)} />
                        <p className="text-xs tabular-nums text-[var(--studio-muted)] md:col-span-2">{translate("drama.seconds", { value0: text(content.durationSeconds) || durationSeconds })}</p>
                    </div>
                ) : generating ? <StageSkeleton stage="plan" /> : <EmptyStage />}
            </div>
        );
    }
    if (!version) return generating ? <StageSkeleton stage={stage} /> : <EmptyStage />;
    if (stage === "script") {
        const scenes = rows(content.scenes);
        return (
            <div className="flex flex-col gap-4">
                <Field label={translate("drama.synopsis")} value={text(content.synopsis)} />
                {scenes.map((scene, index) => (
                    <article key={text(scene.id) || text(scene.ref) || index} className="rounded-xl border border-[var(--studio-line)] bg-[var(--studio-surface)] p-4">
                        <div className="flex items-start gap-3">
                            <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--studio-primary-soft)] text-xs font-semibold tabular-nums text-[var(--studio-ink)]">{index + 1}</span>
                            <h3 className="text-sm font-semibold leading-6 text-[var(--studio-ink)]">{text(scene.heading)}</h3>
                        </div>
                        {text(scene.action) ? <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[var(--studio-text)]">{text(scene.action)}</p> : null}
                        {rows(scene.lines).length ? (
                            <div className="mt-3 flex flex-col gap-2">
                                {rows(scene.lines).map((line, lineIndex) => (
                                    <p key={lineIndex} className="rounded-lg bg-[var(--studio-surface-soft)] px-3 py-2 text-sm leading-6 text-[var(--studio-ink)]">
                                        <span className="mr-2 text-xs font-semibold text-[var(--studio-action-emphasis)]">{text(line.speaker) || text(line.characterRef) || "—"}</span>
                                        {text(line.text)}
                                    </p>
                                ))}
                            </div>
                        ) : null}
                    </article>
                ))}
            </div>
        );
    }
    if (stage === "cast") {
        return (
            <div className="flex flex-col gap-6">
                <section className="flex flex-col gap-3">
                    <h3 className="text-sm font-semibold text-[var(--studio-ink)]">{translate("drama.characters")}</h3>
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                        {rows(content.characters).map((person, index) => {
                            const targetKey = `character:${text(person.ref)}`;
                            return (
                                <article key={text(person.id) || targetKey || index} className="overflow-hidden rounded-xl border border-[var(--studio-line)] bg-[var(--studio-surface)]">
                                    <MediaFrame bare media={mediaByKey[targetKey]} kind="image" targetKey={targetKey} pending={pendingKeys.includes(targetKey)} aspect="aspect-[3/2]" onGenerate={onGenerate} onStop={onStop} onRequeried={onRequeried} stoppingTaskId={stoppingTaskId} />
                                    <div className="flex flex-col gap-3 p-4">
                                        <p className="text-sm font-semibold text-[var(--studio-ink)]">{text(person.name)}</p>
                                        <Field plain label={translate("drama.personality")} value={text(person.personality)} />
                                        <Field plain label={translate("drama.appearance")} value={text(person.appearance)} />
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                </section>
                <section className="flex flex-col gap-3">
                    <h3 className="text-sm font-semibold text-[var(--studio-ink)]">{translate("drama.locations")}</h3>
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                        {rows(content.locations).map((place, index) => {
                            const targetKey = `location:${text(place.ref)}`;
                            return (
                                <article key={text(place.id) || targetKey || index} className="overflow-hidden rounded-xl border border-[var(--studio-line)] bg-[var(--studio-surface)]">
                                    <MediaFrame bare media={mediaByKey[targetKey]} kind="image" targetKey={targetKey} pending={pendingKeys.includes(targetKey)} aspect="aspect-video" onGenerate={onGenerate} onStop={onStop} onRequeried={onRequeried} stoppingTaskId={stoppingTaskId} />
                                    <div className="flex flex-col gap-3 p-4">
                                        <p className="text-sm font-semibold text-[var(--studio-ink)]">{text(place.name)}</p>
                                        <Field plain label={translate("drama.visual")} value={text(place.visual)} />
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                </section>
            </div>
        );
    }
    if (stage === "shot") {
        const shotsByRef = new Map(rows(content.shots).map((shot) => [text(shot.ref), shot]));
        const stageRefs = refsOf(content.shots);
        return (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {(stageRefs.length ? stageRefs : shotRefs).map((ref, index) => {
                    const shot = shotsByRef.get(ref);
                    const duration = Number(shot?.durationSeconds) || shotDurations[ref];
                    const firstKey = `shot-first:${ref}`;
                    const lastKey = `shot-last:${ref}`;
                    const videoKey = `shot-video:${ref}`;
                    return (
                        <article key={text(shot?.id) || ref} className="flex flex-col overflow-hidden rounded-xl border border-[var(--studio-line)] bg-[var(--studio-surface)]">
                            <div className="flex flex-wrap items-center gap-2 border-b border-[var(--studio-line)] px-4 py-3">
                                <span className="inline-flex size-6 items-center justify-center rounded-full bg-[var(--studio-primary-soft)] text-xs font-semibold tabular-nums text-[var(--studio-ink)]">{text(shot?.order) || index + 1}</span>
                                <span className="text-xs font-semibold text-[var(--studio-muted)]">{ref}</span>
                                {[text(shot?.size), text(shot?.camera)].filter(Boolean).map((chip, chipIndex) => (
                                    <span key={`${chip}-${chipIndex}`} className="rounded-full bg-[var(--studio-surface-soft)] px-2 py-0.5 text-xs text-[var(--studio-text)]">{chip}</span>
                                ))}
                                {duration ? <span className="ml-auto text-xs tabular-nums text-[var(--studio-muted)]">{translate("drama.seconds", { value0: duration })}</span> : null}
                            </div>
                            <div className="grid grid-cols-2 gap-2.5 p-3">
                                <div className="flex flex-col gap-1.5">
                                    <p className="text-xs font-medium text-[var(--studio-faint)]">{translate("drama.firstFrame")}</p>
                                    <MediaFrame media={mediaByKey[firstKey]} kind="image" targetKey={firstKey} pending={pendingKeys.includes(firstKey)} aspect="aspect-video" onGenerate={onGenerate} onStop={onStop} onRequeried={onRequeried} stoppingTaskId={stoppingTaskId} />
                                </div>
                                <div className="flex flex-col gap-1.5">
                                    <p className="text-xs font-medium text-[var(--studio-faint)]">{translate("drama.lastFrame")}</p>
                                    <MediaFrame media={mediaByKey[lastKey]} kind="image" targetKey={lastKey} pending={pendingKeys.includes(lastKey)} aspect="aspect-video" onGenerate={onGenerate} onStop={onStop} onRequeried={onRequeried} stoppingTaskId={stoppingTaskId} />
                                </div>
                            </div>
                            <div className="flex flex-1 flex-col gap-3 px-4 pb-3">
                                <Field plain label={translate("drama.picture")} value={text(shot?.picture)} />
                                <Field plain label={translate("drama.dialogue")} value={text(shot?.dialogue)} />
                                <Field plain label={translate("drama.videoPrompt")} value={text(shot?.videoPrompt)} />
                            </div>
                            <div className="px-3 pb-3">
                                <MediaFrame media={mediaByKey[videoKey]} kind="video" targetKey={videoKey} pending={pendingKeys.includes(videoKey)} aspect="aspect-video" onGenerate={onGenerate} onStop={onStop} onRequeried={onRequeried} stoppingTaskId={stoppingTaskId} />
                            </div>
                        </article>
                    );
                })}
            </div>
        );
    }
    return null;
}
