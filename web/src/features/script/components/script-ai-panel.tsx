"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { App, Alert, Button, Input, Modal, Select, Tag } from "antd";
import { Check, Sparkles, Trash2 } from "lucide-react";

import { ModelPicker } from "@/features/settings/components/model-picker";
import { modelOptionLabel, useConfigStore, useEffectiveConfig } from "@/features/settings/stores/use-config-store";
import { analyzeScript, applyScriptAiDraft, discardScriptAiDraft, generateScriptDraft } from "@/services/api/script";
import { isScriptAiDraftStale } from "../lib/script-episode-editing";
import { useScriptStore } from "../stores/use-script-store";
import type { ScriptAiDraft, ScriptWorkspaceSection } from "../types";

const ACTIONS = [
    { value: "storyDirections", label: "生成候选故事方向", sections: ["overview"] },
    { value: "outline", label: "生成故事大纲", sections: ["outline"] },
    { value: "characters", label: "生成人物与关系", sections: ["characters"] },
    { value: "world", label: "生成世界观与地点", sections: ["world"] },
    { value: "episodePlan", label: "生成分集规划", sections: ["episodes"] },
    { value: "episodeDraft", label: "生成单集场次与正文", sections: ["episodes"] },
    ...[
        ["polish", "润色"], ["expand", "扩写"], ["condense", "精简"], ["rewrite", "改写"],
        ["colloquialize", "口语化"], ["dialogue", "对白优化"], ["conflict", "冲突强化"],
        ["suspense", "悬念优化"], ["twist", "反转优化"], ["motivation", "动机优化"],
        ["emotion", "情绪优化"], ["climax", "高潮优化"], ["rhythm", "节奏优化"], ["style", "风格优化"],
    ].map(([value, label]) => ({ value, label, sections: ["episodes"] })),
    { value: "analyzeProject", label: "分析整个剧本", sections: ["analysis"] },
    { value: "analyzeEpisode", label: "分析选中单集", sections: ["analysis", "episodes"] },
] as Array<{ value: string; label: string; sections: string[] }>;

