"use client";

import { translateMessage } from "@/features/locale/translate";
import { useTranslation } from "@/features/locale/use-translation";

import { useEffect, useMemo, useRef, useState } from "react";
import { App, Alert, Button, Collapse, Input, Modal, Select, Tag } from "antd";
import { Check, Sparkles, Trash2 } from "lucide-react";

import { ModelPicker } from "@/features/settings/components/model-picker";
import { modelOptionLabel, useConfigStore, useEffectiveConfig } from "@/features/settings/stores/use-config-store";
import { applyScriptAiDraft, discardScriptAiDraft, generateScriptDraft } from "@/services/api/script";
import { isScriptAiDraftStale } from "../lib/script-episode-editing";
import { useScriptStore } from "../stores/use-script-store";
import type { ScriptAiDraft, ScriptWorkspaceSection } from "../types";

const getActions = (translate = translateMessage) => ([
    { value: "storyDirections", label: translate("script.generateStoryDirections"), sections: ["overview"] },
    { value: "outline", label: translate("script.generateStoryOutline"), sections: ["outline"] },
    { value: "characters", label: translate("script.generateCharactersAndRelationships"), sections: ["characters"] },
    { value: "world", label: translate("script.generateWorldAndLocations"), sections: ["world"] },
    { value: "episodePlan", label: translate("script.generateEpisodePlans"), sections: ["episodes"] },
    { value: "episodeDraft", label: translate("script.generateEpisodeScenesAndText"), sections: ["episodes"] },
    ...[
        ["polish", translate("script.polish")], ["expand", translate("script.expand")], ["condense", translate("script.condense")], ["rewrite", translate("script.rewrite")],
        ["colloquialize", translate("script.makeConversational")], ["dialogue", translate("script.improveDialogue")], ["conflict", translate("script.strengthenConflict")],
        ["suspense", translate("script.improveSuspense")], ["twist", translate("script.improveTwists")], ["motivation", translate("script.improveMotivation")],
        ["emotion", translate("script.improveEmotion")], ["climax", translate("script.improveClimax")], ["rhythm", translate("script.improvePacing")], ["style", translate("script.improveStyle")],
    ].map(([value, label]) => ({ value, label, sections: ["episodes"] })),
] as Array<{ value: string; label: string; sections: string[] }>);

/**
 * 小说改编流程产出的动作中文名。
 * <p>
 * 那些草稿同样会进入「待确认草稿」列表 —— 这里目前是草稿唯一的应用入口（改编面板只负责生成），
 * 所以必须给出中文名，不能只显示 {@code novelAdaptationepisode} 这样的英文标识。
 */
const getNovelAdaptationLabels = (translate = translateMessage): Record<string, string> => ({
    novelAdaptationoverview: translate("script.novelAdaptationStoryOverview"),
    novelAdaptationoutline: translate("script.novelAdaptationStoryOutline"),
    novelAdaptationcharacters: translate("script.novelAdaptationCharactersAndRelationships"),
    novelAdaptationworld: translate("script.novelAdaptationWorldAndLocations"),
    novelAdaptationepisodes: translate("script.novelAdaptationEpisodePlanning"),
    novelAdaptationepisode: translate("script.novelAdaptationEpisodeText"),
});

/** 草稿标题：优先用助手动作名，其次是小说改编动作名，最后退回目标类型；能定位到分集时补上集号。 */
function draftTitle(draft: ScriptAiDraft, episodes: Array<{ id: string; episodeNumber: number }>, translate = translateMessage) {
    const label = getActions(translate).find((item) => item.value === draft.actionType)?.label
        || getNovelAdaptationLabels(translate)[draft.actionType]
        || (draft.actionType.startsWith("novelAdaptation") ? translate("script.novelAdaptationDraft") : translate("script.aiDraft"));
    if (draft.targetType === "episode" && draft.targetId) {
        const episode = episodes.find((item) => item.id === draft.targetId);
        if (episode) return translate("script.countEpisodeCount", { value0: label, value1: episode.episodeNumber });
    }
    return label;
}

type CardAiTarget = { targetType: "episode" | "scene"; targetId: string; label: string };

