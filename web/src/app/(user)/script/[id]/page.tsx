"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { App, Alert, Button, Drawer, Progress, Spin, Tag } from "antd";
import { ArrowLeft, Bot, BookOpenText, CheckCircle2, CircleAlert, FileClock, Globe2, ListTree, ScrollText, Sparkles, Users, WandSparkles } from "lucide-react";

import { enterComicDrama, getScriptProductionReadiness } from "@/services/api/script";
import { ScriptAiPanel } from "@/features/script/components/script-ai-panel";
import { ScriptSectionEditor } from "@/features/script/components/section-editors";
import { useScriptStore } from "@/features/script/stores/use-script-store";
import type { ScriptWorkspaceSection } from "@/features/script/types";

const NAVIGATION: Array<{ key: ScriptWorkspaceSection; label: string; icon: typeof BookOpenText }> = [
    { key: "overview", label: "故事概览", icon: BookOpenText },
    { key: "outline", label: "故事大纲", icon: ListTree },
    { key: "characters", label: "人物与关系", icon: Users },
    { key: "world", label: "世界观与地点", icon: Globe2 },
    { key: "episodes", label: "分集剧本", icon: ScrollText },
    { key: "analysis", label: "专业分析", icon: WandSparkles },
    { key: "versions", label: "版本记录", icon: FileClock },
];

const SAVE_LABELS = { idle: "尚未修改", dirty: "有未保存修改", saving: "保存中", saved: "已保存", error: "保存失败", conflict: "版本冲突" };

