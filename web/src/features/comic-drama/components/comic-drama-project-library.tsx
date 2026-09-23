"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Empty, Input, Modal, Pagination, Progress, Select, Skeleton } from "antd";
import { BookOpenText, CheckCircle2, CircleAlert, Clapperboard, Clock3, FilePlus2, ListChecks, RefreshCw, Search } from "lucide-react";

import { initializeComicDramaProject, listComicDramaProjects } from "@/services/api/comic-drama";
import { createScriptProject, listScriptProjects } from "@/services/api/script";
import type { ComicDramaProjectSummary, ComicDramaProjectType } from "@/features/comic-drama/types";
import type { ScriptProjectSummary } from "@/features/script/types";

const PAGE_SIZE = 12;

const PROJECT_TYPES: Array<{ value: ComicDramaProjectType; label: string }> = [
    { value: "comicDrama", label: "漫剧" },
    { value: "liveActionShort", label: "真人短剧" },
    { value: "animation", label: "动画" },
    { value: "advertisement", label: "广告故事" },
    { value: "musicVideo", label: "音乐视频" },
    { value: "storyShort", label: "故事短片" },
];

const SCRIPT_STAGE_LABELS: Record<string, string> = {
    idea: "构思中",
    outline: "大纲中",
    writing: "编写中",
    completed: "已完成",
    production: "已进入制作",
};

const PRODUCTION_STAGE_LABELS: Record<string, string> = {
    preparing: "生产准备",
    producing: "制作中",
    paused: "已暂停",
    idea: "剧本构思",
    outline: "剧本大纲",
    writing: "剧本编写",
    production: "进入制作",
    completed: "已完成",
    readiness: "生产准备",
    settings: "生产设置",
    assets: "资产制作",
    shots: "镜头拆分",
    storyboard: "分镜规划",
    media: "媒体生成",
    sound: "声音制作",
    canvas: "成片编排",
    updates: "待更新处理",
    ready: "生产完成",
};

function projectTypeLabel(projectType: string) {
    return PROJECT_TYPES.find((item) => item.value === projectType)?.label || projectType || "未设置类型";
}

function productionStageLabel(stage: string) {
    return PRODUCTION_STAGE_LABELS[stage] || stage || "尚未开始";
}

function formatUpdatedAt(updatedAt: string) {
    return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(updatedAt));
}

function readinessInfo(readiness: ComicDramaProjectSummary["readiness"]) {
    if (readiness === "ready") return { label: "准备就绪", className: "text-[var(--studio-success)]" };
    if (readiness === "attention") return { label: "建议完善", className: "text-[var(--studio-warning)]" };
    return { label: "存在缺失项", className: "text-[var(--studio-danger)]" };
}

