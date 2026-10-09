"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, App, Badge, Button, Modal, Progress, Spin, Tag } from "antd";
import {
    ArrowLeft,
    CheckCircle2,
    Clapperboard,
    ExternalLink,
    Film,
    History,
    Layers,
    LayoutGrid,
    Link2,
    MessageSquare,
    Mic,
    Palette,
    RefreshCw,
    SendToBack,
    Settings,
    ShieldCheck,
    Volume2,
} from "lucide-react";

import { useComicDramaStore } from "../stores/use-comic-drama-store";
import type { ComicDramaStage } from "../types";
import { BatchGenerationModal } from "./batch-generation-modal";
import { ContinuityDrawer } from "./continuity-drawer";
import { StageAssets } from "./stage-assets";
import { StageCanvas } from "./stage-canvas";
import { StageMedia } from "./stage-media";
import { StageReadiness } from "./stage-readiness";
import { StageSettings } from "./stage-settings";
import { StageShots } from "./stage-shots";
import { StageSound } from "./stage-sound";
import { StageStoryboard } from "./stage-storyboard";
import { StageUpdates } from "./stage-updates";

const STAGE_NAV_ITEMS: Array<{
    key: ComicDramaStage;
    label: string;
    icon: typeof Clapperboard;
    badgeKey?: "pendingUpdateCount";
    /** 有值的项在菜单里显示步骤序号，用于指示推荐操作顺序。 */
    order?: number;
}> = [
    { key: "readiness", label: "生产准备", icon: CheckCircle2, order: 1 },
    { key: "settings", label: "生产设置", icon: Settings, order: 2 },
    { key: "shots", label: "镜头清单", icon: Clapperboard, order: 3 },
    { key: "storyboard", label: "视觉分镜板", icon: LayoutGrid, order: 4 },
    { key: "assets", label: "视觉资产", icon: Palette },
    { key: "sound", label: "声音对白", icon: Volume2 },
    { key: "canvas", label: "画布联动", icon: SendToBack },
    { key: "updates", label: "待更新项", icon: History, badgeKey: "pendingUpdateCount" },
];

const PROJECT_TYPE_LABELS: Record<string, string> = {
    comicDrama: "漫剧",
    liveActionShort: "真人短剧",
    animation: "动画",
    advertisement: "广告故事",
    musicVideo: "音乐视频",
    storyShort: "故事短片",
};

type ComicDramaWorkspaceProps = {
    projectId: string;
    scriptProjectId?: string;
};

