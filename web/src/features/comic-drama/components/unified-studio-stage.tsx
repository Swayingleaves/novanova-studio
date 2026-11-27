"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Empty, Input, InputNumber, Modal, Select, Spin, Tag } from "antd";
import {
    AlertCircle,
    ArrowDown,
    ArrowUp,
    AtSign,
    ChevronUp,
    Clapperboard,
    Columns2,
    Download,
    Film,
    Image as ImageIcon,
    LayoutGrid,
    List,
    Loader2,
    PanelRightClose,
    PanelRightOpen,
    Pause,
    Play,
    Plus,
    SkipBack,
    SkipForward,
    SlidersHorizontal,
    Sparkles,
    Trash2,
    Video,
} from "lucide-react";

import { useTranslation } from "@/features/locale/use-translation";
import { useResizableRightPanel } from "@/shared/hooks/use-resizable-right-panel";
import { ModelPicker } from "@/features/settings/components/model-picker";
import { useEffectiveConfig } from "@/features/settings/stores/use-config-store";
import {
    exportComicDramaVideo,
    listComicDramaAssetVersions,
    readComicDramaMediaUrl,
    type ComicDramaShotDurationLevel,
} from "@/services/api/comic-drama";
import { useFinalPromptConfirmation } from "../hooks/use-final-prompt-confirmation";
import { useFinalPromptPricing } from "../hooks/use-final-prompt-pricing";
import { useMediaAutoRefresh } from "../hooks/use-media-auto-refresh";
import { usePendingImpactTargets } from "../hooks/use-pending-impact-targets";
import { useComicDramaStore } from "../stores/use-comic-drama-store";
import { useVideoExportSettingsStore } from "../stores/use-video-export-settings-store";
import type {
    ComicDramaAgentActionSuggestion,
    ComicDramaAssetType,
    ComicDramaMediaResult,
    ComicDramaPromptVersion,
    ComicDramaShot,
} from "../types";
import { AssetImageBatchModal } from "./asset-image-batch-modal";
import { ComicDramaAgentPanel } from "./comic-drama-agent-panel";
import { ShotDeleteImpactModal } from "./shot-delete-impact-modal";
import { ShotDraftModal } from "./shot-draft-modal";
import { ShotGenerationModal } from "./shot-generation-modal";
import { StageStoryboard } from "./stage-storyboard";
import { UnifiedShotInspector } from "./unified-shot-inspector";

type MainViewMode = "list" | "grid" | "preview" | "timeline";
type ShotFilter = "all" | "missingVideo" | "failed";
type RightTab = "agent" | "inspector";

function latestShotMedia(media: ComicDramaMediaResult[], shotId: string): ComicDramaMediaResult | undefined {
    const video = media.find((item) => item.targetType === "shot" && item.targetId === shotId && item.mediaType === "video" && item.adopted)
        || media.find((item) => item.targetType === "shot" && item.targetId === shotId && item.mediaType === "video");
    if (video) return video;
    return media.find((item) => item.targetType === "shot" && item.targetId === shotId && item.mediaType === "image" && item.adopted)
        || media.find((item) => item.targetType === "shot" && item.targetId === shotId && item.mediaType === "image");
}

function fmtSeconds(sec: number): string {
    const safe = Math.max(0, sec);
    const mins = Math.floor(safe / 60);
    const rem = (safe - mins * 60).toFixed(1).padStart(4, "0");
    return `${String(mins).padStart(2, "0")}:${rem}`;
}

type UnifiedStudioStageProps = {
    episodeId: string;
    pauseAutoSave: boolean;
    onOpenOneClick: () => void;
    externalFilter?: ShotFilter;
};

