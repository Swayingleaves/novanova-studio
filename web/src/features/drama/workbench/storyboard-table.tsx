"use client";

import { App, Button, Input, InputNumber, Modal, Tooltip } from "antd";
import {
    AlertTriangle,
    AtSign,
    Check,
    ChevronDown,
    ChevronUp,
    Coins,
    Copy,
    GripVertical,
    HelpCircle,
    Image as ImageIcon,
    LoaderCircle,
    Maximize2,
    Play,
    Square,
    Video,
    X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "@/features/locale/use-translation";
import { useCopyText } from "@/shared/hooks/use-copy-text";
import { creditAmount, creditText } from "@/shared/lib/credit-amounts";
import { ResultDetailDialog, type ResultDetail } from "@/features/generation/components/result-detail-dialog";
import { downloadMedia } from "@/features/storage/services/media-download";
import { RequeryFailedTaskButton } from "@/features/ai-task/requery-failed-task-button";
import type { DramaMedia, DramaShotItem } from "@/services/api/drama";
import {
    countDialogueChars,
    estimateSpeechOverflow,
    formatShotNumber,
    formatTimecode,
    type TimedDramaShot,
} from "../lib/shot-utils";
import { SafeThumbImage } from "./safe-thumb";

/** 中栏「分镜表 / 确认分镜」核心编辑组件：支持行内编辑、拖拽排序、时长告警与媒体快捷生成。 */
export function DramaStoryboardTable({
    shots,
    totalSeconds,
    targetDurationSeconds,
    aspectRatio,
    selectedShotRef,
    onSelectShot,
    editable,
    saving,
    savedHint,
    canConfirm,
    confirming,
    confirmLabel,
    onConfirm,
    onUpdateShot,
    onReorderShots,
    onDeleteShot,
    onMentionShot,
    mediaByKey,
    pendingKeys,
    imageUnitCredits,
    shotVideoCreditsByRef,
    filling,
    stoppingTaskId,
    onGenerateMedia,
    onExtractLastFrame,
    extractingShotRef,
    onStopMedia,
    onRequeried,
    onGenerateMissingVideos,
}: {
    shots: TimedDramaShot[];
    totalSeconds: number;
    targetDurationSeconds: number;
    aspectRatio: string;
    selectedShotRef: string;
    onSelectShot: (ref: string) => void;
    editable: boolean;
    saving: boolean;
    savedHint: boolean;
    canConfirm: boolean;
    confirming: boolean;
    confirmLabel: string;
    onConfirm: () => void;
    onUpdateShot: (ref: string, patch: Partial<DramaShotItem>) => void;
    onReorderShots: (fromIndex: number, toIndex: number) => void;
    onDeleteShot: (ref: string) => void;
    onMentionShot: (shot: TimedDramaShot) => void;
    mediaByKey: Record<string, DramaMedia | undefined>;
    pendingKeys: string[];
    imageUnitCredits: string;
    shotVideoCreditsByRef: Record<string, { credits: string; reason?: string }>;
    filling: boolean;
    stoppingTaskId: string;
    onGenerateMedia: (targetKey: string, customPrompt?: string) => void;
    onExtractLastFrame: (prevShotRef: string) => void;
    extractingShotRef: string;
    onStopMedia: (media: DramaMedia) => void;
    onRequeried: () => void;
    onGenerateMissingVideos: () => void;
}) {
    const translate = useTranslation();
    const copy = useCopyText();
    const { modal, message } = App.useApp();
    const [dragIndex, setDragIndex] = useState<number | null>(null);
    const [overIndex, setOverIndex] = useState<number | null>(null);
    const [expandedMedia, setExpandedMedia] = useState<Record<string, boolean>>({});
    const [expandedText, setExpandedText] = useState<{
        shotRef: string;
        field: "picture" | "dialogue" | "videoPrompt" | "rhythm";
        label: string;
        placeholder: string;
    } | null>(null);
    const [customFirstFrame, setCustomFirstFrame] = useState<{ shotRef: string; shotLabel: string; prompt: string } | null>(null);
    const [detail, setDetail] = useState<ResultDetail | null>(null);
    const cardRefs = useRef<Record<string, HTMLElement | null>>({});

    const expandedShot = expandedText ? shots.find((item) => item.ref === expandedText.shotRef) : undefined;
    const expandedValue = expandedShot && expandedText ? expandedShot[expandedText.field] : "";

    useEffect(() => {
        if (!selectedShotRef) return;
        const target = cardRefs.current[selectedShotRef];
        if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
    }, [selectedShotRef]);

    const totalDialogueChars = countDialogueChars(shots);
    const missingVideosTotalCredits = shots.reduce((sum, shot) => {
        const videoMedia = mediaByKey[`shot-video:${shot.ref}`];
        if (videoMedia?.status === "success" || videoMedia?.status === "pending" || videoMedia?.status === "running") {
            return sum;
        }
        const quote = shotVideoCreditsByRef[shot.ref]?.credits;
        return quote ? sum.plus(creditAmount(quote)) : sum;
    }, creditAmount(0));
    const missingVideosCreditsText = missingVideosTotalCredits.gt(0) ? creditText(missingVideosTotalCredits) : "";

    const requestDelete = (shot: TimedDramaShot) => {
        if (shots.length <= 1) {
            message.warning(translate("drama.keepAtLeastOneShot"));
            return;
        }
        modal.confirm({
            title: translate("drama.deleteShotTitle"),
            content: translate("drama.deleteShotHint"),
            okButtonProps: { danger: true },
            onOk: () => onDeleteShot(shot.ref),
        });
    };

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[var(--studio-line)] px-5 py-3.5">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <h2 className="text-base font-semibold text-[var(--studio-ink)]">{translate("drama.modeStoryboard")}</h2>
                        <Tooltip title={translate("drama.storyboardReadyGuide")}>
                            <HelpCircle className="size-3.5 text-[var(--studio-faint)]" aria-hidden="true" />
                        </Tooltip>
                        {saving ? (
                            <span className="inline-flex items-center gap-1 text-[11px] text-[var(--studio-muted)]">
                                <LoaderCircle className="size-3 animate-spin" aria-hidden="true" />
                                {translate("drama.savingShots")}
                            </span>
                        ) : savedHint ? (
                            <span className="text-[11px] text-[var(--studio-success)]">{translate("drama.shotsSaved")}</span>
                        ) : null}
                    </div>
                    <p className="mt-1 text-xs tabular-nums text-[var(--studio-muted)]">
                        {translate("drama.storyboardHeaderSummary", { shots: shots.length, seconds: totalSeconds, chars: totalDialogueChars })}
                    </p>
                    <p className="mt-0.5 text-[11px] tabular-nums text-[var(--studio-faint)]">
                        {translate("drama.projectTargetSummary", { ratio: aspectRatio, seconds: targetDurationSeconds })}
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <Button
                        size="middle"
                        loading={filling}
                        disabled={pendingKeys.length > 0 || filling || shots.length === 0}
                        onClick={onGenerateMissingVideos}
                    >
                        {missingVideosCreditsText
                            ? `${translate("drama.generateMissingVideos")} · ${missingVideosCreditsText} 积分`
                            : translate("drama.generateMissingVideos")}
                    </Button>
                    {canConfirm ? (
                        <Button
                            type="primary"
                            size="middle"
                            icon={<Check className="size-4" aria-hidden="true" />}
                            loading={confirming}
                            onClick={onConfirm}
                        >
                            {confirmLabel}
                        </Button>
                    ) : null}
                </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                <div className="mx-auto flex w-full max-w-[1160px] flex-col gap-3">
                    {shots.map((shot) => {
                        const active = selectedShotRef === shot.ref;
                        const overflow = estimateSpeechOverflow(shot.dialogue, shot.durationSeconds);
                        const firstMedia = mediaByKey[`shot-first:${shot.ref}`];
                        const prevShot = shot.index > 0 ? shots[shot.index - 1] : undefined;
                        const prevVideoMedia = prevShot ? mediaByKey[`shot-video:${prevShot.ref}`] : undefined;
                        const inheritedFirstMedia = prevShot ? mediaByKey[`shot-last:${prevShot.ref}`] : undefined;
                        const videoMedia = mediaByKey[`shot-video:${shot.ref}`];
                        const hasAnyMedia = Boolean(
                            firstMedia?.url || inheritedFirstMedia?.url || videoMedia?.url
                            || firstMedia?.status === "pending" || firstMedia?.status === "running"
                            || videoMedia?.status === "pending" || videoMedia?.status === "running"
                            || prevVideoMedia?.status === "success",
                        );
                        const mediaOpen = expandedMedia[shot.ref] ?? hasAnyMedia;
                        const videoQuote = shotVideoCreditsByRef[shot.ref];
                        const videoCredits = videoQuote?.credits || "";
                        const shotCreditTooltip = [
                            videoCredits
                                ? `视频：${videoCredits} 积分（${shot.durationSeconds} 秒）`
                                : videoQuote?.reason
                                    ? `视频：${videoQuote.reason}`
                                    : "视频：未定价",
                            shot.index === 0
                                ? (imageUnitCredits ? `自定义首帧：${imageUnitCredits} 积分/张` : "自定义首帧：未定价")
                                : null,
                        ].filter(Boolean).join("；");
                        const directorNotes = [shot.rhythm, shot.size, shot.camera, shot.characterRef, shot.locationRef].filter(Boolean).join(" · ");

                        return (
                            <article
                                key={shot.id || shot.ref}
                                ref={(node) => { cardRefs.current[shot.ref] = node; }}
                                draggable={editable}
                                onDragStart={() => setDragIndex(shot.index)}
                                onDragOver={(event) => {
                                    if (!editable || dragIndex === null) return;
                                    event.preventDefault();
                                    if (overIndex !== shot.index) setOverIndex(shot.index);
                                }}
                                onDrop={(event) => {
                                    event.preventDefault();
                                    if (editable && dragIndex !== null && dragIndex !== shot.index) {
                                        onReorderShots(dragIndex, shot.index);
                                    }
                                    setDragIndex(null);
                                    setOverIndex(null);
                                }}
                                onDragEnd={() => {
                                    setDragIndex(null);
                                    setOverIndex(null);
                                }}
                                onClick={() => onSelectShot(shot.ref)}
                                style={
                                    active
                                        ? {
                                            borderColor: "var(--studio-action)",
                                            boxShadow: "0 0 0 1px var(--studio-action)",
                                        }
                                        : undefined
                                }
                                className={`overflow-hidden rounded-lg border transition-all ${
                                    overIndex === shot.index && dragIndex !== null && dragIndex !== shot.index
                                        ? "border-[var(--studio-action)] bg-[var(--studio-surface-raised)]"
                                        : active
                                            ? "bg-[var(--studio-surface)]"
                                            : "border-[var(--studio-line)] bg-[var(--studio-surface)] hover:border-[var(--studio-line-strong)]"
                                }`}
                            >
                                <div
                                    style={
                                        active
                                            ? { background: "color-mix(in srgb, var(--studio-action) 10%, var(--studio-surface))" }
                                            : undefined
                                    }
                                    className="flex flex-wrap items-center gap-2 border-b border-[var(--studio-line)] px-3.5 py-2.5 transition-colors"
                                >
                                    <span
                                        className={`inline-flex items-center text-[var(--studio-faint)] ${editable ? "cursor-grab active:cursor-grabbing" : "opacity-40"}`}
                                        aria-hidden="true"
                                    >
                                        <GripVertical className="size-3.5" />
                                    </span>
                                    <span
                                        style={active ? { color: "var(--studio-action)" } : undefined}
                                        className={`text-xs font-semibold tabular-nums ${active ? "" : "text-[var(--studio-muted)]"}`}
                                    >
                                        {formatShotNumber(shot.index)}
                                    </span>
                                    <input
                                        type="text"
                                        value={shot.title}
                                        disabled={!editable}
                                        maxLength={120}
                                        placeholder={shot.size || `${translate("drama.tabShots")} ${formatShotNumber(shot.index)}`}
                                        onChange={(event) => onUpdateShot(shot.ref, { title: event.target.value })}
                                        className="min-w-28 flex-1 rounded bg-transparent px-1.5 py-0.5 text-sm font-semibold text-[var(--studio-ink)] outline-none placeholder:font-normal placeholder:text-[var(--studio-faint)] hover:bg-[var(--studio-surface-hover)] focus:bg-[var(--studio-surface-raised)] disabled:opacity-80"
                                    />
                                    <span className="rounded bg-[var(--studio-surface-raised)] px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-[var(--studio-muted)]">
                                        {shot.ref}
                                    </span>
                                    <Tooltip title={shotCreditTooltip}>
                                        <span className="inline-flex items-center gap-1 rounded bg-[var(--studio-surface-raised)] px-2 py-0.5 text-[11px] font-medium tabular-nums text-[var(--studio-action)]">
                                            <Coins className="size-3 shrink-0" aria-hidden="true" />
                                            {videoCredits
                                                ? (shot.index === 0 && imageUnitCredits
                                                    ? `视频 ${videoCredits} / 首帧 ${imageUnitCredits} 积分`
                                                    : `${videoCredits} 积分`)
                                                : (shot.index === 0 && imageUnitCredits ? `首帧 ${imageUnitCredits} 积分` : "未定价")}
                                        </span>
                                    </Tooltip>
                                    <span className="text-xs tabular-nums text-[var(--studio-faint)]">
                                        {formatTimecode(shot.startSec)}–{formatTimecode(shot.endSec)}
                                    </span>
                                    <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
                                        <InputNumber
                                            size="small"
                                            className="w-16!"
                                            min={1}
                                            max={60}
                                            value={shot.durationSeconds}
                                            disabled={!editable}
                                            onChange={(value) => {
                                                if (typeof value === "number" && value >= 1 && value <= 60) {
                                                    onUpdateShot(shot.ref, { durationSeconds: Math.round(value) });
                                                }
                                            }}
                                        />
                                        <span className="text-xs text-[var(--studio-muted)]">{translate("drama.secondUnit")}</span>
                                    </div>
                                    <button
                                        type="button"
                                        aria-label={translate("drama.mediaPanelToggle")}
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            setExpandedMedia((prev) => ({ ...prev, [shot.ref]: !mediaOpen }));
                                        }}
                                        className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px]! text-[var(--studio-muted)]! hover:bg-[var(--studio-surface-hover)] hover:text-[var(--studio-ink)]!"
                                    >
                                        {mediaOpen ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                                    </button>
                                    {editable ? (
                                        <button
                                            type="button"
                                            aria-label={translate("drama.delete")}
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                requestDelete(shot);
                                            }}
                                            className="inline-flex size-6 items-center justify-center rounded text-[var(--studio-faint)]! hover:bg-[var(--studio-surface-hover)] hover:text-[var(--studio-danger)]!"
                                        >
                                            <X className="size-3.5" />
                                        </button>
                                    ) : null}
                                </div>

                                {directorNotes || overflow ? (
                                    <div className="flex flex-col gap-1 border-b border-[var(--studio-line)] px-4 py-2 text-xs">
                                        {directorNotes ? (
                                            <div className="flex items-start justify-between gap-2">
                                                <p className="min-w-0 flex-1 leading-5 text-[var(--studio-muted)]">
                                                    <span className="text-[var(--studio-faint)]">{translate("drama.rhythmLabel")}：</span>
                                                    {directorNotes}
                                                </p>
                                                <Tooltip title="放大查看与编辑">
                                                    <button
                                                        type="button"
                                                        aria-label="放大查看节奏提示"
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            setExpandedText({
                                                                shotRef: shot.ref,
                                                                field: "rhythm",
                                                                label: translate("drama.rhythmLabel"),
                                                                placeholder: "输入本镜节奏与承接提示",
                                                            });
                                                        }}
                                                        className="inline-flex size-5 shrink-0 items-center justify-center rounded text-[var(--studio-faint)]! hover:bg-[var(--studio-surface-hover)] hover:text-[var(--studio-ink)]!"
                                                    >
                                                        <Maximize2 className="size-3" />
                                                    </button>
                                                </Tooltip>
                                            </div>
                                        ) : null}
                                        {overflow ? (
                                            <p className="inline-flex items-center gap-1.5 font-medium text-[var(--studio-warning)]">
                                                <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
                                                {translate("drama.speechOverflowWarning", { need: overflow.estimatedSeconds, over: overflow.overflowSeconds })}
                                            </p>
                                        ) : null}
                                    </div>
                                ) : null}

                                <div className="grid grid-cols-1 gap-3 p-3.5 md:grid-cols-3">
                                    <div className="flex flex-col rounded-md border border-[var(--studio-line)] bg-[var(--studio-surface-raised)] p-2.5 focus-within:border-[var(--studio-action)]">
                                        <div className="mb-1.5 flex items-center justify-between gap-2">
                                            <span className="text-[11px] font-medium text-[var(--studio-faint)]">{translate("drama.picture")}</span>
                                            <div className="flex items-center gap-1">
                                                <Tooltip title="放大查看与编辑">
                                                    <button
                                                        type="button"
                                                        aria-label="放大画面描述"
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            setExpandedText({
                                                                shotRef: shot.ref,
                                                                field: "picture",
                                                                label: translate("drama.picture"),
                                                                placeholder: translate("drama.picturePlaceholder"),
                                                            });
                                                        }}
                                                        className="inline-flex size-5 items-center justify-center rounded text-[var(--studio-faint)]! hover:bg-[var(--studio-surface-hover)] hover:text-[var(--studio-ink)]!"
                                                    >
                                                        <Maximize2 className="size-3" />
                                                    </button>
                                                </Tooltip>
                                                <Tooltip title={translate("drama.mentionShotInChat")}>
                                                    <button
                                                        type="button"
                                                        aria-label={translate("drama.mentionShotInChat")}
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            onMentionShot(shot);
                                                        }}
                                                        className="inline-flex size-5 items-center justify-center rounded text-[var(--studio-faint)]! hover:bg-[var(--studio-surface-hover)] hover:text-[var(--studio-action)]!"
                                                    >
                                                        <AtSign className="size-3" />
                                                    </button>
                                                </Tooltip>
                                            </div>
                                        </div>
                                        <textarea
                                            rows={3}
                                            value={shot.picture}
                                            disabled={!editable}
                                            placeholder={translate("drama.picturePlaceholder")}
                                            onChange={(event) => onUpdateShot(shot.ref, { picture: event.target.value })}
                                            className="w-full resize-none bg-transparent text-xs leading-5 text-[var(--studio-ink)] outline-none placeholder:text-[var(--studio-faint)] disabled:opacity-80"
                                        />
                                    </div>

                                    <div className="flex flex-col rounded-md border border-[var(--studio-line)] bg-[var(--studio-surface-raised)] p-2.5 focus-within:border-[var(--studio-action)]">
                                        <div className="mb-1.5 flex items-center justify-between gap-2">
                                            <span className="text-[11px] font-medium text-[var(--studio-faint)]">{translate("drama.dialogue")}</span>
                                            <Tooltip title="放大查看与编辑">
                                                <button
                                                    type="button"
                                                    aria-label="放大对白"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        setExpandedText({
                                                            shotRef: shot.ref,
                                                            field: "dialogue",
                                                            label: translate("drama.dialogue"),
                                                            placeholder: translate("drama.dialoguePlaceholder"),
                                                        });
                                                    }}
                                                    className="inline-flex size-5 items-center justify-center rounded text-[var(--studio-faint)]! hover:bg-[var(--studio-surface-hover)] hover:text-[var(--studio-ink)]!"
                                                >
                                                    <Maximize2 className="size-3" />
                                                </button>
                                            </Tooltip>
                                        </div>
                                        <textarea
                                            rows={3}
                                            value={shot.dialogue}
                                            disabled={!editable}
                                            placeholder={translate("drama.dialoguePlaceholder")}
                                            onChange={(event) => onUpdateShot(shot.ref, { dialogue: event.target.value })}
                                            className="w-full resize-none bg-transparent text-xs leading-5 text-[var(--studio-ink)] outline-none placeholder:text-[var(--studio-faint)] disabled:opacity-80"
                                        />
                                    </div>

                                    <div className="flex flex-col rounded-md border border-[var(--studio-line)] bg-[var(--studio-surface-raised)] p-2.5 focus-within:border-[var(--studio-action)]">
                                        <div className="mb-1.5 flex items-center justify-between gap-2">
                                            <span className="text-[11px] font-medium text-[var(--studio-faint)]">{translate("drama.videoPrompt")}</span>
                                            <Tooltip title="放大查看与编辑">
                                                <button
                                                    type="button"
                                                    aria-label="放大视频提示词"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        setExpandedText({
                                                            shotRef: shot.ref,
                                                            field: "videoPrompt",
                                                            label: translate("drama.videoPrompt"),
                                                            placeholder: translate("drama.videoPromptPlaceholder"),
                                                        });
                                                    }}
                                                    className="inline-flex size-5 items-center justify-center rounded text-[var(--studio-faint)]! hover:bg-[var(--studio-surface-hover)] hover:text-[var(--studio-ink)]!"
                                                >
                                                    <Maximize2 className="size-3" />
                                                </button>
                                            </Tooltip>
                                        </div>
                                        <textarea
                                            rows={3}
                                            value={shot.videoPrompt}
                                            disabled={!editable}
                                            placeholder={translate("drama.videoPromptPlaceholder")}
                                            onChange={(event) => onUpdateShot(shot.ref, { videoPrompt: event.target.value })}
                                            className="w-full resize-none bg-transparent text-xs leading-5 text-[var(--studio-ink)] outline-none placeholder:text-[var(--studio-faint)] disabled:opacity-80"
                                        />
                                    </div>
                                </div>

                                {mediaOpen ? (
                                    <div className="flex flex-wrap items-center gap-2.5 border-t border-[var(--studio-line)] bg-[var(--studio-page)]/40 px-3.5 py-2.5">
                                        <div className="min-w-[220px] flex-1">
                                            <InlineMediaSlot
                                                label={translate("drama.generateVideo")}
                                                kind="video"
                                                targetKey={`shot-video:${shot.ref}`}
                                                media={videoMedia}
                                                pending={pendingKeys.includes(`shot-video:${shot.ref}`)}
                                                stoppingTaskId={stoppingTaskId}
                                                creditsText={videoCredits}
                                                creditsReason={videoQuote?.reason}
                                                helperText={
                                                    shot.index > 0 && mediaByKey[`shot-last:${shots[shot.index - 1]?.ref}`]?.status !== "success"
                                                        ? `等待上一镜（${shots[shot.index - 1]?.ref}）视频完成后自动截取尾帧`
                                                        : shot.index === 0
                                                            ? "结合角色+场景直接生成（可选自定义首帧）"
                                                            : "自动衔接上一镜尾帧 + 角色/场景"
                                                }
                                                onGenerate={onGenerateMedia}
                                                onStop={onStopMedia}
                                                onRequeried={onRequeried}
                                                onPreview={(item) => setDetail(item)}
                                            />
                                        </div>

                                        {shot.index === 0 ? (
                                            <div className="min-w-[200px] flex-1">
                                                <InlineMediaSlot
                                                    label="自定义首帧（可选）"
                                                    kind="image"
                                                    targetKey={`shot-first:${shot.ref}`}
                                                    media={firstMedia}
                                                    pending={pendingKeys.includes(`shot-first:${shot.ref}`)}
                                                    stoppingTaskId={stoppingTaskId}
                                                    creditsText={imageUnitCredits}
                                                    helperText="默认不需要，按需输入提示词生成"
                                                    onGenerate={() => setCustomFirstFrame({
                                                        shotRef: shot.ref,
                                                        shotLabel: `${formatShotNumber(shot.index)} 镜`,
                                                        prompt: shot.picture,
                                                    })}
                                                    onStop={onStopMedia}
                                                    onRequeried={onRequeried}
                                                    onPreview={(item) => setDetail(item)}
                                                />
                                            </div>
                                        ) : prevShot ? (
                                            (() => {
                                                const hasCustomFirst = firstMedia?.status === "success" || firstMedia?.status === "pending" || firstMedia?.status === "running";
                                                const displayedFirst = hasCustomFirst ? firstMedia : inheritedFirstMedia;
                                                const extracting = extractingShotRef === prevShot.ref;
                                                const customPending = pendingKeys.includes(`shot-first:${shot.ref}`);
                                                const prevVideoReady = prevVideoMedia?.status === "success";
                                                return (
                                                    <div className="min-w-[220px] flex-1">
                                                        <InlineMediaSlot
                                                            label={hasCustomFirst ? "首帧（自定义生成）" : `首帧（承接自 ${formatShotNumber(prevShot.index)} 镜尾帧）`}
                                                            kind="image"
                                                            targetKey={hasCustomFirst ? `shot-first:${shot.ref}` : `shot-last:${prevShot.ref}`}
                                                            media={displayedFirst}
                                                            pending={extracting || customPending}
                                                            stoppingTaskId={stoppingTaskId}
                                                            creditsText={imageUnitCredits}
                                                            helperText={
                                                                extracting
                                                                    ? `正在从 ${formatShotNumber(prevShot.index)} 镜视频重新截取尾帧…`
                                                                    : hasCustomFirst
                                                                        ? "已使用自定义首帧，生成本镜视频时优先传入"
                                                                        : inheritedFirstMedia?.status === "success"
                                                                            ? `已从 ${formatShotNumber(prevShot.index)} 镜视频截取，生成本镜视频时自动传入`
                                                                            : prevVideoReady
                                                                                ? `可点「重新截取」从 ${formatShotNumber(prevShot.index)} 镜视频截尾帧，或自定义生成`
                                                                                : `生成 ${formatShotNumber(prevShot.index)} 镜视频后可自动截取，也可直接自定义生成`
                                                            }
                                                            extraActions={
                                                                <>
                                                                    <button
                                                                        type="button"
                                                                        disabled={!prevVideoReady || extracting}
                                                                        onClick={(event) => {
                                                                            event.stopPropagation();
                                                                            onExtractLastFrame(prevShot.ref);
                                                                        }}
                                                                        className="text-[11px]! font-medium text-[var(--studio-action)]! hover:underline disabled:cursor-not-allowed disabled:opacity-45"
                                                                    >
                                                                        {extracting ? "截取中…" : "重新截取"}
                                                                    </button>
                                                                    <span className="text-[10px] text-[var(--studio-line-strong)]" aria-hidden="true">|</span>
                                                                    <button
                                                                        type="button"
                                                                        disabled={customPending}
                                                                        onClick={(event) => {
                                                                            event.stopPropagation();
                                                                            setCustomFirstFrame({
                                                                                shotRef: shot.ref,
                                                                                shotLabel: `${formatShotNumber(shot.index)} 镜`,
                                                                                prompt: shot.picture,
                                                                            });
                                                                        }}
                                                                        className="text-[11px]! font-medium text-[var(--studio-text)]! hover:text-[var(--studio-ink)]! hover:underline disabled:opacity-45"
                                                                    >
                                                                        自定义生成
                                                                    </button>
                                                                </>
                                                            }
                                                            onGenerate={() => setCustomFirstFrame({
                                                                shotRef: shot.ref,
                                                                shotLabel: `${formatShotNumber(shot.index)} 镜`,
                                                                prompt: shot.picture,
                                                            })}
                                                            onStop={onStopMedia}
                                                            onRequeried={onRequeried}
                                                            onPreview={(item) => setDetail(item)}
                                                        />
                                                    </div>
                                                );
                                            })()
                                        ) : null}
                                    </div>
                                ) : null}
                            </article>
                        );
                    })}
                </div>
            </div>
            <Modal
                open={Boolean(expandedText && expandedShot)}
                title={expandedText && expandedShot
                    ? `${formatShotNumber(expandedShot.index)} ${expandedShot.title || expandedShot.ref} · ${expandedText.label}`
                    : ""}
                width={680}
                mask={{ closable: true }}
                onCancel={() => setExpandedText(null)}
                footer={[
                    <Button
                        key="copy"
                        icon={<Copy className="size-3.5" />}
                        onClick={() => copy(expandedValue)}
                    >
                        {translate("drama.copy")}
                    </Button>,
                    <Button key="close" type="primary" onClick={() => setExpandedText(null)}>
                        完成
                    </Button>,
                ]}
            >
                <div className="pt-2">
                    <Input.TextArea
                        autoFocus
                        rows={10}
                        value={expandedValue}
                        readOnly={!editable}
                        placeholder={expandedText?.placeholder}
                        onChange={(event) => {
                            if (editable && expandedText) {
                                onUpdateShot(expandedText.shotRef, { [expandedText.field]: event.target.value });
                            }
                        }}
                    />
                    <div className="mt-2 flex items-center justify-between text-xs text-[var(--studio-faint)]">
                        <span>{editable ? "修改内容会自动保存" : "当前为只读预览"}</span>
                        <span className="tabular-nums">{expandedValue.length} 字</span>
                    </div>
                </div>
            </Modal>
            <Modal
                open={Boolean(customFirstFrame)}
                title={customFirstFrame ? `自定义 ${customFirstFrame.shotLabel} 首帧提示词` : "自定义首帧提示词"}
                width={560}
                mask={{ closable: true }}
                okText={imageUnitCredits ? `生成首帧图（${imageUnitCredits} 积分）` : "生成首帧图"}
                cancelText={translate("drama.cancel")}
                okButtonProps={{ disabled: !customFirstFrame?.prompt.trim() }}
                onCancel={() => setCustomFirstFrame(null)}
                onOk={() => {
                    if (!customFirstFrame || !customFirstFrame.prompt.trim()) return;
                    onGenerateMedia(`shot-first:${customFirstFrame.shotRef}`, customFirstFrame.prompt.trim());
                    setCustomFirstFrame(null);
                }}
            >
                <div className="pt-2">
                    <label className="block text-xs font-medium text-[var(--studio-ink)]">首帧画面提示词</label>
                    <Input.TextArea
                        className="mt-2"
                        autoFocus
                        rows={6}
                        maxLength={4000}
                        value={customFirstFrame?.prompt || ""}
                        placeholder="请单独描述第一镜首帧的构图、主体动作、光线和环境"
                        onChange={(event) => setCustomFirstFrame((prev) => (prev ? { ...prev, prompt: event.target.value } : null))}
                    />
                    <p className="mt-2 text-xs text-[var(--studio-faint)]">
                        生成后将自动作为第一镜视频的首帧参考图，并与角色图、场景图一起传入视频模型。
                    </p>
                </div>
            </Modal>
            <ResultDetailDialog detail={detail} onClose={() => setDetail(null)} />
        </div>
    );
}

