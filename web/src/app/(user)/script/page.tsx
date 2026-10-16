"use client";

import { scriptTemplateLabel } from "@/features/script/lib/script-localization";

import { translateMessage } from "@/features/locale/translate";
import { useTranslation } from "@/features/locale/use-translation";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { App, Alert, Button, Checkbox, Empty, Input, Modal, Pagination, Progress, Select, Spin, Tag } from "antd";
import { BookOpenText, Clock3, FilePlus2, Search, Trash2, Upload } from "lucide-react";

import { createScriptProject, deleteScriptProjects, listScriptTemplates } from "@/services/api/script";
import { ScriptSourceUploadModal } from "./components/script-source-upload-modal";
import { useScriptStore } from "@/features/script/stores/use-script-store";
import type { ScriptContentType, ScriptStage, ScriptTemplate } from "@/features/script/types";

const getContentTypes = (translate = translateMessage): Array<{ value: ScriptContentType; label: string }> => ([
    { value: "comicDrama", label: translate("script.comicDrama") },
    { value: "liveActionShort", label: translate("script.liveActionShortDrama") },
    { value: "animation", label: translate("script.animation") },
    { value: "advertisement", label: translate("script.advertisementPromotionalVideo") },
    { value: "musicVideo", label: translate("script.musicVideo") },
    { value: "storyShort", label: translate("script.shortFilm") },
]);

const getStages = (translate = translateMessage): Array<{ value: ScriptStage; label: string }> => ([
    { value: "idea", label: translate("script.developingIdea") },
    { value: "outline", label: translate("script.outlining") },
    { value: "writing", label: translate("script.writing") },
    { value: "completed", label: translate("script.completed") },
    { value: "production", label: translate("script.inProduction") },
]);