/** 漫剧一体化主工作台：合并镜头清单、视觉分镜、成片预览、Nana助手、单镜精调与可折叠多轨精剪。 */
export function UnifiedStudioStage({
    episodeId,
    pauseAutoSave,
    onOpenOneClick,
    externalFilter,
}: UnifiedStudioStageProps) {
    const translate = useTranslation();
    const assistantName = translate("comicDrama.nanaAgent");
    const { message } = App.useApp();
    const config = useEffectiveConfig();
    const pendingImpactTargets = usePendingImpactTargets();
    const videoExportEnabled = useVideoExportSettingsStore((state) => state.enabled);

    const workspace = useComicDramaStore((state) => state.workspace);
    const selectedShotId = useComicDramaStore((state) => state.selectedShotId);
    const setSelectedShotId = useComicDramaStore((state) => state.setSelectedShotId);
    const saveShot = useComicDramaStore((state) => state.saveShot);
    const reorderShots = useComicDramaStore((state) => state.reorderShots);
    const generateShotDraft = useComicDramaStore((state) => state.generateShotDraft);
    const generateFinalVideoPrompt = useComicDramaStore((state) => state.generateFinalVideoPrompt);
    const composePromptsBatch = useComicDramaStore((state) => state.composePromptsBatch);
    const focusAssetVersion = useComicDramaStore((state) => state.focusAssetVersion);
    const setActiveStage = useComicDramaStore((state) => state.setActiveStage);

    const [viewMode, setViewMode] = useState<MainViewMode>("list");
    const [filter, setFilter] = useState<ShotFilter>("all");
    const [rightOpen, setRightOpen] = useState(true);
    const [rightTab, setRightTab] = useState<RightTab>("agent");
    const [splitRightMode, setSplitRightMode] = useState(false);
    const {
        width: rightPanelWidth,
        isResizing: rightPanelResizing,
        minWidth: rightPanelMinWidth,
        maxWidth: rightPanelMaxWidth,
        startResize: startRightPanelResize,
        resizeWithKeyboard: resizeRightPanelWithKeyboard,
        resetWidth: resetRightPanelWidth,
    } = useResizableRightPanel({
        defaultWidth: 380,
        minWidth: 320,
        maxWidth: 720,
        minMainWidth: splitRightMode ? 680 : 360,
        storageKey: "novanova:comic-drama-nana-width",
    });
    const [mentionedShotIds, setMentionedShotIds] = useState<string[]>([]);

    // 弹窗与异步状态
    const [splitModalOpen, setSplitModalOpen] = useState(false);
    const [splitRhythm, setSplitRhythm] = useState("紧凑利落");
    const [splitDuration, setSplitDuration] = useState<ComicDramaShotDurationLevel>("medium");
    const [splitShotCount, setSplitShotCount] = useState<number | null>(null);
    const [splitFocus, setSplitFocus] = useState("");
    const [splitModel, setSplitModel] = useState("");
    const [splitting, setSplitting] = useState(false);

    const [draftReviewOpen, setDraftReviewOpen] = useState(false);
    const [generationShotIds, setGenerationShotIds] = useState<string[]>([]);
    const [deleteTargetShot, setDeleteTargetShot] = useState<ComicDramaShot | null>(null);
    const [assetBatch, setAssetBatch] = useState<{ versionIds: string[]; types: ComicDramaAssetType[] } | null>(null);
    const [loadingAssetBatchId, setLoadingAssetBatchId] = useState<string | null>(null);
    const [composingShotId, setComposingShotId] = useState<string | null>(null);
    const [batchComposing, setBatchComposing] = useState(false);
    const [exporting, setExporting] = useState(false);

    // 连续预览播放状态
    const [previewPlaying, setPreviewPlaying] = useState(false);
    const previewVideoRef = useRef<HTMLVideoElement>(null);

    const promptModel = config.textModel || "";
    const pricingQuery = useFinalPromptPricing(promptModel, Boolean(workspace));
    const confirmFinalPrompt = useFinalPromptConfirmation(workspace?.projectId);

    // 同步多轨精剪模式到 store.activeStage，保证未保存时间轴离开拦截生效
    useEffect(() => {
        setActiveStage(viewMode === "timeline" ? "storyboard" : "shots");
    }, [viewMode, setActiveStage]);

    useEffect(() => {
        if (externalFilter) {
            setFilter(externalFilter);
            if (viewMode === "preview" || viewMode === "timeline") {
                setViewMode("list");
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [externalFilter]);

    // 自动轮询进行中的媒体任务（资产图 + 镜头视频）
    const activeMedia = useMemo(() => workspace?.media || [], [workspace]);
    useMediaAutoRefresh(activeMedia);

    const episodeShots = useMemo(() => {
        const all = workspace?.shots || [];
        return all
            .filter((shot) => !episodeId || episodeId === "all" || shot.sourceEpisodeId === episodeId)
            .sort((a, b) => a.sortOrder - b.sortOrder);
    }, [workspace?.shots, episodeId]);

    // 切换分集或删除镜头后保证选中有效镜头
    useEffect(() => {
        if (episodeShots.length === 0) {
            if (selectedShotId) setSelectedShotId(null);
            return;
        }
        if (!selectedShotId || !episodeShots.some((shot) => shot.id === selectedShotId)) {
            setSelectedShotId(episodeShots[0].id);
        }
    }, [episodeShots, selectedShotId, setSelectedShotId]);

    const adoptedPrompts = useMemo(() => {
        const map = new Map<string, ComicDramaPromptVersion>();
        for (const prompt of workspace?.promptVersions || []) {
            if (prompt.status !== "adopted") continue;
            const existing = map.get(prompt.shotId);
            if (!existing || prompt.versionNumber > existing.versionNumber) {
                map.set(prompt.shotId, prompt);
            }
        }
        return map;
    }, [workspace?.promptVersions]);

    const assetImageByVersionId = useMemo(() => {
        const map = new Map<string, string>();
        for (const media of activeMedia) {
            if (media.targetType !== "assetVersion" || media.mediaType !== "image") continue;
            if (media.status !== "completed" && media.status !== "needsUpdate") continue;
            const url = readComicDramaMediaUrl(media.resultData);
            if (url && !map.has(media.targetId)) map.set(media.targetId, url);
        }
        return map;
    }, [activeMedia]);

    const generatingAssetVersionIds = useMemo(
        () => new Set(activeMedia.filter((m) => m.targetType === "assetVersion" && (m.status === "queued" || m.status === "processing")).map((m) => m.targetId)),
        [activeMedia],
    );

    const shotMediaMap = useMemo(() => {
        const map = new Map<string, ComicDramaMediaResult>();
        for (const shot of episodeShots) {
            const media = latestShotMedia(activeMedia, shot.id);
            if (media) map.set(shot.id, media);
        }
        return map;
    }, [episodeShots, activeMedia]);

    const filteredShots = useMemo(() => {
        if (filter === "missingVideo") {
            return episodeShots.filter((shot) => {
                const m = shotMediaMap.get(shot.id);
                return !(m && m.mediaType === "video" && (m.status === "completed" || m.status === "needsUpdate") && readComicDramaMediaUrl(m.resultData));
            });
        }
        if (filter === "failed") {
            return episodeShots.filter((shot) => shotMediaMap.get(shot.id)?.status === "failed");
        }
        return episodeShots;
    }, [episodeShots, filter, shotMediaMap]);

    const stats = useMemo(() => {
        let missingVideo = 0;
        let failed = 0;
        let missingPrompt = 0;
        for (const shot of episodeShots) {
            const m = shotMediaMap.get(shot.id);
            const hasVideo = Boolean(m && m.mediaType === "video" && (m.status === "completed" || m.status === "needsUpdate") && readComicDramaMediaUrl(m.resultData));
            if (!hasVideo) missingVideo += 1;
            if (m?.status === "failed") failed += 1;
            if (!adoptedPrompts.has(shot.id)) missingPrompt += 1;
        }
        const totalDuration = episodeShots.reduce((acc, s) => acc + Number(s.durationSeconds || 0), 0);
        return { missingVideo, failed, missingPrompt, totalDuration };
    }, [episodeShots, shotMediaMap, adoptedPrompts]);

    if (!workspace) return null;

    const activeShot = episodeShots.find((shot) => shot.id === selectedShotId) || episodeShots[0] || null;
    const activeShotIndex = activeShot ? episodeShots.findIndex((shot) => shot.id === activeShot.id) : -1;
    const pendingDraft = workspace.shotDrafts.find((draft) => draft.status === "pending") || null;

    const openSplitModal = () => {
        setSplitModel(config.textModel || "");
        setSplitModalOpen(true);
    };

    const handleTriggerSplit = async () => {
        if (!splitModel) {
            message.warning("请先选择拆镜头使用的文本模型");
            return;
        }
        setSplitting(true);
        try {
            await generateShotDraft({
                episodeId: episodeId !== "all" ? episodeId : workspace.scriptProject.episodes[0]?.id,
                shotCount: splitShotCount ?? undefined,
                rhythm: splitRhythm,
                focus: splitFocus,
                shotDuration: splitDuration,
                model: splitModel,
            });
            message.success("镜头拆分草稿已生成，请审阅并确认生效");
            setSplitModalOpen(false);
            setDraftReviewOpen(true);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "AI 拆镜头失败");
        } finally {
            setSplitting(false);
        }
    };

    const handleAddManualShot = async () => {
        const nextNumber = workspace.shots.length > 0 ? Math.max(...workspace.shots.map((s) => s.shotNumber)) + 1 : 1;
        try {
            const saved = await saveShot({
                id: `shot_${Date.now()}`,
                sourceEpisodeId: episodeId !== "all" ? episodeId : workspace.scriptProject.episodes[0]?.id,
                sourceSceneId: undefined,
                sourceScriptExcerpt: "",
                shotNumber: nextNumber,
                sortOrder: workspace.shots.length,
                durationSeconds: 5,
                shotSize: "中景",
                composition: "",
                visualDescription: `新建镜头：可在右侧「镜头精调」编辑画面描述或直接让 ${assistantName} 完善。`,
                actionDescription: "",
                cameraMovement: "固定镜头",
                lightingAtmosphere: "",
                dialogueVoiceover: "",
                soundDescription: "",
                styleOverride: "",
                productionStatus: "draft",
                assetVersionIds: [],
                revision: 0,
            });
            setSelectedShotId(saved.id);
            setRightOpen(true);
            if (!splitRightMode) setRightTab("inspector");
            message.success(`已添加镜头 #${saved.shotNumber}`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "添加镜头失败");
        }
    };

    const handleMoveShot = async (index: number, direction: "up" | "down") => {
        const targetIndex = direction === "up" ? index - 1 : index + 1;
        if (targetIndex < 0 || targetIndex >= filteredShots.length) return;
        const moving = filteredShots[index];
        const swapping = filteredShots[targetIndex];
        const allOrdered = [...workspace.shots].sort((a, b) => a.sortOrder - b.sortOrder).map((s) => s.id);
        const posA = allOrdered.indexOf(moving.id);
        const posB = allOrdered.indexOf(swapping.id);
        if (posA < 0 || posB < 0) return;
        allOrdered[posA] = swapping.id;
        allOrdered[posB] = moving.id;
        try {
            await reorderShots(allOrdered);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "调整镜头顺序失败");
        }
    };

    const openAssetBatchForShots = async (shots: ComicDramaShot[], onlyMissing = true) => {
        const targetKey = shots.length === 1 ? shots[0].id : "__episode__";
        setLoadingAssetBatchId(targetKey);
        try {
            const candidateIds = new Set<string>();
            for (const shot of shots) {
                for (const versionId of shot.assetVersionIds) {
                    if (generatingAssetVersionIds.has(versionId)) continue;
                    if (onlyMissing && assetImageByVersionId.has(versionId)) continue;
                    candidateIds.add(versionId);
                }
            }
            if (candidateIds.size === 0) {
                message.info("没有需要补齐的资产图");
                return;
            }
            const typeByVersionId = new Map<string, ComicDramaAssetType>();
            await Promise.all(workspace.assets.map(async (asset) => {
                for (const version of await listComicDramaAssetVersions(workspace.projectId, asset.id)) {
                    if (candidateIds.has(version.id)) typeByVersionId.set(version.id, asset.assetType);
                }
            }));
            const versionIds = [...candidateIds].filter((id) => typeByVersionId.has(id));
            if (versionIds.length === 0) {
                message.info("没有找到可生成的资产版本");
                return;
            }
            setAssetBatch({ versionIds, types: versionIds.map((id) => typeByVersionId.get(id)!) });
        } catch (error) {
            message.error(error instanceof Error ? error.message : "加载资产版本失败");
        } finally {
            setLoadingAssetBatchId(null);
        }
    };

    const handleComposeSinglePrompt = (shot: ComicDramaShot) => {
        if (!promptModel) {
            message.warning("请先在模型设置中选择默认文本模型");
            return;
        }
        if (!pricingQuery.ready) {
            message.warning(pricingQuery.reason || "当前提示词模型价格尚未就绪");
            return;
        }
        confirmFinalPrompt(1, pricingQuery.data!.unitPrice!, async () => {
            setComposingShotId(shot.id);
            try {
                const result = await generateFinalVideoPrompt(workspace.projectId, shot.id, promptModel, pricingQuery.data!.revision);
                message.success(`镜头 #${shot.shotNumber} 最终提示词已生成并采用 (v${result.versionNumber})`);
            } catch (error) {
                message.error(error instanceof Error ? error.message : "生成最终提示词失败");
            } finally {
                setComposingShotId(null);
                void pricingQuery.refetch();
            }
        });
    };

    const handleBatchComposeMissingPrompts = (shotIds?: string[]) => {
        const targets = shotIds && shotIds.length > 0
            ? shotIds
            : episodeShots.filter((shot) => !adoptedPrompts.has(shot.id)).map((shot) => shot.id);
        if (targets.length === 0) {
            message.info("当前分集所有镜头均已具备最终提示词");
            return;
        }
        if (!promptModel || !pricingQuery.ready) {
            message.warning(pricingQuery.reason || "请先配置可用的文本提示词模型");
            return;
        }
        confirmFinalPrompt(targets.length, pricingQuery.data!.unitPrice!, async () => {
            setBatchComposing(true);
            try {
                const res = await composePromptsBatch(workspace.projectId, targets, promptModel, pricingQuery.data!.revision);
                message.success(`已为 ${res.succeededShotIds.length} 个镜头合成并采用最终提示词`);
            } catch (error) {
                message.error(error instanceof Error ? error.message : "批量合成提示词失败");
            } finally {
                setBatchComposing(false);
                void pricingQuery.refetch();
            }
        });
    };

    const handleExportCurrentEpisode = async () => {
        if (!videoExportEnabled) {
            message.info("当前系统未开启视频导出功能");
            return;
        }
        setExporting(true);
        try {
            await exportComicDramaVideo(workspace.projectId, episodeId === "all" ? null : episodeId);
            message.success("本集 MP4 导出任务已创建，可在多轨精剪中查看进度与下载");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "创建导出任务失败");
        } finally {
            setExporting(false);
        }
    };

    const handleMentionShot = (shotId: string) => {
        setSelectedShotId(shotId);
        setRightOpen(true);
        if (!splitRightMode) setRightTab("agent");
        setMentionedShotIds((prev) => (prev.includes(shotId) ? prev : [...prev, shotId]));
    };

    const handleOpenInspectorForShot = (shotId: string) => {
        setSelectedShotId(shotId);
        setRightOpen(true);
        if (!splitRightMode) setRightTab("inspector");
    };

    // 响应 AI 制片助手建议卡片（全部走真实预算确认流程）
    const handleAgentSuggestion = (suggestion: ComicDramaAgentActionSuggestion) => {
        switch (suggestion.actionType) {
            case "oneClickEpisode":
                onOpenOneClick();
                break;
            case "splitEpisode":
                openSplitModal();
                break;
            case "generateAssets": {
                const targets = suggestion.shotIds.length > 0
                    ? episodeShots.filter((s) => suggestion.shotIds.includes(s.id))
                    : episodeShots;
                void openAssetBatchForShots(targets, true);
                break;
            }
            case "composePrompts":
                handleBatchComposeMissingPrompts(suggestion.shotIds);
                break;
            case "generateVideos": {
                const targets = suggestion.shotIds.length > 0
                    ? suggestion.shotIds
                    : episodeShots.filter((shot) => {
                        const m = shotMediaMap.get(shot.id);
                        return !(m && m.mediaType === "video" && (m.status === "completed" || m.status === "needsUpdate") && readComicDramaMediaUrl(m.resultData));
                    }).map((shot) => shot.id);
                setGenerationShotIds(targets.length > 0 ? targets : episodeShots.map((s) => s.id));
                break;
            }
            case "exportVideo":
                void handleExportCurrentEpisode();
                break;
            default:
                break;
        }
    };

    const renderShotStatusTag = (shot: ComicDramaShot, media?: ComicDramaMediaResult) => {
        const pendingUpdate = pendingImpactTargets.has(`shot:${shot.id}`);
        if (media?.status === "processing" || media?.status === "queued") {
            return <Tag color="processing" className="!m-0">渲染中</Tag>;
        }
        if (media?.status === "failed") {
            return <Tag color="error" className="!m-0">视频失败</Tag>;
        }
        if (media && media.mediaType === "video" && (media.status === "completed" || media.status === "needsUpdate") && readComicDramaMediaUrl(media.resultData)) {
            return pendingUpdate
                ? <Tag color="warning" className="!m-0">需更新</Tag>
                : <Tag color="success" className="!m-0">已完成</Tag>;
        }
        return <Tag className="!m-0">待生视频</Tag>;
    };

    const renderShotThumb = (shot: ComicDramaShot, media: ComicDramaMediaResult | undefined, compact: boolean) => {
        const url = media ? readComicDramaMediaUrl(media.resultData) : "";
        const isVid = media?.mediaType === "video" && Boolean(url);
        const boxCls = compact ? "aspect-video w-full" : "aspect-video w-full";

        if (isVid) {
            return (
                <div
                    className={`group relative ${boxCls} cursor-pointer overflow-hidden rounded-lg border border-[var(--studio-line)] bg-black`}
                    onClick={(e) => {
                        e.stopPropagation();
                        setSelectedShotId(shot.id);
                        setViewMode("preview");
                        setPreviewPlaying(true);
                    }}
                >
                    <video
                        src={url.includes("#") ? url : `${url}#t=0.001`}
                        muted
                        playsInline
                        preload="metadata"
                        className="h-full w-full object-cover"
                    />
                    <div className="absolute inset-0 flex items-center justify-center bg-black/25 opacity-0 transition-opacity group-hover:opacity-100">
                        <span className="flex size-8 items-center justify-center rounded-full bg-black/75 text-white">
                            <Play className="size-4" />
                        </span>
                    </div>
                    <span className="absolute left-1.5 top-1.5 rounded bg-black/75 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-white tabular-nums">
                        #{String(shot.shotNumber).padStart(2, "0")}
                    </span>
                    <span className="absolute bottom-1.5 right-1.5 rounded bg-black/75 px-1.5 py-0.5 font-mono text-[11px] text-white tabular-nums">
                        {Number(shot.durationSeconds || 0).toFixed(1)}s
                    </span>
                </div>
            );
        }
        if (media?.status === "queued" || media?.status === "processing") {
            return (
                <div className={`flex ${boxCls} flex-col items-center justify-center gap-1.5 rounded-lg border border-[var(--studio-info)] bg-[var(--studio-surface-raised)] p-2 text-center`}>
                    <Loader2 className="size-4 animate-spin text-[var(--studio-info)]" />
                    <span className="text-xs text-[var(--studio-info)]">视频渲染中</span>
                </div>
            );
        }
        if (media?.status === "failed") {
            return (
                <div className={`flex ${boxCls} flex-col items-center justify-center gap-1.5 rounded-lg border border-[var(--studio-danger)] bg-[var(--studio-surface-raised)] p-2 text-center`}>
                    <AlertCircle className="size-4 text-[var(--studio-danger)]" />
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            setGenerationShotIds([shot.id]);
                        }}
                        className="cursor-pointer rounded border border-[var(--studio-line-strong)] bg-[var(--studio-surface)] px-2 py-0.5 text-xs! text-[var(--studio-ink)]! hover:bg-[var(--studio-surface-hover)]"
                    >
                        重试本镜
                    </button>
                </div>
            );
        }
        return (
            <div className={`flex ${boxCls} flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--studio-line-strong)] bg-[var(--studio-surface-raised)] p-2 text-center`}>
                <Video className="size-4 text-[var(--studio-muted)]" />
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        setGenerationShotIds([shot.id]);
                    }}
                    className="cursor-pointer rounded border border-[var(--studio-line-strong)] bg-[var(--studio-surface)] px-2 py-0.5 text-xs! text-[var(--studio-ink)]! hover:border-[var(--studio-action)]"
                >
                    生成本镜
                </button>
            </div>
        );
    };

    const renderInlineAssets = (shot: ComicDramaShot) => {
        if (!shot.assetVersionIds || shot.assetVersionIds.length === 0) return null;
        const hasMissing = shot.assetVersionIds.some((id) => !assetImageByVersionId.has(id) && !generatingAssetVersionIds.has(id));
        return (
            <div className="flex flex-wrap items-center gap-1.5">
                {shot.assetVersionIds.map((versionId) => {
                    const img = assetImageByVersionId.get(versionId);
                    const loading = generatingAssetVersionIds.has(versionId);
                    return (
                        <button
                            key={versionId}
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                focusAssetVersion(versionId);
                            }}
                            title={img ? "点击查看资产详情" : "缺少资产图，点击前往资产库或右侧一键补齐"}
                            className={`flex size-8 cursor-pointer items-center justify-center overflow-hidden rounded border ${
                                img
                                    ? "border-[var(--studio-line)]"
                                    : "border-dashed border-[var(--studio-warning)] bg-[var(--studio-surface-raised)] text-[var(--studio-warning)]"
                            }`}
                        >
                            {loading ? (
                                <Loader2 className="size-3.5 animate-spin" />
                            ) : img ? (
                                <img src={img} alt="" className="h-full w-full object-cover" />
                            ) : (
                                <ImageIcon className="size-3.5" />
                            )}
                        </button>
                    );
                })}
                {hasMissing ? (
                    <button
                        type="button"
                        disabled={loadingAssetBatchId === shot.id}
                        onClick={(e) => {
                            e.stopPropagation();
                            void openAssetBatchForShots([shot], true);
                        }}
                        className="inline-flex h-8 cursor-pointer items-center gap-1 rounded border border-dashed border-[var(--studio-warning)] px-2 text-xs! text-[var(--studio-warning)]! hover:bg-[var(--studio-surface-hover)]"
                    >
                        {loadingAssetBatchId === shot.id ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
                        <span>补缺图</span>
                    </button>
                ) : null}
            </div>
        );
    };

    const activePreviewMedia = activeShot ? shotMediaMap.get(activeShot.id) : undefined;
    const activePreviewUrl = activePreviewMedia ? readComicDramaMediaUrl(activePreviewMedia.resultData) : "";
    const activePreviewIsVideo = activePreviewMedia?.mediaType === "video" && Boolean(activePreviewUrl);

    const stepPreviewShot = (delta: number) => {
        if (episodeShots.length === 0) return;
        const nextIdx = (Math.max(0, activeShotIndex) + delta + episodeShots.length) % episodeShots.length;
        setSelectedShotId(episodeShots[nextIdx].id);
    };

    return (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex min-h-0 flex-1 overflow-hidden">
                {/* 主工作区：分镜清单 / 故事板网格 / 成片预览 / 多轨精剪 */}
                <section className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--studio-page)]">
                    {viewMode === "timeline" ? (
                        <StageStoryboard
                            pauseAutoSave={pauseAutoSave}
                            externalEpisodeId={episodeId}
                            onCollapseTimeline={() => setViewMode("list")}
                        />
                    ) : (
                        <>
                            {/* 主区紧凑工具栏 */}
                            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--studio-line)] bg-[var(--studio-surface)] px-4 py-2">
                                <div className="flex flex-wrap items-center gap-2">
                                    <div className="inline-flex rounded-lg border border-[var(--studio-line)] bg-[var(--studio-page)] p-0.5">
                                        {([
                                            { key: "list", label: "分镜清单", icon: List },
                                            { key: "grid", label: "故事板网格", icon: LayoutGrid },
                                            { key: "preview", label: "成片预览", icon: Film },
                                        ] as const).map((item) => {
                                            const Icon = item.icon;
                                            const active = viewMode === item.key;
                                            return (
                                                <button
                                                    key={item.key}
                                                    type="button"
                                                    onClick={() => setViewMode(item.key)}
                                                    className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-xs! font-medium transition-colors ${
                                                        active
                                                            ? "bg-[var(--studio-surface-raised)] text-[var(--studio-ink)]!"
                                                            : "text-[var(--studio-muted)]! hover:text-[var(--studio-ink)]!"
                                                    }`}
                                                >
                                                    <Icon className="size-3.5" />
                                                    <span>{item.label}</span>
                                                </button>
                                            );
                                        })}
                                    </div>

                                    {viewMode !== "preview" && episodeShots.length > 0 ? (
                                        <div className="flex items-center gap-1">
                                            {([
                                                { key: "all" as const, label: `全部 (${episodeShots.length})` },
                                                { key: "missingVideo" as const, label: `缺视频 (${stats.missingVideo})` },
                                                ...(stats.failed > 0 ? [{ key: "failed" as const, label: `失败 (${stats.failed})` }] : []),
                                            ] satisfies Array<{ key: ShotFilter; label: string }>).map((chip) => (
                                                <button
                                                    key={chip.key}
                                                    type="button"
                                                    onClick={() => setFilter(chip.key)}
                                                    className={`cursor-pointer rounded-md border px-2 py-1 text-xs! font-medium transition-colors ${
                                                        filter === chip.key
                                                            ? "border-[var(--studio-line-strong)] bg-[var(--studio-surface-raised)] text-[var(--studio-ink)]!"
                                                            : "border-transparent text-[var(--studio-muted)]! hover:bg-[var(--studio-surface-hover)]"
                                                    }`}
                                                >
                                                    {chip.label}
                                                </button>
                                            ))}
                                        </div>
                                    ) : null}
                                </div>

                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="hidden text-xs text-[var(--studio-muted)] tabular-nums sm:inline">
                                        {episodeShots.length} 镜 · 约 {stats.totalDuration.toFixed(1)}s
                                    </span>
                                    <Button size="small" icon={<Sparkles className="size-3.5" />} onClick={openSplitModal}>
                                        AI 拆镜头
                                    </Button>
                                    {episodeShots.length > 0 && stats.missingPrompt > 0 ? (
                                        <Button
                                            size="small"
                                            loading={batchComposing}
                                            onClick={() => handleBatchComposeMissingPrompts()}
                                        >
                                            补齐提示词 ({stats.missingPrompt})
                                        </Button>
                                    ) : null}
                                    {episodeShots.length > 0 ? (
                                        <Button
                                            size="small"
                                            onClick={() => setGenerationShotIds(episodeShots.map((s) => s.id))}
                                        >
                                            批量生视频
                                        </Button>
                                    ) : null}
                                    <Button size="small" icon={<Plus className="size-3.5" />} onClick={() => void handleAddManualShot()}>
                                        加一镜
                                    </Button>
                                    <Button
                                        size="small"
                                        type="text"
                                        icon={rightOpen ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
                                        onClick={() => setRightOpen((prev) => !prev)}
                                        title={rightOpen ? "收起右侧协作栏" : "展开右侧协作栏"}
                                    />
                                </div>
                            </div>

                            {/* 待确认拆镜头草稿提示条 */}
                            {pendingDraft ? (
                                <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--studio-line)] bg-[var(--studio-surface-raised)] px-4 py-2.5">
                                    <div className="flex items-center gap-2 text-xs">
                                        <Sparkles className="size-4 text-[var(--studio-action)]" />
                                        <span className="font-semibold text-[var(--studio-ink)]">存在待确认的 AI 镜头拆分草稿</span>
                                        <span className="text-[var(--studio-muted)]">审阅并确认后将写入本集正式分镜。</span>
                                    </div>
                                    <Button size="small" type="primary" onClick={() => setDraftReviewOpen(true)}>
                                        审核并确认草稿
                                    </Button>
                                </div>
                            ) : null}

                            {/* 主内容滚动区 */}
                            <div className="min-h-0 flex-1 overflow-y-auto p-4">
                                {episodeShots.length === 0 ? (
                                    <div className="mx-auto my-12 max-w-md rounded-lg border border-dashed border-[var(--studio-line-strong)] bg-[var(--studio-surface)] p-8 text-center">
                                        <Clapperboard className="mx-auto mb-3 size-8 text-[var(--studio-muted)]" />
                                        <h3 className="text-base font-semibold text-[var(--studio-ink)]">当前分集还没有镜头</h3>
                                        <p className="mt-1.5 text-xs leading-5 text-[var(--studio-muted)]">
                                            点击「一键出集」可自动串联拆镜头、补齐资产图、合成提示词与批量出视频；也可先手动或用 AI 拆分分镜。
                                        </p>
                                        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                                            <Button type="primary" icon={<Sparkles className="size-4" />} onClick={onOpenOneClick}>
                                                一键出集
                                            </Button>
                                            <Button icon={<Clapperboard className="size-4" />} onClick={openSplitModal}>
                                                先仅 AI 拆镜头
                                            </Button>
                                            <Button icon={<Plus className="size-4" />} onClick={() => void handleAddManualShot()}>
                                                手动加一镜
                                            </Button>
                                        </div>
                                    </div>
                                ) : viewMode === "preview" ? (
                                    /* 大屏连续预览视图 */
                                    <div className="mx-auto flex h-full max-w-4xl flex-col gap-3">
                                        <div className="relative flex min-h-[340px] flex-1 items-center justify-center overflow-hidden rounded-lg border border-[var(--studio-line)] bg-black">
                                            {activePreviewIsVideo ? (
                                                <video
                                                    ref={previewVideoRef}
                                                    key={activePreviewUrl}
                                                    src={activePreviewUrl}
                                                    autoPlay={previewPlaying}
                                                    controls
                                                    playsInline
                                                    onEnded={() => {
                                                        if (previewPlaying && activeShotIndex < episodeShots.length - 1) {
                                                            stepPreviewShot(1);
                                                        } else {
                                                            setPreviewPlaying(false);
                                                        }
                                                    }}
                                                    className="h-full max-h-[60dvh] w-full object-contain"
                                                />
                                            ) : activePreviewUrl ? (
                                                <img src={activePreviewUrl} alt="" className="h-full max-h-[60dvh] w-full object-contain" />
                                            ) : (
                                                <div className="flex flex-col items-center gap-2 p-6 text-center">
                                                    <Video className="size-8 text-[var(--studio-muted)]" />
                                                    <div className="text-sm font-medium text-white">
                                                        镜头 #{activeShot?.shotNumber} 尚未生成视频
                                                    </div>
                                                    {activeShot ? (
                                                        <Button type="primary" size="small" onClick={() => setGenerationShotIds([activeShot.id])}>
                                                            立即生成本镜视频
                                                        </Button>
                                                    ) : null}
                                                </div>
                                            )}

                                            {activeShot ? (
                                                <div className="absolute left-3 top-3 flex items-center gap-1.5">
                                                    <span className="rounded bg-black/75 px-2 py-0.5 font-mono text-xs font-semibold text-white">
                                                        #{String(activeShot.shotNumber).padStart(2, "0")} · {activeShot.shotSize || "中景"}
                                                    </span>
                                                    <span className="rounded bg-black/65 px-2 py-0.5 text-xs text-white/90">
                                                        {activeShot.cameraMovement || "固定镜头"}
                                                    </span>
                                                </div>
                                            ) : null}

                                            {activeShot ? (
                                                <button
                                                    type="button"
                                                    onClick={() => handleMentionShot(activeShot.id)}
                                                    className="absolute right-3 top-3 inline-flex cursor-pointer items-center gap-1 rounded-md border border-white/20 bg-black/75 px-2.5 py-1 text-xs! text-white! hover:bg-black"
                                                >
                                                    <AtSign className="size-3.5" />
                                                    <span>针对这镜问 AI</span>
                                                </button>
                                            ) : null}
                                        </div>

                                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface)] px-4 py-2.5">
                                            <div className="flex items-center gap-2">
                                                <Button size="small" icon={<SkipBack className="size-3.5" />} onClick={() => stepPreviewShot(-1)} />
                                                <Button
                                                    size="small"
                                                    type="primary"
                                                    icon={previewPlaying ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                                                    onClick={() => {
                                                        const next = !previewPlaying;
                                                        setPreviewPlaying(next);
                                                        if (previewVideoRef.current) {
                                                            if (next) void previewVideoRef.current.play().catch(() => {});
                                                            else previewVideoRef.current.pause();
                                                        }
                                                    }}
                                                >
                                                    {previewPlaying ? "暂停连播" : "连续播放"}
                                                </Button>
                                                <Button size="small" icon={<SkipForward className="size-3.5" />} onClick={() => stepPreviewShot(1)} />
                                                <span className="ml-1 font-mono text-xs text-[var(--studio-muted)] tabular-nums">
                                                    第 {activeShotIndex + 1} / {episodeShots.length} 镜
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {activeShot ? (
                                                    <Button size="small" onClick={() => handleOpenInspectorForShot(activeShot.id)}>
                                                        精调当前镜
                                                    </Button>
                                                ) : null}
                                                <Button size="small" onClick={() => setViewMode("timeline")}>
                                                    进入多轨精剪
                                                </Button>
                                            </div>
                                        </div>
                                    </div>
                                ) : filteredShots.length === 0 ? (
                                    <Empty description="当前筛选条件下没有镜头" />
                                ) : viewMode === "grid" ? (
                                    /* 故事板网格视图：宽屏自适应 3~4 列铺满 */
                                    <div className="grid w-full grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                                        {filteredShots.map((shot) => {
                                            const media = shotMediaMap.get(shot.id);
                                            const selected = shot.id === activeShot?.id;
                                            return (
                                                <div
                                                    key={shot.id}
                                                    onClick={() => setSelectedShotId(shot.id)}
                                                    className={`flex cursor-pointer flex-col overflow-hidden rounded-lg border transition-colors ${
                                                        selected
                                                            ? "border-[var(--studio-action)] bg-[var(--studio-surface-raised)]"
                                                            : "border-[var(--studio-line)] bg-[var(--studio-surface)] hover:border-[var(--studio-line-strong)]"
                                                    }`}
                                                >
                                                    <div className="p-2 pb-0">{renderShotThumb(shot, media, true)}</div>
                                                    <div className="flex flex-1 flex-col justify-between gap-2 p-3">
                                                        <div className="space-y-1.5">
                                                            <div className="flex items-center justify-between gap-1.5">
                                                                <div className="flex min-w-0 items-center gap-1.5">
                                                                    <Tag className="!m-0 shrink-0 text-[11px]">{shot.shotSize || "中景"}</Tag>
                                                                    <span className="truncate text-xs text-[var(--studio-muted)]" title={shot.cameraMovement || "固定镜头"}>
                                                                        {shot.cameraMovement || "固定镜头"}
                                                                    </span>
                                                                </div>
                                                                {renderShotStatusTag(shot, media)}
                                                            </div>
                                                            <p className="line-clamp-2 text-xs leading-5 text-[var(--studio-ink)]">
                                                                {shot.visualDescription || "暂无画面描述"}
                                                            </p>
                                                        </div>
                                                        <div className="flex flex-wrap items-center justify-between gap-1.5 border-t border-[var(--studio-line)] pt-2">
                                                            {renderInlineAssets(shot) || <span className="text-[11px] text-[var(--studio-faint)]">无绑定资产</span>}
                                                            <div className="flex items-center gap-1">
                                                                <Button size="small" type="text" onClick={(e) => { e.stopPropagation(); handleMentionShot(shot.id); }}>
                                                                    @AI
                                                                </Button>
                                                                <Button size="small" onClick={(e) => { e.stopPropagation(); handleOpenInspectorForShot(shot.id); }}>
                                                                    精调
                                                                </Button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    /* 默认：全宽多列分镜清单（铺满工作区，避免宽屏两侧留空，长运镜文案不再撑爆标签） */
                                    <div className="flex w-full flex-col gap-2.5">
                                        {filteredShots.map((shot, idx) => {
                                            const media = shotMediaMap.get(shot.id);
                                            const prompt = adoptedPrompts.get(shot.id);
                                            const selected = shot.id === activeShot?.id;
                                            return (
                                                <div
                                                    key={shot.id}
                                                    onClick={() => setSelectedShotId(shot.id)}
                                                    className={`cursor-pointer rounded-lg border p-3 transition-colors ${
                                                        selected
                                                            ? "border-[var(--studio-action)] bg-[var(--studio-surface-raised)]"
                                                            : "border-[var(--studio-line)] bg-[var(--studio-surface)] hover:border-[var(--studio-line-strong)]"
                                                    }`}
                                                >
                                                    {/* 顶部单行元信息与操作条 */}
                                                    <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--studio-line)] pb-2">
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-mono text-xs font-semibold text-[var(--studio-ink)] tabular-nums">
                                                                #{String(shot.shotNumber).padStart(2, "0")}
                                                            </span>
                                                            <Tag className="!m-0 text-[11px]">{shot.shotSize || "中景"}</Tag>
                                                            <span className="font-mono text-xs text-[var(--studio-muted)] tabular-nums">
                                                                {Number(shot.durationSeconds || 0).toFixed(1)}s
                                                            </span>
                                                            {renderShotStatusTag(shot, media)}
                                                        </div>

                                                        <div className="flex items-center gap-1">
                                                            <Button
                                                                size="small"
                                                                type="text"
                                                                disabled={idx === 0}
                                                                icon={<ArrowUp className="size-3.5" />}
                                                                onClick={(e) => { e.stopPropagation(); void handleMoveShot(idx, "up"); }}
                                                                title="上移"
                                                            />
                                                            <Button
                                                                size="small"
                                                                type="text"
                                                                disabled={idx === filteredShots.length - 1}
                                                                icon={<ArrowDown className="size-3.5" />}
                                                                onClick={(e) => { e.stopPropagation(); void handleMoveShot(idx, "down"); }}
                                                                title="下移"
                                                            />
                                                            <Button
                                                                size="small"
                                                                icon={<AtSign className="size-3" />}
                                                                onClick={(e) => { e.stopPropagation(); handleMentionShot(shot.id); }}
                                                            >
                                                                AI 改这镜
                                                            </Button>
                                                            <Button
                                                                size="small"
                                                                icon={<SlidersHorizontal className="size-3" />}
                                                                onClick={(e) => { e.stopPropagation(); handleOpenInspectorForShot(shot.id); }}
                                                            >
                                                                精调
                                                            </Button>
                                                            <Button
                                                                size="small"
                                                                type="text"
                                                                danger
                                                                icon={<Trash2 className="size-3.5" />}
                                                                onClick={(e) => { e.stopPropagation(); setDeleteTargetShot(shot); }}
                                                                title="删除镜头"
                                                            />
                                                        </div>
                                                    </div>

                                                    {/* 四栏响应式主体：画面预览 | 剧情与运镜 | 关联资产与光影 | 最终视频提示词 */}
                                                    <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[176px_minmax(0,1.4fr)_minmax(200px,0.85fr)] 2xl:grid-cols-[188px_minmax(0,1.45fr)_minmax(220px,0.85fr)_minmax(260px,1fr)]">
                                                        {/* 第 1 栏：视频/分镜图预览槽 */}
                                                        <div className="flex flex-col gap-1.5">
                                                            {renderShotThumb(shot, media, false)}
                                                        </div>

                                                        {/* 第 2 栏：画面描述、对白与运镜调度 */}
                                                        <div className="min-w-0 space-y-1.5">
                                                            <div className="text-[11px] font-medium text-[var(--studio-muted)]">画面构图与内容</div>
                                                            <p className="text-xs leading-5 text-[var(--studio-ink)]">
                                                                {shot.visualDescription || "暂无画面描述"}
                                                            </p>
                                                            {shot.cameraMovement ? (
                                                                <p className="line-clamp-2 text-xs leading-5 text-[var(--studio-muted)]" title={shot.cameraMovement}>
                                                                    <span className="font-medium text-[var(--studio-text)]">运镜：</span>
                                                                    {shot.cameraMovement}
                                                                </p>
                                                            ) : null}
                                                            {shot.dialogueVoiceover ? (
                                                                <p className="text-xs leading-5 text-[var(--studio-text)]">
                                                                    <span className="font-medium text-[var(--studio-muted)]">对白：</span>
                                                                    “{shot.dialogueVoiceover}”
                                                                </p>
                                                            ) : null}
                                                        </div>

                                                        {/* 第 3 栏：关联视觉资产与光影音效 */}
                                                        <div className="min-w-0 space-y-2 border-t border-[var(--studio-line)] pt-2 lg:border-l lg:border-t-0 lg:pl-3.5 lg:pt-0">
                                                            <div className="text-[11px] font-medium text-[var(--studio-muted)]">关联资产与氛围</div>
                                                            {renderInlineAssets(shot) || (
                                                                <span className="block text-xs text-[var(--studio-faint)]">未绑定视觉资产</span>
                                                            )}
                                                            {shot.lightingAtmosphere ? (
                                                                <p className="line-clamp-2 text-xs leading-5 text-[var(--studio-muted)]" title={shot.lightingAtmosphere}>
                                                                    光影：{shot.lightingAtmosphere}
                                                                </p>
                                                            ) : null}
                                                            {shot.soundDescription ? (
                                                                <p className="line-clamp-1 text-xs text-[var(--studio-faint)]" title={shot.soundDescription}>
                                                                    音效：{shot.soundDescription}
                                                                </p>
                                                            ) : null}
                                                        </div>

                                                        {/* 第 4 栏：最终视频提示词（宽屏独立成列，中小屏折到下方） */}
                                                        <div className="min-w-0 space-y-1.5 border-t border-[var(--studio-line)] pt-2 lg:col-span-3 2xl:col-span-1 2xl:border-l 2xl:border-t-0 2xl:pl-3.5 2xl:pt-0">
                                                            <div className="flex items-center justify-between gap-2">
                                                                <span className="text-[11px] font-medium text-[var(--studio-muted)]">
                                                                    最终视频提示词 {prompt ? `· v${prompt.versionNumber}` : ""}
                                                                </span>
                                                                <Button
                                                                    size="small"
                                                                    type="text"
                                                                    loading={composingShotId === shot.id}
                                                                    icon={<Sparkles className="size-3" />}
                                                                    onClick={(e) => { e.stopPropagation(); handleComposeSinglePrompt(shot); }}
                                                                >
                                                                    {prompt ? "重写" : "AI 写提示词"}
                                                                </Button>
                                                            </div>
                                                            {prompt ? (
                                                                <p
                                                                    className="line-clamp-4 text-xs leading-5 text-[var(--studio-text)]"
                                                                    title={prompt.prompt}
                                                                >
                                                                    {prompt.prompt}
                                                                </p>
                                                            ) : (
                                                                <p className="text-xs leading-5 text-[var(--studio-faint)]">
                                                                    暂未生成，点击右上角「AI 写提示词」或使用顶栏「补齐提示词」批量生成。
                                                                </p>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </section>

                {/* 宽屏并排模式下的独立「镜头精调」栏 */}
                {rightOpen && splitRightMode ? (
                    <aside className="hidden w-[340px] shrink-0 flex-col overflow-hidden border-l border-[var(--studio-line)] bg-[var(--studio-surface)] xl:flex">
                        <div className="flex h-11 shrink-0 items-center justify-between border-b border-[var(--studio-line)] bg-[var(--studio-rail)] px-3.5">
                            <span className="text-xs font-semibold text-[var(--studio-ink)]">镜头精调与小窗预览</span>
                            <Button size="small" type="text" onClick={() => setSplitRightMode(false)}>合并</Button>
                        </div>
                        <div className="min-h-0 flex-1 overflow-y-auto">
                            <UnifiedShotInspector
                                shot={activeShot}
                                media={activeShot ? shotMediaMap.get(activeShot.id) : undefined}
                                adoptedPrompt={activeShot ? adoptedPrompts.get(activeShot.id) : undefined}
                                assetImageByVersionId={assetImageByVersionId}
                                composingPrompt={Boolean(activeShot && composingShotId === activeShot.id)}
                                onOpenBigPreview={() => setViewMode("preview")}
                                onMentionInAgent={handleMentionShot}
                                onComposePrompt={handleComposeSinglePrompt}
                                onGenerateVideo={(shotId) => setGenerationShotIds([shotId])}
                                onGenerateShotAssets={(shot) => void openAssetBatchForShots([shot], true)}
                                onDeleteShot={setDeleteTargetShot}
                            />
                        </div>
                    </aside>
                ) : null}

                {/* 右侧常驻协作栏：默认「Nana助手」，可切「镜头精调」或宽屏并排，支持左边界拖拽调宽 */}
                {rightOpen ? (
                    <aside
                        className={`relative flex shrink-0 flex-col border-l border-[var(--studio-line)] bg-[var(--studio-surface)] ${rightPanelResizing ? "select-none" : "transition-[width] duration-150 ease-out motion-reduce:transition-none"}`}
                        style={{ width: rightPanelWidth }}
                    >
                        <button
                            type="button"
                            className="group absolute inset-y-0 left-0 z-40 w-3 -translate-x-1/2 cursor-col-resize touch-none outline-none"
                            onPointerDown={startRightPanelResize}
                            onKeyDown={resizeRightPanelWithKeyboard}
                            onDoubleClick={resetRightPanelWidth}
                            role="separator"
                            aria-orientation="vertical"
                            aria-label={translate("canvas.resizeCanvasAgent")}
                            aria-valuemin={rightPanelMinWidth}
                            aria-valuemax={Math.round(rightPanelMaxWidth)}
                            aria-valuenow={Math.round(rightPanelWidth)}
                            title={translate("canvas.dragToResizeDoubleClickToReset")}
                        >
                            <span className="absolute left-1/2 top-1/2 h-12 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--studio-muted)] opacity-0 transition-opacity group-hover:opacity-60 group-focus-visible:opacity-80 group-active:opacity-100" />
                        </button>
                        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                        <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-[var(--studio-line)] bg-[var(--studio-rail)] px-3">
                            {splitRightMode ? (
                                <span className="flex items-center gap-1.5 text-xs font-semibold text-[var(--studio-ink)]">
                                    <span className="size-1.5 rounded-full bg-[var(--studio-action)]" />
                                    <span>{assistantName}</span>
                                </span>
                            ) : (
                                <div className="inline-flex rounded-lg border border-[var(--studio-line)] bg-[var(--studio-page)] p-0.5">
                                    <button
                                        type="button"
                                        onClick={() => setRightTab("agent")}
                                        className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-xs! font-medium transition-colors ${
                                            rightTab === "agent"
                                                ? "bg-[var(--studio-surface-raised)] text-[var(--studio-ink)]!"
                                                : "text-[var(--studio-muted)]! hover:text-[var(--studio-ink)]!"
                                        }`}
                                    >
                                        <span className="size-1.5 rounded-full bg-[var(--studio-action)]" />
                                        <span>{assistantName}</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setRightTab("inspector")}
                                        className={`cursor-pointer rounded-md px-2.5 py-1 text-xs! font-medium transition-colors ${
                                            rightTab === "inspector"
                                                ? "bg-[var(--studio-surface-raised)] text-[var(--studio-ink)]!"
                                                : "text-[var(--studio-muted)]! hover:text-[var(--studio-ink)]!"
                                        }`}
                                    >
                                        镜头精调
                                    </button>
                                </div>
                            )}

                            <button
                                type="button"
                                onClick={() => setSplitRightMode((prev) => !prev)}
                                className="hidden cursor-pointer items-center gap-1 rounded px-2 py-1 text-xs! text-[var(--studio-muted)]! hover:bg-[var(--studio-surface-hover)] hover:text-[var(--studio-ink)]! xl:inline-flex"
                                title={`宽屏同时并排显示「镜头精调」与「${assistantName}」`}
                            >
                                <Columns2 className="size-3.5" />
                                <span>{splitRightMode ? "合并" : "并排"}</span>
                            </button>
                        </div>

                        {splitRightMode || rightTab === "agent" ? (
                            <ComicDramaAgentPanel
                                episodeId={episodeId}
                                episodeShots={episodeShots}
                                selectedShotId={activeShot?.id || null}
                                mentionedShotIds={mentionedShotIds}
                                onRemoveMention={(id) => setMentionedShotIds((prev) => prev.filter((item) => item !== id))}
                                onClearMentions={() => setMentionedShotIds([])}
                                onAttachCurrentShot={() => {
                                    if (activeShot) handleMentionShot(activeShot.id);
                                }}
                                onExecuteSuggestion={handleAgentSuggestion}
                            />
                        ) : (
                            <div className="min-h-0 flex-1 overflow-y-auto">
                                <UnifiedShotInspector
                                    shot={activeShot}
                                    media={activeShot ? shotMediaMap.get(activeShot.id) : undefined}
                                    adoptedPrompt={activeShot ? adoptedPrompts.get(activeShot.id) : undefined}
                                    assetImageByVersionId={assetImageByVersionId}
                                    composingPrompt={Boolean(activeShot && composingShotId === activeShot.id)}
                                    onOpenBigPreview={() => setViewMode("preview")}
                                    onMentionInAgent={handleMentionShot}
                                    onComposePrompt={handleComposeSinglePrompt}
                                    onGenerateVideo={(shotId) => setGenerationShotIds([shotId])}
                                    onGenerateShotAssets={(shot) => void openAssetBatchForShots([shot], true)}
                                    onDeleteShot={setDeleteTargetShot}
                                />
                            </div>
                        )}
                        </div>
                    </aside>
                ) : null}
            </div>

            {/* 底部可折叠 48px 节奏条（不在多轨精剪模式时展示） */}
            {viewMode !== "timeline" ? (
                <footer className="flex h-12 shrink-0 items-center justify-between gap-3 border-t border-[var(--studio-line)] bg-[var(--studio-rail)] px-4">
                    <div className="flex shrink-0 items-center gap-2">
                        <Button
                            size="small"
                            icon={<Play className="size-3.5" />}
                            disabled={episodeShots.length === 0}
                            onClick={() => {
                                setViewMode("preview");
                                setPreviewPlaying(true);
                            }}
                        >
                            连播
                        </Button>
                        <span className="font-mono text-xs text-[var(--studio-muted)] tabular-nums">
                            {episodeShots.length} 镜 · {fmtSeconds(stats.totalDuration)}
                        </span>
                    </div>

                    {/* 比例节奏色块条 */}
                    <div className="flex h-6 min-w-0 flex-1 items-center gap-1 overflow-x-auto">
                        {episodeShots.length === 0 ? (
                            <span className="text-xs text-[var(--studio-faint)]">拆完镜头后将在此展示全集节奏条</span>
                        ) : (
                            episodeShots.map((shot) => {
                                const media = shotMediaMap.get(shot.id);
                                const hasVideo = Boolean(media && media.mediaType === "video" && (media.status === "completed" || media.status === "needsUpdate") && readComicDramaMediaUrl(media.resultData));
                                const isFailed = media?.status === "failed";
                                const isRunning = media?.status === "queued" || media?.status === "processing";
                                const selected = shot.id === activeShot?.id;
                                const pct = stats.totalDuration > 0 ? Math.max(4, (Number(shot.durationSeconds || 3) / stats.totalDuration) * 100) : 10;
                                return (
                                    <button
                                        key={shot.id}
                                        type="button"
                                        onClick={() => setSelectedShotId(shot.id)}
                                        style={{ width: `${pct}%` }}
                                        title={`镜头 #${shot.shotNumber} · ${shot.durationSeconds}s`}
                                        className={`h-full min-w-[34px] cursor-pointer truncate rounded border px-1.5 text-left font-mono text-[11px]! text-[var(--studio-ink)]! transition-colors ${
                                            selected
                                                ? "border-[var(--studio-action)]"
                                                : "border-[var(--studio-line-strong)]"
                                        } ${
                                            hasVideo
                                                ? "bg-[color-mix(in_srgb,var(--studio-success)_18%,var(--studio-surface))]"
                                                : isFailed
                                                    ? "bg-[color-mix(in_srgb,var(--studio-danger)_18%,var(--studio-surface))]"
                                                    : isRunning
                                                        ? "bg-[color-mix(in_srgb,var(--studio-info)_18%,var(--studio-surface))]"
                                                        : "bg-[var(--studio-surface-raised)]"
                                        }`}
                                    >
                                        #{String(shot.shotNumber).padStart(2, "0")}
                                    </button>
                                );
                            })
                        )}
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                        <Button size="small" icon={<ChevronUp className="size-3.5" />} onClick={() => setViewMode("timeline")}>
                            展开多轨精剪
                        </Button>
                        {videoExportEnabled ? (
                            <Button
                                size="small"
                                icon={<Download className="size-3.5" />}
                                loading={exporting}
                                disabled={episodeShots.length === 0}
                                onClick={() => void handleExportCurrentEpisode()}
                            >
                                导出 MP4
                            </Button>
                        ) : null}
                    </div>
                </footer>
            ) : null}

            {/* AI 拆分镜头弹窗 */}
            <Modal
                title="AI 智能拆分本集镜头"
                open={splitModalOpen}
                onCancel={() => setSplitModalOpen(false)}
                footer={null}
                width={520}
                mask={{ closable: true }}
            >
                <div className="space-y-4 py-2">
                    <p className="text-xs text-[var(--studio-muted)]">
                        将基于当前选中的分集剧本正文自动拆分为连续镜头草稿，审阅确认后写入正式分镜清单。
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="mb-1 block text-xs text-[var(--studio-muted)]">叙事节奏</label>
                            <Select
                                className="w-full"
                                value={splitRhythm}
                                onChange={setSplitRhythm}
                                options={[
                                    { value: "紧凑利落", label: "紧凑利落 (短剧快节奏)" },
                                    { value: "高潮反转", label: "高潮反转 (悬疑爆发)" },
                                    { value: "舒缓写意", label: "舒缓写意 (情感烘托)" },
                                    { value: "激烈打斗", label: "激烈打斗 (快速切换)" },
                                ]}
                            />
                        </div>
                        <div>
                            <label className="mb-1 block text-xs text-[var(--studio-muted)]">单镜时长档位</label>
                            <Select
                                className="w-full"
                                value={splitDuration}
                                onChange={setSplitDuration}
                                options={[
                                    { value: "short", label: "简短 (~5s)" },
                                    { value: "medium", label: "中等 (5~8s)" },
                                    { value: "long", label: "较长 (10s+)" },
                                ]}
                            />
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="mb-1 block text-xs text-[var(--studio-muted)]">预计镜头数（可选）</label>
                            <InputNumber
                                min={1}
                                max={100}
                                className="w-full!"
                                placeholder="留空由 AI 自动判断"
                                value={splitShotCount}
                                onChange={setSplitShotCount}
                            />
                        </div>
                        <div>
                            <label className="mb-1 block text-xs text-[var(--studio-muted)]">拆分文本模型</label>
                            <ModelPicker config={config} capability="text" value={splitModel} onChange={setSplitModel} fullWidth />
                        </div>
                    </div>
                    <div>
                        <label className="mb-1 block text-xs text-[var(--studio-muted)]">创作重点指示（可选）</label>
                        <Input value={splitFocus} onChange={(e) => setSplitFocus(e.target.value)} placeholder="如：突出主角微表情和雨夜氛围" />
                    </div>
                    <div className="flex justify-end gap-2 border-t border-[var(--studio-line)] pt-3">
                        <Button onClick={() => setSplitModalOpen(false)}>取消</Button>
                        <Button type="primary" loading={splitting} icon={<Sparkles className="size-4" />} onClick={() => void handleTriggerSplit()}>
                            开始拆分
                        </Button>
                    </div>
                </div>
            </Modal>

            {/* 复用既有核心弹窗：草稿审阅、单镜/批量视频生成、批量资产图、删除影响确认 */}
            <ShotDraftModal draft={pendingDraft} open={draftReviewOpen} onClose={() => setDraftReviewOpen(false)} />
            <ShotGenerationModal open={generationShotIds.length > 0} shotIds={generationShotIds} onClose={() => setGenerationShotIds([])} />
            <AssetImageBatchModal
                open={Boolean(assetBatch)}
                versionIds={assetBatch?.versionIds || []}
                assetTypes={assetBatch?.types || []}
                onClose={() => setAssetBatch(null)}
            />
            <ShotDeleteImpactModal
                shot={deleteTargetShot}
                open={Boolean(deleteTargetShot)}
                onClose={() => setDeleteTargetShot(null)}
            />
        </div>
    );
}