/** 剧本工作台右侧动作式AI助手。 */
export function ScriptAiPanel({ section, selectedEpisodeId }: { section: ScriptWorkspaceSection; selectedEpisodeId: string }) {
    const { message, modal } = App.useApp();
    const config = useEffectiveConfig();
    const openConfig = useConfigStore((state) => state.openConfigDialog);
    const project = useScriptStore((state) => state.project);
    const drafts = useScriptStore((state) => state.drafts);
    const aiTarget = useScriptStore((state) => state.aiTarget);
    const saveStatus = useScriptStore((state) => state.saveStatus);
    const replaceDrafts = useScriptStore((state) => state.replaceDrafts);
    const replaceReports = useScriptStore((state) => state.replaceAnalysisReports);
    const reloadProject = useScriptStore((state) => state.reloadProject);
    const [model, setModel] = useState("");
    const [action, setAction] = useState("");
    const [instruction, setInstruction] = useState("");
    const [running, setRunning] = useState(false);
    const [discardingId, setDiscardingId] = useState("");
    const [preview, setPreview] = useState<ScriptAiDraft | null>(null);
    const [draftJson, setDraftJson] = useState("");
    const requestGeneration = useRef(0);
    const discardGeneration = useRef(0);
    const options = useMemo(() => ACTIONS.filter((item) => item.sections.includes(section)), [section]);
    const creditCost = config.modelCosts.find((item) => item.taskType === "text" && item.model === model)?.credits;
    const directionCandidates = useMemo(() => preview?.actionType === "storyDirections" && Array.isArray(preview.draftData.candidates)
        ? preview.draftData.candidates as Array<Record<string, unknown>> : [], [preview]);
    const isAnalysisAction = action.startsWith("analyze");

    useEffect(() => { if (!model && config.textModel) setModel(config.textModel); }, [config.textModel, model]);
    useEffect(() => { if (!options.some((item) => item.value === action)) setAction(options[0]?.value || ""); }, [action, options]);
    useEffect(() => { if (preview) setDraftJson(JSON.stringify(preview.draftData, null, 2)); }, [preview]);
    useEffect(() => {
        requestGeneration.current += 1;
        discardGeneration.current += 1;
        setPreview(null);
        setDraftJson("");
        setInstruction("");
        setRunning(false);
        setDiscardingId("");
    }, [project?.id]);
    if (!project) return null;

    const isOverviewEmpty = !project.overview.logline?.trim() && !project.overview.synopsis?.trim();
    const isStoryDirectionsBlocked = action === "storyDirections" && isOverviewEmpty;
    const isOutlineBlocked = action === "outline" && isOverviewEmpty;
    const isOutlineEmpty = !project.outlineSections?.length || project.outlineSections.some((item) => !item.content?.trim());
    const isOutlineDependentBlocked = ["characters", "world", "episodePlan", "episodeDraft"].includes(action) && isOutlineEmpty;

    const blockedReason = isStoryDirectionsBlocked
        ? "请先在故事概览中填写一句话创意或故事梗概，再生成候选故事方向"
        : isOutlineBlocked
            ? "请先在故事概览中填写一句话创意或故事梗概，再生成故事大纲"
            : isOutlineDependentBlocked
                ? "请先完成故事大纲，再继续当前AI动作"
                : "";
    const isBlocked = Boolean(blockedReason);

    const resolveTarget = () => {
        if (action === "storyDirections") return { targetType: "overview", targetId: undefined };
        if (["outline", "characters", "world"].includes(action)) return { targetType: action, targetId: undefined };
        if (action === "episodePlan") return { targetType: "episodes", targetId: undefined };
        if (action === "episodeDraft") return { targetType: "episode", targetId: aiTarget?.targetType === "episode" ? aiTarget.targetId : selectedEpisodeId };
        if (action === "analyzeProject") return { targetType: "project", targetId: undefined };
        if (action === "analyzeEpisode") return { targetType: "episode", targetId: selectedEpisodeId };
        return aiTarget || { targetType: "episode", targetId: selectedEpisodeId, label: "选中单集" };
    };

    const execute = () => {
        if (isBlocked) {
            message.warning(blockedReason);
            return;
        }
        if (saveStatus !== "saved" && saveStatus !== "idle") {
            message.warning("请先完成当前剧本修改的保存，再调用AI");
            return;
        }
        if (!model) {
            message.warning("请先选择文本模型");
            return;
        }
        if (creditCost === undefined) {
            message.warning("当前模型未提供明确的积分价格，请刷新模型配置后重试");
            return;
        }
        const target = resolveTarget();
        if ((action === "episodeDraft" || !["storyDirections", "outline", "characters", "world", "episodePlan", "analyzeProject"].includes(action)) && !target.targetId) {
            message.warning("请先选择单集、场次或正文块作为AI目标");
            return;
        }
        modal.confirm({
            title: isAnalysisAction ? "确认执行剧本分析？" : "确认生成AI草稿？",
            content: <div className="space-y-2 text-sm"><p>模型：{modelOptionLabel(config, model)}</p><p>预计消耗：{creditCost} 积分</p><p>{isAnalysisAction ? "分析结果会保存为报告，不会修改正式剧本。" : "AI结果会先保存为待确认草稿，不会直接覆盖正式内容。"}</p></div>,
            okText: "确认执行",
            cancelText: "取消",
            onOk: async () => {
                if (!["saved", "idle"].includes(useScriptStore.getState().saveStatus)) {
                    message.warning("剧本又有未保存修改，请保存完成后重新确认");
                    return;
                }
                const latestProject = useScriptStore.getState().project;
                if (!latestProject || latestProject.id !== project.id) {
                    message.warning("当前剧本项目已经切换，请重新发起AI操作");
                    return;
                }
                const generation = ++requestGeneration.current;
                setRunning(true);
                try {
                    const projectId = latestProject.id;
                    if (action === "analyzeProject" || action === "analyzeEpisode") {
                        const scopeType = action === "analyzeProject" ? "project" : "episode";
                        const report = await analyzeScript({ projectId, expectedRevision: latestProject.revision, scopeType, scopeId: scopeType === "episode" ? selectedEpisodeId : undefined, instruction, model });
                        if (generation !== requestGeneration.current || useScriptStore.getState().project?.id !== projectId) return;
                        replaceReports([report, ...useScriptStore.getState().analysisReports]);
                        message.success("分析报告已生成");
                    } else {
                        const draft = await generateScriptDraft({ projectId, expectedRevision: latestProject.revision, actionType: action, targetType: target.targetType, targetId: target.targetId, instruction, model });
                        if (generation !== requestGeneration.current || useScriptStore.getState().project?.id !== projectId) return;
                        replaceDrafts([draft, ...useScriptStore.getState().drafts]);
                        setPreview(draft);
                        message.success("AI草稿已生成，请检查后确认应用");
                    }
                } catch (error) {
                    if (generation === requestGeneration.current && useScriptStore.getState().project?.id === latestProject.id) {
                        message.error(error instanceof Error ? error.message : "AI操作失败");
                    }
                } finally {
                    if (generation === requestGeneration.current) setRunning(false);
                }
            },
        });
    };

    const applyDraft = async () => {
        if (!preview) return;
        if (!["saved", "idle"].includes(useScriptStore.getState().saveStatus)) {
            message.warning("请先完成当前剧本修改的保存，再应用AI草稿");
            return;
        }
        let parsed: Record<string, unknown>;
        try { parsed = JSON.parse(draftJson) as Record<string, unknown>; } catch { message.error("草稿JSON格式不合法"); return; }
        const latestProject = useScriptStore.getState().project;
        if (!latestProject || latestProject.id !== project.id) {
            message.warning("当前剧本项目已经切换，请重新选择AI草稿");
            return;
        }
        const generation = ++requestGeneration.current;
        setRunning(true);
        try {
            const projectId = latestProject.id;
            await applyScriptAiDraft({ projectId, expectedRevision: latestProject.revision, draftId: preview.id, draftData: parsed });
            if (generation !== requestGeneration.current || useScriptStore.getState().project?.id !== projectId) return;
            setPreview(null);
            await reloadProject();
            message.success("AI草稿已应用，并已自动保存修改前版本");
        } catch (error) {
            if (generation === requestGeneration.current && useScriptStore.getState().project?.id === latestProject.id) {
                message.error(error instanceof Error ? error.message : "应用AI草稿失败");
            }
        } finally {
            if (generation === requestGeneration.current) setRunning(false);
        }
    };

    const discard = async (draft: ScriptAiDraft) => {
        const latestProject = useScriptStore.getState().project;
        if (!latestProject || latestProject.id !== project.id) {
            message.warning("当前剧本项目已经切换，请重新选择AI草稿");
            return;
        }
        const projectId = latestProject.id;
        const generation = ++discardGeneration.current;
        setDiscardingId(draft.id);
        try {
            await discardScriptAiDraft(projectId, latestProject.revision, draft.id);
            if (generation !== discardGeneration.current || useScriptStore.getState().project?.id !== projectId) return;
            replaceDrafts(useScriptStore.getState().drafts.filter((item) => item.id !== draft.id));
            if (preview?.id === draft.id) setPreview(null);
            message.success("草稿已放弃");
        } catch (error) {
            if (generation === discardGeneration.current && useScriptStore.getState().project?.id === projectId) {
                message.error(error instanceof Error ? error.message : "放弃草稿失败，请重试");
            }
        } finally {
            if (generation === discardGeneration.current) setDiscardingId("");
        }
    };

    return <aside className="flex h-full min-h-0 flex-col bg-[var(--studio-panel-solid)]"><div className="border-b border-[var(--studio-line)] p-4"><div className="flex items-center gap-2"><Sparkles className="size-5 text-[var(--studio-primary)]" /><h2 className="font-semibold text-[var(--studio-ink)]">AI 剧本助手</h2></div><p className="mt-2 text-xs leading-5 text-[var(--studio-muted)]">草稿确认后才修改正式剧本，专业分析只生成报告。</p></div><div className="flex-1 space-y-4 overflow-y-auto p-4"><label className="block text-xs font-medium text-[var(--studio-muted)]">动作<Select className="mt-1 w-full" value={action} options={options.map(({ value, label }) => ({ value, label }))} onChange={setAction} /></label><label className="block text-xs font-medium text-[var(--studio-muted)]">模型<div className="mt-1"><ModelPicker config={config} value={model} onChange={setModel} capability="text" fullWidth onMissingConfig={() => openConfig(true, "models")} /></div></label><div className="rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-3 text-xs text-[var(--studio-muted)]"><p>当前目标：{aiTarget?.label || (selectedEpisodeId ? "选中单集" : "当前区块")}</p><p className="mt-1">预计积分：{creditCost === undefined ? "未配置" : `${creditCost} 积分`}</p></div><Input.TextArea rows={4} value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="补充风格、篇幅、节奏或必须保留的设定" />{isBlocked ? <Alert type="warning" showIcon title={blockedReason} className="text-xs" /> : null}<Button type="primary" block loading={running} disabled={isBlocked} icon={<Sparkles className="size-4" />} onClick={execute}>{isAnalysisAction ? "执行专业分析" : "生成待确认草稿"}</Button><div className="border-t border-[var(--studio-line)] pt-4"><h3 className="text-sm font-medium text-[var(--studio-ink)]">待确认草稿</h3><div className="mt-2 space-y-2">{drafts.filter((draft) => draft.status === "pending").map((draft) => <div key={draft.id} className="rounded-lg border border-[var(--studio-line)] p-3"><div className="flex items-center justify-between gap-2"><button type="button" className="truncate text-left text-sm font-medium text-[var(--studio-text)]" onClick={() => setPreview(draft)}>{ACTIONS.find((item) => item.value === draft.actionType)?.label || draft.actionType}</button>{isScriptAiDraftStale(draft, project.revision) ? <Tag color="orange">已过期</Tag> : <Tag color="blue">待确认</Tag>}</div><div className="mt-2 flex gap-2"><Button size="small" onClick={() => setPreview(draft)}>预览差异</Button><Button size="small" danger icon={<Trash2 className="size-3.5" />} loading={discardingId === draft.id} disabled={Boolean(discardingId) && discardingId !== draft.id} onClick={() => void discard(draft)}>放弃</Button></div></div>)}{!drafts.some((draft) => draft.status === "pending") ? <p className="text-xs text-[var(--studio-faint)]">暂无待确认草稿</p> : null}</div></div></div><Modal width={920} title="AI草稿差异预览" open={Boolean(preview)} onCancel={() => setPreview(null)} footer={<div className="flex justify-end gap-2"><Button onClick={() => setPreview(null)}>稍后处理</Button><Button type="primary" icon={<Check className="size-4" />} disabled={Boolean(preview && isScriptAiDraftStale(preview, project.revision)) || !["saved", "idle"].includes(saveStatus)} loading={running} onClick={() => void applyDraft()}>确认应用</Button></div>}>{preview ? <div>{isScriptAiDraftStale(preview, project.revision) ? <Alert type="warning" showIcon title="项目内容已变化" description="该草稿基于旧修订生成，不能覆盖当前内容。请放弃并重新生成。" className="mb-4" /> : null}{directionCandidates.length ? <div className="mb-4 grid gap-2 md:grid-cols-3">{directionCandidates.map((candidate, index) => <button key={index} type="button" className="rounded-lg border border-[var(--studio-line)] p-3 text-left hover:border-[var(--studio-primary-line)]" onClick={() => { const next = { ...preview.draftData, selectedIndex: index }; setDraftJson(JSON.stringify(next, null, 2)); }}><strong className="text-sm text-[var(--studio-ink)]">{String(candidate.name || `方向 ${index + 1}`)}</strong><p className="mt-2 text-xs leading-5 text-[var(--studio-muted)]">{String(candidate.logline || "")}</p></button>)}</div> : null}<div className="grid gap-4 md:grid-cols-2"><label className="text-sm font-medium text-[var(--studio-text)]">修改前<Input.TextArea className="mt-2 font-mono text-xs" rows={22} readOnly value={JSON.stringify(preview.sourceData, null, 2)} /></label><label className="text-sm font-medium text-[var(--studio-text)]">AI草稿（可编辑）<Input.TextArea className="mt-2 font-mono text-xs" rows={22} value={draftJson} onChange={(event) => setDraftJson(event.target.value)} /></label></div></div> : null}</Modal></aside>;
}
