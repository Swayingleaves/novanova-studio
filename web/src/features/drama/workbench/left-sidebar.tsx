"use client";

import { Button, InputNumber } from "antd";
import { Film, LoaderCircle, Square } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "@/features/locale/use-translation";
import { ModelPicker } from "@/features/settings/components/model-picker";
import { VIDEO_RESOLUTION_OPTIONS } from "@/features/generation/lib/video-billing";
import type { AiConfig, VideoResolution } from "@/features/settings/stores/use-config-store";
import type { DramaMedia, DramaProjectDetail, DramaStage, DramaVersion } from "@/services/api/drama";
import { DramaAspectPicker, dramaAspectRatio } from "../aspect-ratio";
import { formatShotNumber, formatTimecode, resolveShotThumbnail, shotDisplayTitle, type TimedDramaShot } from "../lib/shot-utils";
import { SafeThumbImage } from "./safe-thumb";

export type LeftSidebarTab = "shots" | "assets" | "params" | "detail";

type Row = Record<string, unknown>;

function rows(value: unknown): Row[] {
    return Array.isArray(value) ? value.filter((item): item is Row => Boolean(item) && typeof item === "object") : [];
}

function readText(value: unknown) {
    return typeof value === "string" ? value : value == null ? "" : String(value);
}

/** 左侧栏：分镜列表、素材（角色与场景）、参数配置、方案与剧本详情。 */
export function DramaLeftSidebar({
    tab,
    onTabChange,
    shots,
    totalSeconds,
    selectedShotRef,
    onSelectShot,
    project,
    planVersion,
    scriptVersion,
    castVersion,
    mediaByKey,
    pendingKeys,
    busy,
    config,
    imageModel,
    videoModel,
    imageQuality,
    imageResolution,
    videoResolution,
    videoResolutions,
    filling,
    stoppingTaskId,
    onImageModelChange,
    onImageQualityChange,
    onImageResolutionChange,
    onVideoModelChange,
    onVideoResolutionChange,
    onSaveProjectSettings,
    onGenerateMedia,
    onStopMedia,
    onGenerateMissingCast,
    onJumpStage,
}: {
    tab: LeftSidebarTab;
    onTabChange: (tab: LeftSidebarTab) => void;
    shots: TimedDramaShot[];
    totalSeconds: number;
    selectedShotRef: string;
    onSelectShot: (ref: string) => void;
    project: DramaProjectDetail;
    planVersion?: DramaVersion;
    scriptVersion?: DramaVersion;
    castVersion?: DramaVersion;
    mediaByKey: Record<string, DramaMedia | undefined>;
    pendingKeys: string[];
    busy: boolean;
    config: AiConfig;
    imageModel: string;
    videoModel: string;
    imageQuality: string;
    imageResolution: string;
    videoResolution: string;
    videoResolutions: VideoResolution[];
    filling: boolean;
    stoppingTaskId: string;
    onImageModelChange: (value: string) => void;
    onImageQualityChange: (value: string) => void;
    onImageResolutionChange: (value: string) => void;
    onVideoModelChange: (value: string) => void;
    onVideoResolutionChange: (value: string) => void;
    onSaveProjectSettings: (patch: { textModel?: string; durationSeconds?: number; aspectRatio?: string }) => void;
    onGenerateMedia: (targetKey: string) => void;
    onStopMedia: (media: DramaMedia) => void;
    onGenerateMissingCast: (targetKeys: string[]) => void;
    onJumpStage: (stage: DramaStage) => void;
}) {
    const translate = useTranslation();
    const [durationDraft, setDurationDraft] = useState(project.durationSeconds);

    useEffect(() => {
        setDurationDraft(project.durationSeconds);
    }, [project.durationSeconds]);

    const readyThumbCount = shots.filter((shot) => resolveShotThumbnail(shot.ref, mediaByKey).kind !== "none").length;
    const castCharacters = rows(castVersion?.content?.characters);
    const castLocations = rows(castVersion?.content?.locations);
    const castTargetKeys = [
        ...castCharacters.map((item) => `character:${readText(item.ref)}`).filter((key) => !key.endsWith(":")),
        ...castLocations.map((item) => `location:${readText(item.ref)}`).filter((key) => !key.endsWith(":")),
    ];

    const tabs: Array<{ key: LeftSidebarTab; label: string }> = [
        { key: "shots", label: translate("drama.tabShots") },
        { key: "assets", label: translate("drama.tabAssets") },
        { key: "params", label: translate("drama.tabParams") },
        { key: "detail", label: translate("drama.tabDetail") },
    ];

    return (
        <aside className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden border-r border-[var(--studio-line)] bg-[var(--studio-rail)]">
            <div className="flex shrink-0 items-center gap-1 border-b border-[var(--studio-line)] px-2.5 py-2" role="tablist">
                {tabs.map((item) => {
                    const active = tab === item.key;
                    return (
                        <button
                            key={item.key}
                            type="button"
                            role="tab"
                            aria-selected={active}
                            onClick={() => onTabChange(item.key)}
                            className={`flex-1 truncate rounded-md px-2 py-1.5 text-xs! font-medium transition-colors ${
                                active
                                    ? "bg-[var(--studio-surface-raised)] text-[var(--studio-ink)]!"
                                    : "text-[var(--studio-muted)]! hover:bg-[var(--studio-surface-hover)] hover:text-[var(--studio-ink)]!"
                            }`}
                        >
                            {item.label}
                        </button>
                    );
                })}
            </div>

            {tab === "shots" ? (
                <div className="flex min-h-0 flex-1 flex-col">
                    <div className="flex shrink-0 items-center justify-between border-b border-[var(--studio-line)] px-3 py-2 text-[11px] tabular-nums text-[var(--studio-muted)]">
                        <span>{translate("drama.shotListSummary", { shots: shots.length, seconds: totalSeconds })}</span>
                        <span>{translate("drama.thumbnailsCount", { ready: readyThumbCount, total: shots.length })}</span>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto p-2">
                        {shots.length === 0 ? (
                            <div className="flex h-40 flex-col items-center justify-center gap-2 px-3 text-center text-xs text-[var(--studio-muted)]">
                                <Film className="size-4 text-[var(--studio-faint)]" aria-hidden="true" />
                                <p>{translate("drama.noShotsYet")}</p>
                            </div>
                        ) : (
                            <ul className="flex flex-col gap-1">
                                {shots.map((shot) => {
                                    const active = selectedShotRef === shot.ref;
                                    const thumb = resolveShotThumbnail(shot.ref, mediaByKey);
                                    const title = shotDisplayTitle(shot, shot.index);
                                    return (
                                        <li key={shot.id || shot.ref}>
                                            <button
                                                type="button"
                                                onClick={() => onSelectShot(shot.ref)}
                                                className={`group flex w-full items-center gap-2.5 rounded-lg border px-2 py-2 text-left transition-colors ${
                                                    active
                                                        ? "border-[var(--studio-line-strong)] bg-[var(--studio-surface-raised)]"
                                                        : "border-transparent hover:bg-[var(--studio-surface-hover)]"
                                                }`}
                                            >
                                                <div className="relative h-9 w-14 shrink-0 overflow-hidden rounded border border-[var(--studio-line)] bg-[var(--studio-page)]">
                                                    {thumb.kind === "video" ? (
                                                        <video src={thumb.url} muted playsInline preload="metadata" className="pointer-events-none size-full object-cover" />
                                                    ) : (
                                                        <SafeThumbImage src={thumb.kind === "image" ? thumb.url : undefined} fallbackLabel={shot.ref} />
                                                    )}
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <p className={`truncate text-xs! font-medium ${active ? "text-[var(--studio-ink)]!" : "text-[var(--studio-text)]!"}`}>
                                                        {title}
                                                    </p>
                                                    <p className="mt-0.5 truncate text-[11px]! tabular-nums text-[var(--studio-faint)]!">
                                                        {formatShotNumber(shot.index)} · {formatTimecode(shot.startSec)}–{formatTimecode(shot.endSec)}
                                                    </p>
                                                </div>
                                                {active ? (
                                                    <span className="size-1.5 shrink-0 rounded-full bg-[var(--studio-action)]" aria-hidden="true" />
                                                ) : null}
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>
                </div>
            ) : null}

            {tab === "assets" ? (
                <div className="min-h-0 flex-1 overflow-y-auto p-3">
                    <div className="mb-3 flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-[var(--studio-muted)]">
                            {translate("drama.cardCastSummary", { characters: castCharacters.length, locations: castLocations.length })}
                        </span>
                        {castTargetKeys.length > 0 ? (
                            <Button
                                size="small"
                                loading={filling}
                                disabled={pendingKeys.length > 0 || filling}
                                onClick={() => onGenerateMissingCast(castTargetKeys)}
                            >
                                {translate("drama.generateMissingImages")}
                            </Button>
                        ) : null}
                    </div>
                    {castCharacters.length === 0 && castLocations.length === 0 ? (
                        <div className="flex flex-col items-center gap-2 py-10 text-center text-xs text-[var(--studio-muted)]">
                            <p>{translate("drama.noVersion")}</p>
                            <Button size="small" onClick={() => onJumpStage("cast")}>{translate("drama.stageCast")}</Button>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-4">
                            {castCharacters.length > 0 ? (
                                <section className="flex flex-col gap-2">
                                    <h3 className="text-xs font-semibold text-[var(--studio-ink)]">{translate("drama.characters")}</h3>
                                    {castCharacters.map((person, index) => {
                                        const ref = readText(person.ref);
                                        const key = `character:${ref}`;
                                        return (
                                            <CompactAssetRow
                                                key={readText(person.id) || key || index}
                                                name={readText(person.name) || ref}
                                                subtitle={readText(person.personality) || readText(person.appearance)}
                                                media={mediaByKey[key]}
                                                pending={pendingKeys.includes(key)}
                                                stoppingTaskId={stoppingTaskId}
                                                onGenerate={() => onGenerateMedia(key)}
                                                onStop={onStopMedia}
                                            />
                                        );
                                    })}
                                </section>
                            ) : null}
                            {castLocations.length > 0 ? (
                                <section className="flex flex-col gap-2">
                                    <h3 className="text-xs font-semibold text-[var(--studio-ink)]">{translate("drama.locations")}</h3>
                                    {castLocations.map((place, index) => {
                                        const ref = readText(place.ref);
                                        const key = `location:${ref}`;
                                        return (
                                            <CompactAssetRow
                                                key={readText(place.id) || key || index}
                                                name={readText(place.name) || ref}
                                                subtitle={readText(place.visual)}
                                                media={mediaByKey[key]}
                                                pending={pendingKeys.includes(key)}
                                                stoppingTaskId={stoppingTaskId}
                                                onGenerate={() => onGenerateMedia(key)}
                                                onStop={onStopMedia}
                                            />
                                        );
                                    })}
                                </section>
                            ) : null}
                        </div>
                    )}
                </div>
            ) : null}

            {tab === "params" ? (
                <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto overflow-x-hidden p-3">
                    <div>
                        <label className="block text-xs font-medium text-[var(--studio-ink)]">
                            {translate("drama.duration")}
                        </label>
                        <div className="mt-1.5">
                            <InputNumber
                                className="w-full!"
                                min={15}
                                max={180}
                                suffix={translate("drama.secondUnit")}
                                value={durationDraft}
                                disabled={busy}
                                onChange={(value) => { if (typeof value === "number") setDurationDraft(value); }}
                                onBlur={() => { if (durationDraft !== project.durationSeconds) onSaveProjectSettings({ durationSeconds: durationDraft }); }}
                            />
                        </div>
                        <p className="mt-1 text-[11px] leading-4 text-[var(--studio-faint)]">{translate("drama.durationHint")}</p>
                    </div>

                    <div>
                        <p className="text-xs font-medium text-[var(--studio-ink)]">{translate("drama.aspectRatio")}</p>
                        <div className="mt-1.5">
                            <DramaAspectPicker
                                value={dramaAspectRatio(project.aspectRatio)}
                                disabled={busy}
                                onChange={(aspectRatio) => onSaveProjectSettings({ aspectRatio })}
                            />
                        </div>
                    </div>

                    <div className="border-t border-[var(--studio-line)] pt-3">
                        <label className="block text-xs font-medium text-[var(--studio-ink)]">{translate("drama.textModel")}</label>
                        <div className="mt-1.5">
                            <ModelPicker
                                config={config}
                                value={project.textModel}
                                onChange={(textModel) => { if (textModel !== project.textModel) onSaveProjectSettings({ textModel }); }}
                                capability="text"
                                fullWidth
                            />
                        </div>
                    </div>

                    <div className="border-t border-[var(--studio-line)] pt-3">
                        <label className="block text-xs font-medium text-[var(--studio-ink)]">{translate("drama.imageModel")}</label>
                        <div className="mt-1.5">
                            <ModelPicker config={config} value={imageModel} onChange={onImageModelChange} capability="image" fullWidth />
                        </div>
                        <div className="mt-2.5 flex flex-col gap-2">
                            <ParamChipGroup
                                label={translate("drama.quality")}
                                value={imageQuality}
                                options={[
                                    { value: "low", label: translate("generation.lowQuality_ebe981") },
                                    { value: "medium", label: translate("generation.standardQuality_3da00d") },
                                    { value: "high", label: translate("generation.highQuality_f31c44") },
                                ]}
                                onChange={onImageQualityChange}
                            />
                            <ParamChipGroup
                                label={translate("drama.resolution")}
                                value={imageResolution}
                                options={["1K", "2K", "4K"].map((item) => ({ value: item, label: item }))}
                                onChange={onImageResolutionChange}
                            />
                        </div>
                    </div>

                    <div className="border-t border-[var(--studio-line)] pt-3">
                        <label className="block text-xs font-medium text-[var(--studio-ink)]">{translate("drama.videoModel")}</label>
                        <div className="mt-1.5">
                            <ModelPicker config={config} value={videoModel} onChange={onVideoModelChange} capability="video" fullWidth />
                        </div>
                        <div className="mt-2.5">
                            <ParamChipGroup
                                label={translate("drama.resolution")}
                                value={videoResolution}
                                options={(videoResolutions.length ? videoResolutions : [videoResolution as VideoResolution]).map((item) => ({
                                    value: item,
                                    label: VIDEO_RESOLUTION_OPTIONS.find((option) => option.value === item)?.label || item,
                                }))}
                                onChange={onVideoResolutionChange}
                            />
                        </div>
                    </div>
                </div>
            ) : null}

            {tab === "detail" ? (
                <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3 text-xs">
                    <section className="flex flex-col gap-2 rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface)] p-3">
                        <div className="flex items-center justify-between">
                            <h3 className="font-semibold text-[var(--studio-ink)]">{translate("drama.stagePlan")}</h3>
                            <button type="button" className="text-[11px]! font-medium text-[var(--studio-action)]! hover:underline" onClick={() => onJumpStage("plan")}>
                                {translate("drama.view")}
                            </button>
                        </div>
                        {planVersion ? (
                            <dl className="flex flex-col gap-2">
                                <DetailRow label={translate("drama.genre")} value={readText(planVersion.content.genre)} />
                                <DetailRow label={translate("drama.style")} value={readText(planVersion.content.style)} />
                                <DetailRow label={translate("drama.understanding")} value={readText(planVersion.content.understanding)} />
                                <DetailRow label={translate("drama.storyDirection")} value={readText(planVersion.content.storyDirection)} />
                            </dl>
                        ) : (
                            <p className="text-[var(--studio-muted)]">{translate("drama.noVersion")}</p>
                        )}
                    </section>

                    <section className="flex flex-col gap-2 rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface)] p-3">
                        <div className="flex items-center justify-between">
                            <h3 className="font-semibold text-[var(--studio-ink)]">{translate("drama.stageScript")}</h3>
                            <button type="button" className="text-[11px]! font-medium text-[var(--studio-action)]! hover:underline" onClick={() => onJumpStage("script")}>
                                {translate("drama.view")}
                            </button>
                        </div>
                        {scriptVersion ? (
                            <div className="flex flex-col gap-2">
                                <DetailRow label={translate("drama.synopsis")} value={readText(scriptVersion.content.synopsis)} />
                                {rows(scriptVersion.content.scenes).map((scene, index) => (
                                    <div key={readText(scene.id) || index} className="rounded-md bg-[var(--studio-surface-raised)] p-2">
                                        <p className="font-medium text-[var(--studio-ink)]">{index + 1}. {readText(scene.heading)}</p>
                                        {readText(scene.action) ? <p className="mt-1 line-clamp-3 text-[var(--studio-muted)]">{readText(scene.action)}</p> : null}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-[var(--studio-muted)]">{translate("drama.noVersion")}</p>
                        )}
                    </section>
                </div>
            ) : null}
        </aside>
    );
}

function CompactAssetRow({
    name,
    subtitle,
    media,
    pending,
    stoppingTaskId,
    onGenerate,
    onStop,
}: {
    name: string;
    subtitle: string;
    media?: DramaMedia;
    pending: boolean;
    stoppingTaskId: string;
    onGenerate: () => void;
    onStop: (media: DramaMedia) => void;
}) {
    const translate = useTranslation();
    const queued = media?.status === "pending" || media?.status === "running";
    const running = pending || queued;
    const ready = media?.status === "success" && Boolean(media.url);
    const stopping = Boolean(media?.taskId && media.taskId === stoppingTaskId);

    return (
        <div className="flex items-center gap-2.5 rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface)] p-2">
            <div className="h-11 w-14 shrink-0 overflow-hidden rounded border border-[var(--studio-line)] bg-[var(--studio-page)]">
                {running && !ready ? (
                    <div className="studio-skeleton size-full" aria-hidden="true" />
                ) : (
                    <SafeThumbImage src={ready ? media?.url : undefined} alt={name} />
                )}
            </div>
            <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-[var(--studio-ink)]">{name}</p>
                {subtitle ? <p className="mt-0.5 line-clamp-1 text-[11px] text-[var(--studio-muted)]">{subtitle}</p> : null}
                <div className="mt-1">
                    {queued && media?.taskId ? (
                        <button
                            type="button"
                            disabled={stopping}
                            onClick={() => onStop(media)}
                            className="inline-flex items-center gap-1 text-[11px]! text-[var(--studio-danger)]! hover:underline disabled:opacity-50"
                        >
                            {stopping ? <LoaderCircle className="size-3 animate-spin" /> : <Square className="size-2.5 fill-current" />}
                            {translate("drama.stop")}
                        </button>
                    ) : (
                        <button
                            type="button"
                            disabled={running}
                            onClick={onGenerate}
                            className="text-[11px]! font-medium text-[var(--studio-action)]! hover:underline disabled:opacity-50"
                        >
                            {running ? translate("drama.mediaRunning") : translate("drama.generateImage")}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

function ParamChipGroup({
    label,
    value,
    options,
    onChange,
}: {
    label: string;
    value: string;
    options: Array<{ value: string; label: string }>;
    onChange: (value: string) => void;
}) {
    return (
        <div className="flex flex-col gap-1">
            <span className="text-[11px] text-[var(--studio-muted)]">{label}</span>
            <div className="flex flex-wrap gap-1">
                {options.map((option) => {
                    const active = value === option.value;
                    return (
                        <button
                            key={option.value}
                            type="button"
                            style={active ? { background: "var(--studio-action)", borderColor: "var(--studio-action)", color: "var(--studio-action-foreground)" } : undefined}
                            className={`rounded-md border px-2 py-1 text-[11px]! font-medium transition-colors ${
                                active
                                    ? ""
                                    : "border-[var(--studio-line-strong)] bg-[var(--studio-surface)] text-[var(--studio-text)]! hover:border-[var(--studio-action)]"
                            }`}
                            onClick={() => onChange(option.value)}
                        >
                            {option.label}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

function DetailRow({ label, value }: { label: string; value: string }) {
    if (!value) return null;
    return (
        <div>
            <dt className="text-[11px] text-[var(--studio-faint)]">{label}</dt>
            <dd className="mt-0.5 whitespace-pre-wrap leading-5 text-[var(--studio-text)]">{value}</dd>
        </div>
    );
}