/** 草稿顶层字段的中文名，用于把草稿讲成人话。 */
const getDraftFieldLabels = (translate = translateMessage): Record<string, string> => ({
    candidates: translate("script.storyDirections"), sections: translate("script.outlineSections"), events: translate("script.keyEvents"),
    characters: translate("script.character"), relations: translate("script.characterRelationships"), worldSetting: translate("script.worldTone"),
    worldItems: translate("script.worldEntries"), locations: translate("script.location"), episodes: translate("script.episode"),
    episode: translate("script.episodeInformation"), scenes: translate("script.scene"), blocks: translate("script.textBlock"),
});

/** 常见字段的中文名；未收录的字段直接显示原键名，好过让用户猜。 */
const getDraftValueLabels = (translate = translateMessage): Record<string, string> => ({
    title: translate("script.title"), logline: translate("script.logline"), synopsis: translate("script.synopsis"), contentType: translate("script.contentFormat"),
    genre: translate("script.genre"), narrativeStyle: translate("script.narrativeStyle"), theme: translate("script.theme"), mainPlot: translate("script.mainPlot"),
    mainConflict: translate("script.centralConflict"), endingDirection: translate("script.endingDirection"), targetEpisodeCount: translate("script.targetEpisodes"),
    targetDurationSeconds: translate("script.targetDurationSeconds"), era: translate("script.era"), region: translate("script.region"),
    socialBackground: translate("script.socialBackground"), overallTone: translate("script.overallTone"), summary: translate("script.plotSummary"),
    keyEvents: translate("script.keyEvents"), climax: translate("script.climax"), endingHook: translate("script.cliffhanger"), episodeNumber: translate("script.episodeNumber"),
    name: translate("script.name"), description: translate("script.description"), content: translate("script.content"), identity: translate("script.identity"),
});

/** 条目显示名：优先名称类字段，退回标题，最后用标识。 */
function draftEntryLabel(entry: Record<string, unknown>, translate = translateMessage) {
    const name = entry.name ?? entry.title ?? entry.summary;
    return String(typeof name === "string" && name.trim() ? name : entry.id ?? translate("script.untitled"));
}

/** 该字段在正式内容里已有的条目标识，用于区分「新增」与「更新」。 */
function draftExistingIds(sourceData: Record<string, unknown> | null | undefined, key: string) {
    const source = sourceData?.[key];
    if (!Array.isArray(source)) return new Set<string>();
    return new Set(source.map((item) => (item && typeof item === "object" ? String((item as Record<string, unknown>).id ?? "") : "")));
}

type DraftSummaryGroup = { label: string; added: string[]; updated: string[]; values: string[] };

/** 把草稿讲成「哪一类、动了几项、分别是谁」，避免让用户直接读 JSON。 */
function summarizeDraft(sourceData: Record<string, unknown> | null | undefined, draftData: Record<string, unknown> | null | undefined, translate = translateMessage): DraftSummaryGroup[] {
    if (!draftData || typeof draftData !== "object") return [];
    const groups: DraftSummaryGroup[] = [];
    for (const [key, value] of Object.entries(draftData)) {
        const label = getDraftFieldLabels(translate)[key] || getDraftValueLabels(translate)[key] || key;
        if (Array.isArray(value)) {
            const existing = draftExistingIds(sourceData, key);
            const added: string[] = [];
            const updated: string[] = [];
            for (const item of value) {
                if (!item || typeof item !== "object") continue;
                const entry = item as Record<string, unknown>;
                (existing.has(String(entry.id ?? "")) ? updated : added).push(draftEntryLabel(entry, translate));
            }
            if (added.length || updated.length) groups.push({ label, added, updated, values: [] });
        } else if (value && typeof value === "object") {
            // 单对象草稿（概览、世界观基调）没有条目可数，改为列出有内容的字段。
            const values = Object.entries(value as Record<string, unknown>)
                .filter(([, item]) => item !== null && item !== undefined && item !== "" && typeof item !== "object")
                .map(([field, item]) => `${getDraftValueLabels(translate)[field] || field}：${String(item).slice(0, 80)}`);
            const listFields = Object.entries(value as Record<string, unknown>)
                .filter(([, item]) => Array.isArray(item) && (item as unknown[]).length > 0)
                .map(([field, item]) => translate("script.countCountItems", { value0: getDraftValueLabels(translate)[field] || field, value1: (item as unknown[]).length }));
            if (values.length || listFields.length) groups.push({ label, added: [], updated: [], values: [...values, ...listFields] });
        }
    }
    return groups;
}

