"use client";

import { useEffect, useRef, useState } from "react";
import { App, Button, Empty, Input, Modal, Tag, Timeline } from "antd";
import { FileClock, GitCompare, RotateCcw } from "lucide-react";

import { createScriptVersion, getScriptVersion, restoreScriptVersion } from "@/services/api/script";
import { diffScriptVersion } from "../lib/script-version-diff";
import { useScriptStore } from "../stores/use-script-store";
import type { ScriptVersionDetail } from "../types";

/** 命名版本记录面板。 */
export function ScriptVersions() {
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
        message.warning("请等待当前修改保存完成后再操作版本");
        return false;
    };
    const create = async () => {
        if (!requireSaved()) return;
        if (!versionName.trim()) {
            message.warning("请输入版本名称");
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
            message.success("命名版本已创建");
        } catch (error) {
            if (generation === createGeneration.current && useScriptStore.getState().project?.id === projectId) {
                message.error(error instanceof Error ? error.message : "版本创建失败，请重试");
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
                message.error(error instanceof Error ? error.message : "版本详情加载失败，请重试");
            }
        } finally {
            if (generation === compareGeneration.current) setComparingId("");
        }
    };
    const restore = (versionId: string) => {
        if (!requireSaved()) return;
        modal.confirm({
        title: "恢复这个版本？",
        content: "恢复不会自动保存当前内容。若需要保留当前状态，请先手动创建命名版本。",
        okText: "确认恢复",
        cancelText: "取消",
        onOk: async () => {
            if (!requireSaved()) return;
            const latestProject = useScriptStore.getState().project;
            if (!latestProject || latestProject.id !== project.id) {
                message.warning("当前剧本项目已经切换，请重新选择版本");
                return;
            }
            try {
                await restoreScriptVersion(project.id, latestProject.revision, versionId);
                await reloadProject();
                message.success("版本已恢复");
            } catch (error) {
                message.error(error instanceof Error ? error.message : "版本恢复失败，请重试");
                throw error;
            }
        },
    });
    };
    const changedSections = compareVersion ? diffScriptVersion(compareVersion.snapshotData, project as unknown as Record<string, unknown>) : [];
    return <section><header className="mb-5 flex items-start justify-between gap-4 border-b border-[var(--studio-line)] pb-4"><div><h2 className="text-xl font-semibold text-[var(--studio-ink)]">版本记录</h2><p className="mt-1 text-sm text-[var(--studio-muted)]">普通自动保存不会产生历史版本；应用AI前会自动保留修改前快照。</p></div><Button type="primary" icon={<FileClock className="size-4" />} onClick={() => setCreateOpen(true)}>创建版本</Button></header>{versions.length ? <Timeline items={versions.map((version) => ({ content: <div className="pb-2"><div className="flex flex-wrap items-center gap-2"><strong>{version.versionName}</strong><Tag color={version.changeSource === "ai" ? "purple" : "blue"}>{version.changeSource === "ai" ? "AI修改前" : "手动"}</Tag><span className="text-xs text-[var(--studio-faint)]">修订 {version.sourceRevision} · {new Date(version.createdAt).toLocaleString("zh-CN")}</span></div><p className="my-2 text-sm text-[var(--studio-muted)]">{version.changeSummary || "无修改说明"}</p><div className="flex gap-2"><Button size="small" icon={<GitCompare className="size-3.5" />} loading={comparingId === version.id} onClick={() => void compare(version.id)}>结构对比</Button><Button size="small" icon={<RotateCcw className="size-3.5" />} onClick={() => restore(version.id)}>恢复</Button></div></div> }))} /> : <Empty description="还没有版本记录" />}<Modal title="创建命名版本" open={createOpen} onCancel={() => setCreateOpen(false)} onOk={() => void create()} confirmLoading={creating} okText="创建"><div className="space-y-3 pt-2"><label className="block text-sm text-[var(--studio-text)]">版本名称<Input className="mt-2" value={versionName} maxLength={120} placeholder="例如：第一幕定稿" onChange={(event) => setVersionName(event.target.value)} /></label><label className="block text-sm text-[var(--studio-text)]">修改说明（可选）<Input.TextArea className="mt-2" value={changeSummary} rows={3} placeholder="说明本版本保留的关键修改" onChange={(event) => setChangeSummary(event.target.value)} /></label></div></Modal><Modal width={920} title="版本内容对比" open={Boolean(compareVersion)} onCancel={() => setCompareVersion(null)} footer={null}>{compareVersion ? <div><p className="text-sm text-[var(--studio-muted)]">展开变化区块可查看版本内容与当前内容。</p><div className="mt-3 flex flex-wrap gap-2">{changedSections.length ? changedSections.map((section) => <Tag key={section.key} color="orange">{section.label}</Tag>) : <Tag color="green">已加载区块未检测到变化</Tag>}</div><div className="mt-4 space-y-3">{changedSections.map((section) => <details key={section.key} className="rounded-lg border border-[var(--studio-line)] p-3"><summary className="cursor-pointer font-medium text-[var(--studio-ink)]">{section.label}</summary><div className="mt-3 grid gap-3 md:grid-cols-2"><div><p className="mb-2 text-xs font-medium text-[var(--studio-muted)]">版本内容</p><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--studio-surface-soft)] p-3 text-xs text-[var(--studio-text)]">{JSON.stringify(section.before, null, 2)}</pre></div><div><p className="mb-2 text-xs font-medium text-[var(--studio-muted)]">当前内容</p><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--studio-surface-soft)] p-3 text-xs text-[var(--studio-text)]">{JSON.stringify(section.after, null, 2)}</pre></div></div></details>)}</div><p className="mt-4 text-xs text-[var(--studio-faint)]">分集正文按需加载，本次仅比较项目详情中的结构化设定与分集摘要。</p></div> : null}</Modal></section>;
}
