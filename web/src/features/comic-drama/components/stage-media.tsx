"use client";

import type { CreditAmount } from "@/shared/lib/credit-amounts";


import { productionParameterLabel } from "../lib/production-labels";

import { translateMessage } from "@/features/locale/translate";
import { useTranslation } from "@/features/locale/use-translation";

import { useEffect, useMemo, useState } from "react";
import {
    Alert,
    App,
    Button,
    Card,
    Empty,
    Image,
    Input,
    Modal,
    Popconfirm,
    Progress,
    Radio,
    Select,
    Space,
    Tag,
} from "antd";
import {
    AlertCircle,
    Check,
    CheckCircle2,
    Clapperboard,
    Eye,
    Film,
    Image as ImageIcon,
    Play,
    Plus,
    RefreshCw,
    RotateCcw,
    Sparkles,
    Square,
} from "lucide-react";

import { ModelPicker } from "@/features/settings/components/model-picker";
import { useEffectiveConfig } from "@/features/settings/stores/use-config-store";
import { ImageSettingsPanel } from "@/features/generation/components/image-settings-panel";
import { VideoSettingsPanel, sizeFromAspectRatio } from "@/features/generation/components/video-settings-panel";
import { readVideoGenerationConstraintIssue } from "@/features/generation/lib/video-generation-constraints";
import { useThemeStore } from "@/features/theme/stores/use-theme-store";
import { estimateComicDramaGeneration, listComicDramaAssetVersions, readComicDramaMediaUrl } from "@/services/api/comic-drama";
import { cancelAiTask } from "@/services/api/server";
import { canvasThemes } from "@/shared/lib/canvas-theme";
import { useMediaAutoRefresh } from "../hooks/use-media-auto-refresh";
import { useComicDramaStore } from "../stores/use-comic-drama-store";
import type { ComicDramaAssetVersion, ComicDramaMediaResult, ComicDramaShot } from "../types";

/** 媒体生成参数，key 与生成页的 ImageSettingsPanel / VideoSettingsPanel 保持一致。 */
type MediaSettingsState = {
    /** 画面比例；视频面板对通用渠道会映射成像素尺寸，原样透传即可 */
    size: string;
    /** 图片画质 low | medium | high */
    quality: string;
    /** 图片清晰度 1K | 2K | 4K */
    imageResolution: string;
    /** 视频清晰度，如 720p / 1080p */
    vquality: string;
    /** 视频时长（秒） */
    videoSeconds: string;
};

type ImageSettingsKey = "quality" | "imageResolution" | "size" | "count";
type VideoSettingsKey = "videoGenerationMode" | "vquality" | "size" | "videoSeconds" | "videoWatermark";

/** 生成目标类型的中文名，与后端 comic_drama_media_results.target_type 对齐。 */
const getTargetTypeLabels = (translate = translateMessage): Record<string, string> => ({
    shot: translate("comicDrama.storyboardShot"),
    assetVersion: translate("comicDrama.assetImage"),
    voiceTrack: translate("comicDrama.audioTrack"),
    project: translate("comicDrama.project"),
});

/** 媒体生成状态的中文名。 */
const getMediaStatusLabels = (translate = translateMessage): Record<string, string> => ({
    quoted: translate("comicDrama.quoted"),
    queued: translate("comicDrama.queued_4dcbbc"),
    processing: translate("comicDrama.generating"),
    completed: translate("comicDrama.complete"),
    failed: translate("comicDrama.failed_3e3c80"),
    needsUpdate: translate("comicDrama.needsUpdate_d2b913"),
});

/** 是否由用户主动停止：后端把 canceled 归一成 failed，只能靠失败原因区分。 */
function isStoppedMedia(media: ComicDramaMediaResult): boolean {
    return media.status === "failed" && media.failureReason === "任务已取消";
}

