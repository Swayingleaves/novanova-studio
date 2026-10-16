"use client";

import { translateMessage } from "@/features/locale/translate";
import { useTranslation } from "@/features/locale/use-translation";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Empty, Input, Modal, Pagination, Progress, Select, Skeleton } from "antd";
import { BookOpenText, CheckCircle2, CircleAlert, Clapperboard, Clock3, FilePlus2, ListChecks, RefreshCw, Search } from "lucide-react";

import { initializeComicDramaProject, listComicDramaProjects } from "@/services/api/comic-drama";
import { createScriptProject, listScriptProjects } from "@/services/api/script";
import type { ComicDramaProjectSummary, ComicDramaProjectType } from "@/features/comic-drama/types";
import type { ScriptProjectSummary } from "@/features/script/types";

const PAGE_SIZE = 12;

const getProjectTypes = (translate = translateMessage): Array<{ value: ComicDramaProjectType; label: string }> => ([
    { value: "comicDrama", label: translate("comicDrama.comicDrama") },
    { value: "liveActionShort", label: translate("comicDrama.liveActionShortDrama") },
    { value: "animation", label: translate("comicDrama.animation") },
    { value: "advertisement", label: translate("comicDrama.advertisingStory") },
    { value: "musicVideo", label: translate("comicDrama.musicVideo") },
    { value: "storyShort", label: translate("comicDrama.shortFilm") },
]);

const getScriptStageLabels = (translate = translateMessage): Record<string, string> => ({
    idea: translate("comicDrama.developingIdea"),
    outline: translate("comicDrama.outlining"),
    writing: translate("comicDrama.writing"),
    completed: translate("comicDrama.completed_e99b48"),
    production: translate("comicDrama.inProduction"),
});

const getProductionStageLabels = (translate = translateMessage): Record<string, string> => ({
    preparing: translate("comicDrama.productionReadiness"),
    producing: translate("comicDrama.producing"),
    paused: translate("comicDrama.paused"),
    idea: translate("comicDrama.scriptIdea"),
    outline: translate("comicDrama.scriptOutline"),
    writing: translate("comicDrama.scriptWriting"),
    production: translate("comicDrama.startProduction"),
    completed: translate("comicDrama.completed_e99b48"),
    readiness: translate("comicDrama.productionReadiness"),
    settings: translate("comicDrama.productionSettings"),
    assets: translate("comicDrama.assetProduction"),
    shots: translate("comicDrama.shotBreakdown"),
    storyboard: translate("comicDrama.storyboardPlanning"),
    media: translate("comicDrama.mediaGeneration"),
    sound: translate("comicDrama.soundProduction"),
    canvas: translate("comicDrama.finalComposition"),
    updates: translate("comicDrama.pendingUpdates"),
    ready: translate("comicDrama.productionComplete"),
});

function projectTypeLabel(projectType: string, translate = translateMessage) {
    return getProjectTypes(translate).find((item) => item.value === projectType)?.label || projectType || translate("comicDrama.typeNotSet");
}

function productionStageLabel(stage: string, translate = translateMessage) {
    return getProductionStageLabels(translate)[stage] || stage || translate("comicDrama.notStartedYet");
}

function formatUpdatedAt(updatedAt: string, locale: string) {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(updatedAt));
}

function readinessInfo(readiness: ComicDramaProjectSummary["readiness"], translate = translateMessage) {
    if (readiness === "ready") return { label: translate("comicDrama.ready"), className: "text-[var(--studio-success)]" };
    if (readiness === "attention") return { label: translate("comicDrama.needsAttention"), className: "text-[var(--studio-warning)]" };
    return { label: translate("comicDrama.missingItems"), className: "text-[var(--studio-danger)]" };
}

