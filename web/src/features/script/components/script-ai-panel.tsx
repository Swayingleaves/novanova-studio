"use client";

import { translateMessage } from "@/features/locale/translate";
import { useTranslation } from "@/features/locale/use-translation";

import { useEffect, useMemo, useRef, useState } from "react";
import { App, Alert, Button, Collapse, Input, InputNumber, Modal, Popover, Spin, Tag } from "antd";
import { ArrowUp, Check, ChevronDown, ChevronUp, FileCheck2, Plus, SlidersHorizontal, Sparkles, Trash2, Wand2, X } from "lucide-react";

import { ModelPicker } from "@/features/settings/components/model-picker";
import { useModelConfigurationGuard } from "@/features/settings/hooks/use-model-configuration-guard";
import { modelOptionLabel, useEffectiveConfig } from "@/features/settings/stores/use-config-store";
import {
    applyScriptAiDraft,
    chatScriptAgent,
    discardScriptAiDraft,
    generateScriptDraft,
    getAiActionPricing,
    getScriptAgentHistory,
    resetScriptAgentSession,
} from "@/services/api/script";
import { isScriptAiDraftStale } from "../lib/script-episode-editing";
import { SCRIPT_AI_ACTIONS } from "../lib/script-ai-actions";
import { useScriptStore } from "../stores/use-script-store";
import type {
    ScriptAgentActionRecommendation,
    ScriptAgentHistoryMessage,
    ScriptAiActionPricing,
    ScriptAiDraft,
    ScriptWorkspaceSection,
} from "../types";

/** 动作清单由 `script-ai-actions.ts` 统一维护，后台定价表用的是同一份。 */
const getActions = (translate = translateMessage) => SCRIPT_AI_ACTIONS.map((item) => ({
    value: item.value, label: translate(item.labelKey), sections: item.sections,
})) as Array<{ value: string; label: string; sections: string[] }>;

/** 内容生成类动作编码集合（其余均为正文优化类动作）。 */
const GENERATION_ACTION_SET = new Set(["storyDirections", "outline", "characters", "world", "episodePlan", "episodeDraft"]);

/** 各工作区板块的中文显示名，用于上下文感知条。 */
const SECTION_LABELS: Record<string, string> = {
    overview: "故事概览",
    outline: "故事大纲",
    characters: "人物设定",
    world: "世界观与地点",
    episodes: "分集正文",
};

