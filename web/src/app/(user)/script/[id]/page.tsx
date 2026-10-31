"use client";

import { readinessItemText } from "@/features/script/lib/script-localization";

import { translateMessage } from "@/features/locale/translate";
import { useTranslation } from "@/features/locale/use-translation";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "@/shared/lib/team-navigation";
import { nanoid } from "nanoid";
import { App, Alert, Button, Drawer, Progress, Spin, Tag } from "antd";
import { ArrowLeft, Bot, BookOpenText, CheckCircle2, ChevronDown, ChevronRight, CircleAlert, FileClock, FileText, Globe2, Library, ListTree, Plus, Save, ScrollText, Sparkles, Users } from "lucide-react";

import { enterComicDrama, getScriptProductionReadiness } from "@/services/api/script";
import { ScriptAiPanel } from "@/features/script/components/script-ai-panel";
import { ScriptSectionEditor } from "@/features/script/components/section-editors";
import { ScriptEpisodeReader } from "@/features/script/components/script-episode-reader";
import { ScriptOutlineWorkspace } from "@/features/script/components/script-outline-workspace";
import { ScriptSourcePanel } from "@/features/script/components/script-source-panel";
import { StoryBiblePanel } from "@/features/script/components/story-bible-panel";
import { NovelAdaptationPanel } from "@/features/script/components/novel-adaptation-panel";
import { createScriptScene } from "@/features/script/lib/script-episode-editing";
import { useScriptStore } from "@/features/script/stores/use-script-store";
import type { ScriptSourceFocus, ScriptWorkspaceSection } from "@/features/script/types";
import styles from "./script-directory.module.css";

/** 左侧目录的一级分组：剧本创作入口与小说素材入口分开。 */
const getNavigationGroups = (translate = translateMessage): Array<{ label: string; items: Array<{ key: ScriptWorkspaceSection; label: string; icon: typeof BookOpenText }> }> => ([
    {
        label: translate("script.script"),
        items: [
            { key: "overview", label: translate("script.storyOverview"), icon: BookOpenText },
            { key: "outline", label: translate("script.storyOutline"), icon: ListTree },
            { key: "characters", label: translate("script.characters"), icon: Users },
            { key: "world", label: translate("script.worldAndLocations"), icon: Globe2 },
            { key: "episodes", label: translate("script.episodeScript_110f7a"), icon: ScrollText },
            { key: "versions", label: translate("script.versionHistory"), icon: FileClock },
        ],
    },
    {
        label: translate("script.novel"),
        items: [
            { key: "source", label: translate("script.source"), icon: FileText },
            { key: "storyBible", label: translate("script.storyBible"), icon: Library },
            { key: "adaptation", label: translate("script.novelAdaptation_b946fb"), icon: Sparkles },
        ],
    },
]);

/**
 * 右侧常驻「AI剧本助手」的区块：只有带AI动作的创作页面才占这一栏。
 * 版本记录、原文、故事知识库、小说改编没有AI动作，不显示助手，也不占宽度。
 */
const AI_PANEL_SECTIONS: ScriptWorkspaceSection[] = ["episodes", "overview", "outline", "characters", "world"];

const getSaveLabels = (translate = translateMessage) => ({ idle: translate("script.unchanged"), dirty: translate("script.unsavedChanges"), saving: translate("script.saving"), saved: translate("script.saved"), error: translate("script.saveFailed"), conflict: translate("script.versionConflict") });

/** 离开剧本工作台时的选择：保存并继续，或放弃并继续。 */
type LeaveChoice = "save" | "discard";