/** 生成目标的可读名称：镜头用镜号，资产图用「资产名-版本名」，其余用类型名。 */
function mediaTargetLabel(media: ComicDramaMediaResult, shots: ComicDramaShot[], versionLabels: Record<string, string>, translate = translateMessage): string {
    if (media.targetType === "shot") {
        const shot = shots.find((item) => item.id === media.targetId);
        return shot ? translate("comicDrama.shotCount", { value0: shot.shotNumber }) : getTargetTypeLabels(translate).shot;
    }
    if (media.targetType === "assetVersion") {
        const versionLabel = versionLabels[media.targetId];
        return versionLabel ? translate("comicDrama.assetImageCount", { value0: versionLabel }) : getTargetTypeLabels(translate).assetVersion;
    }
    return getTargetTypeLabels(translate)[media.targetType] || media.targetType;
}

/** 媒体生成中心阶段视图。 */
export function StageMedia() {
    const translate = useTranslation();
    const { message } = App.useApp();
    const config = useEffectiveConfig();
    const workspace = useComicDramaStore((state) => state.workspace);
    const createGenerationTask = useComicDramaStore((state) => state.createGenerationTask);
    const adoptMedia = useComicDramaStore((state) => state.adoptMedia);
    const selectedShotId = useComicDramaStore((state) => state.selectedShotId);
    const pendingGeneration = useComicDramaStore((state) => state.pendingGeneration);
    const clearPendingGeneration = useComicDramaStore((state) => state.clearPendingGeneration);

    // Filters
    const [mediaTypeFilter, setMediaTypeFilter] = useState<string>("all");
    const [statusFilter, setStatusFilter] = useState<string>("all");
    const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(null);

    // Generation Modal
    const [genModalOpen, setGenModalOpen] = useState(false);
    const [targetType, setTargetType] = useState<string>("shot");
    const [targetShotId, setTargetShotId] = useState<string>("");
    const [mediaType, setMediaType] = useState<"image" | "video">("image");
    const [model, setModel] = useState<string>("");
    const [mediaSettings, setMediaSettings] = useState<MediaSettingsState>(() => ({
        size: config.size || "16:9",
        quality: config.quality || "medium",
        imageResolution: config.imageResolution || "2K",
        vquality: config.vquality || "720p",
        videoSeconds: config.videoSeconds || "5",
    }));
    const [estimating, setEstimating] = useState(false);
    const [generating, setGenerating] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [estimatedCredits, setEstimatedCredits] = useState<CreditAmount | null>(null);
    const [cancelingMediaId, setCancelingMediaId] = useState<string | null>(null);
    const [versionsByAsset, setVersionsByAsset] = useState<Record<string, ComicDramaAssetVersion[]>>({});

    const assets = useMemo(() => workspace?.assets || [], [workspace]);
    const projectId = workspace?.projectId;
    const shots = workspace?.shots || [];
    const mediaList = workspace?.media || [];

    /**
     * 生成弹窗的画幅取值：视频按项目画面方向换算成当前模型接受的 size，图片沿用项目画幅比例。
     *
     * @param type 当前媒体类型
     * @param videoModel 当前选中的视频模型
     * @returns 该媒体类型下的 size 取值
     */
    const sizeForMediaType = (type: string, videoModel: string) => (type === "video"
        ? sizeFromAspectRatio({ ...config, videoModel: videoModel || config.videoModel }, workspace?.settings.aspectRatio)
        : workspace?.settings.aspectRatio || config.size || "16:9");

    // 有任务在跑时自动轮询媒体状态
    const { autoRefreshing, runningCount: runningMediaCount, lastSyncedAt, syncNow } = useMediaAutoRefresh(mediaList);

    // 资产图记录要显示「资产名-版本名」，按资产拉一次版本列表供标签解析
    useEffect(() => {
        if (!projectId) return;
        let cancelled = false;
        Promise.all(assets.map(async (asset) => [asset.id, await listComicDramaAssetVersions(projectId, asset.id)] as const))
            .then((entries) => {
                if (!cancelled) setVersionsByAsset(Object.fromEntries(entries));
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [projectId, assets]);

    const versionLabels = useMemo(() => {
        const labels: Record<string, string> = {};
        for (const asset of assets) {
            for (const version of versionsByAsset[asset.id] || []) {
                labels[version.id] = `${asset.name}-${version.versionName}`;
            }
        }
        return labels;
    }, [assets, versionsByAsset]);

    const filteredMedia = useMemo(() => {
        return mediaList.filter((m) => {
            if (mediaTypeFilter !== "all" && m.mediaType !== mediaTypeFilter) return false;
            if (statusFilter === "adopted" && !m.adopted) return false;
            if (statusFilter !== "all" && statusFilter !== "adopted" && m.status !== statusFilter) return false;
            return true;
        });
    }, [mediaList, mediaTypeFilter, statusFilter]);

    // 生成设置用与「图片生成」「视频生成」页同一套面板，主题沿用它们传画布主题的既有做法
    const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
    const settingsTheme = canvasThemes[resolvedTheme];

    // Open creation modal
    const openGenModal = (defaultShotId?: string, defaultMediaType: "image" | "video" = "image") => {
        setTargetType("shot");
        setTargetShotId(defaultShotId || selectedShotId || shots[0]?.id || "");
        setMediaType(defaultMediaType);
        setModel(defaultMediaType === "video" ? config.videoModel || "" : config.imageModel || "");
        // 每次打开都回到项目画幅与全局配置默认值
        setMediaSettings({
            size: sizeForMediaType(defaultMediaType, config.videoModel || ""),
            quality: config.quality || "medium",
            imageResolution: config.imageResolution || "2K",
            vquality: config.vquality || "720p",
            videoSeconds: config.videoSeconds || "5",
        });
        setEstimatedCredits(null);
        setGenModalOpen(true);
    };

    // 从镜头清单点「生成」跳过来时，直接按该镜头与指定媒体类型打开生成弹窗
    useEffect(() => {
        if (!workspace || !pendingGeneration) return;
        clearPendingGeneration();
        openGenModal(pendingGeneration.shotId, pendingGeneration.mediaType);
        // 只在信号出现时执行一次；openGenModal 每次渲染都会重建，不进依赖
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pendingGeneration, workspace, clearPendingGeneration]);

    if (!workspace) return null;

    const currentTargetShot = useMemo(
        () => shots.find((s) => s.id === targetShotId),
        [shots, targetShotId]
    );

    // 镜头已有分镜图（优先采用，其次已完成）
    const shotStoryboardImage = useMemo(() => {
        if (!targetShotId) return null;
        const adopted = mediaList.find(
            (m) => m.targetId === targetShotId && m.mediaType === "image" && m.status === "completed" && m.adopted
        );
        if (adopted) {
            const url = readComicDramaMediaUrl(adopted.resultData);
            if (url) return { name: translate("comicDrama.storyboardImageAdopted"), url };
        }
        const completed = mediaList.find(
            (m) => m.targetId === targetShotId && m.mediaType === "image" && m.status === "completed"
        );
        if (completed) {
            const url = readComicDramaMediaUrl(completed.resultData);
            if (url) return { name: translate("comicDrama.storyboardImage_874e0f"), url };
        }
        return null;
    }, [mediaList, targetShotId, translate.locale]);

    // 镜头关联资产版本的已完成图片
    const shotAssetImages = useMemo(() => {
        if (!currentTargetShot || !currentTargetShot.assetVersionIds?.length) return [];
        const list: { id: string; name: string; url: string }[] = [];
        for (const vId of currentTargetShot.assetVersionIds) {
            const media = mediaList.find(
                (m) => m.targetType === "assetVersion" && m.targetId === vId && m.mediaType === "image" && m.status === "completed"
            );
            if (media) {
                const url = readComicDramaMediaUrl(media.resultData);
                if (url) {
                    const label = versionLabels[vId] || translate("comicDrama.assetReferenceImage");
                    list.push({ id: vId, name: label, url });
                }
            }
        }
        return list;
    }, [currentTargetShot, mediaList, versionLabels, translate.locale]);

    // 视频模式综合参考列表：分镜图置首，后接关联资产图
    const videoReferences = useMemo(() => {
        const refs: { id: string; name: string; url: string; isStoryboard?: boolean }[] = [];
        if (shotStoryboardImage?.url) {
            refs.push({ id: "storyboard", name: shotStoryboardImage.name, url: shotStoryboardImage.url, isStoryboard: true });
        }
        refs.push(...shotAssetImages);
        return refs;
    }, [shotStoryboardImage, shotAssetImages]);

    const hasVideoReferences = videoReferences.length > 0;
    const constraintIssue = mediaType === "video" ? readVideoGenerationConstraintIssue({ config, model,
        mode: hasVideoReferences ? "image-to-video" : "text-to-video", size: mediaSettings.size,
        seconds: mediaSettings.videoSeconds, imageCount: videoReferences.length }) : "";

    // 与生成页一致：适配器读 size/quality/resolution/seconds。有参考图时自适应为图生视频
    const taskSettings = mediaType === "video"
        ? {
            mediaType,
            size: mediaSettings.size,
            resolution: mediaSettings.vquality,
            seconds: mediaSettings.videoSeconds,
            videoGenerationMode: hasVideoReferences ? "image-to-video" : "text-to-video",
        }
        : {
            mediaType,
            size: mediaSettings.size,
            quality: mediaSettings.quality,
            resolution: mediaSettings.imageResolution,
        };

    const handleImageSettingChange = (key: ImageSettingsKey, value: string) => {
        if (key === "size") setMediaSettings((current) => ({ ...current, size: value }));
        else if (key === "quality") setMediaSettings((current) => ({ ...current, quality: value }));
        else if (key === "imageResolution") setMediaSettings((current) => ({ ...current, imageResolution: value }));
    };

    const handleVideoSettingChange = (key: VideoSettingsKey, value: string) => {
        if (key === "size") setMediaSettings((current) => ({ ...current, size: value }));
        else if (key === "vquality") setMediaSettings((current) => ({ ...current, vquality: value }));
        else if (key === "videoSeconds") setMediaSettings((current) => ({ ...current, videoSeconds: value }));
    };

    // Estimate Credits
    const handleEstimate = async () => {
        if (constraintIssue) { message.warning(constraintIssue); return; }
        if (!targetShotId || !model) {
            message.warning(translate("comicDrama.selectAShotAndGenerationModelFirst"));
            return;
        }
        setEstimating(true);
        try {
            const res = await estimateComicDramaGeneration({
                projectId: workspace.projectId,
                targetType: "shot",
                targetIds: [targetShotId],
                model,
                settings: taskSettings,
            });
            setEstimatedCredits(res.estimatedCredits);
            message.info(translate("comicDrama.estimatedCostPerTaskCountCredits", { value0: res.estimatedCredits }));
        } catch (error) {
            if (error instanceof Error) message.error(error.message);
        } finally {
            setEstimating(false);
        }
    };

    // Create generation task
    const handleCreateTask = async () => {
        if (constraintIssue) { message.warning(constraintIssue); return; }
        if (!targetShotId || !model) {
            message.warning(translate("comicDrama.selectAShotAndGenerationModelFirst"));
            return;
        }
        setGenerating(true);
        try {
            await createGenerationTask({
                targetType: "shot",
                targetIds: [targetShotId],
                model,
                settings: taskSettings,
            });
            message.success(translate("comicDrama.mediaTaskCreatedCheckQueueAndRenderProgressInThe"));
            setGenModalOpen(false);
        } catch (error) {
            if (error instanceof Error) message.error(error.message);
        } finally {
            setGenerating(false);
        }
    };

    // Adopt media version
    const handleAdopt = async (mediaId: string) => {
        try {
            await adoptMedia(mediaId);
            message.success(translate("comicDrama.adoptedAsThisShotSProductionVersion"));
        } catch (error) {
            if (error instanceof Error) message.error(error.message);
        }
    };

    // 停止排队或生成中的任务：取消底层AI任务（服务端会自动退款），再同步一次状态
    const handleCancelMedia = async (media: ComicDramaMediaResult) => {
        if (!media.taskId) return;
        setCancelingMediaId(media.id);
        try {
            await cancelAiTask(media.taskId);
            await syncNow();
            message.success(translate("comicDrama.generationStoppedChargedCreditsWillBeRefundedAutomatically"));
        } catch (error) {
            if (error instanceof Error) message.error(error.message);
        } finally {
            setCancelingMediaId(null);
        }
    };

    // Manual sync task statuses
    const handleSync = async () => {
        setSyncing(true);
        try {
            await syncNow();
            message.success(translate("comicDrama.latestMediaTaskStatusSynced"));
        } catch (error) {
            if (error instanceof Error) message.error(error.message);
        } finally {
            setSyncing(false);
        }
    };

    return (
        <div className="flex flex-col gap-6">
            <header className="flex flex-col gap-2 border-b border-[var(--studio-line)] pb-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="text-xl font-semibold text-[var(--studio-ink)]">{translate("comicDrama.mediaGenerationCenter")}</h2>
                    <p className="mt-1 text-sm text-[var(--studio-muted)]">
                        {translate("comicDrama.generateStoryboardImagesOrShotVideosFromAdoptedPromptsAnd")}</p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                    {autoRefreshing && (
                        <span className="flex items-center gap-1.5 text-xs text-[var(--studio-muted)]">
                            <RefreshCw className="size-3.5 animate-spin" />
                            {translate("comicDrama.autoRefreshing")}{runningMediaCount} {translate("comicDrama.running")}{lastSyncedAt && translate("comicDrama.lastCount", { value0: lastSyncedAt })}
                        </span>
                    )}
                    <Button icon={<RefreshCw className={`size-4 ${syncing ? "animate-spin" : ""}`} />} onClick={handleSync}>
                        {translate("comicDrama.syncStatus")}</Button>
                    <Button type="primary" icon={<Plus className="size-4" />} onClick={() => openGenModal()}>
                        {translate("comicDrama.newGenerationTask")}</Button>
                </div>
            </header>

            {/* Filter toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <Space>
                    <Radio.Group value={mediaTypeFilter} onChange={(e) => setMediaTypeFilter(e.target.value)} buttonStyle="solid">
                        <Radio.Button value="all">{translate("comicDrama.allTypes")}</Radio.Button>
                        <Radio.Button value="image">{translate("comicDrama.image")}</Radio.Button>
                        <Radio.Button value="video">{translate("comicDrama.video")}</Radio.Button>
                    </Radio.Group>

                    <Select
                        className="w-32"
                        value={statusFilter}
                        onChange={setStatusFilter}
                        options={[
                            { value: "all", label: translate("comicDrama.allStatuses") },
                            { value: "adopted", label: translate("comicDrama.adoptedVersion") },
                            { value: "completed", label: translate("comicDrama.completed_e99b48") },
                            { value: "processing", label: translate("comicDrama.processing") },
                            { value: "failed", label: translate("comicDrama.failed_3e3c80") },
                        ]}
                    />
                </Space>

                <div className="text-xs text-[var(--studio-muted)]">
                    {translate("comicDrama.total")}<strong className="text-[var(--studio-ink)]">{filteredMedia.length}</strong> {translate("comicDrama.mediaRecords")}</div>
            </div>

            {/* Media Grid */}
            {filteredMedia.length === 0 ? (
                <Empty description={translate("comicDrama.noMatchingMediaRecords")}>
                    <Button type="primary" icon={<Plus className="size-4" />} onClick={() => openGenModal()}>
                        {translate("comicDrama.createFirstGenerationTask")}</Button>
                </Empty>
            ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {filteredMedia.map((media) => {
                        const mediaUrl = readComicDramaMediaUrl(media.resultData);
                        const isVideo = media.mediaType === "video";
                        const targetShot = shots.find((s) => s.id === media.targetId);

                        return (
                            <div
                                key={media.id}
                                className={`flex flex-col justify-between overflow-hidden rounded-xl border bg-[var(--studio-panel-solid)] p-3 shadow-sm transition-all hover:border-[var(--studio-line-strong)] ${
                                    media.adopted ? "border-emerald-500/50 ring-1 ring-emerald-500/20" : "border-[var(--studio-line)]"
                                }`}
                            >
                                {/* Media Preview Container */}
                                <div className="relative aspect-[9/16] w-full overflow-hidden rounded-lg bg-black/40 sm:aspect-video">
                                    {media.status === "completed" && mediaUrl ? (
                                        isVideo ? (
                                            <div
                                                className="group relative flex h-full w-full cursor-pointer items-center justify-center bg-black"
                                                onClick={() => setPreviewVideoUrl(mediaUrl)}
                                            >
                                                <video src={mediaUrl} className="h-full w-full object-contain" muted playsInline />
                                                <div className="absolute inset-0 flex items-center justify-center bg-black/20 transition-opacity group-hover:bg-black/10">
                                                    <Play className="size-8 text-white drop-shadow" />
                                                </div>
                                            </div>
                                        ) : (
                                            <Image
                                                src={mediaUrl}
                                                alt={translate("comicDrama.generationResult")}
                                                className="h-full w-full object-cover"
                                                classNames={{ root: "h-full w-full" }}
                                            />
                                        )
                                    ) : media.status === "processing" || media.status === "queued" ? (
                                        <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center">
                                            <RefreshCw className="size-6 animate-spin text-[var(--studio-primary)]" />
                                            <span className="text-xs text-[var(--studio-muted)]">
                                                {media.status === "queued" ? translate("comicDrama.queued_a1cef3") : translate("comicDrama.aiRendering")}
                                            </span>
                                        </div>
                                    ) : (
                                        <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 p-4 text-center text-xs text-rose-500">
                                            <AlertCircle className="size-6" />
                                            <span>{isStoppedMedia(media) ? translate("comicDrama.generationStopped") : translate("comicDrama.generationFailed")}</span>
                                            {media.failureReason && (
                                                <span className="line-clamp-2 text-[10px] text-[var(--studio-muted)]">
                                                    {media.failureReason}
                                                </span>
                                            )}
                                        </div>
                                    )}

                                    {/* Overlay Tags */}
                                    <div className="absolute left-2 top-2 flex items-center gap-1">
                                        <Tag color={isVideo ? "purple" : "blue"}>{isVideo ? translate("comicDrama.video") : translate("comicDrama.image")}</Tag>
                                        {media.adopted && <Tag color="success">{translate("comicDrama.adopted")}</Tag>}
                                    </div>
                                </div>

                                {/* Details & Adoption */}
                                <div className="mt-3 flex flex-col gap-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-semibold text-[var(--studio-ink)]">
                                            {mediaTargetLabel(media, shots, versionLabels, translate)}
                                        </span>
                                        <span className="text-[11px] text-[var(--studio-muted)]">
                                            {isStoppedMedia(media) ? translate("comicDrama.stopped") : getMediaStatusLabels(translate)[media.status] || media.status}
                                        </span>
                                    </div>

                                    {/* Adopt button */}
                                    <div className="mt-1 flex items-center justify-between border-t border-[var(--studio-line)] pt-2">
                                        <span className="text-[10px] text-[var(--studio-faint)]">
                                            {new Date(media.createdAt || "").toLocaleTimeString(translate.locale, {
                                                hour: "2-digit",
                                                minute: "2-digit",
                                            })}
                                        </span>

                                        {media.status === "completed" && !media.adopted && (
                                            <Button
                                                size="small"
                                                type="primary"
                                                ghost
                                                icon={<Check className="size-3.5" />}
                                                onClick={() => handleAdopt(media.id)}
                                            >
                                                {translate("comicDrama.adopt")}</Button>
                                        )}

                                        {(media.status === "queued" || media.status === "processing") && media.taskId && (
                                            <Popconfirm
                                                title={translate("comicDrama.stopThisGenerationTask")}
                                                description={translate("comicDrama.chargedCreditsWillBeRefundedAutomatically")}
                                                okText={translate("comicDrama.stop")}
                                                cancelText={translate("comicDrama.cancel")}
                                                onConfirm={() => handleCancelMedia(media)}
                                            >
                                                <Button
                                                    size="small"
                                                    danger
                                                    loading={cancelingMediaId === media.id}
                                                    icon={<Square className="size-3" />}
                                                >
                                                    {translate("comicDrama.stop")}</Button>
                                            </Popconfirm>
                                        )}

                                        {media.status === "failed" && targetShot && (
                                            <Button
                                                size="small"
                                                danger
                                                icon={<RotateCcw className="size-3.5" />}
                                                onClick={() => openGenModal(targetShot.id, isVideo ? "video" : "image")}
                                            >
                                                {translate("comicDrama.retry")}</Button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Creation Modal */}
            <Modal
                title={translate("comicDrama.newMediaGenerationTask")}
                open={genModalOpen}
                onCancel={() => setGenModalOpen(false)}
                footer={null}
                width={560}
            >
                <div className="flex flex-col gap-4 py-2">
                    <div>
                        <label className="text-xs font-medium text-[var(--studio-muted)]">{translate("comicDrama.targetShot")}</label>
                        <Select
                            className="mt-1 w-full"
                            value={targetShotId}
                            onChange={(val) => {
                                setTargetShotId(val);
                                setEstimatedCredits(null);
                            }}
                            options={shots.map((s) => ({
                                value: s.id,
                                label: translate("comicDrama.shotCountCountCount", { value0: s.shotNumber, value1: productionParameterLabel(s.shotSize || "", translate) || translate("comicDrama.shotSizeNotSet_457b65"), value2: s.visualDescription.slice(0, 20) }),
                            }))}
                        />
                    </div>

                    <div>
                        <label className="text-xs font-medium text-[var(--studio-muted)]">{translate("comicDrama.mediaType")}</label>
                        <Select
                            className="mt-1 w-full"
                            value={mediaType}
                            onChange={(val: "image" | "video") => {
                                setMediaType(val);
                                setModel(val === "video" ? config.videoModel || "" : config.imageModel || "");
                                // 视频面板对通用渠道会把比例映射成像素尺寸，这里按项目画面方向换算，避免两个面板的比例表示不一致
                                setMediaSettings((current) => ({ ...current, size: sizeForMediaType(val, config.videoModel || "") }));
                                setEstimatedCredits(null);
                            }}
                            options={[
                                { value: "image", label: translate("comicDrama.imageKeyframeStoryboard") },
                                { value: "video", label: translate("comicDrama.shotVideo_03f8f3") },
                            ]}
                        />
                    </div>

                    <div>
                        <label className="text-xs font-medium text-[var(--studio-muted)]">{translate("comicDrama.generationModel")}</label>
                        <div className="mt-1">
                            <ModelPicker
                                config={config}
                                capability={mediaType === "video" ? "video" : "image"}
                                value={model}
                                onChange={(val) => {
                                    setModel(val);
                                    setEstimatedCredits(null);
                                }}
                                fullWidth
                            />
                        </div>
                    </div>

                    {/* 参考图信息展示 */}
                    {currentTargetShot && (
                        <div className="rounded-xl border border-[var(--studio-line)] bg-[var(--studio-card)]/40 p-3">
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-medium text-[var(--studio-muted)]">
                                    {mediaType === "video"
                                        ? translate("comicDrama.linkedReferenceImagesCount", { value0: videoReferences.length })
                                        : translate("comicDrama.linkedAssetImagesCount", { value0: shotAssetImages.length })}
                                </span>
                                <span className="text-[11px] text-[var(--studio-faint)]">
                                    {mediaType === "video"
                                        ? (hasVideoReferences ? translate("comicDrama.imageToVideoSelectedAutomatically") : translate("comicDrama.noReferenceImageUsingTextToVideo"))
                                        : (shotAssetImages.length > 0 ? translate("comicDrama.usedAutomaticallyAsVisualReferencesDuringGeneration") : translate("comicDrama.noAssetImagesAvailable"))}
                                </span>
                            </div>

                            {(mediaType === "video" ? videoReferences : shotAssetImages).length > 0 ? (
                                <div className="mt-2.5 flex flex-wrap gap-2.5">
                                    {(mediaType === "video" ? videoReferences : shotAssetImages).map((ref) => (
                                        <div key={ref.id} className="group relative flex flex-col items-center">
                                            <div className="relative size-14 overflow-hidden rounded-lg border border-[var(--studio-line)] bg-[var(--studio-bg)] shadow-sm">
                                                <img src={ref.url} alt={ref.name} className="h-full w-full object-cover" />
                                                {"isStoryboard" in ref && ref.isStoryboard === true && (
                                                    <span className="absolute bottom-0 inset-x-0 bg-black/60 text-center text-[9px] text-white">
                                                        {translate("comicDrama.storyboard")}</span>
                                                )}
                                            </div>
                                            <span
                                                className="mt-1 max-w-[64px] truncate text-[10px] text-[var(--studio-muted)]"
                                                title={ref.name}
                                            >
                                                {ref.name}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="mt-1.5 text-xs text-[var(--studio-faint)]">
                                    {mediaType === "video"
                                        ? translate("comicDrama.thisShotHasNoGeneratedStoryboardImagesOrLinkedAsset")
                                        : translate("comicDrama.theAssetsLinkedToThisShotHaveNoCompletedImage")}
                                </p>
                            )}
                        </div>
                    )}

                    {/* 生成参数复用生成页的同一套面板：视频按模型收敛比例/清晰度/时长，图片用画质/清晰度/比例 */}
                    <div className="rounded-xl border border-[var(--studio-line)] p-3">
                        {mediaType === "video" ? (
                            <VideoSettingsPanel
                                config={{
                                    ...config,
                                    // 面板按 config.videoModel 决定为哪个渠道模型展示比例/清晰度/时长，必须传入弹窗里选中的模型
                                    videoModel: model || config.videoModel,
                                    size: mediaSettings.size,
                                    vquality: mediaSettings.vquality,
                                    videoSeconds: mediaSettings.videoSeconds,
                                    videoGenerationMode: hasVideoReferences ? "image-to-video" : "text-to-video",
                                }}
                                onConfigChange={handleVideoSettingChange}
                                theme={settingsTheme}
                                showTitle={false}
                                showGenerationMode={false}
                                className="space-y-4 px-0 py-0"
                            />
                        ) : (
                            <ImageSettingsPanel
                                config={{
                                    ...config,
                                    size: mediaSettings.size,
                                    quality: mediaSettings.quality,
                                    imageResolution: mediaSettings.imageResolution,
                                }}
                                onConfigChange={handleImageSettingChange}
                                theme={settingsTheme}
                                showTitle={false}
                                showCount={false}
                                className="space-y-4 px-0 py-0"
                            />
                        )}
                    </div>

                    {constraintIssue ? <p role="alert" className="text-xs text-[var(--studio-danger)]">{constraintIssue}</p> : null}
                    <div className="mt-2 flex items-center justify-between border-t border-[var(--studio-line)] pt-3">
                        <div className="text-xs text-[var(--studio-muted)]">
                            {estimatedCredits !== null ? (
                                <span>{translate("comicDrama.estimatedCost_657727")}<strong className="text-amber-500">{estimatedCredits}</strong> {translate("comicDrama.credits")}</span>
                            ) : (
                                <Button size="small" loading={estimating} disabled={Boolean(constraintIssue)} onClick={handleEstimate}>
                                    {translate("comicDrama.estimatedCost_d79de0")}</Button>
                            )}
                        </div>

                        <Space>
                            <Button onClick={() => setGenModalOpen(false)}>{translate("comicDrama.cancel")}</Button>
                            <Button
                                type="primary"
                                loading={generating}
                                disabled={Boolean(constraintIssue)}
                                icon={<Sparkles className="size-4" />}
                                onClick={handleCreateTask}
                            >
                                {translate("comicDrama.confirmGeneration")}</Button>
                        </Space>
                    </div>
                </div>
            </Modal>

            {/* Video preview modal */}
            <Modal
                open={Boolean(previewVideoUrl)}
                onCancel={() => setPreviewVideoUrl(null)}
                footer={null}
                width={800}
                destroyOnHidden
            >
                {previewVideoUrl && (
                    <div className="flex aspect-video w-full items-center justify-center bg-black py-4">
                        <video src={previewVideoUrl} controls autoPlay className="h-full w-full object-contain" />
                    </div>
                )}
            </Modal>
        </div>
    );
}
