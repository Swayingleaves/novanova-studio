"use client";

import { useTranslation } from "@/features/locale/use-translation";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "@/shared/lib/team-navigation";
import { Alert, App, Badge, Button, Drawer, Dropdown, Modal, Progress, Select, Spin, Tabs } from "antd";
import {
    ArrowLeft,
    CheckCircle2,
    Download,
    ExternalLink,
    Film,
    History,
    MoreHorizontal,
    Palette,
    RefreshCw,
    SendToBack,
    Settings,
    Sparkles,
    Square,
    Volume2,
} from "lucide-react";

import {
    cancelComicDramaPipeline,
    getLatestComicDramaPipeline,
    readComicDramaMediaUrl,
    resumeComicDramaPipeline,
} from "@/services/api/comic-drama";
import { downloadComicDramaExportVideo } from "@/services/api/server";
import { useComicDramaStore } from "../stores/use-comic-drama-store";
import { useVideoExportSettingsStore } from "../stores/use-video-export-settings-store";
import type { ComicDramaEpisodePipeline } from "../types";
import { EpisodeOneClickModal } from "./episode-one-click-modal";
import { StageAssets } from "./stage-assets";
import { StageCanvas } from "./stage-canvas";
import { StageMedia } from "./stage-media";
import { StageReadiness } from "./stage-readiness";
import { StageSettings } from "./stage-settings";
import { StageSound } from "./stage-sound";
import { StageUpdates } from "./stage-updates";
import { UnifiedStudioStage } from "./unified-studio-stage";

type ComicDramaWorkspaceProps = {
    projectId: string;
    scriptProjectId?: string;
};