/** 漫剧创作项目库，统一管理已初始化项目与共享剧本承接入口。 */
export function ComicDramaProjectLibrary() {
    const translate = useTranslation();
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
            setProjectError(requestError instanceof Error ? requestError.message : translate("comicDrama.couldNotLoadComicDramaProjects"));
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
            setScriptError(requestError instanceof Error ? requestError.message : translate("comicDrama.couldNotLoadScriptProjects"));
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
            message.warning(translate("comicDrama.enterAProjectName"));
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
            message.success(translate("comicDrama.comicDramaProjectCreated"));
            setCreateOpen(false);
            resetCreateForm();
            router.push(`/comic-drama?projectId=${encodeURIComponent(workspace.projectId)}`);
        } catch (requestError) {
            const errorMessage = requestError instanceof Error ? requestError.message : translate("comicDrama.couldNotCreateTheProject");
            message.error(scriptProjectCreated ? translate("comicDrama.scriptCreatedButComicDramaInitializationFailedCount", { value0: errorMessage }) : errorMessage);
        } finally {
            setCreating(false);
        }
    };

    const selectedScriptProject = scriptProjects.find((project) => project.id === selectedScriptProjectId);

    const submitScriptAdoption = async () => {
        if (!selectedScriptProject) {
            message.warning(translate("comicDrama.selectAScriptProjectFirst"));
            return;
        }

        setInitializingScriptProjectId(selectedScriptProject.id);
        try {
            const workspace = await initializeComicDramaProject({
                scriptProjectId: selectedScriptProject.id,
                projectType: selectedScriptProject.contentType,
            });
            message.success(translate("comicDrama.sharedScriptLinkedYouCanContinueComicDramaProduction"));
            setScriptSelectorOpen(false);
            router.push(`/comic-drama?projectId=${encodeURIComponent(workspace.projectId)}`);
        } catch (requestError) {
            message.error(requestError instanceof Error ? requestError.message : translate("comicDrama.couldNotLinkTheScriptTryAgain"));
        } finally {
            setInitializingScriptProjectId("");
        }
    };

    return (
        <main className="studio-page h-full overflow-y-auto px-4 py-6 sm:px-6" aria-labelledby="comic-drama-page-title">
            <div className="mx-auto flex max-w-7xl flex-col gap-5">
                <header className="flex flex-col gap-4 border-b border-[var(--studio-line)] pb-5 md:flex-row md:items-end md:justify-between">
                    <div>
                        <p className="studio-caption text-xs">{translate("comicDrama.narrativeVideoProduction")}</p>
                        <h1 id="comic-drama-page-title" className="studio-title mt-2 text-2xl font-semibold">{translate("comicDrama.comicDrama_7c3584")}</h1>
                        <p className="studio-subtitle mt-2 text-sm">{translate("comicDrama.useASharedScriptToManageVisualAssetsShotsStoryboards")}</p>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                        <Button size="large" icon={<BookOpenText className="size-4" aria-hidden="true" />} onClick={openScriptSelector}>{translate("comicDrama.useExistingScript")}</Button>
                        <Button type="primary" size="large" icon={<FilePlus2 className="size-4" aria-hidden="true" />} onClick={() => setCreateOpen(true)}>{translate("comicDrama.createFullProject")}</Button>
                    </div>
                </header>

                <section className="flex flex-col gap-3 border-b border-[var(--studio-line)] pb-4 sm:flex-row sm:items-end" aria-label={translate("comicDrama.comicDramaProjectFilters")}>
                    <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-[var(--studio-text)]">
                        <span>{translate("comicDrama.searchProjects")}</span>
                        <Input
                            allowClear
                            value={keyword}
                            prefix={<Search className="size-4 text-[var(--studio-faint)]" aria-hidden="true" />}
                            placeholder={translate("comicDrama.searchByProjectName")}
                            aria-label={translate("comicDrama.searchByProjectName")}
                            onChange={(event) => setKeyword(event.target.value)}
                            onPressEnter={applyProjectSearch}
                        />
                    </label>
                    <div className="flex gap-2">
                        <Button onClick={applyProjectSearch}>{translate("comicDrama.search")}</Button>
                        <Button icon={<RefreshCw className="size-4" aria-hidden="true" />} onClick={() => void loadProjects()}>{translate("comicDrama.refresh")}</Button>
                    </div>
                </section>

                <p className="sr-only" aria-live="polite">{projectLoading ? translate("comicDrama.loadingComicDramaProjects") : translate("comicDrama.loadedCountComicDramaProjects", { value0: projectTotal })}</p>

                {projectError ? (
                    <Alert
                        type="error"
                        showIcon
                        title={translate("comicDrama.couldNotLoadTheComicDramaLibrary")}
                        description={projectError}
                        action={<Button size="small" onClick={() => void loadProjects()}>{translate("comicDrama.retry")}</Button>}
                    />
                ) : null}

                {projectLoading ? (
                    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label={translate("comicDrama.loadingComicDramaProject")}>
                        {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} active className="rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface)] p-5" paragraph={{ rows: 4 }} />)}
                    </section>
                ) : null}

                {!projectLoading && !projectError && projects.length ? (
                    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label={translate("comicDrama.comicDramaProjectList")}>
                        {projects.map((project) => {
                            const readiness = readinessInfo(project.readiness, translate);
                            return (
                                <article key={project.projectId} className="overflow-hidden rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface)] transition-colors duration-150 hover:border-[var(--studio-primary-line)] hover:bg-[var(--studio-surface-hover)] motion-reduce:transition-none">
                                    <button
                                        type="button"
                                        className="block min-h-64 w-full p-5 text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--studio-action)]"
                                        aria-label={translate("comicDrama.openComicDramaProjectCount", { value0: project.title })}
                                        onClick={() => router.push(`/comic-drama?projectId=${encodeURIComponent(project.projectId)}`)}
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <Clapperboard className="size-5 shrink-0 text-[var(--studio-action)]" aria-hidden="true" />
                                                    <h2 className="truncate text-base font-semibold text-[var(--studio-ink)]" title={project.title}>{project.title}</h2>
                                                </div>
                                                <p className="mt-2 text-xs text-[var(--studio-faint)]">{projectTypeLabel(project.projectType, translate)} · {productionStageLabel(project.stage, translate)}</p>
                                            </div>
                                            <span className={`inline-flex shrink-0 items-center gap-1 text-xs font-medium ${readiness.className}`}>
                                                {project.readiness === "ready" ? <CheckCircle2 className="size-3.5" aria-hidden="true" /> : <CircleAlert className="size-3.5" aria-hidden="true" />}
                                                {readiness.label}
                                            </span>
                                        </div>

                                        <div className="mt-5">
                                            <div className="flex items-center justify-between gap-3 text-sm text-[var(--studio-text)]">
                                                <span>{translate("comicDrama.productionProgress")}</span>
                                                <span className="font-medium tabular-nums text-[var(--studio-ink)]">{project.completionRate}%</span>
                                            </div>
                                            <Progress percent={project.completionRate} showInfo={false} size="small" strokeColor="var(--studio-action)" />
                                        </div>

                                        <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-[var(--studio-line)] pt-4 text-xs">
                                            <div>
                                                <dt className="text-[var(--studio-faint)]">{translate("comicDrama.completedShots")}</dt>
                                                <dd className="mt-1 font-medium tabular-nums text-[var(--studio-ink)]">{project.completedShotCount} / {project.shotCount}</dd>
                                            </div>
                                            <div>
                                                <dt className="text-[var(--studio-faint)]">{translate("comicDrama.pendingUpdates_30e81c")}</dt>
                                                <dd className="mt-1 font-medium tabular-nums text-[var(--studio-ink)]">{translate("comicDrama.countItems_f656de", { value0: project.pendingUpdateCount })}</dd>
                                            </div>
                                            <div>
                                                <dt className="text-[var(--studio-faint)]">{translate("comicDrama.taskStatus")}</dt>
                                                <dd className="mt-1 font-medium tabular-nums text-[var(--studio-ink)]">{project.runningTaskCount ? translate("comicDrama.runningCount", { value0: project.runningTaskCount }) : translate("comicDrama.noRunningTasks")}</dd>
                                            </div>
                                        </dl>

                                        <div className="mt-4 flex items-center gap-1.5 text-xs text-[var(--studio-faint)]">
                                            <Clock3 className="size-3.5" aria-hidden="true" />
                                            {translate("comicDrama.lastUpdated")}{formatUpdatedAt(project.updatedAt, translate.locale)}
                                        </div>
                                    </button>
                                </article>
                            );
                        })}
                    </section>
                ) : null}

                {!projectLoading && !projectError && !projects.length ? (
                    <Empty description={translate("comicDrama.noComicDramaProjectsYet")} image={Empty.PRESENTED_IMAGE_SIMPLE}>
                        <div className="flex flex-col items-center gap-2 sm:flex-row">
                            <Button type="primary" icon={<FilePlus2 className="size-4" aria-hidden="true" />} onClick={() => setCreateOpen(true)}>{translate("comicDrama.createFullProject")}</Button>
                            <Button icon={<BookOpenText className="size-4" aria-hidden="true" />} onClick={openScriptSelector}>{translate("comicDrama.useExistingScript")}</Button>
                        </div>
                    </Empty>
                ) : null}

                {!projectLoading && projectTotal > PAGE_SIZE ? <Pagination className="self-center" current={page} pageSize={PAGE_SIZE} total={projectTotal} showSizeChanger={false} onChange={setPage} /> : null}
            </div>

            <Modal
                title={translate("comicDrama.newComicDramaProject")}
                open={createOpen}
                onCancel={closeCreateModal}
                onOk={() => void submitNewProject()}
                confirmLoading={creating}
                okText={createdScriptProjectId ? translate("comicDrama.continueInitialization") : translate("comicDrama.createAndOpen")}
                cancelText={translate("comicDrama.cancel")}
                destroyOnHidden
            >
                <div className="flex flex-col gap-4 pt-2">
                    <p className="text-sm leading-6 text-[var(--studio-muted)]">{translate("comicDrama.createsASharedScriptThenInitializesItsComicDramaProduction")}</p>
                    <label className="flex flex-col gap-2 text-sm text-[var(--studio-text)]">
                        <span>{translate("comicDrama.projectName")}</span>
                        <Input value={newProjectTitle} maxLength={120} showCount disabled={Boolean(createdScriptProjectId)} onChange={(event) => setNewProjectTitle(event.target.value)} placeholder={translate("comicDrama.exampleEchoesInTheRain")} />
                    </label>
                    <label className="flex flex-col gap-2 text-sm text-[var(--studio-text)]">
                        <span>{translate("comicDrama.projectType")}</span>
                        <Select
                            className="w-full"
                            value={newProjectType}
                            disabled={Boolean(createdScriptProjectId)}
                            aria-label={translate("comicDrama.projectType")}
                            options={getProjectTypes(translate)}
                            onChange={(value) => setNewProjectType(value as ComicDramaProjectType)}
                        />
                    </label>
                    <label className="flex flex-col gap-2 text-sm text-[var(--studio-text)]">
                        <span>{translate("comicDrama.loglineOptional")}</span>
                        <Input.TextArea value={newProjectLogline} rows={3} maxLength={2000} showCount disabled={Boolean(createdScriptProjectId)} onChange={(event) => setNewProjectLogline(event.target.value)} placeholder={translate("comicDrama.describeTheProtagonistGoalAndMainObstacleInOneSentence")} />
                    </label>
                    {createdScriptProjectId ? <Alert type="warning" showIcon title={translate("comicDrama.scriptProjectCreatedWaitingToInitializeTheComicDramaWorkspace")} description={translate("comicDrama.retryInitializationOrCancelAndContinueThroughUseExistingScript")} /> : null}
                </div>
            </Modal>

            <Modal
                title={translate("comicDrama.useExistingScript")}
                open={scriptSelectorOpen}
                onCancel={() => { if (!initializingScriptProjectId) setScriptSelectorOpen(false); }}
                onOk={() => void submitScriptAdoption()}
                confirmLoading={Boolean(initializingScriptProjectId)}
                okText={translate("comicDrama.confirmLinkSharedData")}
                cancelText={translate("comicDrama.cancel")}
                okButtonProps={{ disabled: !selectedScriptProject }}
                width={720}
                destroyOnHidden
            >
                <div className="flex flex-col gap-4 pt-2">
                    <p className="text-sm leading-6 text-[var(--studio-muted)]">{translate("comicDrama.thisUsesTheSameScriptDataChangesAlsoAppearIn")}</p>
                    <section className="flex flex-col gap-3 border-b border-[var(--studio-line)] pb-4 sm:flex-row sm:items-end" aria-label={translate("comicDrama.scriptProjectFilters")}>
                        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-[var(--studio-text)]">
                            <span>{translate("comicDrama.searchScripts")}</span>
                            <Input
                                allowClear
                                value={scriptKeyword}
                                prefix={<Search className="size-4 text-[var(--studio-faint)]" aria-hidden="true" />}
                                placeholder={translate("comicDrama.searchByScriptName")}
                                aria-label={translate("comicDrama.searchByScriptName")}
                                onChange={(event) => setScriptKeyword(event.target.value)}
                                onPressEnter={applyScriptSearch}
                            />
                        </label>
                        <Button onClick={applyScriptSearch}>{translate("comicDrama.search")}</Button>
                    </section>

                    {scriptError ? <Alert type="error" showIcon title={translate("comicDrama.couldNotLoadTheScriptProject")} description={scriptError} action={<Button size="small" onClick={() => void loadScriptProjects()}>{translate("comicDrama.retry")}</Button>} /> : null}

                    {scriptLoading ? (
                        <div className="flex flex-col gap-3" aria-label={translate("comicDrama.loadingScriptProject")}>
                            {Array.from({ length: 3 }, (_, index) => <Skeleton key={index} active paragraph={{ rows: 2 }} />)}
                        </div>
                    ) : null}

                    {!scriptLoading && !scriptError && scriptProjects.length ? (
                        <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto pr-1" aria-label={translate("comicDrama.availableScriptProjects")}>
                            {scriptProjects.map((project) => {
                                const selected = project.id === selectedScriptProjectId;
                                return (
                                    <li key={project.id}>
                                        <button
                                            type="button"
                                            className={`w-full rounded-lg border p-4 text-left transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--studio-action)] motion-reduce:transition-none ${selected ? "border-[var(--studio-action)] bg-[var(--studio-primary-soft)]" : "border-[var(--studio-line)] bg-[var(--studio-surface)] hover:border-[var(--studio-primary-line)] hover:bg-[var(--studio-surface-hover)]"}`}
                                            aria-pressed={selected}
                                            aria-label={translate("comicDrama.selectScriptProjectCount", { value0: project.title })}
                                            onClick={() => setSelectedScriptProjectId(project.id)}
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <BookOpenText className="size-4 shrink-0 text-[var(--studio-action)]" aria-hidden="true" />
                                                        <span className="truncate font-medium text-[var(--studio-ink)]" title={project.title}>{project.title}</span>
                                                    </div>
                                                    <p className="mt-2 line-clamp-2 text-xs leading-5 text-[var(--studio-muted)]">{project.logline || translate("comicDrama.noLoglineYet")}</p>
                                                </div>
                                                {selected ? <CheckCircle2 className="size-5 shrink-0 text-[var(--studio-action)]" aria-label={translate("comicDrama.selected")} /> : null}
                                            </div>
                                            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--studio-faint)]">
                                                <span>{projectTypeLabel(project.contentType, translate)}</span>
                                                <span>{getScriptStageLabels(translate)[project.stage] || project.stage}</span>
                                                <span className="tabular-nums">{translate("comicDrama.scriptCompletionCount_ef5fae", { value0: project.completionRate })}</span>
                                            </div>
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    ) : null}

                    {!scriptLoading && !scriptError && !scriptProjects.length ? <Empty description={translate("comicDrama.noScriptsAvailableToLink")} image={Empty.PRESENTED_IMAGE_SIMPLE} /> : null}

                    {!scriptLoading && scriptProjectTotal > PAGE_SIZE ? <Pagination className="self-center" current={scriptPage} pageSize={PAGE_SIZE} total={scriptProjectTotal} showSizeChanger={false} onChange={(nextPage) => { setSelectedScriptProjectId(""); setScriptPage(nextPage); }} /> : null}
                    {selectedScriptProject ? <div className="flex items-center gap-2 rounded-lg border border-[var(--studio-primary-line)] bg-[var(--studio-primary-soft)] px-3 py-2 text-sm text-[var(--studio-text)]"><ListChecks className="size-4 shrink-0 text-[var(--studio-action)]" aria-hidden="true" />{translate("comicDrama.selected_9c5605")}{selectedScriptProject.title}</div> : null}
                </div>
            </Modal>
        </main>
    );
}
