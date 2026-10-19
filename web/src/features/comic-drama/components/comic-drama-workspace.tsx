"use client";

import { translateMessage } from "@/features/locale/translate";
import { useTranslation } from "@/features/locale/use-translation";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "@/shared/lib/team-navigation";
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

const getStageNavItems = (translate = translateMessage): Array<{
    key: ComicDramaStage;
    label: string;
    icon: typeof Clapperboard;
    badgeKey?: "pendingUpdateCount";
    /** 有值的项在菜单里显示步骤序号，用于指示推荐操作顺序。 */
    order?: number;
}> => ([
    { key: "readiness", label: translate("comicDrama.productionReadiness"), icon: CheckCircle2, order: 1 },
    { key: "settings", label: translate("comicDrama.productionSettings"), icon: Settings, order: 2 },
    { key: "shots", label: translate("comicDrama.shotList"), icon: Clapperboard, order: 3 },
    { key: "storyboard", label: translate("comicDrama.visualStoryboard"), icon: LayoutGrid, order: 4 },
    { key: "assets", label: translate("comicDrama.visualAssets"), icon: Palette },
    { key: "sound", label: translate("comicDrama.soundAndDialogue"), icon: Volume2 },
    { key: "canvas", label: translate("comicDrama.canvasIntegration"), icon: SendToBack },
    { key: "updates", label: translate("comicDrama.pendingUpdates_7c9d22"), icon: History, badgeKey: "pendingUpdateCount" },
]);

const getProjectTypeLabels = (translate = translateMessage): Record<string, string> => ({
    comicDrama: translate("comicDrama.comicDrama"),
    liveActionShort: translate("comicDrama.liveActionShortDrama"),
    animation: translate("comicDrama.animation"),
    advertisement: translate("comicDrama.advertisingStory"),
    musicVideo: translate("comicDrama.musicVideo"),
    storyShort: translate("comicDrama.shortFilm"),
});

type ComicDramaWorkspaceProps = {
    projectId: string;
    scriptProjectId?: string;
};

/** 漫剧生产工作台主容器。 */
export function ComicDramaWorkspace({ projectId, scriptProjectId }: ComicDramaWorkspaceProps) {
    const translate = useTranslation();
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
        }
    }, [projectId, loadWorkspace]);

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
                    action={
                        <Button type="primary" onClick={() => void loadWorkspace(projectId)}>
                            {translate("comicDrama.retry")}</Button>
                    }
                />
            </main>
        );
    }

    if (!workspace) return null;

    const progress = workspace.productionProgress;
    const projectTitle = workspace.scriptProject?.overview?.title || translate("comicDrama.untitledProject");
    const projectType = getProjectTypeLabels(translate)[workspace.settings.projectType] || translate("comicDrama.comicDrama");

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
            {getStageNavItems(translate).map((item) => {
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
                    aria-label={translate("comicDrama.backToComicDramaLibrary")}
                    icon={<ArrowLeft className="size-4" />}
                        onClick={() => requestRouteLeave(() => router.push("/comic-drama"))}
                />

                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        <h1 className="truncate text-base font-semibold text-[var(--studio-ink)]">{projectTitle}</h1>
                        <Tag color="purple">{projectType}</Tag>
                    </div>

                    <div className="mt-0.5 flex flex-wrap items-center gap-3 text-xs text-[var(--studio-muted)]">
                        <span>{translate("comicDrama.revisionCount_0b0315", { value0: workspace.revision })}</span>
                        <span>{translate("comicDrama.assetsCountCount_735adc", { value0: progress.readyAssetCount, value1: progress.assetCount })}</span>
                        <span>{translate("comicDrama.shotsCountCount_67c7ca", { value0: progress.completedShotCount, value1: progress.shotCount })}</span>
                        {progress.runningTaskCount > 0 && (
                            <span className="text-[var(--studio-primary)]">{translate("comicDrama.runningTasksCount_7acd87", { value0: progress.runningTaskCount })}</span>
                        )}
                        {progress.pendingUpdateCount > 0 && (
                            <span className="text-amber-500 font-medium">{translate("comicDrama.pendingUpdatesCount_eafaf7", { value0: progress.pendingUpdateCount })}</span>
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
                        title={translate("comicDrama.refreshWorkspace")}
                    />

                    <Button
                        icon={<ExternalLink className="size-3.5" />}
                        onClick={() => requestRouteLeave(() => router.push(`/script/${encodeURIComponent(workspace.scriptProjectId)}`))}
                    >
                        {translate("comicDrama.scriptWorkspace")}</Button>

                    <Button
                        type={activeStage === "media" ? "primary" : "default"}
                        icon={<Film className="size-3.5" />}
                        onClick={() => setActiveStage("media")}
                    >
                        {translate("comicDrama.mediaGenerationCenter")}</Button>

                    <Button icon={<ShieldCheck className="size-3.5" />} onClick={() => setContinuityOpen(true)}>
                        {translate("comicDrama.continuityCheck")}</Button>

                    <Button
                        type="primary"
                        icon={<Layers className="size-3.5" />}
                        onClick={() => setBatchModalOpen(true)}
                    >
                        {translate("comicDrama.batchProduction_9d2fe0")}</Button>
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
            <Modal title={translate("comicDrama.unsavedTimelineChanges")} open={leavePromptOpen} onCancel={cancelLeave} closable={!timelineSaving} mask={{ closable: false }} footer={[
                <Button key="cancel" onClick={cancelLeave} disabled={timelineSaving}>{translate("comicDrama.continueEditing")}</Button>,
                <Button key="discard" danger onClick={() => finishLeave(true)} disabled={timelineSaving}>{translate("comicDrama.leaveWithoutSaving")}</Button>,
                <Button key="save" type="primary" loading={timelineSaving} onClick={() => void saveAndLeave()}>{translate("comicDrama.saveAndLeave")}</Button>,
            ]}>
                <p>{translate("comicDrama.textOrAudioTracksContainUnsavedMovesOrTrims")}</p>
                {timelineSaveError ? <Alert className="mt-3" type="error" showIcon message={timelineSaveError} /> : null}
            </Modal>
        </main>
    );
}