function InlineMediaSlot({
    label,
    kind,
    targetKey,
    media,
    pending,
    stoppingTaskId,
    readOnly = false,
    creditsText,
    creditsReason,
    helperText,
    extraActions,
    onGenerate,
    onStop,
    onRequeried,
    onPreview,
}: {
    label: string;
    kind: "image" | "video";
    targetKey: string;
    media?: DramaMedia;
    pending: boolean;
    stoppingTaskId: string;
    readOnly?: boolean;
    creditsText?: string;
    creditsReason?: string;
    helperText?: string;
    extraActions?: React.ReactNode;
    onGenerate: (targetKey: string) => void;
    onStop: (media: DramaMedia) => void;
    onRequeried: () => void;
    onPreview: (detail: ResultDetail) => void;
}) {
    const translate = useTranslation();
    const queued = media?.status === "pending" || media?.status === "running";
    const running = pending || queued;
    const ready = media?.status === "success" && Boolean(media.url);
    const failed = media?.status === "failed" || media?.status === "canceled";
    const stopping = Boolean(media?.taskId && media.taskId === stoppingTaskId);
    const fileName = kind === "video" ? "drama-video.mp4" : "drama-image.png";

    return (
        <div className="flex items-center gap-2.5 rounded-md border border-[var(--studio-line)] bg-[var(--studio-surface)] p-2">
            <div className="relative h-12 w-20 shrink-0 overflow-hidden rounded border border-[var(--studio-line)] bg-[var(--studio-page)]">
                {ready ? (
                    <button
                        type="button"
                        className="relative block size-full cursor-zoom-in p-0"
                        onClick={(event) => {
                            event.stopPropagation();
                            onPreview({
                                media: { kind, url: media?.url || "", storageKey: media?.storageKey || undefined },
                                onDownload: () => downloadMedia({ storageKey: media?.storageKey || undefined, url: media?.url || "" }, fileName),
                            });
                        }}
                    >
                        {kind === "image" ? (
                            <SafeThumbImage src={media?.url} alt={label} />
                        ) : (
                            <>
                                <video src={media?.url} muted playsInline preload="metadata" className="pointer-events-none size-full object-cover" />
                                <span className="pointer-events-none absolute inset-0 grid place-items-center bg-black/30 text-white">
                                    <Play className="size-3.5 fill-current" />
                                </span>
                            </>
                        )}
                    </button>
                ) : running ? (
                    <div className="studio-skeleton size-full" aria-hidden="true" />
                ) : (
                    <span className="grid size-full place-items-center text-[var(--studio-faint)]">
                        {kind === "video" ? <Video className="size-3.5" /> : <ImageIcon className="size-3.5" />}
                    </span>
                )}
                {queued && (media?.progress || 0) > 0 ? (
                    <span className="pointer-events-none absolute right-1 top-1 rounded bg-black/65 px-1 text-[10px] tabular-nums text-white">
                        {media?.progress}%
                    </span>
                ) : null}
            </div>
            <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-[11px] font-medium text-[var(--studio-ink)]">{label}</p>
                    {!readOnly ? (
                        creditsText ? (
                            <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-[var(--studio-surface-raised)] px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-[var(--studio-action)]">
                                <Coins className="size-2.5" aria-hidden="true" />
                                {creditsText} 积分
                            </span>
                        ) : creditsReason ? (
                            <Tooltip title={creditsReason}>
                                <span className="shrink-0 rounded bg-[var(--studio-surface-raised)] px-1.5 py-0.5 text-[10px] text-[var(--studio-warning)]">
                                    不可报价
                                </span>
                            </Tooltip>
                        ) : null
                    ) : null}
                </div>
                {failed ? (
                    <p className="mt-0.5 truncate text-[10px] text-[var(--studio-danger)]">{media?.errorMessage || translate("drama.statusFailed")}</p>
                ) : helperText ? (
                    <p className="mt-0.5 truncate text-[10px] text-[var(--studio-faint)]">{helperText}</p>
                ) : null}
                {!readOnly ? (
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                        {queued && media?.taskId ? (
                            <button
                                type="button"
                                disabled={stopping}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    onStop(media);
                                }}
                                className="inline-flex items-center gap-1 text-[11px]! text-[var(--studio-danger)]! hover:underline disabled:opacity-50"
                            >
                                {stopping ? <LoaderCircle className="size-3 animate-spin" /> : <Square className="size-2.5 fill-current" />}
                                {translate("drama.stop")}
                            </button>
                        ) : extraActions ? (
                            extraActions
                        ) : (
                            <button
                                type="button"
                                disabled={running}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    onGenerate(targetKey);
                                }}
                                className="text-[11px]! font-medium text-[var(--studio-action)]! hover:underline disabled:opacity-50"
                            >
                                {running ? translate("drama.mediaRunning") : ready ? translate("drama.regenerate") : label}
                            </button>
                        )}
                        {media?.status === "failed" && media.taskId && !extraActions ? (
                            <RequeryFailedTaskButton taskId={media.taskId} onRestarted={onRequeried} />
                        ) : null}
                    </div>
                ) : null}
            </div>
        </div>
    );
}
