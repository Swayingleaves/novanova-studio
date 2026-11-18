"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Images } from "lucide-react";
import { useTranslation } from "@/features/locale/use-translation";
import { ResultDetailDialog, type ResultDetail } from "@/features/generation/components/result-detail-dialog";
import { downloadMedia } from "@/features/storage/services/media-download";
import type { DramaMedia, DramaStage, DramaVersion, DramaWorkspace } from "@/services/api/drama";
import { dramaStageMeta } from "../stage-meta";

/** 助手消息 meta 的结构，字段由服务端按消息种类写入。 */
export type DramaMessageMeta = {
    kind?: string;
    stage?: DramaStage;
    versionId?: string;
    versionNumber?: number;
    counts?: Record<string, number | string | undefined>;
    mediaKeys?: string[];
    mediaCount?: number;
};

/** 解析服务端写入的消息 meta，解析失败按没有卡片处理。 */
export function parseDramaMeta(value?: string | null): DramaMessageMeta | null {
    if (!value) return null;
    try {
        const parsed = JSON.parse(value) as DramaMessageMeta;
        return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
        return null;
    }
}

type Row = Record<string, unknown>;

function rows(value: unknown): Row[] {
    return Array.isArray(value) ? value.filter((item): item is Row => Boolean(item) && typeof item === "object") : [];
}

function text(value: unknown) {
    return typeof value === "string" ? value : value == null ? "" : String(value);
}

function clip(value: unknown, length = 60) {
    const content = text(value);
    return content.length > length ? `${content.slice(0, length)}…` : content;
}

/** 阶段产物卡片一句话摘要。 */
export function stageSummary(translate: ReturnType<typeof useTranslation>, stage: DramaStage, counts: DramaMessageMeta["counts"], version: DramaVersion | undefined) {
    const content = (version?.content || {}) as Record<string, unknown>;
    if (stage === "plan") {
        return translate("drama.cardPlanSummary", { seconds: text(counts?.durationSeconds) || text(content.durationSeconds), ratio: text(counts?.aspectRatio) || text(content.aspectRatio) });
    }
    if (stage === "script") return translate("drama.cardScriptSummary", { scenes: Number(counts?.scenes) || 0 });
    if (stage === "cast") return translate("drama.cardCastSummary", { characters: Number(counts?.characters) || 0, locations: Number(counts?.locations) || 0 });
    if (stage === "storyboard" || stage === "shot") return translate("drama.cardShotSummary", { shots: Number(counts?.shots) || 0 });
    return translate("drama.cardPreviewSummary", { checks: Number(counts?.checks) || 0 });
}

/**
 * 折叠展开的档案摘要，只列关键字段，完整内容去右侧工作台看。
 */
function archiveRows(stage: DramaStage, version: DramaVersion | undefined): Array<{ label: string; value: string }> {
    const content = (version?.content || {}) as Record<string, unknown>;
    if (stage === "plan") {
        return [
            { label: "drama.genre", value: text(content.genre) },
            { label: "drama.style", value: text(content.style) },
            { label: "drama.understanding", value: text(content.understanding) },
            { label: "drama.storyDirection", value: text(content.storyDirection) },
        ];
    }
    if (stage === "script") {
        return [
            { label: "drama.synopsis", value: text(content.synopsis) },
            ...rows(content.scenes).map((scene, index) => ({ label: `${index + 1}`, value: text(scene.heading) })),
        ];
    }
    if (stage === "cast") {
        return [
            ...rows(content.characters).map((person) => ({ label: text(person.name), value: text(person.personality) })),
            ...rows(content.locations).map((place) => ({ label: text(place.name), value: text(place.visual) })),
        ];
    }
    if (stage === "storyboard") {
        return rows(content.shots).map((shot, index) => ({
            label: text(shot.order) || `${index + 1}`,
            value: [text(shot.size), clip(shot.picture)].filter(Boolean).join(" · "),
        }));
    }
    if (stage === "shot") {
        return rows(content.shots).map((shot) => ({ label: text(shot.ref), value: clip(shot.videoPrompt) }));
    }
    return [
        { label: "drama.summary", value: text(content.summary) },
        ...rows(content.checklist).map((item) => ({ label: item.passed === true ? "drama.passed" : "drama.notPassed", value: text(item.item) })),
    ];
}