/** 漫剧创作项目库，统一管理已初始化项目与共享剧本承接入口。 */
export function ComicDramaProjectLibrary() {
    const router = useRouter();
    const { message } = App.useApp();
    const projectRequestVersion = useRef(0);
    const scriptRequestVersion = useRef(0);
    const [projects, setProjects] = useState<ComicDramaProjectSummary[]>([]);
    const [projectTotal, setProjectTotal] = useState(0);
    const [projectLoading, setProjectLoading] = useState(true);
    const [projectError, setProjectError] = useState("");
    const [page, setPage] = useState(1);
    const [keyword, setKeyword] = useState("");
    const [searchKeyword, setSearchKeyword] = useState("");
    const [createOpen, setCreateOpen] = useState(false);
    const [creating, setCreating] = useState(false);
    const [newProjectTitle, setNewProjectTitle] = useState("");
    const [newProjectLogline, setNewProjectLogline] = useState("");
    const [newProjectType, setNewProjectType] = useState<ComicDramaProjectType>("comicDrama");
    const [createdScriptProjectId, setCreatedScriptProjectId] = useState("");
    const [scriptSelectorOpen, setScriptSelectorOpen] = useState(false);
    const [scriptProjects, setScriptProjects] = useState<ScriptProjectSummary[]>([]);
    const [scriptProjectTotal, setScriptProjectTotal] = useState(0);
    const [scriptLoading, setScriptLoading] = useState(false);
    const [scriptError, setScriptError] = useState("");
    const [scriptPage, setScriptPage] = useState(1);
    const [scriptKeyword, setScriptKeyword] = useState("");
    const [searchScriptKeyword, setSearchScriptKeyword] = useState("");
    const [selectedScriptProjectId, setSelectedScriptProjectId] = useState("");
    const [initializingScriptProjectId, setInitializingScriptProjectId] = useState("");

    const loadProjects = useCallback(async () => {
        const requestVersion = ++projectRequestVersion.current;
        setProjectLoading(true);
        setProjectError("");
        try {
            const result = await listComicDramaProjects({ page, pageSize: PAGE_SIZE, keyword: searchKeyword });
            if (requestVersion !== projectRequestVersion.current) return;
            setProjects(result.projects);
            setProjectTotal(result.total);
        } catch (requestError) {
            if (requestVersion !== projectRequestVersion.current) return;
            setProjectError(requestError instanceof Error ? requestError.message : "加载漫剧项目失败");
        } finally {
            if (requestVersion === projectRequestVersion.current) setProjectLoading(false);
        }
    }, [page, searchKeyword]);

    const loadScriptProjects = useCallback(async () => {
        const requestVersion = ++scriptRequestVersion.current;
        setScriptLoading(true);
        setScriptError("");
        try {
            const result = await listScriptProjects({ page: scriptPage, pageSize: PAGE_SIZE, keyword: searchScriptKeyword });
            if (requestVersion !== scriptRequestVersion.current) return;
            setScriptProjects(result.projects);
            setScriptProjectTotal(result.total);
        } catch (requestError) {
            if (requestVersion !== scriptRequestVersion.current) return;
            setScriptError(requestError instanceof Error ? requestError.message : "加载剧本项目失败");
        } finally {
            if (requestVersion === scriptRequestVersion.current) setScriptLoading(false);
        }
    }, [scriptPage, searchScriptKeyword]);

    useEffect(() => {
        void loadProjects();
    }, [loadProjects]);

    useEffect(() => {
        if (scriptSelectorOpen) void loadScriptProjects();
    }, [loadScriptProjects, scriptSelectorOpen]);

    const applyProjectSearch = () => {
        const nextKeyword = keyword.trim();
        if (page === 1 && nextKeyword === searchKeyword) {
            void loadProjects();
            return;
        }
        setPage(1);
        setSearchKeyword(nextKeyword);
    };

    const openScriptSelector = () => {
        setSelectedScriptProjectId("");
        setScriptPage(1);
        setScriptKeyword("");
        setSearchScriptKeyword("");
        setScriptSelectorOpen(true);
    };

    const applyScriptSearch = () => {
        const nextKeyword = scriptKeyword.trim();
        setSelectedScriptProjectId("");
        if (scriptPage === 1 && nextKeyword === searchScriptKeyword) {
            void loadScriptProjects();
            return;
        }
        setScriptPage(1);
        setSearchScriptKeyword(nextKeyword);
    };

    const resetCreateForm = () => {
        setNewProjectTitle("");
        setNewProjectLogline("");
        setNewProjectType("comicDrama");
        setCreatedScriptProjectId("");
    };

    const closeCreateModal = () => {
        if (creating) return;
        setCreateOpen(false);
        resetCreateForm();
    };

    const submitNewProject = async () => {
        if (!newProjectTitle.trim()) {
            message.warning("请输入项目名称");
            return;
        }

        setCreating(true);
        let scriptProjectCreated = Boolean(createdScriptProjectId);
        try {
            let scriptProjectId = createdScriptProjectId;
            if (!scriptProjectId) {
                const scriptProject = await createScriptProject({
                    title: newProjectTitle.trim(),
                    contentType: newProjectType,
                    logline: newProjectLogline.trim(),
                });
                scriptProjectId = scriptProject.id;
                scriptProjectCreated = true;
                setCreatedScriptProjectId(scriptProjectId);
            }
            const workspace = await initializeComicDramaProject({ scriptProjectId, projectType: newProjectType });
            message.success("完整漫剧项目已创建");
            setCreateOpen(false);
            resetCreateForm();
            router.push(`/comic-drama?projectId=${encodeURIComponent(workspace.projectId)}`);
        } catch (requestError) {
            const errorMessage = requestError instanceof Error ? requestError.message : "创建项目失败";
            message.error(scriptProjectCreated ? `剧本已创建，但漫剧初始化失败：${errorMessage}` : errorMessage);
        } finally {
            setCreating(false);
        }
    };

    const selectedScriptProject = scriptProjects.find((project) => project.id === selectedScriptProjectId);

    const submitScriptAdoption = async () => {
        if (!selectedScriptProject) {
            message.warning("请先选择一个剧本项目");
            return;
        }

        setInitializingScriptProjectId(selectedScriptProject.id);
        try {
            const workspace = await initializeComicDramaProject({
                scriptProjectId: selectedScriptProject.id,
                projectType: selectedScriptProject.contentType,
            });
            message.success("已承接共享剧本，可继续进行漫剧制作");
            setScriptSelectorOpen(false);
            router.push(`/comic-drama?projectId=${encodeURIComponent(workspace.projectId)}`);
        } catch (requestError) {
            message.error(requestError instanceof Error ? requestError.message : "承接剧本失败，请重试");
        } finally {
            setInitializingScriptProjectId("");
        }
    };

    return (
        <main className="studio-page h-full overflow-y-auto px-4 py-6 sm:px-6" aria-labelledby="comic-drama-page-title">
            <div className="mx-auto flex max-w-7xl flex-col gap-5">
                <header className="flex flex-col gap-4 border-b border-[var(--studio-line)] pb-5 md:flex-row md:items-end md:justify-between">
                    <div>
                        <p className="studio-caption text-xs">叙事视频生产</p>
                        <h1 id="comic-drama-page-title" className="studio-title mt-2 text-2xl font-semibold">漫剧创作</h1>
                        <p className="studio-subtitle mt-2 text-sm">承接共享剧本，管理视觉资产、镜头、分镜与生成任务。</p>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                        <Button size="large" icon={<BookOpenText className="size-4" aria-hidden="true" />} onClick={openScriptSelector}>承接已有剧本</Button>
                        <Button type="primary" size="large" icon={<FilePlus2 className="size-4" aria-hidden="true" />} onClick={() => setCreateOpen(true)}>新建完整项目</Button>
                    </div>
                </header>

                <section className="flex flex-col gap-3 border-b border-[var(--studio-line)] pb-4 sm:flex-row sm:items-end" aria-label="漫剧项目筛选">
                    <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-[var(--studio-text)]">
                        <span>搜索项目</span>
                        <Input
                            allowClear
                            value={keyword}
                            prefix={<Search className="size-4 text-[var(--studio-faint)]" aria-hidden="true" />}
                            placeholder="按项目名称搜索"
                            aria-label="按项目名称搜索"
                            onChange={(event) => setKeyword(event.target.value)}
                            onPressEnter={applyProjectSearch}
                        />
                    </label>
                    <div className="flex gap-2">
                        <Button onClick={applyProjectSearch}>查询</Button>
                        <Button icon={<RefreshCw className="size-4" aria-hidden="true" />} onClick={() => void loadProjects()}>刷新</Button>
                    </div>
                </section>

                <p className="sr-only" aria-live="polite">{projectLoading ? "正在加载漫剧项目" : `已加载 ${projectTotal} 个漫剧项目`}</p>

                {projectError ? (
                    <Alert
                        type="error"
                        showIcon
                        title="漫剧项目库加载失败"
                        description={projectError}
                        action={<Button size="small" onClick={() => void loadProjects()}>重试</Button>}
                    />
                ) : null}

                {projectLoading ? (
                    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="漫剧项目加载中">
                        {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} active className="rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface)] p-5" paragraph={{ rows: 4 }} />)}
                    </section>
                ) : null}

                {!projectLoading && !projectError && projects.length ? (
                    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="漫剧项目列表">
                        {projects.map((project) => {
                            const readiness = readinessInfo(project.readiness);
                            return (
                                <article key={project.projectId} className="overflow-hidden rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface)] transition-colors duration-150 hover:border-[var(--studio-primary-line)] hover:bg-[var(--studio-surface-hover)] motion-reduce:transition-none">
                                    <button
                                        type="button"
                                        className="block min-h-64 w-full p-5 text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--studio-action)]"
                                        aria-label={`打开漫剧项目：${project.title}`}
                                        onClick={() => router.push(`/comic-drama?projectId=${encodeURIComponent(project.projectId)}`)}
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <Clapperboard className="size-5 shrink-0 text-[var(--studio-action)]" aria-hidden="true" />
                                                    <h2 className="truncate text-base font-semibold text-[var(--studio-ink)]" title={project.title}>{project.title}</h2>
                                                </div>
                                                <p className="mt-2 text-xs text-[var(--studio-faint)]">{projectTypeLabel(project.projectType)} · {productionStageLabel(project.stage)}</p>
                                            </div>
                                            <span className={`inline-flex shrink-0 items-center gap-1 text-xs font-medium ${readiness.className}`}>
                                                {project.readiness === "ready" ? <CheckCircle2 className="size-3.5" aria-hidden="true" /> : <CircleAlert className="size-3.5" aria-hidden="true" />}
                                                {readiness.label}
                                            </span>
                                        </div>

                                        <div className="mt-5">
                                            <div className="flex items-center justify-between gap-3 text-sm text-[var(--studio-text)]">
                                                <span>制作进度</span>
                                                <span className="font-medium tabular-nums text-[var(--studio-ink)]">{project.completionRate}%</span>
                                            </div>
                                            <Progress percent={project.completionRate} showInfo={false} size="small" strokeColor="var(--studio-action)" />
                                        </div>

                                        <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-[var(--studio-line)] pt-4 text-xs">
                                            <div>
                                                <dt className="text-[var(--studio-faint)]">已完成镜头</dt>
                                                <dd className="mt-1 font-medium tabular-nums text-[var(--studio-ink)]">{project.completedShotCount} / {project.shotCount}</dd>
                                            </div>
                                            <div>
                                                <dt className="text-[var(--studio-faint)]">待更新</dt>
                                                <dd className="mt-1 font-medium tabular-nums text-[var(--studio-ink)]">{project.pendingUpdateCount} 项</dd>
                                            </div>
                                            <div>
                                                <dt className="text-[var(--studio-faint)]">任务状态</dt>
                                                <dd className="mt-1 font-medium tabular-nums text-[var(--studio-ink)]">{project.runningTaskCount ? `进行中 ${project.runningTaskCount}` : "暂无运行"}</dd>
                                            </div>
                                        </dl>

                                        <div className="mt-4 flex items-center gap-1.5 text-xs text-[var(--studio-faint)]">
                                            <Clock3 className="size-3.5" aria-hidden="true" />
                                            最近更新 {formatUpdatedAt(project.updatedAt)}
                                        </div>
                                    </button>
                                </article>
                            );
                        })}
                    </section>
                ) : null}

                {!projectLoading && !projectError && !projects.length ? (
                    <Empty description="还没有漫剧项目" image={Empty.PRESENTED_IMAGE_SIMPLE}>
                        <div className="flex flex-col items-center gap-2 sm:flex-row">
                            <Button type="primary" icon={<FilePlus2 className="size-4" aria-hidden="true" />} onClick={() => setCreateOpen(true)}>新建完整项目</Button>
                            <Button icon={<BookOpenText className="size-4" aria-hidden="true" />} onClick={openScriptSelector}>承接已有剧本</Button>
                        </div>
                    </Empty>
                ) : null}

                {!projectLoading && projectTotal > PAGE_SIZE ? <Pagination className="self-center" current={page} pageSize={PAGE_SIZE} total={projectTotal} showSizeChanger={false} onChange={setPage} /> : null}
            </div>

            <Modal
                title="新建完整漫剧项目"
                open={createOpen}
                onCancel={closeCreateModal}
                onOk={() => void submitNewProject()}
                confirmLoading={creating}
                okText={createdScriptProjectId ? "继续初始化" : "创建并进入"}
                cancelText="取消"
                destroyOnHidden
            >
                <div className="flex flex-col gap-4 pt-2">
                    <p className="text-sm leading-6 text-[var(--studio-muted)]">将先创建一份共享剧本，再初始化对应的漫剧生产工作台；不会复制项目数据。</p>
                    <label className="flex flex-col gap-2 text-sm text-[var(--studio-text)]">
                        <span>项目名称</span>
                        <Input value={newProjectTitle} maxLength={120} showCount disabled={Boolean(createdScriptProjectId)} onChange={(event) => setNewProjectTitle(event.target.value)} placeholder="例如：雨夜回声" />
                    </label>
                    <label className="flex flex-col gap-2 text-sm text-[var(--studio-text)]">
                        <span>项目类型</span>
                        <Select
                            className="w-full"
                            value={newProjectType}
                            disabled={Boolean(createdScriptProjectId)}
                            aria-label="项目类型"
                            options={PROJECT_TYPES}
                            onChange={(value) => setNewProjectType(value as ComicDramaProjectType)}
                        />
                    </label>
                    <label className="flex flex-col gap-2 text-sm text-[var(--studio-text)]">
                        <span>一句话创意（可选）</span>
                        <Input.TextArea value={newProjectLogline} rows={3} maxLength={2000} showCount disabled={Boolean(createdScriptProjectId)} onChange={(event) => setNewProjectLogline(event.target.value)} placeholder="用一句话描述主角、目标与主要阻力" />
                    </label>
                    {createdScriptProjectId ? <Alert type="warning" showIcon title="剧本项目已创建，正在等待初始化漫剧工作台" description="可重试初始化，或取消后从“承接已有剧本”继续。" /> : null}
                </div>
            </Modal>

            <Modal
                title="承接已有剧本"
                open={scriptSelectorOpen}
                onCancel={() => { if (!initializingScriptProjectId) setScriptSelectorOpen(false); }}
                onOk={() => void submitScriptAdoption()}
                confirmLoading={Boolean(initializingScriptProjectId)}
                okText="确认承接（不复制）"
                cancelText="取消"
                okButtonProps={{ disabled: !selectedScriptProject }}
                width={720}
                destroyOnHidden
            >
                <div className="flex flex-col gap-4 pt-2">
                    <p className="text-sm leading-6 text-[var(--studio-muted)]">承接后会使用同一份剧本数据，后续修改会同步到剧本创作，不会创建副本。</p>
                    <section className="flex flex-col gap-3 border-b border-[var(--studio-line)] pb-4 sm:flex-row sm:items-end" aria-label="剧本项目筛选">
                        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-[var(--studio-text)]">
                            <span>搜索剧本</span>
                            <Input
                                allowClear
                                value={scriptKeyword}
                                prefix={<Search className="size-4 text-[var(--studio-faint)]" aria-hidden="true" />}
                                placeholder="按剧本名称搜索"
                                aria-label="按剧本名称搜索"
                                onChange={(event) => setScriptKeyword(event.target.value)}
                                onPressEnter={applyScriptSearch}
                            />
                        </label>
                        <Button onClick={applyScriptSearch}>查询</Button>
                    </section>

                    {scriptError ? <Alert type="error" showIcon title="剧本项目加载失败" description={scriptError} action={<Button size="small" onClick={() => void loadScriptProjects()}>重试</Button>} /> : null}

                    {scriptLoading ? (
                        <div className="flex flex-col gap-3" aria-label="剧本项目加载中">
                            {Array.from({ length: 3 }, (_, index) => <Skeleton key={index} active paragraph={{ rows: 2 }} />)}
                        </div>
                    ) : null}

                    {!scriptLoading && !scriptError && scriptProjects.length ? (
                        <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto pr-1" aria-label="可承接的剧本项目">
                            {scriptProjects.map((project) => {
                                const selected = project.id === selectedScriptProjectId;
                                return (
                                    <li key={project.id}>
                                        <button
                                            type="button"
                                            className={`w-full rounded-lg border p-4 text-left transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--studio-action)] motion-reduce:transition-none ${selected ? "border-[var(--studio-action)] bg-[var(--studio-primary-soft)]" : "border-[var(--studio-line)] bg-[var(--studio-surface)] hover:border-[var(--studio-primary-line)] hover:bg-[var(--studio-surface-hover)]"}`}
                                            aria-pressed={selected}
                                            aria-label={`选择剧本项目：${project.title}`}
                                            onClick={() => setSelectedScriptProjectId(project.id)}
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <BookOpenText className="size-4 shrink-0 text-[var(--studio-action)]" aria-hidden="true" />
                                                        <span className="truncate font-medium text-[var(--studio-ink)]" title={project.title}>{project.title}</span>
                                                    </div>
                                                    <p className="mt-2 line-clamp-2 text-xs leading-5 text-[var(--studio-muted)]">{project.logline || "尚未填写一句话创意"}</p>
                                                </div>
                                                {selected ? <CheckCircle2 className="size-5 shrink-0 text-[var(--studio-action)]" aria-label="已选择" /> : null}
                                            </div>
                                            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--studio-faint)]">
                                                <span>{projectTypeLabel(project.contentType)}</span>
                                                <span>{SCRIPT_STAGE_LABELS[project.stage] || project.stage}</span>
                                                <span className="tabular-nums">剧本完成度 {project.completionRate}%</span>
                                            </div>
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    ) : null}

                    {!scriptLoading && !scriptError && !scriptProjects.length ? <Empty description="没有可承接的剧本项目" image={Empty.PRESENTED_IMAGE_SIMPLE} /> : null}

                    {!scriptLoading && scriptProjectTotal > PAGE_SIZE ? <Pagination className="self-center" current={scriptPage} pageSize={PAGE_SIZE} total={scriptProjectTotal} showSizeChanger={false} onChange={(nextPage) => { setSelectedScriptProjectId(""); setScriptPage(nextPage); }} /> : null}
                    {selectedScriptProject ? <div className="flex items-center gap-2 rounded-lg border border-[var(--studio-primary-line)] bg-[var(--studio-primary-soft)] px-3 py-2 text-sm text-[var(--studio-text)]"><ListChecks className="size-4 shrink-0 text-[var(--studio-action)]" aria-hidden="true" />已选择：{selectedScriptProject.title}</div> : null}
                </div>
            </Modal>
        </main>
    );
}