/** 单组最多直接列出的条目数，超出只显示数量。 */
const DRAFT_SUMMARY_MAX_ITEMS = 12;

/** 草稿差异摘要：默认让人一眼看懂改了什么，原始 JSON 收进折叠区。 */
function DraftDiffSummary({ sourceData, draftData }: { sourceData: Record<string, unknown>; draftData: Record<string, unknown> }) {
    const translate = useTranslation();
    const groups = summarizeDraft(sourceData, draftData, translate);
    if (!groups.length) return <Alert type="info" showIcon title={translate("script.noChangesToPreview")} description={translate("script.theModelReturnedNoRecognizableContentDiscardThisDraftAnd")} />;
    return <div className="space-y-3">
        <p className="text-xs text-[var(--studio-muted)]">{translate("script.changesFromThisDraftExpandTheRawJsonBelowFor")}</p>
        {groups.map((group) => <div key={group.label} className="rounded-lg border border-[var(--studio-line)] p-3">
            <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-[var(--studio-ink)]">{group.label}</span>
                {group.added.length ? <Tag color="green" className="mr-0">{translate("script.addCount_d96dbf", { value0: group.added.length })}</Tag> : null}
                {group.updated.length ? <Tag color="blue" className="mr-0">{translate("script.updateCount_370616", { value0: group.updated.length })}</Tag> : null}
            </div>
            {group.values.length ? <div className="mt-2 space-y-1">
                {group.values.map((line, index) => <p key={index} className="break-words text-xs leading-5 text-[var(--studio-muted)]">{line}</p>)}
            </div> : null}
            {group.added.length || group.updated.length ? <div className="mt-2 space-y-1 text-xs">
                {group.added.slice(0, DRAFT_SUMMARY_MAX_ITEMS).map((name, index) => <p key={`a${index}`} className="break-words text-[var(--studio-text)]"><span className="text-emerald-500">＋</span> {name}</p>)}
                {group.added.length > DRAFT_SUMMARY_MAX_ITEMS ? <p className="text-[var(--studio-muted)]">{translate("script.countMoreAdditionsNotShown_4f4282", { value0: group.added.length - DRAFT_SUMMARY_MAX_ITEMS })}</p> : null}
                {group.updated.slice(0, DRAFT_SUMMARY_MAX_ITEMS).map((name, index) => <p key={`u${index}`} className="break-words text-[var(--studio-text)]"><span className="text-[var(--studio-primary)]">～</span> {name}</p>)}
                {group.updated.length > DRAFT_SUMMARY_MAX_ITEMS ? <p className="text-[var(--studio-muted)]">{translate("script.countMoreUpdatesNotShown_7d4532", { value0: group.updated.length - DRAFT_SUMMARY_MAX_ITEMS })}</p> : null}
            </div> : null}
        </div>)}
    </div>;
}