export function DramaStageCard({
    meta,
    workspace,
    onView,
}: {
    meta: DramaMessageMeta;
    workspace: DramaWorkspace | null;
    onView: (stage: DramaStage, versionId?: string) => void;
}) {
    const translate = useTranslation();
    const [open, setOpen] = useState(false);
    const stage = (meta.stage || "plan") as DramaStage;
    const version = useMemo(() => (workspace?.versions || []).find((item) => item.id === meta.versionId), [meta.versionId, workspace?.versions]);
    if (meta.versionId && !version) return null;
    const Icon = dramaStageMeta[stage].icon;
    const details = open ? archiveRows(stage, version) : [];
    return (
        <section className="mt-2 overflow-hidden rounded-2xl border border-[var(--studio-line)] bg-[var(--studio-surface)]">
            <div className="flex items-start gap-2.5 px-3.5 py-3">
                <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-[var(--studio-primary-soft)] text-[var(--studio-action-emphasis)]">
                    <Icon className="size-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-[var(--studio-ink)]">
                        {translate("drama.cardStageTitle", { stage: translate(dramaStageMeta[stage].label) })}
                        {meta.versionNumber ? <span className="ml-1.5 text-xs font-normal tabular-nums text-[var(--studio-muted)]">{translate("drama.version", { value0: meta.versionNumber })}</span> : null}
                    </p>
                    <p className="mt-0.5 text-xs leading-5 text-[var(--studio-muted)]">{stageSummary(translate, stage, meta.counts, version)}</p>
                </div>
            </div>
            {open && details.length ? (
                <dl className="border-t border-[var(--studio-line)] px-3.5 py-2.5">
                    {details.map((row, index) => (
                        <div key={`${row.label}-${index}`} className="flex gap-3 py-1">
                            <dt className="w-16 shrink-0 truncate text-xs leading-5 text-[var(--studio-faint)]">{row.label}</dt>
                            <dd className="min-w-0 flex-1 text-xs leading-5 text-[var(--studio-text)]">{row.value || "—"}</dd>
                        </div>
                    ))}
                </dl>
            ) : null}
            <div className="flex items-center gap-3 border-t border-[var(--studio-line)] bg-[var(--studio-surface-soft)] px-3.5 py-2">
                <button type="button" className="text-xs! font-medium text-[var(--studio-action-emphasis)]! hover:underline" onClick={() => onView(stage, meta.versionId)}>
                    {translate("drama.view")}
                </button>
                <button type="button" className="inline-flex items-center gap-1 text-xs! text-[var(--studio-muted)]! hover:text-[var(--studio-ink)]!" onClick={() => setOpen((value) => !value)}>
                    {open ? <ChevronUp className="size-3" aria-hidden="true" /> : <ChevronDown className="size-3" aria-hidden="true" />}
                    {translate(open ? "drama.collapseArchive" : "drama.expandArchive")}
                </button>
            </div>
        </section>
    );
}

export function DramaMediaCard({ meta, workspace, onView }: { meta: DramaMessageMeta; workspace: DramaWorkspace | null; onView: (stage: DramaStage, versionId?: string) => void }) {
    const translate = useTranslation();
    const [detail, setDetail] = useState<ResultDetail | null>(null);
    const [expanded, setExpanded] = useState(false);
    const media = useMemo(() => {
        const byKey = new Map<string, DramaMedia>();
        for (const item of workspace?.media || []) {
            if (!byKey.has(item.targetKey)) byKey.set(item.targetKey, item);
        }
        return (meta.mediaKeys || []).map((key) => byKey.get(key)).filter((item): item is DramaMedia => Boolean(item?.url));
    }, [meta.mediaKeys, workspace?.media]);
    const visible = expanded ? media : media.slice(0, 4);
    const stage = (meta.stage || "plan") as DramaStage;
    const video = media.some((item) => item.mediaType === "video");
    return (
        <section className="mt-2 overflow-hidden rounded-2xl border border-[var(--studio-line)] bg-[var(--studio-surface)]">
            <div className="flex items-center gap-2 px-3.5 pt-3 text-xs text-[var(--studio-muted)]">
                <Images className="size-3.5" aria-hidden="true" />
                {translate(video ? "drama.cardVideoTitle" : "drama.cardMediaTitle", { count: meta.mediaCount ?? media.length })}
            </div>
            {visible.length ? (
                <div className="flex flex-wrap gap-2 px-3.5 py-3">
                    {visible.map((item) => (
                        <button
                            key={item.id}
                            type="button"
                            className="size-16 overflow-hidden rounded-lg border border-[var(--studio-line)] bg-[var(--studio-media)] p-0"
                            onClick={() => setDetail({
                                media: { kind: item.mediaType === "video" ? "video" : "image", url: item.url, storageKey: item.storageKey || undefined },
                                onDownload: () => downloadMedia({ storageKey: item.storageKey || undefined, url: item.url }, item.mediaType === "video" ? "drama-video.mp4" : "drama-image.png"),
                            })}
                        >
                            {item.mediaType === "video"
                                ? <video className="pointer-events-none size-full object-cover" src={item.url} muted playsInline preload="metadata" />
                                : <img src={item.url} alt="" className="size-full object-cover" />}
                        </button>
                    ))}
                </div>
            ) : null}
            <div className="flex items-center gap-3 border-t border-[var(--studio-line)] bg-[var(--studio-surface-soft)] px-3.5 py-2">
                <button type="button" className="text-xs! font-medium text-[var(--studio-action-emphasis)]! hover:underline" onClick={() => onView(stage)}>
                    {translate("drama.view")}
                </button>
                {media.length > 4 ? (
                    <button type="button" className="text-xs! text-[var(--studio-muted)]! hover:text-[var(--studio-ink)]!" onClick={() => setExpanded((value) => !value)}>
                        {translate(expanded ? "drama.collapseArchive" : "drama.expandArchive")}
                    </button>
                ) : null}
            </div>
            <ResultDetailDialog detail={detail} onClose={() => setDetail(null)} />
        </section>
    );
}
