"use client";

import { useTranslation } from "@/features/locale/use-translation";

import { useEffect, useRef, useState } from "react";
import { App, Button, Empty, Input, Modal, Tag, Timeline } from "antd";
import { FileClock, GitCompare, RotateCcw } from "lucide-react";

import { createScriptVersion, getScriptVersion, restoreScriptVersion } from "@/services/api/script";
import { diffScriptVersion } from "../lib/script-version-diff";
import { useScriptStore } from "../stores/use-script-store";
import type { ScriptVersionDetail } from "../types";

/** 命名版本记录面板。 */
export function ScriptVersions() {
    const translate = useTranslation();
    const { message, modal } = App.useApp();
    const project = useScriptStore((state) => state.project);
    const versions = useScriptStore((state) => state.versions);
    const replaceVersions = useScriptStore((state) => state.replaceVersions);
    const reloadProject = useScriptStore((state) => state.reloadProject);
    const [createOpen, setCreateOpen] = useState(false);
    const [versionName, setVersionName] = useState("");
    const [changeSummary, setChangeSummary] = useState("");
    const [compareVersion, setCompareVersion] = useState<ScriptVersionDetail | null>(null);
    const [creating, setCreating] = useState(false);
    const [comparingId, setComparingId] = useState("");
    const createGeneration = useRef(0);
    const compareGeneration = useRef(0);
    useEffect(() => {
        createGeneration.current += 1;
        compareGeneration.current += 1;
        setCompareVersion(null);
        setComparingId("");
        setCreateOpen(false);
        setCreating(false);
    }, [project?.id]);
    if (!project) return null;
    const requireSaved = () => {
        if (["saved", "idle"].includes(useScriptStore.getState().saveStatus)) return true;
        message.warning(translate("script.waitUntilTheCurrentChangesAreSavedBeforeUsingVersions"));
        return false;
    };
    const create = async () => {
        if (!requireSaved()) return;
        if (!versionName.trim()) {
            message.warning(translate("script.enterAVersionName"));
            return;
        }
        const projectId = project.id;
        const generation = ++createGeneration.current;
        setCreating(true);
        try {
            const version = await createScriptVersion(projectId, project.revision, versionName.trim(), changeSummary.trim());
            if (generation !== createGeneration.current || useScriptStore.getState().project?.id !== projectId) return;
            replaceVersions([version, ...useScriptStore.getState().versions]);
            setCreateOpen(false);
            setVersionName("");
            setChangeSummary("");
            message.success(translate("script.namedVersionCreated"));
        } catch (error) {
            if (generation === createGeneration.current && useScriptStore.getState().project?.id === projectId) {
                message.error(error instanceof Error ? error.message : translate("script.couldNotCreateTheVersionTryAgain"));
            }
        } finally {
            if (generation === createGeneration.current) setCreating(false);
        }
    };
    const compare = async (versionId: string) => {
        const projectId = project.id;
        const generation = ++compareGeneration.current;
        setComparingId(versionId);
        try {
            const detail = await getScriptVersion(projectId, versionId);
            if (generation === compareGeneration.current && useScriptStore.getState().project?.id === projectId) setCompareVersion(detail);
        } catch (error) {
            if (generation === compareGeneration.current && useScriptStore.getState().project?.id === projectId) {
                message.error(error instanceof Error ? error.message : translate("script.couldNotLoadVersionDetailsTryAgain"));
            }
        } finally {
            if (generation === compareGeneration.current) setComparingId("");
        }
    };
    const restore = (versionId: string) => {
        if (!requireSaved()) return;
        modal.confirm({
        title: translate("script.restoreThisVersion"),
        content: translate("script.restoringDoesNotSaveTheCurrentContentAutomaticallyCreateA"),
        okText: translate("script.confirmRestore"),
        cancelText: translate("script.cancel"),
        onOk: async () => {
            if (!requireSaved()) return;
            const latestProject = useScriptStore.getState().project;
            if (!latestProject || latestProject.id !== project.id) {
                message.warning(translate("script.theScriptProjectHasChangedSelectTheVersionAgain"));
                return;
            }
            try {
                await restoreScriptVersion(project.id, latestProject.revision, versionId);
                await reloadProject();
                message.success(translate("script.versionRestored"));
            } catch (error) {
                message.error(error instanceof Error ? error.message : translate("script.couldNotRestoreTheVersionTryAgain"));
                throw error;
            }
        },
    });
    };
    const changedSections = compareVersion ? diffScriptVersion(compareVersion.snapshotData, project as unknown as Record<string, unknown>, undefined, translate) : [];
    return <section><header className="mb-5 flex items-start justify-between gap-4 border-b border-[var(--studio-line)] pb-4"><div><h2 className="text-xl font-semibold text-[var(--studio-ink)]">{translate("script.versionHistory")}</h2><p className="mt-1 text-sm text-[var(--studio-muted)]">{translate("script.normalAutosavesDoNotCreateHistoricalVersionsASnapshotIs")}</p></div><Button type="primary" icon={<FileClock className="size-4" />} onClick={() => setCreateOpen(true)}>{translate("script.createVersion")}</Button></header>{versions.length ? <Timeline items={versions.map((version) => ({ content: <div className="pb-2"><div className="flex flex-wrap items-center gap-2"><strong>{version.versionName}</strong><Tag color={version.changeSource === "ai" ? "purple" : "blue"}>{version.changeSource === "ai" ? translate("script.beforeAiChanges") : translate("script.manual")}</Tag><span className="text-xs text-[var(--studio-faint)]">{translate("script.revisionCountCount_741e27", { value0: version.sourceRevision, value1: new Date(version.createdAt).toLocaleString(translate.locale) })}</span></div><p className="my-2 text-sm text-[var(--studio-muted)]">{version.changeSummary || translate("script.noChangeNotes")}</p><div className="flex gap-2"><Button size="small" icon={<GitCompare className="size-3.5" />} loading={comparingId === version.id} onClick={() => void compare(version.id)}>{translate("script.compareStructure")}</Button><Button size="small" icon={<RotateCcw className="size-3.5" />} onClick={() => restore(version.id)}>{translate("script.restore")}</Button></div></div> }))} /> : <Empty description={translate("script.noVersionHistoryYet")} />}<Modal title={translate("script.createNamedVersion")} open={createOpen} onCancel={() => setCreateOpen(false)} onOk={() => void create()} confirmLoading={creating} okText={translate("script.create")}><div className="space-y-3 pt-2"><label className="block text-sm text-[var(--studio-text)]">{translate("script.versionName")}<Input className="mt-2" value={versionName} maxLength={120} placeholder={translate("script.exampleAct1FinalDraft")} onChange={(event) => setVersionName(event.target.value)} /></label><label className="block text-sm text-[var(--studio-text)]">{translate("script.changeNotesOptional")}<Input.TextArea className="mt-2" value={changeSummary} rows={3} placeholder={translate("script.describeTheKeyChangesSavedInThisVersion")} onChange={(event) => setChangeSummary(event.target.value)} /></label></div></Modal><Modal width={920} title={translate("script.compareVersionContent")} open={Boolean(compareVersion)} onCancel={() => setCompareVersion(null)} footer={null}>{compareVersion ? <div><p className="text-sm text-[var(--studio-muted)]">{translate("script.expandAChangedSectionToCompareThisVersionWithThe")}</p><div className="mt-3 flex flex-wrap gap-2">{changedSections.length ? changedSections.map((section) => <Tag key={section.key} color="orange">{section.label}</Tag>) : <Tag color="green">{translate("script.noChangesDetectedInLoadedSections")}</Tag>}</div><div className="mt-4 space-y-3">{changedSections.map((section) => <details key={section.key} className="rounded-lg border border-[var(--studio-line)] p-3"><summary className="cursor-pointer font-medium text-[var(--studio-ink)]">{section.label}</summary><div className="mt-3 grid gap-3 md:grid-cols-2"><div><p className="mb-2 text-xs font-medium text-[var(--studio-muted)]">{translate("script.versionContent")}</p><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--studio-surface-soft)] p-3 text-xs text-[var(--studio-text)]">{JSON.stringify(section.before, null, 2)}</pre></div><div><p className="mb-2 text-xs font-medium text-[var(--studio-muted)]">{translate("script.currentContent")}</p><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--studio-surface-soft)] p-3 text-xs text-[var(--studio-text)]">{JSON.stringify(section.after, null, 2)}</pre></div></div></details>)}</div><p className="mt-4 text-xs text-[var(--studio-faint)]">{translate("script.episodeTextIsLoadedOnDemandThisComparisonIncludesOnly")}</p></div> : null}</Modal></section>;
}