/** 剧本工作台的动作式AI助手，可用于侧栏或指定卡片弹窗。 */
export function ScriptAiPanel({ section, selectedEpisodeId, cardTarget }: { section: ScriptWorkspaceSection; selectedEpisodeId: string; cardTarget?: CardAiTarget }) {
    const translate = useTranslation();
    const { message, modal } = App.useApp();
    const config = useEffectiveConfig();
    const openConfig = useConfigStore((state) => state.openConfigDialog);
    const project = useScriptStore((state) => state.project);
    const drafts = useScriptStore((state) => state.drafts);
    const aiTarget = useScriptStore((state) => state.aiTarget);
    const saveStatus = useScriptStore((state) => state.saveStatus);
    const replaceDrafts = useScriptStore((state) => state.replaceDrafts);
    const reloadProject = useScriptStore((state) => state.reloadProject);
    const [model, setModel] = useState("");
    const [action, setAction] = useState(cardTarget?.targetType === "episode" ? "episodeDraft" : cardTarget?.targetType === "scene" ? "polish" : "");
    const [instruction, setInstruction] = useState("");
    const [running, setRunning] = useState(false);
    const [discardingId, setDiscardingId] = useState("");
    const [preview, setPreview] = useState<ScriptAiDraft | null>(null);
    const [draftJson, setDraftJson] = useState("");
    const requestGeneration = useRef(0);
    const discardGeneration = useRef(0);
    const options = useMemo(() => getActions(translate).filter((item) => item.sections.includes(section) && (!cardTarget || (cardTarget.targetType === "episode" ? item.value === "episodeDraft" : !["episodePlan", "episodeDraft"].includes(item.value)))), [cardTarget, section, translate.locale]);
    const creditCost = config.modelCosts.find((item) => item.taskType === "text" && item.model === model)?.credits;
    const directionCandidates = useMemo(() => preview?.actionType === "storyDirections" && Array.isArray(preview.draftData.candidates)
        ? preview.draftData.candidates as Array<Record<string, unknown>> : [], [preview]);
    const visibleDrafts = drafts.filter((draft) => draft.status === "pending" && (!cardTarget || (draft.targetType === cardTarget.targetType && draft.targetId === cardTarget.targetId)));

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
        ? translate("script.addALoglineOrSynopsisToTheStoryOverviewBefore")
        : isOutlineBlocked
            ? translate("script.addALoglineOrSynopsisToTheStoryOverviewBefore_966c69")
            : isOutlineDependentBlocked
                ? translate("script.completeTheStoryOutlineBeforeUsingThisAiAction")
                : "";
    const isBlocked = Boolean(blockedReason);

    const resolveTarget = () => {
        if (action === "storyDirections") return { targetType: "overview", targetId: undefined };
        if (["outline", "characters", "world"].includes(action)) return { targetType: action, targetId: undefined };
        if (action === "episodePlan") return { targetType: "episodes", targetId: undefined };
        if (action === "episodeDraft") return { targetType: "episode", targetId: cardTarget?.targetId || (aiTarget?.targetType === "episode" ? aiTarget.targetId : selectedEpisodeId) };
        return cardTarget || aiTarget || { targetType: "episode", targetId: selectedEpisodeId, label: translate("script.selectedEpisode") };
    };

    const execute = () => {
        if (isBlocked) {
            message.warning(blockedReason);
            return;
        }
        if (saveStatus !== "saved" && saveStatus !== "idle") {
            message.warning(translate("script.saveScriptChangesBeforeUsingAi"));
            return;
        }
        if (!model) {
            message.warning(translate("script.selectATextModelFirst"));
            return;
        }
        if (creditCost === undefined) {
            message.warning(translate("script.thisModelHasNoExplicitCreditPriceRefreshTheModel"));
            return;
        }
        const target = resolveTarget();
        if ((action === "episodeDraft" || !["storyDirections", "outline", "characters", "world", "episodePlan"].includes(action)) && !target.targetId) {
            message.warning(translate("script.selectAnEpisodeSceneOrTextBlockAsTheAi"));
            return;
        }
        modal.confirm({
            title: translate("script.generateAnAiDraft"),
            content: <div className="space-y-2 text-sm"><p>{translate("script.modelCount_d0ad77", { value0: modelOptionLabel(config, model) })}</p><p>{translate("script.estimatedCostCountCredits_ed4072", { value0: creditCost })}</p><p>{translate("script.aiResultsAreSavedAsReviewDraftsAndWillNot")}</p></div>,
            okText: translate("script.confirm"),
            cancelText: translate("script.cancel"),
            onOk: async () => {
                if (!["saved", "idle"].includes(useScriptStore.getState().saveStatus)) {
                    message.warning(translate("script.theScriptHasNewUnsavedChangesSaveBeforeConfirmingAgain"));
                    return;
                }
                const latestProject = useScriptStore.getState().project;
                if (!latestProject || latestProject.id !== project.id) {
                    message.warning(translate("script.theScriptProjectHasChangedStartTheAiActionAgain"));
                    return;
                }
                const generation = ++requestGeneration.current;
                setRunning(true);
                try {
                    const projectId = latestProject.id;
                    const draft = await generateScriptDraft({ projectId, expectedRevision: latestProject.revision, actionType: action, targetType: target.targetType, targetId: target.targetId, instruction, model });
                    if (generation !== requestGeneration.current || useScriptStore.getState().project?.id !== projectId) return;
                    replaceDrafts([draft, ...useScriptStore.getState().drafts]);
                    setPreview(draft);
                    message.success(translate("script.aiDraftGeneratedReviewItBeforeApplying"));
                } catch (error) {
                    if (generation === requestGeneration.current && useScriptStore.getState().project?.id === latestProject.id) {
                        message.error(error instanceof Error ? error.message : translate("script.aiActionFailed"));
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
            message.warning(translate("script.saveScriptChangesBeforeApplyingAnAiDraft"));
            return;
        }
        let parsed: Record<string, unknown>;
        try { parsed = JSON.parse(draftJson) as Record<string, unknown>; } catch { message.error(translate("script.theDraftIsNotValidJson")); return; }
        const latestProject = useScriptStore.getState().project;
        if (!latestProject || latestProject.id !== project.id) {
            message.warning(translate("script.theScriptProjectHasChangedSelectTheAiDraftAgain"));
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
            message.success(translate("script.aiDraftAppliedAPreviousVersionWasSavedAutomatically"));
        } catch (error) {
            if (generation === requestGeneration.current && useScriptStore.getState().project?.id === latestProject.id) {
                message.error(error instanceof Error ? error.message : translate("script.couldNotApplyTheAiDraft"));
            }
        } finally {
            if (generation === requestGeneration.current) setRunning(false);
        }
    };

    const discard = async (draft: ScriptAiDraft) => {
        const latestProject = useScriptStore.getState().project;
        if (!latestProject || latestProject.id !== project.id) {
            message.warning(translate("script.theScriptProjectHasChangedSelectTheAiDraftAgain"));
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
            message.success(translate("script.draftDiscarded"));
        } catch (error) {
            if (generation === discardGeneration.current && useScriptStore.getState().project?.id === projectId) {
                message.error(error instanceof Error ? error.message : translate("script.couldNotDiscardTheDraftTryAgain"));
            }
        } finally {
            if (generation === discardGeneration.current) setDiscardingId("");
        }
    };

    return <aside className="flex h-full min-h-0 flex-col bg-[var(--studio-panel-solid)]"><div className="border-b border-[var(--studio-line)] p-4"><div className="flex items-center gap-2"><Sparkles className="size-5 text-[var(--studio-primary)]" /><h2 className="font-semibold text-[var(--studio-ink)]">{translate("script.aiScriptAssistant")}</h2></div><p className="mt-2 text-xs leading-5 text-[var(--studio-muted)]">{translate("script.theScriptChangesOnlyAfterYouApproveADraft")}</p></div><div className="flex-1 space-y-4 overflow-y-auto p-4"><label className="block text-xs font-medium text-[var(--studio-muted)]">{translate("script.action")}<Select className="mt-1 w-full" value={action} options={options.map(({ value, label }) => ({ value, label }))} onChange={setAction} /></label><label className="block text-xs font-medium text-[var(--studio-muted)]">{translate("script.model_98fd0c")}<div className="mt-1"><ModelPicker config={config} value={model} onChange={setModel} capability="text" fullWidth onMissingConfig={() => openConfig(true, "models")} /></div></label><div className="rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-3 text-xs text-[var(--studio-muted)]"><p>{translate("script.currentTargetCount_a7f10b", { value0: cardTarget?.label || aiTarget?.label || (selectedEpisodeId ? translate("script.selectedEpisode") : translate("script.currentSection")) })}</p><p className="mt-1">{translate("script.estimatedCreditsCount_2061fd", { value0: creditCost === undefined ? translate("script.notConfigured") : translate("script.countCredits", { value0: creditCost }) })}</p></div><Input.TextArea rows={4} value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder={translate("script.addRequirementsForStyleLengthPacingOrSettingsToPreserve")} />{isBlocked ? <Alert type="warning" showIcon title={blockedReason} className="text-xs" /> : null}<Button type="primary" block loading={running} disabled={isBlocked} icon={<Sparkles className="size-4" />} onClick={execute}>{translate("script.generateReviewDraft")}</Button>{running ? <p role="status" className="text-center text-xs text-[var(--studio-muted)]">{translate("script.aiIsProcessingPleaseWait")}</p> : null}<div className="border-t border-[var(--studio-line)] pt-4"><h3 className="text-sm font-medium text-[var(--studio-ink)]">{translate("script.pendingDrafts")}</h3><div className="mt-2 space-y-2">{visibleDrafts.map((draft) => <div key={draft.id} className="rounded-lg border border-[var(--studio-line)] p-3"><div className="flex items-center justify-between gap-2"><button type="button" className="truncate text-left text-sm font-medium text-[var(--studio-text)]" onClick={() => setPreview(draft)}>{draftTitle(draft, project.episodes, translate)}</button>{isScriptAiDraftStale(draft, project.revision) ? <Tag color="orange">{translate("script.outdated")}</Tag> : <Tag color="blue">{translate("script.pendingApproval")}</Tag>}</div><div className="mt-2 flex gap-2"><Button size="small" onClick={() => setPreview(draft)}>{translate("script.previewChanges")}</Button><Button size="small" danger icon={<Trash2 className="size-3.5" />} loading={discardingId === draft.id} disabled={Boolean(discardingId) && discardingId !== draft.id} onClick={() => void discard(draft)}>{translate("script.discard")}</Button></div></div>)}{!visibleDrafts.length ? <p className="text-xs text-[var(--studio-faint)]">{translate("script.noPendingDrafts")}</p> : null}</div></div></div><Modal width={920} title={translate("script.aiDraftChanges")} open={Boolean(preview)} onCancel={() => setPreview(null)} footer={<div className="flex justify-end gap-2"><Button onClick={() => setPreview(null)}>{translate("script.reviewLater")}</Button><Button type="primary" icon={<Check className="size-4" />} disabled={Boolean(preview && isScriptAiDraftStale(preview, project.revision)) || !["saved", "idle"].includes(saveStatus)} loading={running} onClick={() => void applyDraft()}>{translate("script.apply")}</Button></div>}>{preview ? <div>{isScriptAiDraftStale(preview, project.revision) ? <Alert type="warning" showIcon title={translate("script.projectContentHasChanged")} description={translate("script.thisDraftIsBasedOnAnOlderRevisionAndCannot")} className="mb-4" /> : null}{directionCandidates.length ? <div className="mb-4 grid gap-2 md:grid-cols-3">{directionCandidates.map((candidate, index) => <button key={index} type="button" className="rounded-lg border border-[var(--studio-line)] p-3 text-left hover:border-[var(--studio-primary-line)]" onClick={() => { const next = { ...preview.draftData, selectedIndex: index }; setDraftJson(JSON.stringify(next, null, 2)); }}><strong className="text-sm text-[var(--studio-ink)]">{String(candidate.name || translate("script.directionCount", { value0: index + 1 }))}</strong><p className="mt-2 text-xs leading-5 text-[var(--studio-muted)]">{String(candidate.logline || "")}</p></button>)}</div> : null}<DraftDiffSummary sourceData={preview.sourceData} draftData={preview.draftData} /><Collapse size="small" className="mt-4" items={[{ key: "json", label: translate("script.advancedEditingRawJson"), children: <div className="grid gap-4 md:grid-cols-2"><label className="text-sm font-medium text-[var(--studio-text)]">{translate("script.before")}<Input.TextArea className="mt-2 font-mono text-xs" rows={22} readOnly value={JSON.stringify(preview.sourceData, null, 2)} /></label><label className="text-sm font-medium text-[var(--studio-text)]">{translate("script.aiDraftEditable")}<Input.TextArea className="mt-2 font-mono text-xs" rows={22} value={draftJson} onChange={(event) => setDraftJson(event.target.value)} /></label></div> }]} /></div> : null}</Modal></aside>;
}
