"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { App, Alert, Button, Checkbox, Empty, Input, Modal, Pagination, Progress, Select, Spin, Tag } from "antd";
import { BookOpenText, Clock3, FilePlus2, Search, Trash2, Upload } from "lucide-react";

import { createScriptProject, deleteScriptProjects, listScriptTemplates } from "@/services/api/script";
import { ScriptSourceUploadModal } from "./components/script-source-upload-modal";
import { useScriptStore } from "@/features/script/stores/use-script-store";
import type { ScriptContentType, ScriptStage, ScriptTemplate } from "@/features/script/types";

const CONTENT_TYPES: Array<{ value: ScriptContentType; label: string }> = [
    { value: "comicDrama", label: "漫剧" },
    { value: "liveActionShort", label: "真人短剧" },
    { value: "animation", label: "动画" },
    { value: "advertisement", label: "广告 / 宣传片" },
    { value: "musicVideo", label: "音乐视频" },
    { value: "storyShort", label: "故事短片" },
];

const STAGES: Array<{ value: ScriptStage; label: string }> = [
    { value: "idea", label: "构思中" },
    { value: "outline", label: "大纲中" },
    { value: "writing", label: "编写中" },
    { value: "completed", label: "已完成" },
    { value: "production", label: "已进入制作" },
];