export default function ScriptWorkspacePage() {
    const params = useParams<{ id: string }>();
    const router = useRouter();
    const { message, modal } = App.useApp();
    const project = useScriptStore((state) => state.project);
    const loading = useScriptStore((state) => state.loading);
    const error = useScriptStore((state) => state.error);
    const saveStatus = useScriptStore((state) => state.saveStatus);
    const saveError = useScriptStore((state) => state.saveError);
    const loadProject = useScriptStore((state) => state.loadProject);
    const reloadProject = useScriptStore((state) => state.reloadProject);
    const loadSupportingData = useScriptStore((state) => state.loadSupportingData);
    const retrySave = useScriptStore((state) => state.retrySave);
    const setAiTarget = useScriptStore((state) => state.setAiTarget);
    const [section, setSection] = useState<ScriptWorkspaceSection>("overview");
    const [selectedEpisodeId, setSelectedEpisodeId] = useState("");
    const [directoryOpen, setDirectoryOpen] = useState(false);
    const [assistantOpen, setAssistantOpen] = useState(false);
    const [entering, setEntering] = useState(false);

    useEffect(() => {
        const projectId = params.id;
        if (!projectId) return;
        setSelectedEpisodeId("");
        void loadProject(projectId).then(() => loadSupportingData()).catch(() => undefined);
    }, [loadProject, loadSupportingData, params.id]);
    useEffect(() => {
        if (!selectedEpisodeId && project?.episodes.length) {
            const first = project.episodes[0];
            setSelectedEpisodeId(first.id);
            setAiTarget({ targetType: "episode", targetId: first.id, label: first.title });
        }
    }, [project?.episodes, selectedEpisodeId, setAiTarget]);

    const selectSection = (next: ScriptWorkspaceSection) => {
        setSection(next);
        setDirectoryOpen(false);
        if (["overview", "outline", "characters", "world"].includes(next)) setAiTarget(null);
    };
    const selectEpisode = (episodeId: string) => {
        setSelectedEpisodeId(episodeId);
        const episode = project?.episodes.find((item) => item.id === episodeId);
        setAiTarget(episode ? { targetType: "episode", targetId: episode.id, label: episode.title } : null);
    };

    const openProduction = async () => {
        if (!project) return;
        if (!["saved", "idle"].includes(useScriptStore.getState().saveStatus)) {
            message.warning("请等待当前剧本修改保存完成，再检查生产准备度");
            return;
        }
        const projectId = project.id;
        try {
            const readiness = await getScriptProductionReadiness(projectId);
            if (useScriptStore.getState().project?.id !== projectId) return;
            modal.confirm({
                width: 620,
                title: "进入漫剧创作前检查",
                content: <div className="mt-4 space-y-3">{readiness.items.map((item) => <div key={item.key} className="flex gap-3 rounded-lg border border-[var(--studio-line)] p-3">{item.status === "ready" ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-[var(--studio-success)]" /> : <CircleAlert className={`mt-0.5 size-5 shrink-0 ${item.status === "missing" ? "text-[var(--studio-danger)]" : "text-[var(--studio-warning)]"}`} />}<div><div className="flex items-center gap-2"><strong>{item.title}</strong><Tag color={item.status === "ready" ? "green" : item.status === "missing" ? "red" : "gold"}>{item.status === "ready" ? "已具备" : item.status === "missing" ? "缺失" : "建议补充"}</Tag></div><p className="mt-1 text-sm text-[var(--studio-muted)]">{item.description}</p></div></div>)}{!readiness.ready ? <Alert type="warning" showIcon title="仍有必需项缺失" description="你可以返回补充，也可以忽略缺失项继续。进入制作只会标记当前项目，不会复制内容或扣除积分。" /> : null}</div>,
                okText: readiness.ready ? "进入漫剧创作" : "忽略缺失并继续",
                cancelText: "返回补充",
                onOk: async () => {
                    if (!["saved", "idle"].includes(useScriptStore.getState().saveStatus)) {
                        message.warning("剧本又有未保存修改，请保存完成后重新确认");
                        return;
                    }
                    const latestProject = useScriptStore.getState().project;
                    if (!latestProject || latestProject.id !== projectId) {
                        message.warning("当前剧本项目已经切换，请重新检查生产准备度");
                        return;
                    }
                    setEntering(true);
                    try {
                        await enterComicDrama(projectId, latestProject.revision);
                        router.push(`/comic-drama?scriptProjectId=${encodeURIComponent(projectId)}`);
                    } catch (requestError) {
                        message.error(requestError instanceof Error ? requestError.message : "进入漫剧创作失败");
                    } finally { setEntering(false); }
                },
            });
        } catch (requestError) {
            if (useScriptStore.getState().project?.id === projectId) {
                message.error(requestError instanceof Error ? requestError.message : "准备度检查失败");
            }
        }
    };

    if (loading && !project) return <main className="studio-page flex h-full items-center justify-center"><Spin size="large" /></main>;
    if (error && !project) return <main className="studio-page flex h-full items-center justify-center p-6"><Alert type="error" showIcon title="无法打开剧本" description={error} action={<Button onClick={() => void loadProject(params.id).catch(() => undefined)}>重试</Button>} /></main>;
    if (!project) return null;

    return (
        <main className="studio-page flex h-full min-h-0 flex-col overflow-hidden">
            {/* 右侧预留全局浮动操作区（版本对比/文档/GitHub/个人中心，fixed right-3 约 256px）的宽度，避免两组按钮重叠 */}
            <header className="flex flex-wrap items-center gap-3 border-b border-[var(--studio-line)] bg-[var(--studio-panel-solid)] py-3 pl-4 pr-[260px]">
                <Button type="text" aria-label="返回项目库" icon={<ArrowLeft className="size-4" />} onClick={() => router.push("/script")} />
                <div className="min-w-0 flex-1"><h1 className="truncate text-base font-semibold text-[var(--studio-ink)]">{project.overview.title}</h1><div className="mt-1 flex items-center gap-2 text-xs text-[var(--studio-faint)]"><span>{SAVE_LABELS[saveStatus]}</span><span>修订 {project.revision}</span><span>{project.completionRate}%</span></div></div>
                <Progress type="circle" size={34} percent={project.completionRate} strokeWidth={10} format={(percent) => `${percent}`} strokeColor="var(--studio-primary)" />
                <Button className="lg:hidden" icon={<ListTree className="size-4" />} onClick={() => setDirectoryOpen(true)}>目录</Button>
                <Button className="xl:hidden" icon={<Bot className="size-4" />} onClick={() => setAssistantOpen(true)}>AI</Button>
                <Button type="primary" loading={entering} icon={<Sparkles className="size-4" />} onClick={() => void openProduction()}>进入漫剧创作</Button>
            </header>

            {error ? <Alert banner type="warning" title={error} action={<Button size="small" onClick={() => void loadSupportingData().catch(() => undefined)}>重试加载</Button>} /> : null}
            {saveStatus === "error" ? <Alert banner type="error" title={saveError || "保存失败，编辑内容仍保留在本地页面中。"} action={<Button size="small" onClick={retrySave}>重试保存</Button>} /> : null}
            {saveStatus === "conflict" ? <Alert banner type="warning" title="云端版本已被其他页面更新，自动保存已暂停。当前页面编辑内容仍保留，请确认后重载云端版本。" action={<Button size="small" onClick={() => modal.confirm({ title: "重载云端版本？", content: "当前页面未保存的修改会丢失。建议先复制重要内容后再重载。", okText: "确认重载", cancelText: "取消", onOk: () => reloadProject() })}>重载云端版本</Button>} /> : null}

            <div className="grid min-h-0 flex-1 lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)_360px]">
                <aside className="hidden min-h-0 overflow-y-auto border-r border-[var(--studio-line)] bg-[var(--studio-panel-solid)] p-3 lg:block"><Directory section={section} selectedEpisodeId={selectedEpisodeId} onSelectSection={selectSection} onSelectEpisode={(episodeId) => { selectEpisode(episodeId); setSection("episodes"); }} /></aside>
                <section className="min-h-0 overflow-y-auto p-4 sm:p-6"><div className="mx-auto max-w-5xl rounded-xl border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] p-4 sm:p-6"><ScriptSectionEditor section={section} selectedEpisodeId={selectedEpisodeId} onSelectEpisode={selectEpisode} /></div></section>
                <div className="hidden min-h-0 border-l border-[var(--studio-line)] xl:block"><ScriptAiPanel section={section} selectedEpisodeId={selectedEpisodeId} /></div>
            </div>

            <Drawer title="剧本目录" placement="left" size={300} open={directoryOpen} onClose={() => setDirectoryOpen(false)}><Directory section={section} selectedEpisodeId={selectedEpisodeId} onSelectSection={selectSection} onSelectEpisode={(episodeId) => { selectEpisode(episodeId); setSection("episodes"); setDirectoryOpen(false); }} /></Drawer>
            <Drawer title="AI 剧本助手" placement="right" size="min(380px, 100vw)" open={assistantOpen} onClose={() => setAssistantOpen(false)} styles={{ body: { padding: 0 } }}><ScriptAiPanel section={section} selectedEpisodeId={selectedEpisodeId} /></Drawer>
        </main>
    );
}

function Directory({ section, selectedEpisodeId, onSelectSection, onSelectEpisode }: { section: ScriptWorkspaceSection; selectedEpisodeId: string; onSelectSection: (section: ScriptWorkspaceSection) => void; onSelectEpisode: (episodeId: string) => void }) {
    const project = useScriptStore((state) => state.project);
    const selectedEpisode = useScriptStore((state) => selectedEpisodeId ? state.episodes[selectedEpisodeId] : undefined);
    const setAiTarget = useScriptStore((state) => state.setAiTarget);
    const aiTarget = useScriptStore((state) => state.aiTarget);
    if (!project) return null;
    return (
        <nav aria-label="剧本工作台目录">
            <div className="space-y-1">
                {NAVIGATION.map((item) => {
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
            <div className="mt-5 border-t border-[var(--studio-line)] pt-4">
                <p className="px-3 text-xs font-medium uppercase tracking-wide text-[var(--studio-faint)]">分集与场次</p>
                <div className="mt-2 space-y-1">
                    {project.episodes.map((episode) => {
                        const isEpActive = episode.id === selectedEpisodeId;
                        return (
                            <div key={episode.id}>
                                <button
                                    type="button"
                                    aria-expanded={isEpActive}
                                    // 同上：选中态与主导航同一组变量，内联样式保证一定生效。
                                    style={isEpActive ? { background: "var(--studio-action)", color: "var(--studio-action-foreground)" } : undefined}
                                    className={`block w-full truncate rounded-lg px-3 py-2 text-left text-sm focus-visible:outline-2 focus-visible:outline-[var(--studio-primary)] ${
                                        isEpActive
                                            ? "font-semibold shadow-sm"
                                            : "text-[var(--studio-muted)] hover:bg-[var(--studio-surface-soft)]"
                                    }`}
                                    onClick={() => onSelectEpisode(episode.id)}
                                >
                                    第 {episode.episodeNumber} 集 · {episode.title}
                                </button>
                                {isEpActive && selectedEpisode?.scenes.length ? (
                                    <div className="ml-4 mt-1 space-y-1 border-l border-[var(--studio-line)] pl-2">
                                        {selectedEpisode.scenes.map((scene) => {
                                            const isSceneActive = aiTarget?.targetType === "scene" && aiTarget?.targetId === scene.id;
                                            return (
                                                <button
                                                    key={scene.id}
                                                    type="button"
                                                    // 同上：场次选中态与主导航同一组变量。
                                                    style={isSceneActive ? { background: "var(--studio-action)", color: "var(--studio-action-foreground)" } : undefined}
                                                    className={`block w-full truncate rounded-md px-2 py-1.5 text-left text-xs transition-colors focus-visible:outline-2 focus-visible:outline-[var(--studio-primary)] ${
                                                        isSceneActive
                                                            ? "font-semibold shadow-sm"
                                                            : "text-[var(--studio-muted)] hover:bg-[var(--studio-surface-soft)] hover:text-[var(--studio-ink)]"
                                                    }`}
                                                    onClick={() => {
                                                        onSelectEpisode(episode.id);
                                                        setAiTarget({
                                                            targetType: "scene",
                                                            targetId: scene.id,
                                                            label: `${episode.title} · ${scene.title || `第 ${scene.sceneNumber} 场`}`,
                                                        });
                                                    }}
                                                >
                                                    第 {scene.sceneNumber} 场 · {scene.title || "未命名场次"}
                                                </button>
                                            );
                                        })}
                                    </div>
                                ) : null}
                            </div>
                        );
                    })}
                    {!project.episodes.length ? (
                        <p className="px-3 py-2 text-xs text-[var(--studio-faint)]">尚未创建分集</p>
                    ) : null}
                </div>
            </div>
        </nav>
    );
}