/** 漫剧生产工作台主容器。 */
export function ComicDramaWorkspace({ projectId, scriptProjectId }: ComicDramaWorkspaceProps) {
    const router = useRouter();
    const { message } = App.useApp();
    const workspace = useComicDramaStore((state) => state.workspace);
    const loading = useComicDramaStore((state) => state.loading);
    const error = useComicDramaStore((state) => state.error);
    const refreshing = useComicDramaStore((state) => state.refreshing);
    const activeStage = useComicDramaStore((state) => state.activeStage);
    const loadWorkspace = useComicDramaStore((state) => state.loadWorkspace);
    const reloadWorkspace = useComicDramaStore((state) => state.reloadWorkspace);
    const setActiveStage = useComicDramaStore((state) => state.setActiveStage);
    const pendingStage = useComicDramaStore((state) => state.pendingStage);
    const clearPendingStage = useComicDramaStore((state) => state.clearPendingStage);
    const pendingTimelineTexts = useComicDramaStore((state) => state.pendingTimelineTexts);
    const pendingTimelineVoices = useComicDramaStore((state) => state.pendingTimelineVoices);
    const savePendingTimelineChanges = useComicDramaStore((state) => state.savePendingTimelineChanges);
    const discardPendingTimelineChanges = useComicDramaStore((state) => state.discardPendingTimelineChanges);
    const timelineSaving = useComicDramaStore((state) => state.timelineSaving);
    const timelineSaveError = useComicDramaStore((state) => state.timelineSaveError);

    // Global modals
    const [batchModalOpen, setBatchModalOpen] = useState(false);
    const [continuityOpen, setContinuityOpen] = useState(false);
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
            message.error(useComicDramaStore.getState().timelineSaveError || "仍有待保存的时间轴修改");
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
        }
    }, [projectId, loadWorkspace]);

    if (loading && !workspace) {
        return (
            <main className="studio-page flex h-full items-center justify-center">
                <Spin size="large" description="正在加载漫剧生产工作台..." />
            </main>
        );
    }

    if (error && !workspace) {
        return (
            <main className="studio-page flex h-full items-center justify-center p-6">
                <Alert
                    type="error"
                    showIcon
                    title="无法打开漫剧工作台"
                    description={error}
                    action={
                        <Button type="primary" onClick={() => void loadWorkspace(projectId)}>
                            重试
                        </Button>
                    }
                />
            </main>
        );
    }

    if (!workspace) return null;

    const progress = workspace.productionProgress;
    const projectTitle = workspace.scriptProject?.overview?.title || "未命名项目";
    const projectType = PROJECT_TYPE_LABELS[workspace.settings.projectType] || "漫剧";

    const renderStageContent = () => {
        switch (activeStage) {
            case "readiness":
                return <StageReadiness />;
            case "settings":
                return <StageSettings />;
            case "assets":
                return <StageAssets />;
            case "shots":
                return <StageShots />;
            case "storyboard":
                return <StageStoryboard pauseAutoSave={leavePromptOpen} />;
            case "media":
                return <StageMedia />;
            case "sound":
                return <StageSound />;
            case "canvas":
                return <StageCanvas />;
            case "updates":
                return <StageUpdates />;
            default:
                return <StageShots />;
        }
    };

    const navigationList = (
        <nav className="flex flex-col gap-1 p-3">
            {STAGE_NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const isActive = activeStage === item.key;
                const badgeCount = item.badgeKey ? progress[item.badgeKey] : 0;

                return (
                    <button
                        key={item.key}
                        type="button"
                        // 激活态与左侧主导航同源（globals.css 的 .sidebar-rail-item-active 用同一组变量）。
                        // 用内联样式而非任意值工具类：不受 utilities 层、样式表缓存与优先级影响，图标/文字靠 currentColor 一起继承。
                        style={isActive ? { background: "var(--studio-action)", color: "var(--studio-action-foreground)" } : undefined}
                        className={`flex items-center justify-between rounded-xl px-3.5 py-2.5 text-sm font-medium transition-all ${
                            isActive
                                ? "font-semibold shadow-sm"
                                : "text-[var(--studio-ink)] hover:bg-[var(--studio-line)] hover:text-[var(--studio-ink)]"
                        }`}
                        onClick={() => setActiveStage(item.key)}
                    >
                        <div className="flex items-center gap-2.5">
                            {typeof item.order === "number" && (
                                <span className="w-3.5 shrink-0 text-right text-xs font-semibold tabular-nums text-current opacity-60">{item.order}.</span>
                            )}
                            <Icon className="size-4 shrink-0 text-current" />
                            <span className="text-current">{item.label}</span>
                        </div>

                        {badgeCount > 0 && (
                            <Badge
                                count={badgeCount}
                                overflowCount={99}
                                className={isActive ? "[&_.ant-badge-count]:!border-none [&_.ant-badge-count]:!bg-black/20 [&_.ant-badge-count]:!text-[var(--studio-action-foreground)]" : ""}
                            />
                        )}
                    </button>
                );
            })}
        </nav>
    );

    return (
        <main className="studio-page flex h-full min-h-0 flex-col overflow-hidden">
            {/* Top Workspace Header */}
            <header className="flex flex-wrap items-center gap-3 border-b border-[var(--studio-line)] bg-[var(--studio-panel-solid)] py-2.5 pl-4 pr-[260px]">
                <Button
                    type="text"
                    aria-label="返回漫剧项目库"
                    icon={<ArrowLeft className="size-4" />}
                        onClick={() => requestRouteLeave(() => router.push("/comic-drama"))}
                />

                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        <h1 className="truncate text-base font-semibold text-[var(--studio-ink)]">{projectTitle}</h1>
                        <Tag color="purple">{projectType}</Tag>
                    </div>

                    <div className="mt-0.5 flex flex-wrap items-center gap-3 text-xs text-[var(--studio-muted)]">
                        <span>修订号 {workspace.revision}</span>
                        <span>
                            资产：{progress.readyAssetCount}/{progress.assetCount}
                        </span>
                        <span>
                            镜头：{progress.completedShotCount}/{progress.shotCount}
                        </span>
                        {progress.runningTaskCount > 0 && (
                            <span className="text-[var(--studio-primary)]">运行任务：{progress.runningTaskCount}</span>
                        )}
                        {progress.pendingUpdateCount > 0 && (
                            <span className="text-amber-500 font-medium">待更新：{progress.pendingUpdateCount} 项</span>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <Progress
                        type="circle"
                        size={32}
                        percent={workspace.completionRate}
                        strokeWidth={10}
                        format={(percent) => `${percent}`}
                        strokeColor="var(--studio-primary)"
                    />

                    <Button
                        icon={<RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />}
                        onClick={() => void reloadWorkspace()}
                        title="刷新工作区"
                    />

                    <Button
                        icon={<ExternalLink className="size-3.5" />}
                        onClick={() => requestRouteLeave(() => router.push(`/script/${encodeURIComponent(workspace.scriptProjectId)}`))}
                    >
                        剧本工作台
                    </Button>

                    <Button
                        type={activeStage === "media" ? "primary" : "default"}
                        icon={<Film className="size-3.5" />}
                        onClick={() => setActiveStage("media")}
                    >
                        媒体生成中心
                    </Button>

                    <Button icon={<ShieldCheck className="size-3.5" />} onClick={() => setContinuityOpen(true)}>
                        连续性检查
                    </Button>

                    <Button
                        type="primary"
                        icon={<Layers className="size-3.5" />}
                        onClick={() => setBatchModalOpen(true)}
                    >
                        批量生产
                    </Button>
                </div>
            </header>

            {/* Main Stage Grid Workspace */}
            <div className="grid min-h-0 flex-1 lg:grid-cols-[220px_minmax(0,1fr)]">
                {/* Desktop Stage Sidebar Navigation */}
                <aside className="hidden min-h-0 overflow-y-auto border-r border-[var(--studio-line)] bg-[var(--studio-panel-solid)] lg:block">
                    {navigationList}
                </aside>

                {/* Central Stage Working Canvas */}
                <section
                    className={
                        activeStage === "storyboard"
                            ? "flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--studio-bg)] p-0"
                            : "min-h-0 overflow-y-auto p-4 sm:p-6"
                    }
                >
                    <div className={activeStage === "storyboard" ? "flex h-full w-full min-h-0 flex-col" : "mx-auto max-w-6xl"}>
                        {renderStageContent()}
                    </div>
                </section>
            </div>

            {/* Global Modals & Drawers */}
            <BatchGenerationModal open={batchModalOpen} onClose={() => setBatchModalOpen(false)} />
            <ContinuityDrawer open={continuityOpen} onClose={() => setContinuityOpen(false)} />
            <Modal title="时间轴有未保存的修改" open={leavePromptOpen} onCancel={cancelLeave} closable={!timelineSaving} mask={{ closable: false }} footer={[
                <Button key="cancel" onClick={cancelLeave} disabled={timelineSaving}>继续编辑</Button>,
                <Button key="discard" danger onClick={() => finishLeave(true)} disabled={timelineSaving}>不保存并离开</Button>,
                <Button key="save" type="primary" loading={timelineSaving} onClick={() => void saveAndLeave()}>保存后离开</Button>,
            ]}>
                <p>文字或音频轨道有尚未保存的移动与裁剪修改。</p>
                {timelineSaveError ? <Alert className="mt-3" type="error" showIcon message={timelineSaveError} /> : null}
            </Modal>
        </main>
    );
}