export default function ScriptPage() {
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
                message.error(requestError instanceof Error ? requestError.message : "加载模板失败");
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
            message.warning("请输入项目名称");
            return;
        }
        setCreating(true);
        try {
            const project = await createScriptProject({ title: title.trim(), templateKey: templateKey || undefined, contentType: newContentType, logline: logline.trim() });
            message.success("剧本项目已创建");
            setCreateOpen(false);
            /* 刷新项目库列表，避免进入工作台后返回时看到旧列表 */
            void refresh();
            router.push(`/script/${project.id}`);
        } catch (requestError) {
            message.error(requestError instanceof Error ? requestError.message : "创建项目失败");
        } finally {
            setCreating(false);
        }
    };

    const confirmDelete = (ids: string[]) => {
        modal.confirm({
            title: `删除 ${ids.length} 个剧本项目？`,
            content: "项目会被移入软删除状态，关联的剧本内容不会立即物理清除。",
            okText: "确认删除",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: async () => {
                try {
                    await deleteScriptProjects(ids.map((id) => {
                        const project = projects.find((item) => item.id === id);
                        if (!project) throw new Error("选中的项目列表已经变化，请刷新后重新选择");
                        return { projectId: id, expectedRevision: project.revision };
                    }));
                    setSelectedIds([]);
                    await refresh();
                    message.success("项目已删除");
                } catch (requestError) {
                    message.error(requestError instanceof Error ? requestError.message : "项目删除失败，请重试");
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
                        <p className="studio-caption text-xs">创作</p>
                        <h1 className="studio-title mt-2 text-2xl font-semibold">剧本创作</h1>
                        <p className="studio-subtitle mt-2 text-sm">从故事创意到分集分场，集中管理可持续修改的结构化剧本。</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <Button icon={<Upload className="size-4" />} onClick={() => setUploadOpen(true)}>上传剧本/小说</Button>
                        <Button type="primary" icon={<FilePlus2 className="size-4" />} onClick={() => void openCreate()}>新建剧本</Button>
                    </div>
                </header>

                <section className="studio-glass flex flex-col gap-3 rounded-xl border border-[var(--studio-line)] p-4 lg:flex-row lg:items-center" aria-label="项目筛选">
                    <Input allowClear value={keyword} onChange={(event) => setKeyword(event.target.value)} onPressEnter={() => { setPage(1); setSearchKeyword(keyword.trim()); }} prefix={<Search className="size-4 text-[var(--studio-faint)]" />} placeholder="搜索项目名称或一句话创意" className="lg:max-w-md" />
                    <Select allowClear value={contentType || undefined} placeholder="内容形式" options={CONTENT_TYPES} className="w-full lg:w-44" onChange={(value) => { setPage(1); setContentType(value || ""); }} />
                    <Select allowClear value={stage || undefined} placeholder="创作阶段" options={STAGES} className="w-full lg:w-40" onChange={(value) => { setPage(1); setStage(value || ""); }} />
                    <Button onClick={() => { setPage(1); setSearchKeyword(keyword.trim()); }}>查询</Button>
                    {selectedIds.length ? <Button danger icon={<Trash2 className="size-4" />} onClick={() => confirmDelete(selectedIds)}>删除所选（{selectedIds.length}）</Button> : null}
                </section>

                {error ? <Alert type="error" showIcon title={permissionDenied ? "没有访问剧本项目库的权限" : "项目库加载失败"} description={error} action={<Button size="small" onClick={() => void refresh()}>重试</Button>} /> : null}

                <Spin spinning={loading}>
                    {projects.length ? (
                        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="剧本项目列表">
                            {projects.map((project) => (
                                <article key={project.id} className="group relative rounded-xl border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] p-5 transition-colors hover:border-[var(--studio-primary-line)]">
                                    <Checkbox aria-label={`选择项目 ${project.title}`} checked={selectedIds.includes(project.id)} className="absolute right-4 top-4" onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, project.id] : current.filter((id) => id !== project.id))} />
                                    <button type="button" className="w-full pr-8 text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--studio-primary)]" onClick={() => router.push(`/script/${project.id}`)}>
                                        <div className="flex items-center gap-2"><BookOpenText className="size-5 text-[var(--studio-primary)]" aria-hidden="true" /><h2 className="truncate text-base font-semibold text-[var(--studio-ink)]">{project.title}</h2></div>
                                        <div className="mt-3 flex flex-wrap gap-2"><Tag>{CONTENT_TYPES.find((item) => item.value === project.contentType)?.label || project.contentType}</Tag><Tag>{project.genre || "未设置题材"}</Tag><Tag color={project.stage === "production" ? "purple" : project.stage === "completed" ? "green" : "blue"}>{STAGES.find((item) => item.value === project.stage)?.label}</Tag></div>
                                        <p className="mt-4 line-clamp-2 min-h-11 text-sm leading-6 text-[var(--studio-muted)]">{project.logline || "还没有一句话创意，进入工作台开始构思。"}</p>
                                        <div className="mt-4 flex items-center justify-between text-xs text-[var(--studio-faint)]"><span>{project.episodeCount} / {project.targetEpisodeCount} 集</span><span>{project.completionRate}%</span></div>
                                        <Progress percent={project.completionRate} showInfo={false} size="small" strokeColor="var(--studio-primary)" />
                                        <div className="mt-3 flex items-center gap-1 text-xs text-[var(--studio-faint)]"><Clock3 className="size-3.5" aria-hidden="true" />最近修改 {new Date(project.updatedAt).toLocaleString("zh-CN")}</div>
                                    </button>
                                </article>
                            ))}
                        </section>
                    ) : !loading && !error ? <Empty description="还没有剧本项目" image={Empty.PRESENTED_IMAGE_SIMPLE}><Button type="primary" onClick={() => void openCreate()}>创建第一个剧本</Button></Empty> : null}
                </Spin>

                {total > 12 ? <Pagination current={page} pageSize={12} total={total} showSizeChanger={false} onChange={setPage} className="self-center" /> : null}
            </div>

            <Modal title="新建剧本项目" open={createOpen} onCancel={() => setCreateOpen(false)} onOk={() => void submitCreate()} confirmLoading={creating} okText="创建并进入" cancelText="取消" destroyOnHidden>
                <div className="flex flex-col gap-4 pt-2">
                    <label className="flex flex-col gap-2 text-sm text-[var(--studio-text)]">项目名称<Input value={title} maxLength={120} showCount onChange={(event) => setTitle(event.target.value)} placeholder="例如：雨夜回声" /></label>
                    <label className="flex flex-col gap-2 text-sm text-[var(--studio-text)]">创建方式<Select value={templateKey || "blank"} onChange={(value) => selectTemplate(value === "blank" ? "" : value)} options={[{ value: "blank", label: "空白项目" }, ...templates.map((template) => ({ value: template.templateKey, label: `${template.name} · ${template.description}` }))]} /></label>
                    <label className="flex flex-col gap-2 text-sm text-[var(--studio-text)]">内容形式<Select value={newContentType} options={CONTENT_TYPES} onChange={setNewContentType} /></label>
                    <label className="flex flex-col gap-2 text-sm text-[var(--studio-text)]">一句话创意（可选）<Input.TextArea value={logline} rows={3} maxLength={2000} showCount onChange={(event) => setLogline(event.target.value)} placeholder="用一句话写清主角、目标与主要阻力" /></label>
                </div>
            </Modal>

            <ScriptSourceUploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} />
        </main>
    );
}