/**
 * 小说改编流程产出的动作中文名。
 * 那些草稿同样会进入「待确认草稿」列表 —— 这里是草稿唯一的应用入口（改编面板只负责生成），
 * 所以必须保留中文名映射与随时查看入口。
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

type ParsedMessageMeta = {
    recommendations?: ScriptAgentActionRecommendation[];
    draftId?: string;
    actionType?: string;
    actionLabel?: string;
    targetLabel?: string;
};

function parseMessageMeta(raw?: string | null): ParsedMessageMeta {
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw) as ParsedMessageMeta;
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
        return {};
    }
}

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

/** 剧本工作台对话式 AI 剧本助手（保留全部 20 项动作与审核草稿流程，可用于右侧栏或卡片弹窗）。 */
export function ScriptAiPanel({ section, selectedEpisodeId, cardTarget }: { section: ScriptWorkspaceSection; selectedEpisodeId: string; cardTarget?: CardAiTarget }) {
    const translate = useTranslation();
    const assistantName = translate("script.aiScriptAssistant");
    const { message, modal } = App.useApp();
    const config = useEffectiveConfig();
    const ensureModelConfiguration = useModelConfigurationGuard();
    const project = useScriptStore((state) => state.project);
    const drafts = useScriptStore((state) => state.drafts);
    const aiTarget = useScriptStore((state) => state.aiTarget);
    const saveStatus = useScriptStore((state) => state.saveStatus);
    const replaceDrafts = useScriptStore((state) => state.replaceDrafts);
    const reloadProject = useScriptStore((state) => state.reloadProject);

    const [model, setModel] = useState("");
    const [showModelPicker, setShowModelPicker] = useState(false);
    const [showDraftsTray, setShowDraftsTray] = useState(false);
    const [actionsPopoverOpen, setActionsPopoverOpen] = useState(false);

    // 选中的快捷动作模式：空字符串表示自由对话模式，有值表示处于对应草稿动作执行模式。
    const [selectedAction, setSelectedAction] = useState<string>(() => (
        cardTarget?.targetType === "scene" ? "polish"
            : cardTarget?.targetType === "episode" ? "episodeDraft"
                : ""
    ));
    const [inputText, setInputText] = useState("");
    const [episodeDurationSeconds, setEpisodeDurationSeconds] = useState<number>(180);

    const [messages, setMessages] = useState<ScriptAgentHistoryMessage[]>([]);
    const [loadingHistory, setLoadingHistory] = useState(false);
    const [sendingChat, setSendingChat] = useState(false);
    const [runningDraft, setRunningDraft] = useState(false);
    const [discardingId, setDiscardingId] = useState("");

    const [preview, setPreview] = useState<ScriptAiDraft | null>(null);
    const [draftJson, setDraftJson] = useState("");
    const [pricing, setPricing] = useState<{ model: string; items: ScriptAiActionPricing[] } | null>(null);

    const scrollRef = useRef<HTMLDivElement>(null);
    const requestGeneration = useRef(0);
    const discardGeneration = useRef(0);

    const cardTargetType = cardTarget?.targetType;
    const cardTargetId = cardTarget?.targetId;
    const aiTargetType = aiTarget?.targetType;
    const aiTargetId = aiTarget?.targetId;

    const allActions = useMemo(() => getActions(translate), [translate.locale]);

    /** 当前上下文可用的全部动作（保持与原先动作下拉一致的过滤语义）。 */
    const options = useMemo(
        () => allActions.filter((item) => item.sections.includes(section)
            && (!cardTargetType || (cardTargetType === "episode"
                ? item.value === "episodeDraft"
                : !["episodePlan", "episodeDraft"].includes(item.value)))),
        [allActions, cardTargetType, section],
    );

    const generationOptions = useMemo(() => options.filter((item) => GENERATION_ACTION_SET.has(item.value)), [options]);
    const optimizationOptions = useMemo(() => options.filter((item) => !GENERATION_ACTION_SET.has(item.value)), [options]);

    /** 输入框上方直接露出的高频快捷芯片（其余全部收纳在「全部动作」弹层里）。 */
    const quickActionOptions = useMemo(() => {
        if (options.length <= 4) return options;
        const optimizing = cardTargetType === "scene" || (!cardTargetType && aiTargetType === "scene");
        const preferredKeys = optimizing
            ? ["polish", "dialogue", "conflict", "suspense"]
            : ["episodeDraft", "episodePlan", "polish", "dialogue"];
        const picked = preferredKeys
            .map((key) => options.find((item) => item.value === key))
            .filter((item): item is { value: string; label: string; sections: string[] } => Boolean(item));
        return picked.length ? picked : options.slice(0, 4);
    }, [aiTargetType, cardTargetType, options]);

    const pricingCurrent = pricing?.model === model;
    const getActionCreditCost = (actionType: string) => (
        pricingCurrent ? pricing.items.find((item) => item.actionType === actionType)?.credits ?? undefined : undefined
    );
    const selectedActionCreditCost = selectedAction ? getActionCreditCost(selectedAction) : undefined;
    const selectedActionLabel = allActions.find((item) => item.value === selectedAction)?.label || "";

    const directionCandidates = useMemo(() => preview?.actionType === "storyDirections" && Array.isArray(preview.draftData.candidates)
        ? preview.draftData.candidates as Array<Record<string, unknown>> : [], [preview]);

    const selectedDirectionIndex = useMemo(() => {
        if (!draftJson || preview?.actionType !== "storyDirections") return 0;
        try {
            const parsed = JSON.parse(draftJson) as { selectedIndex?: unknown };
            return typeof parsed.selectedIndex === "number" ? parsed.selectedIndex : 0;
        } catch {
            return 0;
        }
    }, [draftJson, preview?.actionType]);

    const visibleDrafts = useMemo(
        () => drafts.filter((draft) => draft.status === "pending" && (!cardTarget || (draft.targetType === cardTarget.targetType && draft.targetId === cardTarget.targetId))),
        [cardTarget, drafts],
    );

    const projectId = project?.id;

    useEffect(() => { if (!model && config.textModel) setModel(config.textModel); }, [config.textModel, model]);

    useEffect(() => {
        if (!model) { setPricing(null); return; }
        let cancelled = false;
        getAiActionPricing(model)
            .then((items) => { if (!cancelled) setPricing({ model, items }); })
            .catch(() => { if (!cancelled) setPricing({ model, items: [] }); });
        return () => { cancelled = true; };
    }, [model]);

    // 加载项目绑定的对话式编剧助手历史会话。
    useEffect(() => {
        if (!projectId) return;
        let cancelled = false;
        setLoadingHistory(true);
        getScriptAgentHistory(projectId)
            .then((res) => { if (!cancelled) setMessages(res.messages || []); })
            .catch(() => { if (!cancelled) setMessages([]); })
            .finally(() => { if (!cancelled) setLoadingHistory(false); });
        return () => { cancelled = true; };
    }, [projectId]);

    // 切换板块或卡片上下文时，若已选动作不在当前上下文可用集合里则自动切回自由对话模式。
    useEffect(() => {
        if (cardTargetType === "scene") {
            setSelectedAction("polish");
            return;
        }
        if (cardTargetType === "episode") {
            setSelectedAction("episodeDraft");
            return;
        }
        setSelectedAction((prev) => (prev && options.some((item) => item.value === prev) ? prev : ""));
    }, [cardTargetId, cardTargetType, options]);

    useEffect(() => { if (preview) setDraftJson(JSON.stringify(preview.draftData, null, 2)); }, [preview]);

    useEffect(() => {
        if (!project) return;
        const activeEpisodeId = cardTargetType === "episode" ? cardTargetId
            : aiTargetType === "episode" ? aiTargetId : selectedEpisodeId;
        const matchedEpisode = project.episodes.find((item) => item.id === activeEpisodeId);
        if (matchedEpisode && matchedEpisode.targetDurationSeconds > 0) {
            setEpisodeDurationSeconds(Math.min(600, Math.max(30, matchedEpisode.targetDurationSeconds)));
            return;
        }
        const count = Math.max(1, project.overview.targetEpisodeCount);
        const totalSeconds = project.overview.targetDurationSeconds;
        const derived = totalSeconds > 0
            ? (count > 1 && totalSeconds >= count * 30 ? Math.round(totalSeconds / count) : totalSeconds)
            : 180;
        setEpisodeDurationSeconds(Math.min(600, Math.max(30, derived)));
    }, [aiTargetId, aiTargetType, cardTargetId, cardTargetType, project, selectedEpisodeId]);

    useEffect(() => {
        requestGeneration.current += 1;
        discardGeneration.current += 1;
        setPreview(null);
        setDraftJson("");
        setInputText("");
        setRunningDraft(false);
        setSendingChat(false);
        setDiscardingId("");
    }, [projectId]);

    useEffect(() => {
        const container = scrollRef.current;
        if (container) container.scrollTop = container.scrollHeight;
    }, [messages, sendingChat, runningDraft]);

    if (!project) return null;

    const currentEpisode = project.episodes.find((ep) => ep.id === selectedEpisodeId);
    const contextLabel = cardTarget?.label
        || aiTarget?.label
        || (section === "episodes" && currentEpisode ? `第${currentEpisode.episodeNumber}集${currentEpisode.title ? ` · ${currentEpisode.title}` : ""}` : "")
        || SECTION_LABELS[section]
        || translate("script.currentSection");

    const isOverviewEmpty = !project.overview.logline?.trim() && !project.overview.synopsis?.trim();
    const isOutlineEmpty = !project.outlineSections?.length || project.outlineSections.some((item) => !item.content?.trim());

    /** 计算指定动作的前置依赖阻塞提示，复用于主动模式与 Agent 推荐卡片。 */
    const getBlockedReason = (actionType: string) => {
        if (actionType === "storyDirections" && isOverviewEmpty) {
            return translate("script.addALoglineOrSynopsisToTheStoryOverviewBefore");
        }
        if (actionType === "outline" && isOverviewEmpty) {
            return translate("script.addALoglineOrSynopsisToTheStoryOverviewBefore_966c69");
        }
        if (["characters", "world", "episodePlan", "episodeDraft"].includes(actionType) && isOutlineEmpty) {
            return translate("script.completeTheStoryOutlineBeforeUsingThisAiAction");
        }
        return "";
    };

    const selectedActionBlockedReason = selectedAction ? getBlockedReason(selectedAction) : "";

    const resolveTargetForAction = (
        actionType: string,
        overrideTarget?: { targetType?: string; targetId?: string; targetLabel?: string },
    ) => {
        if (actionType === "storyDirections") return { targetType: "overview", targetId: undefined, label: "故事概览" };
        if (["outline", "characters", "world"].includes(actionType)) {
            return { targetType: actionType, targetId: undefined, label: SECTION_LABELS[actionType] || actionType };
        }
        if (actionType === "episodePlan") return { targetType: "episodes", targetId: undefined, label: "分集规划" };
        if (overrideTarget?.targetType && overrideTarget.targetId) {
            return { targetType: overrideTarget.targetType, targetId: overrideTarget.targetId, label: overrideTarget.targetLabel || contextLabel };
        }
        if (actionType === "episodeDraft") {
            const epId = cardTarget?.targetId || (aiTarget?.targetType === "episode" ? aiTarget.targetId : selectedEpisodeId);
            return { targetType: "episode", targetId: epId || undefined, label: contextLabel };
        }
        if (cardTarget) return cardTarget;
        if (aiTarget) return aiTarget;
        return { targetType: "episode", targetId: selectedEpisodeId || undefined, label: contextLabel };
    };

    /** 按当前板块提供 2-3 条开场对话引导。 */
    const starterPrompts = (() => {
        if (cardTarget) {
            return [
                `分析「${cardTarget.label}」现在的戏剧张力和节奏，给我具体修改建议`,
                `帮我想几个让「${cardTarget.label}」更有钩子和反转的改法`,
            ];
        }
        if (section === "overview") {
            return [
                "帮我打磨故事的一句话创意和核心冲突，让爽点和卖点更明确",
                "诊断当前故事概览还有哪些设定漏洞或可以强化的地方",
            ];
        }
        if (section === "outline") {
            return [
                "检查当前故事大纲的起承转合节奏，看看哪里容易平淡",
                "帮我构思一个更有张力的中段反转和高潮推进方案",
            ];
        }
        if (section === "characters") {
            return [
                "分析现有主角和对手的人物动机是否足够强烈、人物关系是否够有拉扯感",
                "帮我补充一个能制造持续冲突的关键配角设定思路",
            ];
        }
        if (section === "world") {
            return [
                "梳理当前世界观的核心规则与视觉化场景特色，方便后续转漫剧制作",
                "帮我检查世界观设定和主线冲突结合得是否紧密",
            ];
        }
        return [
            `诊断${currentEpisode ? `第${currentEpisode.episodeNumber}集` : "当前分集"}的节奏、对白和结尾钩子，给出优化建议`,
            "帮我头脑风暴下一场戏的冲突升级与镜头画面感",
        ];
    })();

    /** 发送自由对话给剧本编剧助手 Agent。 */
    const handleSendChat = async (overrideText?: string) => {
        if (!project || sendingChat || runningDraft) return;
        const text = (typeof overrideText === "string" ? overrideText : inputText).trim();
        if (!text) return;
        if (!ensureModelConfiguration("text", model || config.textModel)) return;
        if (typeof overrideText !== "string") setInputText("");

        const optimisticUser: ScriptAgentHistoryMessage = {
            id: `local_u_${Date.now()}`,
            role: "user",
            text,
            createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, optimisticUser]);
        setSendingChat(true);
        const target = cardTarget || aiTarget;
        try {
            const response = await chatScriptAgent({
                projectId: project.id,
                section,
                selectedEpisodeId: selectedEpisodeId || undefined,
                targetType: target?.targetType,
                targetId: target?.targetId,
                targetLabel: target?.label || contextLabel,
                message: text,
                model: model || config.textModel || undefined,
            });
            const meta = JSON.stringify({ kind: "scriptAgent", recommendations: response.recommendations });
            setMessages((prev) => [
                ...prev,
                {
                    id: response.messageId,
                    role: "assistant",
                    text: response.reply,
                    meta,
                    createdAt: new Date().toISOString(),
                },
            ]);
        } catch (error) {
            message.error(error instanceof Error ? error.message : `${assistantName}对话请求失败`);
        } finally {
            setSendingChat(false);
        }
    };

    /** 执行正式扣费 AI 动作生成审核草稿（完整保留前置校验、未保存拦截、定价确认、草稿落库与对话流内联卡片）。 */
    const executeAction = (params: {
        actionType: string;
        actionInstruction: string;
        durationSeconds?: number;
        overrideTarget?: { targetType?: string; targetId?: string; targetLabel?: string };
        clearComposerAfterStart?: boolean;
    }) => {
        const { actionType, actionInstruction, durationSeconds, overrideTarget, clearComposerAfterStart } = params;
        if (!ensureModelConfiguration("text", model)) return;
        const blockedReason = getBlockedReason(actionType);
        if (blockedReason) {
            message.warning(blockedReason);
            return;
        }
        if (saveStatus !== "saved" && saveStatus !== "idle") {
            message.warning(translate("script.saveScriptChangesBeforeUsingAi"));
            return;
        }
        const cost = getActionCreditCost(actionType);
        if (cost === undefined) {
            message.warning(translate("script.thisActionHasNoPriceAskTheAdministratorToSetItUnderCreationPricing"));
            return;
        }
        const target = resolveTargetForAction(actionType, overrideTarget);
        if ((actionType === "episodeDraft" || !["storyDirections", "outline", "characters", "world", "episodePlan"].includes(actionType)) && !target.targetId) {
            message.warning(translate("script.selectAnEpisodeSceneOrTextBlockAsTheAi"));
            return;
        }
        const actionLabel = allActions.find((item) => item.value === actionType)?.label || actionType;
        const effectiveDuration = ["episodePlan", "episodeDraft"].includes(actionType)
            ? (durationSeconds ?? episodeDurationSeconds)
            : undefined;

        modal.confirm({
            title: `${translate("script.generateAnAiDraft")} · ${actionLabel}`,
            content: <div className="space-y-2 text-sm">
                <p>目标：{target.label || contextLabel}</p>
                <p>{translate("script.modelCount_d0ad77", { value0: modelOptionLabel(config, model) })}</p>
                <p>{translate("script.estimatedCostCountCredits_ed4072", { value0: cost })}</p>
                <p>{translate("script.aiResultsAreSavedAsReviewDraftsAndWillNot")}</p>
            </div>,
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
                if (clearComposerAfterStart) {
                    setInputText("");
                }
                const cleanInstruction = actionInstruction.trim();
                setMessages((prev) => [
                    ...prev,
                    {
                        id: `local_act_u_${Date.now()}`,
                        role: "user",
                        text: cleanInstruction ? `【${actionLabel}】${cleanInstruction}` : `【${actionLabel}】按当前上下文生成审核草稿`,
                        createdAt: new Date().toISOString(),
                    },
                ]);
                const generation = ++requestGeneration.current;
                setRunningDraft(true);
                try {
                    const currentProjectId = latestProject.id;
                    const draft = await generateScriptDraft({
                        projectId: currentProjectId,
                        expectedRevision: latestProject.revision,
                        actionType,
                        targetType: target.targetType,
                        targetId: target.targetId,
                        instruction: cleanInstruction,
                        model,
                        episodeDurationSeconds: effectiveDuration,
                    });
                    if (generation !== requestGeneration.current || useScriptStore.getState().project?.id !== currentProjectId) return;
                    replaceDrafts([draft, ...useScriptStore.getState().drafts]);
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: `local_act_a_${draft.id}`,
                            role: "assistant",
                            text: `已为「${target.label || contextLabel}」生成「${actionLabel}」审核草稿，请预览差异确认后再应用到正式剧本。`,
                            meta: JSON.stringify({
                                draftId: draft.id,
                                actionType,
                                actionLabel,
                                targetLabel: target.label || contextLabel,
                            }),
                            createdAt: new Date().toISOString(),
                        },
                    ]);
                    setPreview(draft);
                    message.success(translate("script.aiDraftGeneratedReviewItBeforeApplying"));
                } catch (error) {
                    if (generation === requestGeneration.current && useScriptStore.getState().project?.id === latestProject.id) {
                        const errMsg = error instanceof Error ? error.message : translate("script.aiActionFailed");
                        message.error(errMsg);
                        setMessages((prev) => [
                            ...prev,
                            {
                                id: `local_act_err_${Date.now()}`,
                                role: "assistant",
                                text: `「${actionLabel}」草稿生成失败：${errMsg}`,
                                createdAt: new Date().toISOString(),
                            },
                        ]);
                    }
                } finally {
                    if (generation === requestGeneration.current) setRunningDraft(false);
                }
            },
        });
    };

    const handleComposerSubmit = () => {
        if (selectedAction) {
            executeAction({
                actionType: selectedAction,
                actionInstruction: inputText,
                durationSeconds: episodeDurationSeconds,
                clearComposerAfterStart: true,
            });
            return;
        }
        void handleSendChat();
    };

    const handleResetSession = async () => {
        if (!project || sendingChat || runningDraft) return;
        try {
            await resetScriptAgentSession(project.id);
            setMessages([]);
            message.success(`已开启新的${assistantName}对话`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "重置会话失败");
        }
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
        setRunningDraft(true);
        try {
            const currentProjectId = latestProject.id;
            await applyScriptAiDraft({ projectId: currentProjectId, expectedRevision: latestProject.revision, draftId: preview.id, draftData: parsed });
            if (generation !== requestGeneration.current || useScriptStore.getState().project?.id !== currentProjectId) return;
            setPreview(null);
            await reloadProject();
            message.success(translate("script.aiDraftAppliedAPreviousVersionWasSavedAutomatically"));
        } catch (error) {
            if (generation === requestGeneration.current && useScriptStore.getState().project?.id === latestProject.id) {
                message.error(error instanceof Error ? error.message : translate("script.couldNotApplyTheAiDraft"));
            }
        } finally {
            if (generation === requestGeneration.current) setRunningDraft(false);
        }
    };

    const discard = async (draft: ScriptAiDraft) => {
        const latestProject = useScriptStore.getState().project;
        if (!latestProject || latestProject.id !== project.id) {
            message.warning(translate("script.theScriptProjectHasChangedSelectTheAiDraftAgain"));
            return;
        }
        const currentProjectId = latestProject.id;
        const generation = ++discardGeneration.current;
        setDiscardingId(draft.id);
        try {
            await discardScriptAiDraft(currentProjectId, latestProject.revision, draft.id);
            if (generation !== discardGeneration.current || useScriptStore.getState().project?.id !== currentProjectId) return;
            replaceDrafts(useScriptStore.getState().drafts.filter((item) => item.id !== draft.id));
            if (preview?.id === draft.id) setPreview(null);
            message.success(translate("script.draftDiscarded"));
        } catch (error) {
            if (generation === discardGeneration.current && useScriptStore.getState().project?.id === currentProjectId) {
                message.error(error instanceof Error ? error.message : translate("script.couldNotDiscardTheDraftTryAgain"));
            }
        } finally {
            if (generation === discardGeneration.current) setDiscardingId("");
        }
    };

    const showDurationBudget = selectedAction === "episodePlan" || selectedAction === "episodeDraft";

    const renderActionMenuContent = () => (
        <div className="w-72 space-y-3">
            {generationOptions.length > 0 ? (
                <div>
                    <div className="mb-1.5 text-[11px] font-semibold text-[var(--studio-muted)]">内容生成</div>
                    <div className="space-y-1">
                        {generationOptions.map((item) => {
                            const cost = getActionCreditCost(item.value);
                            const active = selectedAction === item.value;
                            return (
                                <button
                                    key={item.value}
                                    type="button"
                                    onClick={() => {
                                        setSelectedAction(active ? "" : item.value);
                                        setActionsPopoverOpen(false);
                                    }}
                                    className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs! transition-colors ${
                                        active
                                            ? "border-[var(--studio-primary-line)] bg-[var(--studio-primary-soft)] text-[var(--studio-primary)]!"
                                            : "border-transparent text-[var(--studio-ink)]! hover:bg-[var(--studio-surface-hover)]"
                                    }`}
                                >
                                    <span className="truncate font-medium">{item.label}</span>
                                    <span className="shrink-0 text-[11px] text-[var(--studio-muted)]">
                                        {cost === undefined ? "未定价" : `${cost} 积分`}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            ) : null}

            {optimizationOptions.length > 0 ? (
                <div>
                    <div className="mb-1.5 text-[11px] font-semibold text-[var(--studio-muted)]">正文优化（14项）</div>
                    <div className="grid grid-cols-2 gap-1">
                        {optimizationOptions.map((item) => {
                            const cost = getActionCreditCost(item.value);
                            const active = selectedAction === item.value;
                            return (
                                <button
                                    key={item.value}
                                    type="button"
                                    onClick={() => {
                                        setSelectedAction(active ? "" : item.value);
                                        setActionsPopoverOpen(false);
                                    }}
                                    className={`flex cursor-pointer items-center justify-between gap-1 rounded-md border px-2 py-1.5 text-left text-xs! transition-colors ${
                                        active
                                            ? "border-[var(--studio-primary-line)] bg-[var(--studio-primary-soft)] text-[var(--studio-primary)]!"
                                            : "border-[var(--studio-line)] bg-[var(--studio-surface)] text-[var(--studio-ink)]! hover:border-[var(--studio-line-strong)] hover:bg-[var(--studio-surface-hover)]"
                                    }`}
                                >
                                    <span className="truncate">{item.label}</span>
                                    <span className="shrink-0 text-[10px] text-[var(--studio-faint)]">
                                        {cost === undefined ? "-" : cost}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            ) : null}
        </div>
    );

    return (
        <aside className={`${cardTarget ? "h-[70vh]" : "h-full"} flex min-h-0 flex-col overflow-hidden bg-[var(--studio-panel-solid)]`}>
            {/* 顶部精简栏：标题、待审草稿抽屉、模型切换、新建对话 */}
            <div className="shrink-0 border-b border-[var(--studio-line)] px-3.5 py-2.5">
                <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                        <Sparkles className="size-4 shrink-0 text-[var(--studio-primary)]" />
                        <h2 className="truncate text-sm font-semibold text-[var(--studio-ink)]">{translate("script.aiScriptAssistant")}</h2>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                        <button
                            type="button"
                            onClick={() => setShowDraftsTray((prev) => !prev)}
                            className={`inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-0.5 text-xs! transition-colors ${
                                visibleDrafts.length > 0
                                    ? "border-[var(--studio-primary-line)] bg-[var(--studio-primary-soft)] text-[var(--studio-primary)]!"
                                    : "border-[var(--studio-line)] text-[var(--studio-muted)]! hover:bg-[var(--studio-surface-hover)]"
                            }`}
                            title="查看待确认草稿"
                        >
                            <FileCheck2 className="size-3.5" />
                            <span>待审 {visibleDrafts.length}</span>
                            {showDraftsTray ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                        </button>
                        <button
                            type="button"
                            onClick={() => setShowModelPicker((prev) => !prev)}
                            className="cursor-pointer rounded px-1.5 py-0.5 text-xs! text-[var(--studio-muted)]! hover:bg-[var(--studio-surface-hover)] hover:text-[var(--studio-ink)]!"
                            title={model ? `当前模型：${modelOptionLabel(config, model)}` : "切换对话与生成模型"}
                        >
                            模型
                        </button>
                        <button
                            type="button"
                            onClick={() => void handleResetSession()}
                            disabled={sendingChat || runningDraft}
                            className="inline-flex size-6 cursor-pointer items-center justify-center rounded text-[var(--studio-muted)]! hover:bg-[var(--studio-surface-hover)] hover:text-[var(--studio-ink)]! disabled:opacity-40"
                            title="新建对话"
                            aria-label="新建对话"
                        >
                            <Plus className="size-3.5" />
                        </button>
                    </div>
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-[var(--studio-muted)]">
                    <span className="truncate">
                        上下文：<strong className="font-medium text-[var(--studio-ink)]">{contextLabel}</strong>
                    </span>
                    <span className="shrink-0 text-[var(--studio-faint)]">草稿确认后落库</span>
                </div>
            </div>

            {/* 可展开的模型选择抽屉 */}
            {showModelPicker ? (
                <div className="shrink-0 border-b border-[var(--studio-line)] bg-[var(--studio-surface-soft)] px-3.5 py-2.5">
                    <label className="mb-1 block text-xs font-medium text-[var(--studio-muted)]">{translate("script.model_98fd0c")}</label>
                    <ModelPicker config={config} value={model} onChange={setModel} capability="text" fullWidth />
                </div>
            ) : null}

            {/* 可展开的待确认草稿托盘（同时承接小说改编产出的待确认草稿） */}
            {showDraftsTray ? (
                <div className="max-h-56 shrink-0 space-y-2 overflow-y-auto border-b border-[var(--studio-line)] bg-[var(--studio-surface-soft)] px-3.5 py-2.5">
                    <div className="flex items-center justify-between text-xs font-medium text-[var(--studio-ink)]">
                        <span>{translate("script.pendingDrafts")}（{visibleDrafts.length}）</span>
                        <button
                            type="button"
                            onClick={() => setShowDraftsTray(false)}
                            className="cursor-pointer text-xs! text-[var(--studio-muted)]! hover:text-[var(--studio-ink)]!"
                        >
                            收起
                        </button>
                    </div>
                    {visibleDrafts.length === 0 ? (
                        <p className="text-xs text-[var(--studio-faint)]">{translate("script.noPendingDrafts")}</p>
                    ) : (
                        visibleDrafts.map((draft) => (
                            <div key={draft.id} className="rounded-lg border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] p-2.5">
                                <div className="flex items-center justify-between gap-2">
                                    <button
                                        type="button"
                                        className="truncate text-left text-xs! font-medium text-[var(--studio-ink)]! hover:underline"
                                        onClick={() => setPreview(draft)}
                                    >
                                        {draftTitle(draft, project.episodes, translate)}
                                    </button>
                                    {isScriptAiDraftStale(draft, project.revision)
                                        ? <Tag color="orange" className="mr-0">{translate("script.outdated")}</Tag>
                                        : <Tag color="blue" className="mr-0">{translate("script.pendingApproval")}</Tag>}
                                </div>
                                <div className="mt-2 flex items-center gap-1.5">
                                    <Button size="small" type="primary" ghost onClick={() => setPreview(draft)}>
                                        {translate("script.previewChanges")}
                                    </Button>
                                    <Button
                                        size="small"
                                        danger
                                        icon={<Trash2 className="size-3.5" />}
                                        loading={discardingId === draft.id}
                                        disabled={Boolean(discardingId) && discardingId !== draft.id}
                                        onClick={() => void discard(draft)}
                                    >
                                        {translate("script.discard")}
                                    </Button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            ) : null}

            {/* 中间可滚动对话消息流 */}
            <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3.5">
                {loadingHistory ? (
                    <div className="flex items-center justify-center py-10">
                        <Spin size="small" />
                    </div>
                ) : messages.length === 0 ? (
                    <div className="space-y-3">
                        <div className="rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-3.5 text-xs leading-5 text-[var(--studio-muted)]">
                            <div className="mb-1 flex items-center gap-1.5 font-semibold text-[var(--studio-ink)]">
                                <Sparkles className="size-3.5 text-[var(--studio-primary)]" />
                                <span>{assistantName}已就绪</span>
                            </div>
                            <p>
                                你可以直接与我讨论剧情走向、人物动机、场次冲突与对白节奏；也可以点击下方快捷动作或「全部动作」直接生成审核草稿，所有正式内容都由你预览确认后才会写入。
                            </p>
                        </div>
                        <div className="space-y-1.5">
                            <div className="text-[11px] font-medium text-[var(--studio-faint)]">试试这样聊</div>
                            {starterPrompts.map((prompt) => (
                                <button
                                    key={prompt}
                                    type="button"
                                    disabled={sendingChat || runningDraft}
                                    onClick={() => void handleSendChat(prompt)}
                                    className="block w-full cursor-pointer rounded-lg border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] px-3 py-2 text-left text-xs! leading-5 text-[var(--studio-text)]! transition-colors hover:border-[var(--studio-primary-line)] hover:bg-[var(--studio-surface-soft)] disabled:opacity-50"
                                >
                                    {prompt}
                                </button>
                            ))}
                        </div>
                    </div>
                ) : (
                    messages.map((item) => {
                        if (item.role === "user") {
                            return (
                                <div key={item.id} className="flex justify-end">
                                    <div className="max-w-[88%] whitespace-pre-wrap break-words rounded-lg border border-[var(--studio-line-strong)] bg-[var(--studio-surface-raised)] px-3 py-2 text-xs leading-5 text-[var(--studio-ink)]">
                                        {item.text}
                                    </div>
                                </div>
                            );
                        }
                        const meta = parseMessageMeta(item.meta);
                        const recommendations = meta.recommendations || [];
                        const linkedDraft = meta.draftId ? drafts.find((d) => d.id === meta.draftId && d.status === "pending") : undefined;

                        return (
                            <div key={item.id} className="space-y-1.5">
                                <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--studio-ink)]">
                                    <span
                                        className="flex size-5 items-center justify-center rounded text-[11px] font-semibold"
                                        style={{ background: "var(--studio-action)", color: "var(--studio-action-foreground)" }}
                                    >
                                        AI
                                    </span>
                                    <span>{assistantName}</span>
                                </div>
                                <div className="space-y-2.5 rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-3 text-xs leading-5 text-[var(--studio-text)]">
                                    <div className="whitespace-pre-wrap break-words">{item.text}</div>

                                    {/* 推荐的可执行草稿动作卡片 */}
                                    {recommendations.length > 0 ? (
                                        <div className="space-y-2 border-t border-[var(--studio-line)] pt-2.5">
                                            {recommendations.map((rec, index) => {
                                                const cost = getActionCreditCost(rec.actionType);
                                                const recBlocked = getBlockedReason(rec.actionType);
                                                return (
                                                    <div
                                                        key={`${rec.actionType}-${index}`}
                                                        className="space-y-2 rounded-md border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] p-2.5"
                                                    >
                                                        <div className="flex items-start justify-between gap-2">
                                                            <div className="min-w-0">
                                                                <div className="flex flex-wrap items-center gap-1.5">
                                                                    <Wand2 className="size-3.5 shrink-0 text-[var(--studio-primary)]" />
                                                                    <span className="font-medium text-[var(--studio-ink)]">{rec.label}</span>
                                                                    {rec.targetLabel ? (
                                                                        <span className="rounded bg-[var(--studio-surface-soft)] px-1.5 py-0.5 text-[10px] text-[var(--studio-muted)]">
                                                                            {rec.targetLabel}
                                                                        </span>
                                                                    ) : null}
                                                                </div>
                                                                {rec.description ? (
                                                                    <p className="mt-1 text-[11px] leading-4 text-[var(--studio-muted)]">{rec.description}</p>
                                                                ) : null}
                                                            </div>
                                                            <span className="shrink-0 text-[11px] font-medium text-[var(--studio-muted)]">
                                                                {cost === undefined ? "未定价" : `${cost} 积分`}
                                                            </span>
                                                        </div>
                                                        {recBlocked ? (
                                                            <p className="text-[11px] text-amber-600">{recBlocked}</p>
                                                        ) : null}
                                                        <div className="flex items-center justify-end gap-1.5">
                                                            <Button
                                                                size="small"
                                                                onClick={() => {
                                                                    setSelectedAction(rec.actionType);
                                                                    if (rec.instruction) setInputText(rec.instruction);
                                                                    if (rec.episodeDurationSeconds) setEpisodeDurationSeconds(rec.episodeDurationSeconds);
                                                                }}
                                                            >
                                                                填到输入框
                                                            </Button>
                                                            <Button
                                                                size="small"
                                                                type="primary"
                                                                disabled={Boolean(recBlocked) || !pricingCurrent || runningDraft}
                                                                onClick={() => executeAction({
                                                                    actionType: rec.actionType,
                                                                    actionInstruction: rec.instruction || "",
                                                                    durationSeconds: rec.episodeDurationSeconds ?? undefined,
                                                                    overrideTarget: rec.targetId ? {
                                                                        targetType: rec.targetType,
                                                                        targetId: rec.targetId,
                                                                        targetLabel: rec.targetLabel,
                                                                    } : undefined,
                                                                })}
                                                            >
                                                                生成草稿
                                                            </Button>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ) : null}

                                    {/* 对话流内联的已生成草稿审核卡片 */}
                                    {meta.draftId ? (
                                        <div className="border-t border-[var(--studio-line)] pt-2">
                                            {linkedDraft ? (
                                                <div className="rounded-md border border-[var(--studio-primary-line)] bg-[var(--studio-panel-solid)] p-2.5">
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span className="truncate font-medium text-[var(--studio-ink)]">
                                                            {draftTitle(linkedDraft, project.episodes, translate)}
                                                        </span>
                                                        {isScriptAiDraftStale(linkedDraft, project.revision)
                                                            ? <Tag color="orange" className="mr-0">{translate("script.outdated")}</Tag>
                                                            : <Tag color="blue" className="mr-0">{translate("script.pendingApproval")}</Tag>}
                                                    </div>
                                                    <div className="mt-2 flex items-center gap-1.5">
                                                        <Button size="small" type="primary" onClick={() => setPreview(linkedDraft)}>
                                                            {translate("script.previewChanges")}
                                                        </Button>
                                                        <Button
                                                            size="small"
                                                            danger
                                                            icon={<Trash2 className="size-3.5" />}
                                                            loading={discardingId === linkedDraft.id}
                                                            disabled={Boolean(discardingId) && discardingId !== linkedDraft.id}
                                                            onClick={() => void discard(linkedDraft)}
                                                        >
                                                            {translate("script.discard")}
                                                        </Button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <span className="text-[11px] text-[var(--studio-faint)]">该草稿已应用或已丢弃</span>
                                            )}
                                        </div>
                                    ) : null}
                                </div>
                            </div>
                        );
                    })
                )}

                {sendingChat || runningDraft ? (
                    <div className="flex items-center gap-2 rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] px-3 py-2 text-xs text-[var(--studio-muted)]">
                        <Spin size="small" />
                        <span>{runningDraft ? translate("script.aiIsProcessingPleaseWait") : `${assistantName}正在思考中…`}</span>
                    </div>
                ) : null}
            </div>

            {/* 底部融合输入区：高频快捷动作芯片 + 全部动作 Popover + 动作模式条 + 对话输入框 */}
            <div className="shrink-0 space-y-2 border-t border-[var(--studio-line)] bg-[var(--studio-panel-solid)] p-3">
                {/* 高频快捷动作与「全部动作」入口 */}
                {options.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                        {quickActionOptions.map((item) => {
                            const active = selectedAction === item.value;
                            return (
                                <button
                                    key={item.value}
                                    type="button"
                                    onClick={() => setSelectedAction(active ? "" : item.value)}
                                    className={`cursor-pointer rounded-full border px-2.5 py-0.5 text-[11px]! transition-colors ${
                                        active
                                            ? "border-[var(--studio-primary-line)] bg-[var(--studio-primary-soft)] font-medium text-[var(--studio-primary)]!"
                                            : "border-[var(--studio-line)] bg-[var(--studio-surface-soft)] text-[var(--studio-muted)]! hover:border-[var(--studio-line-strong)] hover:text-[var(--studio-ink)]!"
                                    }`}
                                >
                                    {item.label}
                                </button>
                            );
                        })}
                        {options.length > quickActionOptions.length ? (
                            <Popover
                                trigger="click"
                                placement="topRight"
                                open={actionsPopoverOpen}
                                onOpenChange={setActionsPopoverOpen}
                                content={renderActionMenuContent()}
                            >
                                <button
                                    type="button"
                                    className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] px-2.5 py-0.5 text-[11px]! text-[var(--studio-ink)]! hover:border-[var(--studio-primary-line)]"
                                >
                                    <SlidersHorizontal className="size-3" />
                                    <span>全部动作 ({options.length})</span>
                                </button>
                            </Popover>
                        ) : null}
                    </div>
                ) : null}

                {/* 选中正式动作时的模式芯片、时长预算与前置提醒 */}
                {selectedAction ? (
                    <div className="space-y-1.5 rounded-lg border border-[var(--studio-primary-line)] bg-[var(--studio-primary-soft)]/40 p-2">
                        <div className="flex items-center justify-between gap-2 text-xs">
                            <div className="flex min-w-0 items-center gap-1.5">
                                <Wand2 className="size-3.5 shrink-0 text-[var(--studio-primary)]" />
                                <span className="truncate font-medium text-[var(--studio-ink)]">{selectedActionLabel}</span>
                                <span className="shrink-0 text-[11px] text-[var(--studio-muted)]">
                                    · {selectedActionCreditCost === undefined ? translate("script.notConfigured") : translate("script.countCredits", { value0: selectedActionCreditCost })}
                                </span>
                            </div>
                            <button
                                type="button"
                                onClick={() => setSelectedAction("")}
                                className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-[var(--studio-muted)]! hover:bg-[var(--studio-surface-hover)] hover:text-[var(--studio-ink)]!"
                                title="退出动作模式，切回自由对话"
                                aria-label="退出动作模式"
                            >
                                <X className="size-3.5" />
                            </button>
                        </div>

                        {showDurationBudget ? (
                            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                                <span className="text-[11px] text-[var(--studio-muted)]">单集时长</span>
                                <InputNumber
                                    size="small"
                                    className="w-24!"
                                    min={30}
                                    max={600}
                                    step={15}
                                    suffix={translate("script.secondsUnit")}
                                    value={episodeDurationSeconds}
                                    onChange={(value) => value && setEpisodeDurationSeconds(value)}
                                />
                                {([60, 120, 180] as const).map((preset) => (
                                    <Button
                                        key={preset}
                                        size="small"
                                        type={episodeDurationSeconds === preset ? "primary" : "default"}
                                        onClick={() => setEpisodeDurationSeconds(preset)}
                                    >
                                        {preset === 60 ? translate("script.episodeDurationPreset1Min") : preset === 120 ? translate("script.episodeDurationPreset2Min") : translate("script.episodeDurationPreset3Min")}
                                    </Button>
                                ))}
                            </div>
                        ) : null}

                        {selectedActionBlockedReason ? (
                            <Alert type="warning" showIcon title={selectedActionBlockedReason} className="text-xs" />
                        ) : null}
                    </div>
                ) : null}

                {/* 统一对话/指令输入框 */}
                <div className="rounded-lg border border-[var(--studio-line-strong)] bg-[var(--studio-surface-soft)] p-2 focus-within:border-[var(--studio-primary-line)]">
                    <textarea
                        rows={2}
                        value={inputText}
                        disabled={sendingChat || runningDraft}
                        onChange={(event) => setInputText(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                                event.preventDefault();
                                handleComposerSubmit();
                            }
                        }}
                        placeholder={
                            selectedAction
                                ? `补充对「${selectedActionLabel}」的风格、篇幅或保留设定要求，留空也可直接生成…（Enter 执行）`
                                : `和${assistantName}聊聊剧情、人物、节奏或对白…（Enter 发送，Shift+Enter 换行）`
                        }
                        className="w-full resize-none bg-transparent text-xs leading-5 text-[var(--studio-ink)] outline-none placeholder:text-[var(--studio-faint)]"
                    />
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                        <span className="truncate text-[11px] text-[var(--studio-faint)]">
                            {selectedAction ? `动作草稿模式 · 目标：${contextLabel}` : "自由对话模式 · 支持推荐动作一键执行"}
                        </span>
                        {selectedAction ? (
                            <Button
                                size="small"
                                type="primary"
                                loading={runningDraft}
                                disabled={Boolean(selectedActionBlockedReason) || !pricingCurrent || sendingChat}
                                icon={<Sparkles className="size-3.5" />}
                                onClick={handleComposerSubmit}
                            >
                                生成草稿
                            </Button>
                        ) : (
                            <Button
                                size="small"
                                type="primary"
                                loading={sendingChat}
                                disabled={!inputText.trim() || runningDraft}
                                icon={<ArrowUp className="size-3.5" />}
                                onClick={handleComposerSubmit}
                            >
                                发送
                            </Button>
                        )}
                    </div>
                </div>
            </div>

            {/* 草稿差异预览与应用弹窗 */}
            <Modal
                width={920}
                title={translate("script.aiDraftChanges")}
                open={Boolean(preview)}
                mask={{ closable: !runningDraft }}
                onCancel={() => setPreview(null)}
                footer={
                    <div className="flex justify-end gap-2">
                        <Button onClick={() => setPreview(null)}>{translate("script.reviewLater")}</Button>
                        <Button
                            type="primary"
                            icon={<Check className="size-4" />}
                            disabled={Boolean(preview && isScriptAiDraftStale(preview, project.revision)) || !["saved", "idle"].includes(saveStatus)}
                            loading={runningDraft}
                            onClick={() => void applyDraft()}
                        >
                            {translate("script.apply")}
                        </Button>
                    </div>
                }
            >
                {preview ? (
                    <div>
                        {isScriptAiDraftStale(preview, project.revision) ? (
                            <Alert
                                type="warning"
                                showIcon
                                title={translate("script.projectContentHasChanged")}
                                description={translate("script.thisDraftIsBasedOnAnOlderRevisionAndCannot")}
                                className="mb-4"
                            />
                        ) : null}
                        {directionCandidates.length ? (
                            <div className="mb-4 grid gap-2 md:grid-cols-3">
                                {directionCandidates.map((candidate, index) => {
                                    const active = selectedDirectionIndex === index;
                                    return (
                                        <button
                                            key={index}
                                            type="button"
                                            className={`cursor-pointer rounded-lg border p-3 text-left transition-colors ${
                                                active
                                                    ? "border-[var(--studio-primary-line)] bg-[var(--studio-primary-soft)]/50"
                                                    : "border-[var(--studio-line)] hover:border-[var(--studio-primary-line)]"
                                            }`}
                                            onClick={() => {
                                                const next = { ...preview.draftData, selectedIndex: index };
                                                setDraftJson(JSON.stringify(next, null, 2));
                                            }}
                                        >
                                            <strong className="text-sm text-[var(--studio-ink)]">
                                                {String(candidate.name || translate("script.directionCount", { value0: index + 1 }))}
                                            </strong>
                                            <p className="mt-2 text-xs leading-5 text-[var(--studio-muted)]">
                                                {String(candidate.logline || "")}
                                            </p>
                                        </button>
                                    );
                                })}
                            </div>
                        ) : null}
                        <DraftDiffSummary sourceData={preview.sourceData} draftData={preview.draftData} />
                        <Collapse
                            size="small"
                            className="mt-4"
                            items={[{
                                key: "json",
                                label: translate("script.advancedEditingRawJson"),
                                children: (
                                    <div className="grid gap-4 md:grid-cols-2">
                                        <label className="block text-sm font-medium text-[var(--studio-text)]">
                                            {translate("script.before")}
                                            <Input.TextArea className="mt-2 font-mono text-xs" rows={22} readOnly value={JSON.stringify(preview.sourceData, null, 2)} />
                                        </label>
                                        <label className="block text-sm font-medium text-[var(--studio-text)]">
                                            {translate("script.aiDraftEditable")}
                                            <Input.TextArea className="mt-2 font-mono text-xs" rows={22} value={draftJson} onChange={(event) => setDraftJson(event.target.value)} />
                                        </label>
                                    </div>
                                ),
                            }]}
                        />
                    </div>
                ) : null}
            </Modal>
        </aside>
    );
}