/** 漫剧一体化生产工作台主容器：顶部全局分集与流水线状态 + 合并分镜与 Agent 主区 + 轻量按需抽屉。 */
export function ComicDramaWorkspace({ projectId }: ComicDramaWorkspaceProps) {
    const translate = useTranslation();
    const router = useRouter();
    const { message } = App.useApp();

    const workspace = useComicDramaStore((state) => state.workspace);
    const loading = useComicDramaStore((state) => state.loading);
    const error = useComicDramaStore((state) => state.error);
    const activeStage = useComicDramaStore((state) => state.activeStage);
    const activeDrawer = useComicDramaStore((state) => state.activeDrawer);
    const setActiveDrawer = useComicDramaStore((state) => state.setActiveDrawer);
    const selectedEpisodeId = useComicDramaStore((state) => state.selectedEpisodeId);
    const setSelectedEpisodeId = useComicDramaStore((state) => state.setSelectedEpisodeId);
    const loadWorkspace = useComicDramaStore((state) => state.loadWorkspace);
    const reloadWorkspace = useComicDramaStore((state) => state.reloadWorkspace);
    const pendingStage = useComicDramaStore((state) => state.pendingStage);
    const clearPendingStage = useComicDramaStore((state) => state.clearPendingStage);
    const setActiveStage = useComicDramaStore((state) => state.setActiveStage);
    const pendingTimelineTexts = useComicDramaStore((state) => state.pendingTimelineTexts);
    const pendingTimelineVoices = useComicDramaStore((state) => state.pendingTimelineVoices);
    const savePendingTimelineChanges = useComicDramaStore((state) => state.savePendingTimelineChanges);
    const discardPendingTimelineChanges = useComicDramaStore((state) => state.discardPendingTimelineChanges);
    const timelineSaving = useComicDramaStore((state) => state.timelineSaving);
    const timelineSaveError = useComicDramaStore((state) => state.timelineSaveError);

    const [oneClickOpen, setOneClickOpen] = useState(false);
    const [pipeline, setPipeline] = useState<ComicDramaEpisodePipeline | null>(null);
    const [pipelineActionLoading, setPipelineActionLoading] = useState(false);
    const [downloadingExport, setDownloadingExport] = useState(false);
    const [shotFilterRequest, setShotFilterRequest] = useState<"all" | "missingVideo" | "failed" | undefined>(undefined);
    const [routeLeaveAction, setRouteLeaveAction] = useState<(() => void) | null>(null);

    const hasPendingTimelineChanges = Object.keys(pendingTimelineTexts).length > 0 || Object.keys(pendingTimelineVoices).length > 0;
    const leavePromptOpen = Boolean(pendingStage || routeLeaveAction);

    const requestRouteLeave = useCallback((action: () => void) => {
        if (activeStage === "storyboard" && hasPendingTimelineChanges) setRouteLeaveAction(() => action);
        else action();
    }, [activeStage, hasPendingTimelineChanges]);

    const cancelLeave = () => {
        setRouteLeaveAction(null);
        clearPendingStage();
    };

    const finishLeave = (discard: boolean) => {
        if (discard) discardPendingTimelineChanges();
        const action = routeLeaveAction;
        const stage = pendingStage;
        cancelLeave();
        if (action) action();
        else if (stage) setActiveStage(stage);
    };

    const saveAndLeave = async () => {
        if (!await savePendingTimelineChanges()) {
            message.error(useComicDramaStore.getState().timelineSaveError || translate("comicDrama.thereAreUnsavedTimelineChanges"));
            return;
        }
        finishLeave(false);
    };

    useEffect(() => {
        if (!hasPendingTimelineChanges || activeStage !== "storyboard") return;
        const warnBeforeUnload = (event: BeforeUnloadEvent) => {
            const current = useComicDramaStore.getState();
            if (Object.keys(current.pendingTimelineTexts).length === 0 && Object.keys(current.pendingTimelineVoices).length === 0) return;
            event.preventDefault();
            event.returnValue = "";
        };
        window.addEventListener("beforeunload", warnBeforeUnload);
        return () => window.removeEventListener("beforeunload", warnBeforeUnload);
    }, [activeStage, hasPendingTimelineChanges]);

    useEffect(() => {
        if (!hasPendingTimelineChanges || activeStage !== "storyboard") return;
        const interceptLink = (event: MouseEvent) => {
            if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
            const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
            if (!anchor || anchor.hasAttribute("download") || (anchor.getAttribute("target") && anchor.getAttribute("target") !== "_self")) return;
            const destination = new URL((anchor as HTMLAnchorElement).href, window.location.href);
            if (destination.origin === window.location.origin && destination.pathname === window.location.pathname && destination.search === window.location.search) return;
            event.preventDefault();
            event.stopPropagation();
            requestRouteLeave(() => {
                if (destination.origin === window.location.origin) router.push(`${destination.pathname}${destination.search}${destination.hash}`);
                else window.location.assign(destination.href);
            });
        };
        document.addEventListener("click", interceptLink, true);
        return () => document.removeEventListener("click", interceptLink, true);
    }, [activeStage, hasPendingTimelineChanges, requestRouteLeave, router]);

    useEffect(() => {
        if (projectId) {
            void loadWorkspace(projectId);
            void useVideoExportSettingsStore.getState().refresh();
        }
    }, [projectId, loadWorkspace]);

    const effectiveEpisodeId = selectedEpisodeId || workspace?.scriptProject.episodes[0]?.id || "all";

    // 加载指定分集的一键出集流水线状态
    useEffect(() => {
        if (!workspace?.projectId) return;
        let cancelled = false;
        getLatestComicDramaPipeline(workspace.projectId, effectiveEpisodeId)
            .then((res) => {
                if (!cancelled) setPipeline(res && res.id ? res : null);
            })
            .catch(() => {
                if (!cancelled) setPipeline(null);
            });
        return () => { cancelled = true; };
    }, [workspace?.projectId, effectiveEpisodeId]);

    // 流水线运行中时自动轮询状态并同步工作区镜头/媒体
    useEffect(() => {
        if (!workspace?.projectId || !pipeline || pipeline.status !== "running") return;
        const timer = window.setInterval(() => {
            void getLatestComicDramaPipeline(workspace.projectId, effectiveEpisodeId)
                .then((res) => {
                    if (res && res.id) {
                        setPipeline(res);
                        if (res.status !== "running") {
                            void reloadWorkspace();
                        }
                    }
                })
                .catch(() => undefined);
            void reloadWorkspace();
        }, 3000);
        return () => window.clearInterval(timer);
    }, [workspace?.projectId, effectiveEpisodeId, pipeline, reloadWorkspace]);

    const episodeShots = useMemo(() => {
        const all = workspace?.shots || [];
        return all
            .filter((shot) => !effectiveEpisodeId || effectiveEpisodeId === "all" || shot.sourceEpisodeId === effectiveEpisodeId)
            .sort((a, b) => a.sortOrder - b.sortOrder);
    }, [workspace?.shots, effectiveEpisodeId]);

    // 当前分集的 5 步完成度统计
    const episodeStats = useMemo(() => {
        const media = workspace?.media || [];
        const readyAssetIds = new Set(
            media
                .filter((m) => m.targetType === "assetVersion" && m.mediaType === "image" && (m.status === "completed" || m.status === "needsUpdate") && readComicDramaMediaUrl(m.resultData))
                .map((m) => m.targetId),
        );
        const usedAssetVersionIds = Array.from(new Set(episodeShots.flatMap((s) => s.assetVersionIds)));
        const readyUsedAssets = usedAssetVersionIds.filter((id) => readyAssetIds.has(id)).length;

        const adoptedPromptIds = new Set(
            (workspace?.promptVersions || []).filter((p) => p.status === "adopted").map((p) => p.shotId),
        );
        const promptReadyCount = episodeShots.filter((s) => adoptedPromptIds.has(s.id)).length;

        const completedVideoShotIds = new Set(
            media
                .filter((m) => m.targetType === "shot" && m.mediaType === "video" && (m.status === "completed" || m.status === "needsUpdate") && readComicDramaMediaUrl(m.resultData))
                .map((m) => m.targetId),
        );
        const videoReadyCount = episodeShots.filter((s) => completedVideoShotIds.has(s.id)).length;
        const exported = pipeline?.status === "completed" && Boolean(pipeline.progress?.exportTaskId);
        return {
            shotCount: episodeShots.length,
            usedAssetCount: usedAssetVersionIds.length,
            readyUsedAssets,
            promptReadyCount,
            videoReadyCount,
            exported,
        };
    }, [workspace, episodeShots, pipeline]);

    if (loading && !workspace) {
        return (
            <main className="studio-page flex h-full items-center justify-center">
                <Spin size="large" description={translate("comicDrama.loadingTheComicDramaWorkspace")} />
            </main>
        );
    }

    if (error && !workspace) {
        return (
            <main className="studio-page flex h-full items-center justify-center p-6">
                <Alert
                    type="error"
                    showIcon
                    title={translate("comicDrama.couldNotOpenTheComicDramaWorkspace")}
                    description={error}
                    action={<Button type="primary" onClick={() => void loadWorkspace(projectId)}>{translate("comicDrama.retry")}</Button>}
                />
            </main>
        );
    }

    if (!workspace) return null;

    const progress = workspace.productionProgress;
    const projectTitle = workspace.scriptProject?.overview?.title || translate("comicDrama.untitledProject");
    const episodes = workspace.scriptProject?.episodes || [];
    const pipelineProgressPercent = Number(pipeline?.progress?.percent || 0);
    const pipelineMessage = String(pipeline?.progress?.message || "");
    const exportTaskId = typeof pipeline?.progress?.exportTaskId === "string" ? pipeline.progress.exportTaskId : "";

    const handleResumePipeline = async () => {
        if (!pipeline) return;
        setPipelineActionLoading(true);
        try {
            const resumed = await resumeComicDramaPipeline(workspace.projectId, pipeline.id);
            setPipeline(resumed);
            message.success("已继续生成提示词、镜头视频与成片");
        } catch (err) {
            message.error(err instanceof Error ? err.message : "继续流水线失败");
        } finally {
            setPipelineActionLoading(false);
        }
    };

    const handleCancelPipeline = async () => {
        if (!pipeline) return;
        setPipelineActionLoading(true);
        try {
            const canceled = await cancelComicDramaPipeline(workspace.projectId, pipeline.id);
            setPipeline(canceled);
            message.info("已停止当前一键出集流水线");
        } catch (err) {
            message.error(err instanceof Error ? err.message : "停止流水线失败");
        } finally {
            setPipelineActionLoading(false);
        }
    };

    const handleDownloadPipelineExport = async () => {
        if (!exportTaskId || downloadingExport) return;
        setDownloadingExport(true);
        try {
            const blob = await downloadComicDramaExportVideo(exportTaskId);
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `${projectTitle}-成片.mp4`;
            link.click();
            URL.revokeObjectURL(url);
        } catch (err) {
            message.error(err instanceof Error ? err.message : "下载成片失败");
        } finally {
            setDownloadingExport(false);
        }
    };

    const allEpisodeReady = episodeStats.shotCount > 0
        && episodeStats.readyUsedAssets === episodeStats.usedAssetCount
        && episodeStats.promptReadyCount === episodeStats.shotCount
        && episodeStats.videoReadyCount === episodeStats.shotCount;

    const pipelineSteps = [
        { key: "split", idx: 1, label: "拆镜头", value: `${episodeStats.shotCount}`, done: episodeStats.shotCount > 0, onClick: () => setOneClickOpen(true) },
        { key: "assets", idx: 2, label: "资产图", value: `${episodeStats.readyUsedAssets}/${episodeStats.usedAssetCount}`, done: episodeStats.shotCount > 0 && episodeStats.readyUsedAssets === episodeStats.usedAssetCount, onClick: () => setActiveDrawer("assets") },
        { key: "prompts", idx: 3, label: "提示词", value: `${episodeStats.promptReadyCount}/${episodeStats.shotCount}`, done: episodeStats.shotCount > 0 && episodeStats.promptReadyCount === episodeStats.shotCount, onClick: () => setOneClickOpen(true) },
        { key: "videos", idx: 4, label: "视频", value: `${episodeStats.videoReadyCount}/${episodeStats.shotCount}`, done: episodeStats.shotCount > 0 && episodeStats.videoReadyCount === episodeStats.shotCount, onClick: () => setShotFilterRequest("missingVideo") },
        { key: "export", idx: 5, label: "成片", value: episodeStats.exported ? "已出" : "待导", done: episodeStats.exported, onClick: () => setOneClickOpen(true) },
    ];

    const moreMenuItems = [
        {
            key: "media",
            icon: <Film className="size-3.5" />,
            label: `媒体生成中心${progress.runningTaskCount > 0 ? ` (${progress.runningTaskCount} 进行中)` : ""}`,
            onClick: () => setActiveDrawer("media"),
        },
        {
            key: "updates",
            icon: <History className="size-3.5" />,
            label: `待更新项${progress.pendingUpdateCount > 0 ? ` (${progress.pendingUpdateCount})` : ""}`,
            onClick: () => setActiveDrawer("updates"),
        },
        {
            key: "canvas",
            icon: <SendToBack className="size-3.5" />,
            label: "无限画布联动",
            onClick: () => setActiveDrawer("canvas"),
        },
        {
            key: "script",
            icon: <ExternalLink className="size-3.5" />,
            label: "前往共享剧本工作台",
            onClick: () => requestRouteLeave(() => router.push(`/script/${encodeURIComponent(workspace.scriptProjectId)}`)),
        },
        {
            key: "refresh",
            icon: <RefreshCw className="size-3.5" />,
            label: "刷新工作区",
            onClick: () => void reloadWorkspace(),
        },
    ];

    return (
        <main className="studio-page flex h-full min-h-0 flex-col overflow-hidden">
            {/* 顶部统一单集工程栏（预留全局右侧悬浮操作宽度） */}
            <header className="flex shrink-0 flex-wrap items-center justify-between gap-2.5 border-b border-[var(--studio-line)] bg-[var(--studio-rail)] py-2 pl-3.5 pr-[var(--studio-floating-actions-width,20rem)]">
                {/* 左：返回 + 项目名 + 全局分集切换 */}
                <div className="flex min-w-0 items-center gap-2">
                    <Button
                        type="text"
                        size="small"
                        aria-label="返回漫剧项目库"
                        icon={<ArrowLeft className="size-4" />}
                        onClick={() => requestRouteLeave(() => router.push("/comic-drama"))}
                    />
                    <h1 className="max-w-[160px] truncate text-sm font-semibold text-[var(--studio-ink)]">{projectTitle}</h1>
                    <div className="h-4 w-px bg-[var(--studio-line)]" />
                    <Select
                        size="small"
                        className="min-w-[168px]"
                        value={effectiveEpisodeId}
                        onChange={(val) => {
                            setSelectedEpisodeId(val);
                            setShotFilterRequest("all");
                        }}
                        options={[
                            ...episodes.map((ep) => ({
                                value: ep.id,
                                label: `第${ep.episodeNumber}集：${ep.title || "未命名"}`,
                            })),
                            { value: "all", label: "全部分集" },
                        ]}
                    />
                </div>

                {/* 中：本集 5 步进度条 */}
                <div className="hidden items-center gap-1 rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface)] px-1.5 py-0.5 2xl:flex">
                    {pipelineSteps.map((step, index) => (
                        <div key={step.key} className="flex items-center gap-1">
                            <button
                                type="button"
                                onClick={step.onClick}
                                className="flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-xs! transition-colors hover:bg-[var(--studio-surface-hover)]"
                            >
                                <span
                                    className="flex size-4 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums"
                                    style={
                                        step.done
                                            ? { background: "color-mix(in srgb, var(--studio-success) 16%, var(--studio-surface))", color: "var(--studio-success)" }
                                            : { background: "var(--studio-surface-raised)", color: "var(--studio-muted)" }
                                    }
                                >
                                    {step.done ? "✓" : step.idx}
                                </span>
                                <span className={step.done ? "font-medium text-[var(--studio-ink)]!" : "text-[var(--studio-muted)]!"}>{step.label}</span>
                                <span className="font-mono text-[11px] text-[var(--studio-faint)] tabular-nums">{step.value}</span>
                            </button>
                            {index < pipelineSteps.length - 1 ? <span className="text-[var(--studio-line-strong)]">›</span> : null}
                        </div>
                    ))}
                </div>

                {/* 右：按需抽屉入口 + 唯一主操作「一键出集」 */}
                <div className="flex shrink-0 items-center gap-1.5">
                    <Button size="small" icon={<Palette className="size-3.5" />} onClick={() => setActiveDrawer("assets")}>
                        资产库 ({progress.readyAssetCount}/{progress.assetCount})
                    </Button>
                    <Button size="small" icon={<Settings className="size-3.5" />} onClick={() => setActiveDrawer("settings")}>
                        设置
                    </Button>
                    <Badge count={progress.pendingUpdateCount} size="small" offset={[-2, 2]}>
                        <Dropdown menu={{ items: moreMenuItems }} trigger={["click"]}>
                            <Button size="small" icon={<MoreHorizontal className="size-4" />} title="更多工具与后台中心" />
                        </Dropdown>
                    </Badge>
                    <Button
                        size="small"
                        type="primary"
                        loading={pipeline?.status === "running"}
                        icon={<Sparkles className="size-3.5" />}
                        onClick={() => setOneClickOpen(true)}
                    >
                        {pipeline?.status === "running"
                            ? "出集中…"
                            : episodeStats.shotCount === 0
                                ? "一键出集"
                                : allEpisodeReady
                                    ? "一键导出"
                                    : "一键补齐本集"}
                    </Button>
                </div>
            </header>

            {/* 剧本准备度轻量提醒条（仅当存在缺失项时出现，不单独占用页面） */}
            {!workspace.readiness.ready && workspace.readiness.items.some((item) => item.status === "missing") ? (
                <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--studio-line)] bg-[var(--studio-surface-raised)] px-4 py-1.5 text-xs">
                    <span className="text-[var(--studio-warning)]">
                        共享剧本存在未完善的必填项，可能影响自动拆镜头效果。
                    </span>
                    <div className="flex items-center gap-2">
                        <Button size="small" type="link" onClick={() => setActiveDrawer("settings")}>查看明细</Button>
                        <Button size="small" onClick={() => router.push(`/script/${encodeURIComponent(workspace.scriptProjectId)}`)}>去完善剧本</Button>
                    </div>
                </div>
            ) : null}

            {/* 单集一键出集流水线状态条 */}
            {pipeline && pipeline.status !== "idle" && pipeline.status !== "canceled" ? (
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[var(--studio-line)] bg-[var(--studio-surface-raised)] px-4 py-2">
                    {pipeline.status === "running" ? (
                        <>
                            <div className="flex items-center gap-2 text-xs">
                                <Spin size="small" />
                                <span className="font-semibold text-[var(--studio-ink)]">一键出集流水线运行中</span>
                                <span className="text-[var(--studio-muted)]">{pipelineMessage}</span>
                            </div>
                            <div className="flex items-center gap-3">
                                <div className="w-36">
                                    <Progress percent={pipelineProgressPercent} size="small" showInfo={false} strokeColor="var(--studio-action)" />
                                </div>
                                <span className="font-mono text-xs font-semibold text-[var(--studio-ink)] tabular-nums">{pipelineProgressPercent}%</span>
                                <Button size="small" danger icon={<Square className="size-3" />} loading={pipelineActionLoading} onClick={() => void handleCancelPipeline()}>
                                    停止
                                </Button>
                            </div>
                        </>
                    ) : pipeline.status === "paused" ? (
                        <>
                            <div className="flex items-center gap-2 text-xs">
                                <span className="rounded bg-[color-mix(in_srgb,var(--studio-warning)_18%,var(--studio-surface))] px-2 py-0.5 font-medium text-[var(--studio-warning)]">
                                    等待确认
                                </span>
                                <span className="font-medium text-[var(--studio-ink)]">{pipelineMessage || "分镜与资产图已就绪"}</span>
                                <span className="text-[var(--studio-muted)]">可先用右侧 {translate("comicDrama.nanaAgent")} 微调，确认后再生成视频</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <Button size="small" loading={pipelineActionLoading} onClick={() => void handleCancelPipeline()}>
                                    暂不继续
                                </Button>
                                <Button size="small" type="primary" loading={pipelineActionLoading} onClick={() => void handleResumePipeline()}>
                                    确认无误，继续生成视频与成片
                                </Button>
                            </div>
                        </>
                    ) : pipeline.status === "completed" ? (
                        <>
                            <div className="flex items-center gap-2 text-xs">
                                <CheckCircle2 className="size-4 text-[var(--studio-success)]" />
                                <span className="font-medium text-[var(--studio-ink)]">{pipelineMessage || "本集一键出集已完成"}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                {exportTaskId ? (
                                    <Button size="small" type="primary" icon={<Download className="size-3.5" />} loading={downloadingExport} onClick={() => void handleDownloadPipelineExport()}>
                                        下载本集 MP4
                                    </Button>
                                ) : null}
                                <Button size="small" type="text" onClick={() => setPipeline(null)}>关闭提示</Button>
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="flex items-center gap-2 text-xs text-[var(--studio-danger)]">
                                <span className="font-semibold">一键出集未完成：</span>
                                <span>{pipeline.errorMessage || pipelineMessage}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <Button size="small" type="primary" onClick={() => setOneClickOpen(true)}>重新补齐</Button>
                                <Button size="small" type="text" onClick={() => setPipeline(null)}>关闭</Button>
                            </div>
                        </>
                    )}
                </div>
            ) : null}

            {/* 一体化主工作区 */}
            <UnifiedStudioStage
                episodeId={effectiveEpisodeId}
                pauseAutoSave={leavePromptOpen}
                onOpenOneClick={() => setOneClickOpen(true)}
                externalFilter={shotFilterRequest}
            />

            {/* 一键出集确认弹窗 */}
            <EpisodeOneClickModal
                open={oneClickOpen}
                episodeId={effectiveEpisodeId}
                episodeShots={episodeShots}
                onClose={() => setOneClickOpen(false)}
                onStarted={(started) => setPipeline(started)}
            />

            {/* 按需侧滑抽屉：资产库 / 项目设置(含准备度与声音对白) / 媒体生成中心 / 待更新项 / 画布联动 */}
            <Drawer
                title={
                    activeDrawer === "assets"
                        ? "全剧视觉资产库"
                        : activeDrawer === "settings"
                            ? "生产设置、剧本准备与声音对白"
                            : activeDrawer === "media"
                                ? "媒体生成中心"
                                : activeDrawer === "updates"
                                    ? "上游剧本变更待更新项"
                                    : activeDrawer === "canvas"
                                        ? "无限画布联动"
                                        : ""
                }
                open={Boolean(activeDrawer)}
                onClose={() => setActiveDrawer(null)}
                size="large"
                styles={{ wrapper: { width: "min(960px, 92vw)" } }}
                destroyOnHidden
            >
                {activeDrawer === "assets" ? <StageAssets /> : null}
                {activeDrawer === "settings" ? (
                    <Tabs
                        items={[
                            { key: "settings", label: "生产设置", icon: <Settings className="size-3.5" />, children: <StageSettings /> },
                            { key: "readiness", label: "剧本准备度", icon: <CheckCircle2 className="size-3.5" />, children: <StageReadiness /> },
                            { key: "sound", label: "声音对白", icon: <Volume2 className="size-3.5" />, children: <StageSound /> },
                        ]}
                    />
                ) : null}
                {activeDrawer === "media" ? <StageMedia /> : null}
                {activeDrawer === "updates" ? <StageUpdates /> : null}
                {activeDrawer === "canvas" ? <StageCanvas /> : null}
            </Drawer>

            {/* 时间轴未保存离开拦截弹窗 */}
            <Modal
                title={translate("comicDrama.unsavedTimelineChanges")}
                open={leavePromptOpen}
                onCancel={cancelLeave}
                closable={!timelineSaving}
                mask={{ closable: false }}
                footer={[
                    <Button key="cancel" onClick={cancelLeave} disabled={timelineSaving}>{translate("comicDrama.continueEditing")}</Button>,
                    <Button key="discard" danger onClick={() => finishLeave(true)} disabled={timelineSaving}>{translate("comicDrama.leaveWithoutSaving")}</Button>,
                    <Button key="save" type="primary" loading={timelineSaving} onClick={() => void saveAndLeave()}>{translate("comicDrama.saveAndLeave")}</Button>,
                ]}
            >
                <p>{translate("comicDrama.textOrAudioTracksContainUnsavedMovesOrTrims")}</p>
                {timelineSaveError ? <Alert className="mt-3" type="error" showIcon title={timelineSaveError} /> : null}
            </Modal>
        </main>
    );
}