export default function ScriptWorkspacePage() {
    const translate = useTranslation();
    const params = useParams<{ id: string }>();
    const router = useRouter();
    const { message, modal } = App.useApp();
    const project = useScriptStore((state) => state.project);
    const loading = useScriptStore((state) => state.loading);
    const error = useScriptStore((state) => state.error);
    const saveStatus = useScriptStore((state) => state.saveStatus);
    const saveError = useScriptStore((state) => state.saveError);
    const hasUnsaved = useScriptStore((state) => state.hasUnsaved);
    const loadProject = useScriptStore((state) => state.loadProject);
    const reloadProject = useScriptStore((state) => state.reloadProject);
    const loadSupportingData = useScriptStore((state) => state.loadSupportingData);
    const retrySave = useScriptStore((state) => state.retrySave);
    const saveAll = useScriptStore((state) => state.saveAll);
    const setAiTarget = useScriptStore((state) => state.setAiTarget);
    const assistantOpen = useScriptStore((state) => state.assistantOpen);
    const setAssistantOpen = useScriptStore((state) => state.setAssistantOpen);
    const [section, setSection] = useState<ScriptWorkspaceSection>("overview");
    const [selectedEpisodeId, setSelectedEpisodeId] = useState("");
    const [selectedSceneId, setSelectedSceneId] = useState("");
    const [sceneEditRequestId, setSceneEditRequestId] = useState("");
    const [expandedEpisodeIds, setExpandedEpisodeIds] = useState<string[]>([]);
    const [directoryOpen, setDirectoryOpen] = useState(false);
    const [entering, setEntering] = useState(false);
    const [sourceFocus, setSourceFocus] = useState<ScriptSourceFocus | null>(null);

    useEffect(() => {
        const projectId = params.id;
        if (!projectId) return;
        setSelectedEpisodeId("");
        setSelectedSceneId("");
        setSceneEditRequestId("");
        setExpandedEpisodeIds([]);
        setAssistantOpen(false);
        /* 上传原文后带 source=1 进入，直接停在“原文”核对解析进度。 */
        if (new URLSearchParams(window.location.search).get("source") === "1") setSection("source");
        void loadProject(projectId).then(() => loadSupportingData()).catch(() => undefined);
    }, [loadProject, loadSupportingData, params.id, setAssistantOpen]);
    /**
     * 把选中的分集对齐到当前项目：没选过就选第一集。
     * 选中的分集已经不在项目里时必须重新选，否则「分集剧本」会一直提示“分集不存在”：
     * 丢弃未保存修改、应用AI草稿、应用小说改编、恢复版本都会整批替换分集（标识会变），
     * 本地选择却还停在旧标识上，重载分集也永远加载不出来。
     */
    useEffect(() => {
        if (!project || project.id !== params.id) return;
        if (project.episodes.some((episode) => episode.id === selectedEpisodeId)) return;
        const first = project.episodes[0];
        setSelectedEpisodeId(first?.id || "");
        setSelectedSceneId("");
        setAiTarget(first ? { targetType: "episode", targetId: first.id, label: first.title } : null);
    }, [params.id, project, selectedEpisodeId, setAiTarget]);

    const selectSection = (next: ScriptWorkspaceSection) => {
        if (next === section) return;
        // 有未保存内容时先确认，避免切换区块把编辑意图丢掉
        if (hasUnsaved) {
            void confirmLeave({
                onContinue: async (choice) => {
                    // 选「放弃」时 confirmLeave 内部已丢弃本地改动并重载云端，直接切过去即可
                    if (choice === "discard") {
                        applySection(next);
                        return;
                    }
                    if (await saveAll()) applySection(next);
                },
            });
            return;
        }
        applySection(next);
    };
    const applySection = (next: ScriptWorkspaceSection) => {
        setSection(next);
        setDirectoryOpen(false);
        // 抽屉是窄屏下的助手入口：切到没有AI动作的区块就收起来，别让它飘在版本记录、原文这些页面上
        if (!AI_PANEL_SECTIONS.includes(next)) setAssistantOpen(false);
        if (next === "episodes" && section !== "episodes") {
            setSelectedSceneId("");
            if (selectedEpisodeId) setExpandedEpisodeIds((current) => current.includes(selectedEpisodeId) ? current : [...current, selectedEpisodeId]);
        }
        if (next !== "source") setSourceFocus(null);
        if (["overview", "outline", "characters", "world", "source", "storyBible", "adaptation"].includes(next)) setAiTarget(null);
    };
    /**
     * 未保存提示：保存并继续 / 放弃并继续 / 取消。
     * onContinue 收到用户的选择，由调用方决定接下来做什么（切区块或跳转）。
     * 选择「放弃」时会先丢弃本地改动，否则弹窗说放弃、实际内容还留在 store 里。
     */
    const confirmLeave = ({ onContinue }: { onContinue: (choice: LeaveChoice) => void | Promise<void> }) => {
        modal.confirm({
            width: 460,
            title: translate("script.youHaveUnsavedChanges"),
            content: translate("script.saveAndContinueWritesYourChangesToTheCloudFirst"),
            okText: translate("script.saveAndContinue"),
            cancelText: translate("script.discardAndContinue"),
            onOk: async () => { await onContinue("save"); },
            onCancel: () => {
                const state = useScriptStore.getState();
                state.discardUnsaved();
                void onContinue("discard");
            },
        });
    };
    // 关闭标签页、刷新、后退这类真正离开页面的动作，浏览器只允许同步提示
    useEffect(() => {
        if (!hasUnsaved) return;
        const handleBeforeUnload = (event: BeforeUnloadEvent) => {
            event.preventDefault();
            event.returnValue = "";
        };
        window.addEventListener("beforeunload", handleBeforeUnload);
        return () => window.removeEventListener("beforeunload", handleBeforeUnload);
    }, [hasUnsaved]);
    // App Router 的路由跳转不会触发 beforeunload，这里用导航拦截补上
    useEffect(() => {
        if (!hasUnsaved) return;
        const handleClick = (event: MouseEvent) => {
            const link = (event.target as HTMLElement | null)?.closest<HTMLAnchorElement>("a[href]");
            if (!link || link.target === "_blank") return;
            if (!useScriptStore.getState().hasUnsaved) return;
            event.preventDefault();
            event.stopPropagation();
            const href = link.getAttribute("href") || "/script";
            confirmLeave({
                onContinue: async (choice) => {
                    if (choice === "save" && !await saveAll()) {
                        message.error(translate("script.saveFailedNavigationCanceled"));
                        return;
                    }
                    router.push(href);
                },
            });
        };
        document.addEventListener("click", handleClick, true);
        return () => document.removeEventListener("click", handleClick, true);
    }, [hasUnsaved, router, saveAll]);
    const selectEpisode = (episodeId: string) => {
        setSelectedEpisodeId(episodeId);
        setSelectedSceneId("");
        if (episodeId) setExpandedEpisodeIds((current) => current.includes(episodeId) ? current : [...current, episodeId]);
        const episode = project?.episodes.find((item) => item.id === episodeId);
        setAiTarget(episode ? { targetType: "episode", targetId: episode.id, label: episode.title } : null);
    };
    const selectScene = useCallback((sceneId: string, episodeId = selectedEpisodeId) => {
        if (episodeId !== selectedEpisodeId) setSelectedEpisodeId(episodeId);
        setSelectedSceneId(sceneId);
        if (episodeId) setExpandedEpisodeIds((current) => current.includes(episodeId) ? current : [...current, episodeId]);
        const episode = useScriptStore.getState().episodes[episodeId];
        const scene = episode?.scenes.find((item) => item.id === sceneId);
        setAiTarget(scene ? { targetType: "scene", targetId: scene.id, label: `${episode.episode.title} · ${scene.title || translate("script.sceneCount", { value0: scene.sceneNumber })}` } : episode ? { targetType: "episode", targetId: episode.episode.id, label: episode.episode.title } : null);
    }, [selectedEpisodeId, setAiTarget]);
    const toggleEpisodeExpansion = (episodeId: string) => setExpandedEpisodeIds((current) => current.includes(episodeId) ? current.filter((id) => id !== episodeId) : [...current, episodeId]);

    const openProduction = async () => {
        if (!project) return;
        // 手动保存后未保存是常态，进入下游前先强制落盘，否则漫剧读到的会是旧内容
        if (useScriptStore.getState().hasUnsaved && !await saveAll()) {
            message.error(translate("script.saveScriptChangesBeforeOpeningComicDrama"));
            return;
        }
        const projectId = project.id;
        try {
            const readiness = await getScriptProductionReadiness(projectId);
            if (useScriptStore.getState().project?.id !== projectId) return;
            modal.confirm({
                width: 620,
                title: translate("script.preProductionCheck"),
                content: <div className="mt-4 space-y-3">{readiness.items.map((item) => <div key={item.key} className="flex gap-3 rounded-lg border border-[var(--studio-line)] p-3">{item.status === "ready" ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-[var(--studio-success)]" /> : <CircleAlert className={`mt-0.5 size-5 shrink-0 ${item.status === "missing" ? "text-[var(--studio-danger)]" : "text-[var(--studio-warning)]"}`} />}<div><div className="flex items-center gap-2"><strong>{readinessItemText(item, translate).title}</strong><Tag color={item.status === "ready" ? "green" : item.status === "missing" ? "red" : "gold"}>{item.status === "ready" ? translate("script.available") : item.status === "missing" ? translate("script.missing") : translate("script.suggestedAdditions")}</Tag></div><p className="mt-1 text-sm text-[var(--studio-muted)]">{readinessItemText(item, translate).description}</p></div></div>)}{!readiness.ready ? <Alert type="warning" showIcon title={translate("script.requiredItemsAreStillMissing")} description={translate("script.returnToCompleteTheContentOrContinueWithMissingItems")} /> : null}</div>,
                okText: readiness.ready ? translate("script.openComicDrama") : translate("script.continueWithMissingItems"),
                cancelText: translate("script.returnToComplete"),
                onOk: async () => {
                    // 准备度检查是弹窗打开前算的，这期间用户可能又改了内容，再落一次盘
                    if (useScriptStore.getState().hasUnsaved && !await saveAll()) {
                        message.error(translate("script.theScriptHasNewUnsavedChangesSaveBeforeConfirming"));
                        return;
                    }
                    const latestProject = useScriptStore.getState().project;
                    if (!latestProject || latestProject.id !== projectId) {
                        message.warning(translate("script.theScriptProjectHasChangedCheckProductionReadinessAgain"));
                        return;
                    }
                    setEntering(true);
                    try {
                        await enterComicDrama(projectId, latestProject.revision);
                        router.push(`/comic-drama?scriptProjectId=${encodeURIComponent(projectId)}`);
                    } catch (requestError) {
                        message.error(requestError instanceof Error ? requestError.message : translate("script.couldNotOpenComicDrama"));
                    } finally { setEntering(false); }
                },
            });
        } catch (requestError) {
            if (useScriptStore.getState().project?.id === projectId) {
                message.error(requestError instanceof Error ? requestError.message : translate("script.readinessCheckFailed"));
            }
        }
    };

    const leaveProjectList = () => {
        if (!hasUnsaved) {
            router.push("/script");
            return;
        }
        confirmLeave({
            onContinue: async (choice) => {
                if (choice === "save" && !await saveAll()) {
                    message.error(translate("script.saveFailedReturnNavigationCanceled"));
                    return;
                }
                router.push("/script");
            },
        });
    };
    if (loading && !project) return <main className="studio-page flex h-full items-center justify-center"><Spin size="large" /></main>;
    if (error && !project) return <main className="studio-page flex h-full items-center justify-center p-6"><Alert type="error" showIcon title={translate("script.couldNotOpenTheScript")} description={error} action={<Button onClick={() => void loadProject(params.id).catch(() => undefined)}>{translate("script.retry")}</Button>} /></main>;
    if (!project) return null;

    return (
        <main className="studio-page flex h-full min-h-0 flex-col overflow-hidden">
            {/* 右侧预留全局浮动操作区（社群/版本对比/文档/GitHub/个人中心，fixed right-3 约 300px）的宽度，避免两组按钮重叠 */}
            <header className="flex flex-wrap items-center gap-3 border-b border-[var(--studio-line)] bg-[var(--studio-panel-solid)] py-3 pl-4 pr-[300px]">
                <Button type="text" aria-label={translate("script.backToProjectLibrary")} icon={<ArrowLeft className="size-4" />} onClick={leaveProjectList} />
                <div className="min-w-0 flex-1"><h1 className="truncate text-base font-semibold text-[var(--studio-ink)]">{project.overview.title}</h1><div className="mt-1 flex items-center gap-2 text-xs text-[var(--studio-faint)]"><span>{getSaveLabels(translate)[saveStatus]}</span><span>{translate("script.revisionCount_95045f", { value0: project.revision })}</span><span>{project.completionRate}%</span></div></div>
                <Progress type="circle" size={34} percent={project.completionRate} strokeWidth={10} format={(percent) => `${percent}`} strokeColor="var(--studio-primary)" />
                <Button className="lg:hidden" icon={<ListTree className="size-4" />} onClick={() => setDirectoryOpen(true)}>{translate("script.contents_41e524")}</Button>
                {AI_PANEL_SECTIONS.includes(section) ? <Button className="xl:hidden" icon={<Bot className="size-4" />} onClick={() => setAssistantOpen(true)}>AI</Button> : null}
                <Button type="primary" icon={<Save className="size-4" />} disabled={!hasUnsaved || saveStatus === "saving"} loading={saveStatus === "saving"} onClick={() => void saveAll().then((success) => { if (!success) message.error(translate("script.saveFailedCheckTheNetworkOrVersionConflict")); })}>{translate("script.save")}</Button>
                <Button type="primary" ghost loading={entering} icon={<Sparkles className="size-4" />} onClick={() => void openProduction()}>{translate("script.openComicDrama")}</Button>
            </header>

            {error ? <Alert banner type="warning" title={error} action={<Button size="small" onClick={() => void loadSupportingData().catch(() => undefined)}>{translate("script.retryLoading")}</Button>} /> : null}
            {saveStatus === "error" ? <Alert banner type="error" title={saveError || translate("script.saveFailedYourEditsRemainOnThisPage")} action={<Button size="small" onClick={retrySave}>{translate("script.retrySave")}</Button>} /> : null}
            {saveStatus === "conflict" ? <Alert banner type="warning" title={translate("script.theCloudVersionWasUpdatedElsewhereYourEditsRemainHere")} action={<Button size="small" onClick={() => modal.confirm({ title: translate("script.reloadCloudVersion"), content: translate("script.unsavedChangesOnThisPageWillBeLostCopyImportant"), okText: translate("script.confirmReload"), cancelText: translate("script.cancel"), onOk: () => reloadProject() })}>{translate("script.reloadCloudVersion_2c8fdf")}</Button>} /> : null}

            <div className={`grid min-h-0 flex-1 lg:grid-cols-[260px_minmax(0,1fr)] ${AI_PANEL_SECTIONS.includes(section) ? "xl:grid-cols-[260px_minmax(0,1fr)_360px]" : ""}`}>
                <aside className="hidden min-h-0 overflow-y-auto border-r border-[var(--studio-line)] bg-[var(--studio-panel-solid)] p-3 lg:block"><Directory section={section} selectedEpisodeId={selectedEpisodeId} selectedSceneId={selectedSceneId} expandedEpisodeIds={expandedEpisodeIds} onToggleEpisode={toggleEpisodeExpansion} onSelectSection={selectSection} onSelectEpisode={(episodeId) => { selectEpisode(episodeId); setSection("episodes"); }} onSelectScene={(episodeId, sceneId) => { selectScene(sceneId, episodeId); setSection("episodes"); }} onCreatedScene={(episodeId, sceneId) => { selectScene(sceneId, episodeId); setSceneEditRequestId(sceneId); setSection("episodes"); }} /></aside>
                {section === "episodes" ? <ScriptEpisodeReader selectedEpisodeId={selectedEpisodeId} selectedSceneId={selectedSceneId} sceneEditRequestId={sceneEditRequestId} onSceneEditRequestHandled={() => setSceneEditRequestId("")} onSelectEpisode={selectEpisode} onSelectScene={selectScene} onOpenAiGeneration={() => setAssistantOpen(true)} /> : section === "outline" ? <ScriptOutlineWorkspace key={project.id} onOpenAiGeneration={() => setAssistantOpen(true)} /> : section === "source" ? <ScriptSourcePanel focus={sourceFocus} /> : section === "storyBible" ? <StoryBiblePanel onOpenSource={(start, end) => { setSourceFocus({ start, end, key: nanoid() }); setSection("source"); }} /> : section === "adaptation" ? <NovelAdaptationPanel /> : <>
                    <section className="min-h-0 overflow-y-auto p-4 sm:p-6"><div className="mx-auto max-w-5xl rounded-xl border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] p-4 sm:p-6"><ScriptSectionEditor section={section} /></div></section>
                </>}
                {AI_PANEL_SECTIONS.includes(section) ? <div className="hidden min-h-0 border-l border-[var(--studio-line)] xl:block"><ScriptAiPanel section={section} selectedEpisodeId={selectedEpisodeId} /></div> : null}
            </div>

            <Drawer title={translate("script.scriptContents")} placement="left" size={300} open={directoryOpen} onClose={() => setDirectoryOpen(false)}><Directory section={section} selectedEpisodeId={selectedEpisodeId} selectedSceneId={selectedSceneId} expandedEpisodeIds={expandedEpisodeIds} onToggleEpisode={toggleEpisodeExpansion} onSelectSection={selectSection} onSelectEpisode={(episodeId) => { selectEpisode(episodeId); setSection("episodes"); setDirectoryOpen(false); }} onSelectScene={(episodeId, sceneId) => { selectScene(sceneId, episodeId); setSection("episodes"); setDirectoryOpen(false); }} onCreatedScene={(episodeId, sceneId) => { selectScene(sceneId, episodeId); setSceneEditRequestId(sceneId); setSection("episodes"); setDirectoryOpen(false); }} /></Drawer>
            <Drawer title={translate("script.aiScriptAssistant")} placement="right" size="min(380px, 100vw)" open={assistantOpen} onClose={() => setAssistantOpen(false)} styles={{ body: { padding: 0 } }}><ScriptAiPanel section={section} selectedEpisodeId={selectedEpisodeId} /></Drawer>
        </main>
    );
}

function Directory({ section, selectedEpisodeId, selectedSceneId, expandedEpisodeIds, onToggleEpisode, onSelectSection, onSelectEpisode, onSelectScene, onCreatedScene }: { section: ScriptWorkspaceSection; selectedEpisodeId: string; selectedSceneId: string; expandedEpisodeIds: string[]; onToggleEpisode: (episodeId: string) => void; onSelectSection: (section: ScriptWorkspaceSection) => void; onSelectEpisode: (episodeId: string) => void; onSelectScene: (episodeId: string, sceneId: string) => void; onCreatedScene: (episodeId: string, sceneId: string) => void }) {
    const translate = useTranslation();
    const { message } = App.useApp();
    const project = useScriptStore((state) => state.project);
    const episodes = useScriptStore((state) => state.episodes);
    const loadEpisode = useScriptStore((state) => state.loadEpisode);
    const updateEpisode = useScriptStore((state) => state.updateEpisode);
    const createEpisode = useScriptStore((state) => state.createEpisode);
    const [loadingEpisodeIds, setLoadingEpisodeIds] = useState<string[]>([]);
    const [episodeLoadErrors, setEpisodeLoadErrors] = useState<Record<string, string>>({});
    const [creatingSceneEpisodeIds, setCreatingSceneEpisodeIds] = useState<string[]>([]);
    if (!project) return null;
    const loadScenes = (episodeId: string) => {
        if (useScriptStore.getState().episodes[episodeId] || loadingEpisodeIds.includes(episodeId)) return;
        setLoadingEpisodeIds((current) => [...current, episodeId]);
        setEpisodeLoadErrors((current) => ({ ...current, [episodeId]: "" }));
        void loadEpisode(episodeId).catch((error: unknown) => {
            setEpisodeLoadErrors((current) => ({ ...current, [episodeId]: error instanceof Error ? error.message : translate("script.couldNotLoadScenes") }));
        }).finally(() => setLoadingEpisodeIds((current) => current.filter((id) => id !== episodeId)));
    };
    const addEpisode = () => {
        const id = createEpisode();
        if (id) onSelectEpisode(id);
    };
    const addScene = async (episodeId: string) => {
        if (creatingSceneEpisodeIds.includes(episodeId)) return;
        setCreatingSceneEpisodeIds((current) => [...current, episodeId]);
        try {
            const detail = useScriptStore.getState().episodes[episodeId] || await loadEpisode(episodeId);
            if (useScriptStore.getState().project?.id !== project.id) return;
            const latestDetail = useScriptStore.getState().episodes[episodeId] || detail;
            const scene = createScriptScene(latestDetail.scenes.length, translate);
            updateEpisode({ ...latestDetail, scenes: [...latestDetail.scenes, scene] });
            onCreatedScene(episodeId, scene.id);
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("script.couldNotAddTheSceneTryAgain"));
        } finally {
            setCreatingSceneEpisodeIds((current) => current.filter((id) => id !== episodeId));
        }
    };
    return (
        <nav aria-label={translate("script.scriptWorkspaceContents")}>
            {getNavigationGroups(translate).map((group, groupIndex) => (
                <div key={group.label} className={groupIndex ? "mt-5 border-t border-[var(--studio-line)] pt-4" : ""}>
                    <p className="px-3 text-xs font-medium uppercase tracking-wide text-[var(--studio-faint)]">{group.label}</p>
                    <div className="mt-2 space-y-1">
                        {group.items.map((item) => {
                            const Icon = item.icon;
                            const isActive = section === item.key;
                            return (
                                <button
                                    key={item.key}
                                    type="button"
                                    // 激活态与左侧主导航同源，用内联样式避免被 utilities 层或样式表缓存干扰（图标/文字继承 currentColor）。
                                    style={isActive ? { background: "var(--studio-action)", color: "var(--studio-action-foreground)" } : undefined}
                                    className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-[var(--studio-primary)] ${
                                        isActive
                                            ? "font-semibold shadow-sm"
                                            : "text-[var(--studio-text)] hover:bg-[var(--studio-surface-hover)]"
                                    }`}
                                    onClick={() => onSelectSection(item.key)}
                                >
                                    <Icon className="size-4 shrink-0 text-current" aria-hidden="true" />
                                    <span className="text-current">{item.label}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            ))}
            <div className="mt-5 border-t border-[var(--studio-line)] pt-4">
                <p className="px-3 text-xs font-medium uppercase tracking-wide text-[var(--studio-faint)]">{translate("script.episodesAndScenes")}</p>
                <div className="mt-2 space-y-1">
                    {project.episodes.map((episode) => {
                        const isEpActive = episode.id === selectedEpisodeId;
                        const isCoverActive = section === "episodes" && isEpActive && !selectedSceneId;
                        const isExpanded = expandedEpisodeIds.includes(episode.id);
                        const detail = episodes[episode.id];
                        return (
                            <div key={episode.id}>
                                <div className="flex items-center gap-1">
                                    <button type="button" aria-expanded={isExpanded} aria-label={translate("script.countScenesForEpisodeCount", { value0: isExpanded ? translate("script.collapse") : translate("script.expand_b0e248"), value1: episode.episodeNumber })} className="flex size-11 shrink-0 items-center justify-center rounded-md text-[var(--studio-muted)] hover:bg-[var(--studio-surface-hover)] focus-visible:outline-2 focus-visible:outline-[var(--studio-action)]" onClick={() => { onToggleEpisode(episode.id); if (!isExpanded) loadScenes(episode.id); }}>
                                        {isExpanded ? <ChevronDown className="size-4" aria-hidden="true" /> : <ChevronRight className="size-4" aria-hidden="true" />}
                                    </button>
                                    <button
                                        type="button"
                                        aria-current={section === "episodes" && isEpActive && !selectedSceneId ? "page" : undefined}
                                        style={isCoverActive ? { background: "var(--studio-action)", color: "var(--studio-action-foreground)" } : isEpActive && section === "episodes" ? { background: "var(--studio-primary-soft)", color: "var(--studio-action)" } : undefined}
                                        className={`min-w-0 flex-1 truncate rounded-lg px-2 py-2 text-left text-sm focus-visible:outline-2 focus-visible:outline-[var(--studio-action)] ${isEpActive && section === "episodes" ? "font-semibold" : "text-[var(--studio-muted)] hover:bg-[var(--studio-surface-hover)]"}`}
                                        onClick={() => onSelectEpisode(episode.id)}
                                        title={translate("script.episodeCountCount", { value0: episode.episodeNumber, value1: episode.title })}
                                    >{translate("script.episodeCountCount_be6362", { value0: episode.episodeNumber, value1: episode.title })}</button>
                                    <button type="button" aria-label={translate("script.addSceneToEpisodeCount", { value0: episode.episodeNumber })} title={translate("script.addScene")} disabled={creatingSceneEpisodeIds.includes(episode.id)} className="flex size-11 shrink-0 items-center justify-center rounded-md text-[var(--studio-muted)] hover:bg-[var(--studio-surface-hover)] hover:text-[var(--studio-ink)] focus-visible:outline-2 focus-visible:outline-[var(--studio-action)] disabled:opacity-50" onClick={() => void addScene(episode.id)}><Plus className="size-4" aria-hidden="true" /></button>
                                </div>
                                {isExpanded ? (
                                    <div className={styles.sceneGroup}>
                                        {detail?.scenes.map((scene) => {
                                            const isSceneActive = section === "episodes" && selectedSceneId === scene.id;
                                            return (
                                                <button
                                                    key={scene.id}
                                                    type="button"
                                                    aria-current={isSceneActive ? "page" : undefined}
                                                    style={isSceneActive ? { background: "var(--studio-action)", color: "var(--studio-action-foreground)" } : undefined}
                                                    className={`${styles.sceneItem} block w-full truncate rounded-md px-2 py-1.5 text-left text-xs transition-colors focus-visible:outline-2 focus-visible:outline-[var(--studio-action)] ${
                                                        isSceneActive
                                                            ? "font-semibold shadow-sm"
                                                            : "text-[var(--studio-muted)] hover:bg-[var(--studio-surface-soft)] hover:text-[var(--studio-ink)]"
                                                    }`}
                                                    onClick={() => onSelectScene(episode.id, scene.id)}
                                                    title={translate("script.sceneCountCount", { value0: scene.sceneNumber, value1: scene.title || translate("script.untitledScene") })}
                                                >{translate("script.sceneCountCount_aa4765", { value0: scene.sceneNumber, value1: scene.title || translate("script.untitledScene") })}</button>
                                            );
                                        })}
                                        {!detail && !episodeLoadErrors[episode.id] ? <div className="px-2 py-1.5 text-xs text-[var(--studio-faint)]"><span>{loadingEpisodeIds.includes(episode.id) ? translate("script.loadingScenes") : translate("script.scenesNotLoadedYet")}</span>{!loadingEpisodeIds.includes(episode.id) ? <button type="button" className="ml-2 underline focus-visible:outline-2 focus-visible:outline-[var(--studio-action)]" onClick={() => loadScenes(episode.id)}>{translate("script.load")}</button> : null}</div> : null}
                                        {!detail && episodeLoadErrors[episode.id] ? <div className="px-2 py-1.5 text-xs text-[var(--studio-danger)]"><span>{episodeLoadErrors[episode.id]}</span><button type="button" className="ml-2 underline focus-visible:outline-2 focus-visible:outline-[var(--studio-action)]" onClick={() => loadScenes(episode.id)}>{translate("script.retry")}</button></div> : null}
                                        {detail && !detail.scenes.length ? <p className="px-2 py-1.5 text-xs text-[var(--studio-faint)]">{translate("script.noScenesYet")}</p> : null}
                                    </div>
                                ) : null}
                            </div>
                        );
                    })}
                    {!project.episodes.length ? (
                        <p className="px-3 py-2 text-xs text-[var(--studio-faint)]">{translate("script.noEpisodesCreatedYet")}</p>
                    ) : null}
                    <button type="button" className="mt-3 flex w-full items-center gap-2 rounded-lg border border-dashed border-[var(--studio-line-strong)] px-3 py-2 text-left text-sm text-[var(--studio-muted)] hover:border-[var(--studio-action)] hover:text-[var(--studio-ink)] focus-visible:outline-2 focus-visible:outline-[var(--studio-action)]" onClick={addEpisode}><Plus className="size-4" aria-hidden="true" />{translate("script.addEpisode")}</button>
                </div>
            </div>
        </nav>
    );
}
