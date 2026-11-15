"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Dropdown, Input, Modal, Pagination, Skeleton } from "antd";
import { ArrowRight, Clapperboard, Clock3, MoreHorizontal, Sparkles } from "lucide-react";
import { useRouter } from "@/shared/lib/team-navigation";
import { useTranslation } from "@/features/locale/use-translation";
import { ModelPicker } from "@/features/settings/components/model-picker";
import { useEffectiveConfig } from "@/features/settings/stores/use-config-store";
import { creditText } from "@/shared/lib/credit-amounts";
import { createDramaProject, deleteDramaProject, dramaStages, listDramaProjects, updateDramaProject, type DramaProjectView, type DramaStage } from "@/services/api/drama";
import { DramaAspectPicker } from "./aspect-ratio";
import { dramaStageMeta } from "./stage-meta";

export function DramaHome() {
    const translate = useTranslation();
    const router = useRouter();
    const { message, modal } = App.useApp();
    const config = useEffectiveConfig();
    const [page, setPage] = useState(1);
    const [projects, setProjects] = useState<DramaProjectView[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [idea, setIdea] = useState("");
    const [story, setStory] = useState("");
    const [model, setModel] = useState("");
    const [aspectRatio, setAspectRatio] = useState("9:16");
    const [creating, setCreating] = useState(false);
    const [renameTarget, setRenameTarget] = useState<DramaProjectView | null>(null);
    const [renameName, setRenameName] = useState("");
    const [renaming, setRenaming] = useState(false);
    const createKey = useRef("");
    const creditCost = config.modelCosts.find((item) => item.taskType === "text" && item.model === model)?.credits;

    useEffect(() => {
        if (!model && config.textModel) setModel(config.textModel);
    }, [config.textModel, model]);

    const load = useCallback(async (nextPage: number) => {
        setLoading(true);
        try {
            const data = await listDramaProjects(nextPage, 12);
            setProjects(data.projects || []);
            setTotal(data.total || 0);
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("common.serverRequestFailed_5ed90b"));
        } finally {
            setLoading(false);
        }
    }, [message, translate]);

    useEffect(() => { void load(page); }, [load, page]);

    const price = useMemo(() => creditCost === undefined ? translate("drama.priceMissing") : translate("drama.unitPrice", { value0: creditText(creditCost) }), [creditCost, translate]);

    const create = async () => {
        if (!idea.trim() && !story.trim()) {
            message.warning(translate("drama.needIdea"));
            return;
        }
        if (!model) {
            message.warning(translate("drama.modelMissing"));
            return;
        }
        const fingerprint = `${idea.trim()}\n${story.trim()}\n${model}`;
        if (!createKey.current.startsWith(`${fingerprint}\n`)) createKey.current = `${fingerprint}\n${crypto.randomUUID()}`;
        setCreating(true);
        try {
            const workspace = await createDramaProject({
                clientRequestId: createKey.current.slice(fingerprint.length + 1),
                ideaText: idea.trim(),
                storyText: story.trim(),
                textModel: model,
                aspectRatio,
            });
            createKey.current = "";
            router.push(`/drama/${workspace.project.id}`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("common.serverRequestFailed_5ed90b"));
        } finally {
            setCreating(false);
        }
    };

    const remove = (project: DramaProjectView) => {
        modal.confirm({
            title: translate("drama.deleteTitle"),
            content: translate("drama.deleteHint"),
            okText: translate("drama.delete"),
            okButtonProps: { danger: true },
            cancelText: translate("drama.cancel"),
            onOk: async () => {
                await deleteDramaProject({ projectId: project.id, revision: project.revision });
                message.success(translate("drama.deleted"));
                await load(page);
            },
        });
    };

    const saveName = async () => {
        if (!renameTarget || !renameName.trim()) return;
        setRenaming(true);
        try {
            await updateDramaProject({ projectId: renameTarget.id, revision: renameTarget.revision, name: renameName.trim(), textModel: renameTarget.textModel });
            setRenameTarget(null);
            message.success(translate("drama.saved"));
            await load(page);
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("common.serverRequestFailed_5ed90b"));
        } finally {
            setRenaming(false);
        }
    };

    return (
        <main className="studio-page h-full overflow-y-auto px-4 py-6 sm:px-6" aria-labelledby="drama-page-title">
            <div className="mx-auto flex max-w-6xl flex-col gap-8">
                <header>
                    <div className="flex items-center gap-2 text-[var(--studio-action)]">
                        <Clapperboard className="size-4" aria-hidden="true" />
                        <p className="studio-caption text-xs font-medium">{translate("common.smartDrama")}</p>
                    </div>
                    <h1 id="drama-page-title" className="studio-title mt-2 text-2xl font-semibold">{translate("drama.title")}</h1>
                    <p className="studio-subtitle mt-2 max-w-2xl text-sm leading-6">{translate("drama.intro")}</p>
                    <ol className="mt-4 flex flex-wrap gap-x-3 gap-y-2">
                        {dramaStages.map((stage, index) => {
                            const Icon = dramaStageMeta[stage].icon;
                            return (
                                <li key={stage} className="inline-flex items-center gap-1.5 text-xs text-[var(--studio-muted)]">
                                    <span className="inline-flex size-5 items-center justify-center rounded-full bg-[var(--studio-surface)] text-[10px] font-semibold tabular-nums text-[var(--studio-faint)] ring-1 ring-[var(--studio-line)]">{index + 1}</span>
                                    <Icon className="size-3.5" aria-hidden="true" />
                                    {translate(dramaStageMeta[stage].label)}
                                </li>
                            );
                        })}
                    </ol>
                </header>

                <section className="overflow-hidden rounded-2xl border border-[var(--studio-line)] bg-[var(--studio-surface)] shadow-[var(--studio-shadow)]">
                    <div className="grid lg:grid-cols-[minmax(0,1.5fr)_minmax(260px,0.7fr)]">
                        <div className="flex flex-col gap-4 p-4 sm:p-6">
                            <label className="block text-sm font-medium text-[var(--studio-ink)]">
                                {translate("drama.idea")}
                                <Input.TextArea className="mt-2 font-normal" rows={3} maxLength={4000} value={idea} placeholder={translate("drama.ideaPlaceholder")} onChange={(event) => setIdea(event.target.value)} />
                            </label>
                            <label className="block text-sm font-medium text-[var(--studio-ink)]">
                                <span>{translate("drama.story")}</span>
                                <span className="ml-2 text-xs font-normal text-[var(--studio-muted)]">{translate("drama.storyOptional")}</span>
                                <Input.TextArea className="mt-2 font-normal" rows={6} maxLength={20000} value={story} onChange={(event) => setStory(event.target.value)} />
                            </label>
                        </div>
                        <aside className="flex flex-col gap-4 border-t border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-4 sm:p-6 lg:border-t-0 lg:border-l">
                            <label className="block text-sm font-medium text-[var(--studio-ink)]">
                                {translate("drama.textModel")}
                                <div className="mt-2"><ModelPicker config={config} value={model} onChange={setModel} capability="text" fullWidth /></div>
                            </label>
                            <div className="text-sm font-medium text-[var(--studio-ink)]">
                                {translate("drama.aspectRatio")}
                                <p className="mt-1 text-xs font-normal leading-5 text-[var(--studio-muted)]">{translate("drama.aspectHint")}</p>
                                <div className="mt-2"><DramaAspectPicker value={aspectRatio} disabled={creating} onChange={setAspectRatio} /></div>
                            </div>
                            <p className="text-xs leading-5 text-[var(--studio-muted)]">{price}</p>
                            <Button className="mt-auto" type="primary" size="large" block icon={<Sparkles className="size-4" aria-hidden="true" />} loading={creating} onClick={() => void create()}>{translate("drama.create")}</Button>
                        </aside>
                    </div>
                </section>

                <section className="flex flex-col gap-4" aria-label={translate("drama.recent")}>
                    <div className="flex items-end justify-between gap-3">
                        <h2 className="text-sm font-semibold text-[var(--studio-ink)]">{translate("drama.recent")}</h2>
                        {!loading && total > 0 ? <span className="text-xs tabular-nums text-[var(--studio-faint)]">{total}</span> : null}
                    </div>
                    {loading ? (
                        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                            {Array.from({ length: 3 }, (_, index) => <Skeleton key={index} active className="rounded-xl border border-[var(--studio-line)] bg-[var(--studio-surface)] p-5" paragraph={{ rows: 3 }} />)}
                        </div>
                    ) : projects.length === 0 ? (
                        <div className="studio-empty flex flex-col items-center gap-2 px-6 py-14 text-center">
                            <Clapperboard className="size-5 text-[var(--studio-faint)]" aria-hidden="true" />
                            <p className="max-w-sm text-sm leading-6">{translate("drama.empty")}</p>
                        </div>
                    ) : (
                        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                            {projects.map((project) => {
                                const stage = (dramaStages as readonly string[]).includes(project.currentStage) ? project.currentStage as DramaStage : "plan";
                                const done = project.status === "completed";
                                const index = dramaStages.indexOf(stage);
                                return (
                                    <article key={project.id} className="relative flex flex-col overflow-hidden rounded-xl border border-[var(--studio-line)] bg-[var(--studio-surface)] transition-colors duration-150 hover:border-[var(--studio-primary-line)] motion-reduce:transition-none">
                                        <Dropdown
                                            trigger={["click"]}
                                            menu={{
                                                items: [
                                                    { key: "rename", label: translate("drama.rename"), onClick: () => { setRenameTarget(project); setRenameName(project.name); } },
                                                    { key: "delete", danger: true, label: translate("drama.delete"), onClick: () => remove(project) },
                                                ],
                                            }}
                                        >
                                            <Button
                                                type="text"
                                                className="absolute right-2 top-2 z-10"
                                                aria-label={`${translate("drama.rename")} / ${translate("drama.delete")}`}
                                                icon={<MoreHorizontal className="size-4" aria-hidden="true" />}
                                            />
                                        </Dropdown>
                                        <button type="button" className="flex h-full flex-col p-5 pr-12 text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--studio-action)]" onClick={() => router.push(`/drama/${project.id}`)}>
                                            <ol className="flex gap-1" aria-label={translate(dramaStageMeta[stage].label)}>
                                                {dramaStages.map((item, itemIndex) => {
                                                    const filled = done || itemIndex <= index;
                                                    const current = !done && itemIndex === index;
                                                    return <li key={item} className={`h-1 flex-1 rounded-full ${current ? "bg-[var(--studio-action)]" : filled ? "bg-[color-mix(in_srgb,var(--studio-action)_42%,transparent)]" : "bg-[var(--studio-line)]"}`} />;
                                                })}
                                            </ol>
                                            <h3 className="mt-4 truncate text-base font-semibold text-[var(--studio-ink)]">{project.name}</h3>
                                            <p className="mt-2 text-xs text-[var(--studio-muted)]">
                                                {translate(dramaStageMeta[stage].label)}
                                                {done ? ` · ${translate("drama.completed")}` : ""}
                                            </p>
                                            <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--studio-line)] pt-4">
                                                <span className="rounded-full bg-[var(--studio-surface-soft)] px-2.5 py-1 text-xs font-medium tabular-nums text-[var(--studio-text)]">{project.aspectRatio || "9:16"}</span>
                                                <span className="rounded-full bg-[var(--studio-surface-soft)] px-2.5 py-1 text-xs font-medium tabular-nums text-[var(--studio-text)]">{translate("drama.seconds", { value0: project.durationSeconds })}</span>
                                                <span className="rounded-full bg-[var(--studio-surface-soft)] px-2.5 py-1 text-xs font-medium tabular-nums text-[var(--studio-text)]">{translate("drama.credits", { value0: creditText(project.textCredits) })}</span>
                                            </div>
                                            <div className="mt-4 flex items-center justify-between gap-3">
                                                <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-[var(--studio-faint)]">
                                                    <Clock3 className="size-3.5 shrink-0" aria-hidden="true" />
                                                    <span className="truncate">{formatUpdatedAt(project.updatedAt, translate.locale)}</span>
                                                </span>
                                                <span className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-[var(--studio-action)]">
                                                    {translate("drama.continue")}
                                                    <ArrowRight className="size-3.5" aria-hidden="true" />
                                                </span>
                                            </div>
                                        </button>
                                    </article>
                                );
                            })}
                        </div>
                    )}
                    {total > 12 ? <Pagination className="self-center" current={page} pageSize={12} total={total} showSizeChanger={false} onChange={setPage} /> : null}
                </section>
            </div>
            <Modal
                open={renameTarget != null}
                title={translate("drama.rename")}
                okText={translate("drama.save")}
                cancelText={translate("drama.cancel")}
                confirmLoading={renaming}
                mask={{ closable: true }}
                onOk={() => void saveName()}
                onCancel={() => setRenameTarget(null)}
            >
                <label className="block py-2 text-sm text-[var(--studio-ink)]">
                    {translate("drama.projectName")}
                    <Input className="mt-2" maxLength={120} value={renameName} onChange={(event) => setRenameName(event.target.value)} onPressEnter={() => void saveName()} />
                </label>
            </Modal>
        </main>
    );
}

function formatUpdatedAt(updatedAt: string, locale: string) {
    const date = new Date(updatedAt);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
}