export default function ScriptPage() {
    const translate = useTranslation();
    const router = useRouter();
    const { message, modal } = App.useApp();
    const projects = useScriptStore((state) => state.projects);
    const total = useScriptStore((state) => state.projectTotal);
    const loading = useScriptStore((state) => state.loading);
    const error = useScriptStore((state) => state.error);
    const loadProjects = useScriptStore((state) => state.loadProjects);
    const [page, setPage] = useState(1);
    const [keyword, setKeyword] = useState("");
    const [searchKeyword, setSearchKeyword] = useState("");
    const [stage, setStage] = useState("");
    const [contentType, setContentType] = useState("");
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [createOpen, setCreateOpen] = useState(false);
    const [uploadOpen, setUploadOpen] = useState(false);
    const [creating, setCreating] = useState(false);
    const [templates, setTemplates] = useState<ScriptTemplate[]>([]);
    const [title, setTitle] = useState("");
    const [logline, setLogline] = useState("");
    const [templateKey, setTemplateKey] = useState("");
    const [newContentType, setNewContentType] = useState<ScriptContentType>("comicDrama");
    const permissionDenied = error.includes("无权限") || error.includes("权限不足") || error.includes("403");

    const query = useMemo(() => ({ page, pageSize: 12, keyword: searchKeyword, stage, contentType }), [contentType, page, searchKeyword, stage]);
    const refresh = useCallback(() => loadProjects(query), [loadProjects, query]);

    useEffect(() => { void refresh(); }, [refresh]);
    useEffect(() => { setSelectedIds((current) => current.filter((id) => projects.some((project) => project.id === id))); }, [projects]);

    const openCreate = async () => {
        setCreateOpen(true);
        if (!templates.length) {
            try {
                setTemplates(await listScriptTemplates());
            } catch (requestError) {
                message.error(requestError instanceof Error ? requestError.message : translate("script.couldNotLoadTemplates"));
            }
        }
    };

    const selectTemplate = (key: string) => {
        setTemplateKey(key);
        const template = templates.find((item) => item.templateKey === key);
        if (template) setNewContentType(template.contentType);
    };

    const submitCreate = async () => {
        if (!title.trim()) {
            message.warning(translate("script.enterAProjectName"));
            return;
        }
        setCreating(true);
        try {
            const project = await createScriptProject({ title: title.trim(), templateKey: templateKey || undefined, contentType: newContentType, logline: logline.trim() });
            message.success(translate("script.scriptProjectCreated"));
            setCreateOpen(false);
            /* 刷新项目库列表，避免进入工作台后返回时看到旧列表 */
            void refresh();
            router.push(`/script/${project.id}`);
        } catch (requestError) {
            message.error(requestError instanceof Error ? requestError.message : translate("script.couldNotCreateTheProject"));
        } finally {
            setCreating(false);
        }
    };

    const confirmDelete = (ids: string[]) => {
        modal.confirm({
            title: translate("script.deleteCountScriptProjects", { value0: ids.length }),
            content: translate("script.projectsAreSoftDeletedTheirScriptContentIsNotPermanently"),
            okText: translate("script.confirmDelete"),
            okButtonProps: { danger: true },
            cancelText: translate("script.cancel"),
            onOk: async () => {
                try {
                    await deleteScriptProjects(ids.map((id) => {
                        const project = projects.find((item) => item.id === id);
                        if (!project) throw new Error(translate("script.theSelectedProjectListHasChangedRefreshAndSelectAgain"));
                        return { projectId: id, expectedRevision: project.revision };
                    }));
                    setSelectedIds([]);
                    await refresh();
                    message.success(translate("script.projectDeleted"));
                } catch (requestError) {
                    message.error(requestError instanceof Error ? requestError.message : translate("script.couldNotDeleteTheProjectTryAgain"));
                    throw requestError;
                }
            },
        });
    };

    return (
        <main className="studio-page h-full overflow-y-auto px-4 py-6 sm:px-6">
            <div className="mx-auto flex max-w-7xl flex-col gap-5">
                <header className="flex flex-col gap-4 border-b border-[var(--studio-line)] pb-5 md:flex-row md:items-end md:justify-between">
                    <div>
                        <p className="studio-caption text-xs">{translate("script.create_b6fc3c")}</p>
                        <h1 className="studio-title mt-2 text-2xl font-semibold">{translate("script.scriptCreation")}</h1>
                        <p className="studio-subtitle mt-2 text-sm">{translate("script.manageStructuredScriptsFromStoryIdeasThroughEpisodesAndScenes")}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <Button icon={<Upload className="size-4" />} onClick={() => setUploadOpen(true)}>{translate("script.uploadScriptNovel_1e8f5f")}</Button>
                        <Button type="primary" icon={<FilePlus2 className="size-4" />} onClick={() => void openCreate()}>{translate("script.newScript")}</Button>
                    </div>
                </header>

                <section className="studio-glass flex flex-col gap-3 rounded-xl border border-[var(--studio-line)] p-4 lg:flex-row lg:items-center" aria-label={translate("script.projectFilters")}>
                    <Input allowClear value={keyword} onChange={(event) => setKeyword(event.target.value)} onPressEnter={() => { setPage(1); setSearchKeyword(keyword.trim()); }} prefix={<Search className="size-4 text-[var(--studio-faint)]" />} placeholder={translate("script.searchProjectNamesOrLoglines")} className="lg:max-w-md" />
                    <Select allowClear value={contentType || undefined} placeholder={translate("script.contentFormat")} options={getContentTypes(translate)} className="w-full lg:w-44" onChange={(value) => { setPage(1); setContentType(value || ""); }} />
                    <Select allowClear value={stage || undefined} placeholder={translate("script.writingStage")} options={getStages(translate)} className="w-full lg:w-40" onChange={(value) => { setPage(1); setStage(value || ""); }} />
                    <Button onClick={() => { setPage(1); setSearchKeyword(keyword.trim()); }}>{translate("script.search")}</Button>
                    {selectedIds.length ? <Button danger icon={<Trash2 className="size-4" />} onClick={() => confirmDelete(selectedIds)}>{translate("script.deleteSelectedCount_c95b50", { value0: selectedIds.length })}</Button> : null}
                </section>

                {error ? <Alert type="error" showIcon title={permissionDenied ? translate("script.youDoNotHaveAccessToTheScriptLibrary") : translate("script.couldNotLoadTheProjectLibrary")} description={error} action={<Button size="small" onClick={() => void refresh()}>{translate("script.retry")}</Button>} /> : null}

                <Spin spinning={loading}>
                    {projects.length ? (
                        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label={translate("script.scriptProjectList")}>
                            {projects.map((project) => (
                                <article key={project.id} className="group relative rounded-xl border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] p-5 transition-colors hover:border-[var(--studio-primary-line)]">
                                    <Checkbox aria-label={translate("script.selectProjectCount", { value0: project.title })} checked={selectedIds.includes(project.id)} className="absolute right-4 top-4" onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, project.id] : current.filter((id) => id !== project.id))} />
                                    <button type="button" className="w-full pr-8 text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--studio-primary)]" onClick={() => router.push(`/script/${project.id}`)}>
                                        <div className="flex items-center gap-2"><BookOpenText className="size-5 text-[var(--studio-primary)]" aria-hidden="true" /><h2 className="truncate text-base font-semibold text-[var(--studio-ink)]">{project.title}</h2></div>
                                        <div className="mt-3 flex flex-wrap gap-2"><Tag>{getContentTypes(translate).find((item) => item.value === project.contentType)?.label || project.contentType}</Tag><Tag>{project.genre || translate("script.genreNotSet")}</Tag><Tag color={project.stage === "production" ? "purple" : project.stage === "completed" ? "green" : "blue"}>{getStages(translate).find((item) => item.value === project.stage)?.label}</Tag></div>
                                        <p className="mt-4 line-clamp-2 min-h-11 text-sm leading-6 text-[var(--studio-muted)]">{project.logline || translate("script.noLoglineYetOpenTheWorkspaceToDevelopYourIdea")}</p>
                                        <div className="mt-4 flex items-center justify-between text-xs text-[var(--studio-faint)]"><span>{translate("script.countCountEpisodes_2c577e", { value0: project.episodeCount, value1: project.targetEpisodeCount })}</span><span>{project.completionRate}%</span></div>
                                        <Progress percent={project.completionRate} showInfo={false} size="small" strokeColor="var(--studio-primary)" />
                                        <div className="mt-3 flex items-center gap-1 text-xs text-[var(--studio-faint)]"><Clock3 className="size-3.5" aria-hidden="true" />{translate("script.lastEdited")}{new Date(project.updatedAt).toLocaleString(translate.locale)}</div>
                                    </button>
                                </article>
                            ))}
                        </section>
                    ) : !loading && !error ? <Empty description={translate("script.noScriptProjectsYet")} image={Empty.PRESENTED_IMAGE_SIMPLE}><Button type="primary" onClick={() => void openCreate()}>{translate("script.createYourFirstScript")}</Button></Empty> : null}
                </Spin>

                {total > 12 ? <Pagination current={page} pageSize={12} total={total} showSizeChanger={false} onChange={setPage} className="self-center" /> : null}
            </div>

            <Modal title={translate("script.newScriptProject")} open={createOpen} onCancel={() => setCreateOpen(false)} onOk={() => void submitCreate()} confirmLoading={creating} okText={translate("script.createAndOpen")} cancelText={translate("script.cancel")} destroyOnHidden>
                <div className="flex flex-col gap-4 pt-2">
                    <label className="flex flex-col gap-2 text-sm text-[var(--studio-text)]">{translate("script.projectName")}<Input value={title} maxLength={120} showCount onChange={(event) => setTitle(event.target.value)} placeholder={translate("script.exampleEchoesInTheRain")} /></label>
                    <label className="flex flex-col gap-2 text-sm text-[var(--studio-text)]">{translate("script.creationMethod")}<Select value={templateKey || "blank"} onChange={(value) => selectTemplate(value === "blank" ? "" : value)} options={[{ value: "blank", label: translate("script.blankProject") }, ...templates.map((template) => ({ value: template.templateKey, label: scriptTemplateLabel(template, translate) }))]} /></label>
                    <label className="flex flex-col gap-2 text-sm text-[var(--studio-text)]">{translate("script.contentFormat")}<Select value={newContentType} options={getContentTypes(translate)} onChange={setNewContentType} /></label>
                    <label className="flex flex-col gap-2 text-sm text-[var(--studio-text)]">{translate("script.loglineOptional")}<Input.TextArea value={logline} rows={3} maxLength={2000} showCount onChange={(event) => setLogline(event.target.value)} placeholder={translate("script.describeTheProtagonistGoalAndMainObstacleInOneSentence")} /></label>
                </div>
            </Modal>

            <ScriptSourceUploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} />
        </main>
    );
}
