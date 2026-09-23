"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Badge, Button, Progress, Spin, Tag } from "antd";
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
}> = [
    { key: "readiness", label: "生产准备", icon: CheckCircle2 },
    { key: "settings", label: "生产设置", icon: Settings },
    { key: "assets", label: "视觉资产", icon: Palette },
    { key: "shots", label: "镜头清单", icon: Clapperboard },
    { key: "storyboard", label: "视觉分镜板", icon: LayoutGrid },
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
    const workspace = useComicDramaStore((state) => state.workspace);
    const loading = useComicDramaStore((state) => state.loading);
    const error = useComicDramaStore((state) => state.error);
    const refreshing = useComicDramaStore((state) => state.refreshing);
    const activeStage = useComicDramaStore((state) => state.activeStage);
    const loadWorkspace = useComicDramaStore((state) => state.loadWorkspace);
    const reloadWorkspace = useComicDramaStore((state) => state.reloadWorkspace);
    const setActiveStage = useComicDramaStore((state) => state.setActiveStage);

    // Global modals
    const [batchModalOpen, setBatchModalOpen] = useState(false);
    const [continuityOpen, setContinuityOpen] = useState(false);

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
                return <StageStoryboard />;
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
                    onClick={() => router.push("/comic-drama")}
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
                        onClick={() => router.push(`/script/${encodeURIComponent(workspace.scriptProjectId)}`)}
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
        </main>
    );
}
