"use client";

import { translateMessage } from "@/features/locale/translate";
import { useTranslation } from "@/features/locale/use-translation";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { nanoid } from "nanoid";
import { App, Alert, Button, Collapse, Input, InputNumber, Modal, Popover, Spin, Tag, Tooltip } from "antd";
import {
    ArrowUp,
    BookOpenText,
    Check,
    ChevronDown,
    ChevronUp,
    FileCheck2,
    MessageSquarePlus,
    SlidersHorizontal,
    Sparkles,
    Trash2,
    Wand2,
    X,
} from "lucide-react";

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
import {
    NanaApprovalCard,
    NanaChatBubble,
    NanaComposerShell,
    NanaHeaderStatus,
    NanaTaskTimeline,
    NanaThinkingRow,
} from "@/shared/components/nana-agent-ui";
import { isScriptAiDraftStale } from "../lib/script-episode-editing";
import { SCRIPT_AI_ACTIONS } from "../lib/script-ai-actions";
import { useScriptStore } from "../stores/use-script-store";
import type {
    OutlineSection,
    ScriptAgentActionRecommendation,
    ScriptAgentHistoryMessage,
    ScriptAgentProposedWrite,
    ScriptAiActionPricing,
    ScriptAiDraft,
    ScriptCharacter,
    ScriptLocation,
    ScriptOverview,
    ScriptProjectDetail,
    ScriptWorkspaceSection,
    WorldItem,
    WorldSetting,
} from "../types";

/** 动作清单由 `script-ai-actions.ts` 统一维护，后台定价表用的是同一份。 */
const getActions = (translate = translateMessage) => SCRIPT_AI_ACTIONS.map((item) => ({
    value: item.value, label: translate(item.labelKey), sections: item.sections,
})) as Array<{ value: string; label: string; sections: string[] }>;

/** 内容生成类动作编码集合（其余均为正文优化类动作）。 */
const GENERATION_ACTION_SET = new Set(["storyDirections", "outline", "characters", "world", "episodePlan", "episodeDraft"]);

/** 各工作区板块的中文显示名，用于上下文胶囊。 */
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
    proposedWrites?: ScriptAgentProposedWrite[];
    draftId?: string;
    actionType?: string;
    actionLabel?: string;
    targetLabel?: string;
};

/** 故事概览字段中文名，用于写入提案预览与覆盖冲突提示。 */
const OVERVIEW_FIELD_LABELS: Record<string, string> = {
    title: "项目名称",
    genre: "题材",
    logline: "一句话创意",
    synopsis: "故事梗概",
    targetEpisodeCount: "目标集数",
    targetDurationSeconds: "目标总时长(秒)",
    narrativeStyle: "叙事风格",
    theme: "故事主题",
    mainPlot: "主线剧情",
    mainConflict: "主要冲突",
    endingDirection: "结局方向",
};

/** 检测写入提案的内容是否已经与当前剧本完全一致（防止刷新页面后再次误判为“覆盖已有内容”）。 */
function isProposedWriteAlreadyApplied(write: ScriptAgentProposedWrite, project: ScriptProjectDetail): boolean {
    const payload = write.payload || {};
    if (write.targetSection === "overview") {
        const patch = (payload.overview || {}) as Record<string, unknown>;
        const entries = Object.entries(patch).filter(([, v]) => v !== undefined && v !== null && v !== "");
        if (!entries.length) return false;
        return entries.every(([key, val]) => {
            const curVal = project.overview[key as keyof ScriptOverview];
            if (typeof val === "number") return curVal === val;
            return String(curVal ?? "").trim() === String(val).trim();
        });
    }
    if (write.targetSection === "outline") {
        const incoming = Array.isArray(payload.outlineSections) ? (payload.outlineSections as Array<Record<string, unknown>>) : [];
        if (!incoming.length || project.outlineSections.length !== incoming.length) return false;
        return incoming.every((sec, index) => {
            const cur = project.outlineSections[index];
            return Boolean(cur)
                && cur.title.trim() === String(sec.title || "").trim()
                && (cur.content || "").trim() === String(sec.content || "").trim();
        });
    }
    if (write.targetSection === "characters") {
        const incoming = Array.isArray(payload.characters) ? (payload.characters as Array<Record<string, unknown>>) : [];
        if (!incoming.length) return false;
        return incoming.every((raw) => {
            const name = String(raw.name || "").trim();
            const cur = project.characters.find((c) => c.name.trim() === name);
            if (!cur) return false;
            return (!raw.identity || cur.identity.trim() === String(raw.identity).trim())
                && (!raw.personality || cur.personality.trim() === String(raw.personality).trim())
                && (!raw.goal || cur.goal.trim() === String(raw.goal).trim());
        });
    }
    if (write.targetSection === "world") {
        const setting = (payload.worldSetting || {}) as Record<string, unknown>;
        for (const [key, val] of Object.entries(setting)) {
            if (typeof val === "string" && val.trim()) {
                const curVal = project.worldSetting?.[key as keyof WorldSetting];
                if (String(curVal ?? "").trim() !== val.trim()) return false;
            }
        }
        const incomingItems = Array.isArray(payload.worldItems) ? (payload.worldItems as Array<Record<string, unknown>>) : [];
        for (const raw of incomingItems) {
            const cur = project.worldItems.find((w) => w.name.trim() === String(raw.name || "").trim());
            if (!cur || (raw.description && cur.description.trim() !== String(raw.description).trim())) return false;
        }
        const incomingLocs = Array.isArray(payload.locations) ? (payload.locations as Array<Record<string, unknown>>) : [];
        for (const raw of incomingLocs) {
            const cur = project.locations.find((l) => l.name.trim() === String(raw.name || "").trim());
            if (!cur) return false;
        }
        return Object.keys(setting).length > 0 || incomingItems.length > 0 || incomingLocs.length > 0;
    }
    return false;
}

/** 将推荐动作映射到所属板块，用于过滤与本轮写入提案重复的推荐卡片。 */
function recommendationSection(actionType: string): string {
    return actionType === "storyDirections" ? "overview" : actionType;
}

/** 判断推荐的整块生成动作是否已在当前剧本中完成（已应用草稿或已有完整内容）。 */
function isRecommendationAlreadyCompleted(
    rec: ScriptAgentActionRecommendation,
    project: ScriptProjectDetail,
    drafts: ScriptAiDraft[],
): boolean {
    if (drafts.some((d) => d.status === "applied" && d.actionType === rec.actionType && (!rec.targetId || d.targetId === rec.targetId))) {
        return true;
    }
    switch (rec.actionType) {
        case "outline":
            return project.outlineSections.length > 0 && project.outlineSections.every((s) => Boolean(s.content?.trim()));
        case "characters":
            return project.characters.length > 0;
        case "world":
            return Boolean(
                project.worldSetting?.era?.trim()
                || project.worldSetting?.region?.trim()
                || project.worldSetting?.socialBackground?.trim()
                || project.worldSetting?.overallTone?.trim()
                || project.worldItems.length > 0
                || project.locations.length > 0,
            );
        case "episodePlan":
            return project.episodes.length > 0;
        case "episodeDraft": {
            const ep = rec.targetId ? project.episodes.find((item) => item.id === rec.targetId) : undefined;
            return Boolean(ep && ep.completionStatus !== "planning");
        }
        default:
            return false;
    }
}

function readAppliedWriteIds(projectId: string): string[] {
    if (typeof window === "undefined" || !projectId) return [];
    try {
        const raw = window.localStorage.getItem(`novanova:script-applied-writes:${projectId}`);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
    } catch {
        return [];
    }
}

function persistAppliedWriteIds(projectId: string, ids: string[]) {
    if (typeof window === "undefined" || !projectId) return;
    try {
        window.localStorage.setItem(`novanova:script-applied-writes:${projectId}`, JSON.stringify(ids.slice(-50)));
    } catch {
        // 忽略存储异常
    }
}

/** 实时检测待确认写入提案是否会覆盖当前剧本中已有内容。 */
function detectProposedWriteConflicts(write: ScriptAgentProposedWrite, project: ScriptProjectDetail): string[] {
    const conflicts: string[] = [];
    const payload = write.payload || {};
    if (write.targetSection === "overview") {
        const patch = (payload.overview || {}) as Record<string, unknown>;
        const cur = project.overview;
        for (const [key, val] of Object.entries(patch)) {
            if (val === undefined || val === null || val === "") continue;
            if (key === "targetEpisodeCount" && typeof val === "number") {
                if (cur.targetEpisodeCount > 1 && cur.targetEpisodeCount !== val) conflicts.push(OVERVIEW_FIELD_LABELS[key]);
                continue;
            }
            if (key === "targetDurationSeconds" && typeof val === "number") {
                if (cur.targetDurationSeconds > 0 && cur.targetDurationSeconds !== val) conflicts.push(OVERVIEW_FIELD_LABELS[key]);
                continue;
            }
            const curVal = cur[key as keyof ScriptOverview];
            if (typeof curVal === "string" && curVal.trim() && curVal.trim() !== String(val).trim()) {
                conflicts.push(OVERVIEW_FIELD_LABELS[key] || key);
            }
        }
    } else if (write.targetSection === "outline") {
        for (const sec of project.outlineSections || []) {
            if (sec.content?.trim()) conflicts.push(sec.title || "大纲结构段");
        }
    } else if (write.targetSection === "characters") {
        const incoming = Array.isArray(payload.characters) ? (payload.characters as Array<Record<string, unknown>>) : [];
        const existingNames = new Set((project.characters || []).map((c) => c.name.trim()).filter(Boolean));
        for (const ch of incoming) {
            const name = String(ch.name || "").trim();
            if (name && existingNames.has(name)) conflicts.push(`人物：${name}`);
        }
    } else if (write.targetSection === "world") {
        const setting = (payload.worldSetting || {}) as Record<string, unknown>;
        const settingLabels: Record<string, string> = { era: "时代背景", region: "地域空间", socialBackground: "社会背景", overallTone: "整体基调" };
        for (const [key, val] of Object.entries(setting)) {
            const curVal = project.worldSetting?.[key as keyof WorldSetting];
            if (typeof val === "string" && val.trim() && typeof curVal === "string" && curVal.trim() && curVal.trim() !== val.trim()) {
                conflicts.push(settingLabels[key] || key);
            }
        }
        const existingItems = new Set((project.worldItems || []).map((w) => w.name.trim()).filter(Boolean));
        for (const item of (Array.isArray(payload.worldItems) ? payload.worldItems : []) as Array<Record<string, unknown>>) {
            const name = String(item.name || "").trim();
            if (name && existingItems.has(name)) conflicts.push(`世界观条目：${name}`);
        }
        const existingLocs = new Set((project.locations || []).map((l) => l.name.trim()).filter(Boolean));
        for (const loc of (Array.isArray(payload.locations) ? payload.locations : []) as Array<Record<string, unknown>>) {
            const name = String(loc.name || "").trim();
            if (name && existingLocs.has(name)) conflicts.push(`场景地点：${name}`);
        }
    }
    return conflicts;
}

/** 将待确认写入提案整理为人类易读的字段预览行。 */
function formatProposedWritePreviewLines(write: ScriptAgentProposedWrite): string[] {
    const lines: string[] = [];
    const payload = write.payload || {};
    if (write.targetSection === "overview" && payload.overview && typeof payload.overview === "object") {
        for (const [key, val] of Object.entries(payload.overview as Record<string, unknown>)) {
            if (val === undefined || val === null || val === "") continue;
            const text = String(val).trim();
            lines.push(`${OVERVIEW_FIELD_LABELS[key] || key}：${text.length > 64 ? `${text.slice(0, 64)}…` : text}`);
        }
    } else if (write.targetSection === "outline" && Array.isArray(payload.outlineSections)) {
        for (const item of (payload.outlineSections as Array<Record<string, unknown>>).slice(0, 6)) {
            lines.push(`大纲段：${String(item.title || "未命名")}`);
        }
    } else if (write.targetSection === "characters" && Array.isArray(payload.characters)) {
        for (const item of (payload.characters as Array<Record<string, unknown>>).slice(0, 6)) {
            const role = item.roleType ? `（${String(item.roleType)}）` : "";
            lines.push(`人物：${String(item.name || "未命名")}${role}`);
        }
    } else if (write.targetSection === "world") {
        if (payload.worldSetting && typeof payload.worldSetting === "object") {
            const ws = payload.worldSetting as Record<string, unknown>;
            if (ws.era) lines.push(`时代：${String(ws.era)}`);
            if (ws.overallTone) lines.push(`基调：${String(ws.overallTone).slice(0, 60)}`);
        }
        if (Array.isArray(payload.worldItems) && payload.worldItems.length) {
            lines.push(`世界观条目：${(payload.worldItems as Array<Record<string, unknown>>).map((i) => String(i.name || "")).filter(Boolean).join("、")}`);
        }
        if (Array.isArray(payload.locations) && payload.locations.length) {
            lines.push(`场景地点：${(payload.locations as Array<Record<string, unknown>>).map((l) => String(l.name || "")).filter(Boolean).join("、")}`);
        }
    }
    return lines;
}

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

/** 剧本工作台右侧 Nana助手对话面板（与画布 Nana助手保持一致的视觉、任务卡片与弹簧对话动效，完整保留全部 20 项动作与审核草稿流程）。 */
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
    const updateOverview = useScriptStore((state) => state.updateOverview);
    const updateOutline = useScriptStore((state) => state.updateOutline);
    const updateCharacters = useScriptStore((state) => state.updateCharacters);
    const updateWorld = useScriptStore((state) => state.updateWorld);
    const saveAll = useScriptStore((state) => state.saveAll);

    const [model, setModel] = useState("");
    const [applyingWriteId, setApplyingWriteId] = useState("");
    const [appliedWriteIds, setAppliedWriteIds] = useState<string[]>([]);
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
    const [runningActionLabel, setRunningActionLabel] = useState("");
    const [animatingMsgId, setAnimatingMsgId] = useState<string | null>(null);
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

    /** 输入框底部直接露出的高频快捷芯片（其余全部收纳在「全部动作」弹层里）。 */
    const quickActionOptions = useMemo(() => {
        if (options.length <= 3) return options;
        const optimizing = cardTargetType === "scene" || (!cardTargetType && aiTargetType === "scene");
        const preferredKeys = optimizing
            ? ["polish", "dialogue", "conflict"]
            : ["episodeDraft", "episodePlan", "polish"];
        const picked = preferredKeys
            .map((key) => options.find((item) => item.value === key))
            .filter((item): item is { value: string; label: string; sections: string[] } => Boolean(item));
        return picked.length ? picked : options.slice(0, 3);
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

    useEffect(() => {
        if (!projectId) return;
        let cancelled = false;
        setLoadingHistory(true);
        setAnimatingMsgId(null);
        getScriptAgentHistory(projectId)
            .then((res) => { if (!cancelled) setMessages(res.messages || []); })
            .catch(() => { if (!cancelled) setMessages([]); })
            .finally(() => { if (!cancelled) setLoadingHistory(false); });
        return () => { cancelled = true; };
    }, [projectId]);

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
        setRunningActionLabel("");
        setSendingChat(false);
        setDiscardingId("");
        setAppliedWriteIds(projectId ? readAppliedWriteIds(projectId) : []);
    }, [projectId]);

    const scrollToBottom = useCallback(() => {
        const container = scrollRef.current;
        if (container) container.scrollTop = container.scrollHeight;
    }, []);

    useEffect(() => {
        scrollToBottom();
    }, [messages, sendingChat, runningDraft, scrollToBottom]);

    if (!project) return null;

    const currentEpisode = project.episodes.find((ep) => ep.id === selectedEpisodeId);
    const contextLabel = cardTarget?.label
        || aiTarget?.label
        || (section === "episodes" && currentEpisode ? `第${currentEpisode.episodeNumber}集${currentEpisode.title ? ` · ${currentEpisode.title}` : ""}` : "")
        || SECTION_LABELS[section]
        || translate("script.currentSection");

    const isOverviewEmpty = !project.overview.logline?.trim() && !project.overview.synopsis?.trim();
    const isOutlineEmpty = !project.outlineSections?.length || project.outlineSections.some((item) => !item.content?.trim());

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
            const meta = JSON.stringify({
                kind: "scriptAgent",
                recommendations: response.recommendations,
                proposedWrites: response.proposedWrites || [],
            });
            setAnimatingMsgId(response.messageId);
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

        const runGenerateDraft = async () => {
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
            setRunningActionLabel(actionLabel);
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
                const msgId = `local_act_a_${draft.id}`;
                setAnimatingMsgId(msgId);
                setMessages((prev) => [
                    ...prev,
                    {
                        id: msgId,
                        role: "assistant",
                        text: `已为「${target.label || contextLabel}」生成「${actionLabel}」审核草稿，请点击下方卡片预览差异并确认应用。`,
                        meta: JSON.stringify({
                            draftId: draft.id,
                            actionType,
                            actionLabel,
                            targetLabel: target.label || contextLabel,
                        }),
                        createdAt: new Date().toISOString(),
                    },
                ]);
                message.success(translate("script.aiDraftGeneratedReviewItBeforeApplying"));
            } catch (error) {
                if (generation === requestGeneration.current && useScriptStore.getState().project?.id === latestProject.id) {
                    const errMsg = error instanceof Error ? error.message : translate("script.aiActionFailed");
                    message.error(errMsg);
                    const errId = `local_act_err_${Date.now()}`;
                    setAnimatingMsgId(errId);
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: errId,
                            role: "assistant",
                            text: `「${actionLabel}」草稿生成失败：${errMsg}`,
                            createdAt: new Date().toISOString(),
                        },
                    ]);
                }
            } finally {
                if (generation === requestGeneration.current) {
                    setRunningDraft(false);
                    setRunningActionLabel("");
                }
            }
        };

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
            onOk: () => {
                // 不返回 Promise：点击确认后立即关闭弹窗，执行进度与结果卡片直接在对话流内呈现。
                void runGenerateDraft();
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
            setAnimatingMsgId(null);
            message.success(`已开启新的${assistantName}对话`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "重置会话失败");
        }
    };

    /** 执行待确认写入提案并立即保存：若已有内容冲突，先弹出二次覆盖确认框。 */
    const commitProposedWrite = async (write: ScriptAgentProposedWrite) => {
        const latestProject = useScriptStore.getState().project;
        if (!latestProject || latestProject.id !== project.id) {
            message.warning(translate("script.theScriptProjectHasChangedSelectTheAiDraftAgain"));
            return;
        }
        setApplyingWriteId(write.id);
        try {
            const payload = write.payload || {};
            if (write.targetSection === "overview" && payload.overview && typeof payload.overview === "object") {
                const patch = payload.overview as Partial<ScriptOverview>;
                updateOverview({
                    ...latestProject.overview,
                    ...(patch.title ? { title: patch.title } : {}),
                    ...(patch.genre !== undefined ? { genre: patch.genre } : {}),
                    ...(patch.logline !== undefined ? { logline: patch.logline } : {}),
                    ...(patch.synopsis !== undefined ? { synopsis: patch.synopsis } : {}),
                    ...(typeof patch.targetEpisodeCount === "number" ? { targetEpisodeCount: patch.targetEpisodeCount } : {}),
                    ...(typeof patch.targetDurationSeconds === "number" ? { targetDurationSeconds: patch.targetDurationSeconds } : {}),
                    ...(patch.narrativeStyle !== undefined ? { narrativeStyle: patch.narrativeStyle } : {}),
                    ...(patch.theme !== undefined ? { theme: patch.theme } : {}),
                    ...(patch.mainPlot !== undefined ? { mainPlot: patch.mainPlot } : {}),
                    ...(patch.mainConflict !== undefined ? { mainConflict: patch.mainConflict } : {}),
                    ...(patch.endingDirection !== undefined ? { endingDirection: patch.endingDirection } : {}),
                });
            } else if (write.targetSection === "outline" && Array.isArray(payload.outlineSections)) {
                const nextSections: OutlineSection[] = (payload.outlineSections as Array<Record<string, unknown>>).map((sec, index) => ({
                    id: latestProject.outlineSections[index]?.id || nanoid(),
                    sectionType: (sec.sectionType as OutlineSection["sectionType"]) || "act",
                    title: String(sec.title || `第${index + 1}幕`),
                    content: String(sec.content || ""),
                    sortOrder: index,
                }));
                updateOutline(nextSections, latestProject.storyEvents);
            } else if (write.targetSection === "characters" && Array.isArray(payload.characters)) {
                const merged: ScriptCharacter[] = [...latestProject.characters];
                for (const raw of payload.characters as Array<Record<string, unknown>>) {
                    const name = String(raw.name || "").trim();
                    if (!name) continue;
                    const existingIndex = merged.findIndex((c) => c.name.trim() === name);
                    const base: ScriptCharacter = existingIndex >= 0 ? merged[existingIndex] : {
                        id: nanoid(), name, identity: "", age: "", occupation: "", roleType: "", personality: "",
                        valuesDescription: "", goal: "", desire: "", fear: "", motivation: "",
                        appearanceDescription: "", habits: "", speechStyle: "", backgroundStory: "",
                        characterArc: "", sortOrder: merged.length,
                    };
                    const updated: ScriptCharacter = {
                        ...base,
                        name,
                        roleType: String(raw.roleType || base.roleType),
                        identity: String(raw.identity || base.identity),
                        age: String(raw.age || base.age),
                        occupation: String(raw.occupation || base.occupation),
                        personality: String(raw.personality || base.personality),
                        goal: String(raw.goal || base.goal),
                        desire: String(raw.desire || base.desire),
                        fear: String(raw.fear || base.fear),
                        motivation: String(raw.motivation || base.motivation),
                        appearanceDescription: String(raw.appearanceDescription || base.appearanceDescription),
                        speechStyle: String(raw.speechStyle || base.speechStyle),
                        backgroundStory: String(raw.backgroundStory || base.backgroundStory),
                        characterArc: String(raw.characterArc || base.characterArc),
                    };
                    if (existingIndex >= 0) merged[existingIndex] = updated;
                    else merged.push(updated);
                }
                updateCharacters(merged.map((c, sortOrder) => ({ ...c, sortOrder })), latestProject.characterRelations);
            } else if (write.targetSection === "world") {
                const settingPatch = (payload.worldSetting || {}) as Partial<WorldSetting>;
                const nextSetting: WorldSetting = {
                    ...latestProject.worldSetting,
                    ...(settingPatch.era ? { era: settingPatch.era } : {}),
                    ...(settingPatch.region ? { region: settingPatch.region } : {}),
                    ...(settingPatch.socialBackground ? { socialBackground: settingPatch.socialBackground } : {}),
                    ...(settingPatch.overallTone ? { overallTone: settingPatch.overallTone } : {}),
                };
                const mergedItems: WorldItem[] = [...latestProject.worldItems];
                if (Array.isArray(payload.worldItems)) {
                    for (const raw of payload.worldItems as Array<Record<string, unknown>>) {
                        const name = String(raw.name || "").trim();
                        if (!name) continue;
                        const idx = mergedItems.findIndex((w) => w.name.trim() === name);
                        const nextItem: WorldItem = {
                            id: idx >= 0 ? mergedItems[idx].id : nanoid(),
                            itemType: (raw.itemType as WorldItem["itemType"]) || (idx >= 0 ? mergedItems[idx].itemType : "rule"),
                            name,
                            description: String(raw.description || (idx >= 0 ? mergedItems[idx].description : "")),
                            sortOrder: idx >= 0 ? idx : mergedItems.length,
                        };
                        if (idx >= 0) mergedItems[idx] = nextItem;
                        else mergedItems.push(nextItem);
                    }
                }
                const mergedLocations: ScriptLocation[] = [...latestProject.locations];
                if (Array.isArray(payload.locations)) {
                    for (const raw of payload.locations as Array<Record<string, unknown>>) {
                        const name = String(raw.name || "").trim();
                        if (!name) continue;
                        const idx = mergedLocations.findIndex((l) => l.name.trim() === name);
                        const base: ScriptLocation = idx >= 0 ? mergedLocations[idx] : {
                            id: nanoid(), name, spacePurpose: "", narrativeRole: "", defaultTime: "",
                            weather: "", atmosphere: "", keyObjects: "", mainEvents: "", sortOrder: mergedLocations.length,
                        };
                        const nextLoc: ScriptLocation = {
                            ...base,
                            name,
                            spacePurpose: String(raw.spacePurpose || base.spacePurpose),
                            narrativeRole: String(raw.narrativeRole || base.narrativeRole),
                            defaultTime: String(raw.defaultTime || base.defaultTime),
                            weather: String(raw.weather || base.weather),
                            atmosphere: String(raw.atmosphere || base.atmosphere),
                            keyObjects: String(raw.keyObjects || base.keyObjects),
                        };
                        if (idx >= 0) mergedLocations[idx] = nextLoc;
                        else mergedLocations.push(nextLoc);
                    }
                }
                updateWorld(
                    nextSetting,
                    mergedItems.map((w, sortOrder) => ({ ...w, sortOrder })),
                    mergedLocations.map((l, sortOrder) => ({ ...l, sortOrder })),
                );
            }
            const saved = await saveAll();
            if (!saved) {
                message.error("写入后自动保存失败，请检查顶部保存状态或手动点击保存");
                return;
            }
            setAppliedWriteIds((prev) => {
                const next = prev.includes(write.id) ? prev : [...prev, write.id];
                persistAppliedWriteIds(project.id, next);
                return next;
            });
            message.success(`已确认${write.title}并保存`);
        } finally {
            setApplyingWriteId("");
        }
    };

    const handleConfirmProposedWrite = (write: ScriptAgentProposedWrite) => {
        const latestProject = useScriptStore.getState().project;
        if (!latestProject) return;
        const conflicts = detectProposedWriteConflicts(write, latestProject);
        if (conflicts.length > 0) {
            modal.confirm({
                title: `确认覆盖「${SECTION_LABELS[write.targetSection] || write.targetSection}」已有内容？`,
                content: (
                    <div className="space-y-2 text-sm">
                        <p>以下内容当前已存在，确认后将被替换为 {assistantName} 提供的新内容：</p>
                        <p className="rounded-md bg-[var(--studio-surface-soft)] px-2.5 py-2 text-xs text-[var(--studio-ink)]">
                            {conflicts.join("、")}
                        </p>
                    </div>
                ),
                okText: "确认覆盖并保存",
                okButtonProps: { danger: true },
                cancelText: translate("script.cancel"),
                onOk: () => {
                    // 立即关闭确认弹窗，在对话卡片内展示保存状态。
                    void commitProposedWrite(write);
                },
            });
            return;
        }
        void commitProposedWrite(write);
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
    const isBusy = sendingChat || runningDraft;
    const canSubmitComposer = selectedAction
        ? !selectedActionBlockedReason && pricingCurrent && !isBusy
        : Boolean(inputText.trim()) && !isBusy;

    // 估算当前会话与剧本上下文的 Token 占用百分比（与画布 Nana助手口径一致：按 32k 窗口折算）。
    const contextUsagePercent = (() => {
        const recentHistoryChars = messages.slice(-12).reduce((sum, item) => sum + Math.min(item.text.length, 800), 0);
        const overviewChars =
            (project.overview.logline?.length || 0)
            + Math.min(project.overview.synopsis?.length || 0, 1200)
            + Math.min(project.overview.mainPlot?.length || 0, 1000)
            + Math.min(project.overview.mainConflict?.length || 0, 600);
        const outlineChars = (project.outlineSections || []).reduce((sum, sec) => sum + Math.min(sec.content?.length || 0, 450), 0);
        const structureChars = Math.min(project.characters.length, 20) * 120 + project.episodes.length * 140;
        const totalChars = recentHistoryChars + overviewChars + outlineChars + structureChars;
        if (totalChars === 0) return 0;
        return Math.min(99, Math.max(1, Math.round((totalChars / 2 / 32000) * 100)));
    })();

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
            {/* 顶部标题栏（与画布 Nana助手标题栏样式对齐） */}
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--studio-line)] px-3.5 py-2.5 text-sm font-medium">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="grid size-6 shrink-0 place-items-center rounded-md bg-[color-mix(in_srgb,var(--studio-ink)_8%,transparent)] text-[var(--studio-muted)]">
                        <BookOpenText className="size-3.5" />
                    </span>
                    <span className="truncate text-[13px] font-medium text-[var(--studio-ink)]">{assistantName}</span>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                    <NanaHeaderStatus active={isBusy} />
                    <button
                        type="button"
                        onClick={() => setShowDraftsTray((prev) => !prev)}
                        className={`inline-flex h-7 cursor-pointer items-center gap-1 rounded-lg border px-2 text-xs! transition-colors ${
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
                    <Tooltip title={translate("canvas.newConversation")}>
                        <button
                            type="button"
                            onClick={() => void handleResetSession()}
                            disabled={isBusy}
                            className="grid size-7 cursor-pointer place-items-center rounded-lg text-[var(--studio-muted)]! opacity-70 transition hover:bg-[var(--studio-surface-hover)] hover:text-[var(--studio-ink)]! hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-30"
                            aria-label={translate("canvas.newConversation")}
                        >
                            <MessageSquarePlus className="size-4" />
                        </button>
                    </Tooltip>
                </div>
            </div>

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
                            <div key={draft.id} className="rounded-xl border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] p-2.5">
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

            {/* 中间可滚动对话消息流（与画布 Nana助手一致的排版、任务时间线与弹簧动效） */}
            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                <div className="flex flex-col gap-3">
                    {loadingHistory ? (
                        <div className="flex items-center justify-center py-12">
                            <Spin size="small" />
                        </div>
                    ) : messages.length === 0 && !isBusy ? (
                        <div className="space-y-4 py-6">
                            <div className="text-center">
                                <div className="text-sm font-medium text-[var(--studio-ink)]">{assistantName}已就绪</div>
                                <p className="mt-1.5 text-xs leading-5 text-[var(--studio-muted)]">
                                    可以直接与我讨论剧情走向、人物动机、场次冲突与对白节奏；也可在下方选择快捷动作或「全部动作」生成审核草稿，所有正式内容都由你确认后写入。
                                </p>
                            </div>
                            <div className="space-y-1.5">
                                {starterPrompts.map((prompt) => (
                                    <button
                                        key={prompt}
                                        type="button"
                                        disabled={isBusy}
                                        onClick={() => void handleSendChat(prompt)}
                                        className="block w-full cursor-pointer rounded-xl border border-[var(--studio-line)] bg-[color-mix(in_srgb,var(--studio-ink)_3%,var(--studio-panel-solid))] px-3 py-2 text-left text-xs! leading-5 text-[var(--studio-text)]! transition-colors hover:border-[var(--studio-primary-line)] hover:text-[var(--studio-ink)]! disabled:opacity-50"
                                    >
                                        {prompt}
                                    </button>
                                ))}
                            </div>
                        </div>
                    ) : (
                        messages.map((item) => {
                            if (item.role === "user") {
                                return <NanaChatBubble key={item.id} role="user" text={item.text} />;
                            }
                            const meta = parseMessageMeta(item.meta);
                            const proposedWrites = meta.proposedWrites || [];
                            const proposedSections = new Set(proposedWrites.map((w) => w.targetSection));
                            const recommendations = (meta.recommendations || []).filter(
                                (rec) => !proposedSections.has(recommendationSection(rec.actionType)),
                            );
                            const linkedDraft = meta.draftId ? drafts.find((d) => d.id === meta.draftId && d.status === "pending") : undefined;
                            const draftStale = linkedDraft ? isScriptAiDraftStale(linkedDraft, project.revision) : false;

                            return (
                                <div key={item.id} className="space-y-2">
                                    {meta.draftId ? (
                                        <NanaThinkingRow
                                            title="执行步骤"
                                            preview={`${meta.actionLabel || "生成审核草稿"} · ${meta.targetLabel || contextLabel}`}
                                            steps={[{
                                                id: meta.draftId,
                                                label: `生成「${meta.actionLabel || "AI 草稿"}」（${meta.targetLabel || contextLabel}）`,
                                                status: "done",
                                            }]}
                                        />
                                    ) : null}

                                    <NanaChatBubble
                                        role="assistant"
                                        text={item.text}
                                        animated={item.id === animatingMsgId}
                                        onHeightChange={scrollToBottom}
                                    />

                                    {/* 待用户确认的结构化写入卡片（已有内容时提示确认覆盖；已写入内容刷新后保持已写入态） */}
                                    {proposedWrites.map((write) => {
                                        const applied = appliedWriteIds.includes(write.id) || isProposedWriteAlreadyApplied(write, project);
                                        const liveConflicts = applied ? [] : detectProposedWriteConflicts(write, project);
                                        const previewLines = formatProposedWritePreviewLines(write);
                                        return (
                                            <NanaApprovalCard
                                                key={write.id}
                                                variant={applied ? "done" : "pending"}
                                                title={write.title}
                                                tag={SECTION_LABELS[write.targetSection] || write.targetSection}
                                                badge={applied ? "已写入" : liveConflicts.length > 0 ? "将覆盖已有内容" : "待确认写入"}
                                                description={
                                                    previewLines.length
                                                        ? `${write.summary}\n${previewLines.slice(0, 6).map((line) => `• ${line}`).join("\n")}`
                                                        : write.summary
                                                }
                                                warning={
                                                    !applied && liveConflicts.length > 0
                                                        ? `检测到已有内容，确认时将二次提醒覆盖：${liveConflicts.slice(0, 5).join("、")}${liveConflicts.length > 5 ? " 等" : ""}`
                                                        : undefined
                                                }
                                                actions={
                                                    <Button
                                                        size="small"
                                                        type={applied ? "default" : "primary"}
                                                        danger={!applied && liveConflicts.length > 0}
                                                        disabled={applied || Boolean(applyingWriteId)}
                                                        loading={applyingWriteId === write.id}
                                                        icon={applied ? <Check className="size-3.5" /> : undefined}
                                                        onClick={() => handleConfirmProposedWrite(write)}
                                                    >
                                                        {applied ? "已写入并保存" : liveConflicts.length > 0 ? "确认覆盖写入" : "确认写入"}
                                                    </Button>
                                                }
                                            />
                                        );
                                    })}

                                    {/* 推荐动作卡片（自动感知是否已有待审草稿或对应板块已生成完成） */}
                                    {recommendations.map((rec, index) => {
                                        const cost = getActionCreditCost(rec.actionType);
                                        const recBlocked = getBlockedReason(rec.actionType);
                                        const pendingMatch = drafts.find(
                                            (d) => d.status === "pending" && d.actionType === rec.actionType && (!rec.targetId || d.targetId === rec.targetId),
                                        );
                                        const completed = !pendingMatch && isRecommendationAlreadyCompleted(rec, project, drafts);
                                        const costLabel = cost === undefined ? "未定价" : `${cost} 积分`;
                                        return (
                                            <NanaApprovalCard
                                                key={`${rec.actionType}-${index}`}
                                                variant={completed ? "done" : "pending"}
                                                title={rec.label}
                                                tag={rec.targetLabel}
                                                badge={pendingMatch ? "已有待审草稿" : completed ? "已生成" : costLabel}
                                                description={rec.description}
                                                warning={completed ? undefined : recBlocked || undefined}
                                                actions={
                                                    pendingMatch ? (
                                                        <>
                                                            <Button
                                                                size="small"
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
                                                                重新生成
                                                            </Button>
                                                            <Button size="small" type="primary" onClick={() => setPreview(pendingMatch)}>
                                                                {translate("script.previewChanges")}
                                                            </Button>
                                                        </>
                                                    ) : (
                                                        <>
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
                                                                type={completed ? "default" : "primary"}
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
                                                                {completed ? `重新生成${cost !== undefined ? ` (${cost}积分)` : ""}` : "生成草稿"}
                                                            </Button>
                                                        </>
                                                    )
                                                }
                                            />
                                        );
                                    })}

                                    {/* 对话流内联的已生成草稿任务时间线卡片 */}
                                    {meta.draftId ? (
                                        <NanaTaskTimeline
                                            title={linkedDraft ? draftTitle(linkedDraft, project.episodes, translate) : `${meta.actionLabel || "审核草稿"} · 已处理`}
                                            status={linkedDraft ? (draftStale ? "warning" : "done") : "done"}
                                            summary={linkedDraft ? (draftStale ? translate("script.outdated") : translate("script.pendingApproval")) : "已归档"}
                                            defaultExpanded={Boolean(linkedDraft)}
                                            items={[{
                                                id: meta.draftId,
                                                name: meta.targetLabel || contextLabel,
                                                meta: linkedDraft ? "等待预览确认后写入正式剧本" : "该草稿已应用或已丢弃",
                                                status: linkedDraft ? (draftStale ? "warning" : "done") : "done",
                                                statusText: linkedDraft ? (draftStale ? "已过期" : "待确认") : "已完成",
                                            }]}
                                            footer={linkedDraft ? (
                                                <>
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
                                                    <Button size="small" type="primary" onClick={() => setPreview(linkedDraft)}>
                                                        {translate("script.previewChanges")}
                                                    </Button>
                                                </>
                                            ) : undefined}
                                        />
                                    ) : null}
                                </div>
                            );
                        })
                    )}

                    {isBusy ? (
                        <NanaThinkingRow
                            active
                            showBubble
                            title={runningDraft ? "正在生成草稿" : "正在思考"}
                            preview={runningDraft ? `执行「${runningActionLabel || selectedActionLabel}」· ${contextLabel}` : `阅读「${contextLabel}」上下文…`}
                            thinkingLabel={runningDraft ? "生成草稿中" : translate("chat.thinking")}
                        />
                    ) : null}
                </div>
            </div>

            {/* 底部圆角输入卡片（与画布 AgentChatComposer 保持一致） */}
            <NanaComposerShell
                value={inputText}
                disabled={isBusy}
                sending={isBusy}
                canSubmit={canSubmitComposer}
                submitIcon={selectedAction ? <Sparkles className="size-3.5" /> : <ArrowUp className="size-4" />}
                submitLabel={selectedAction ? "生成草稿" : translate("canvas.send")}
                placeholder={
                    selectedAction
                        ? `补充对「${selectedActionLabel}」的风格、篇幅或保留设定要求，留空也可直接生成…（Enter 执行）`
                        : `和${assistantName}聊聊剧情、人物、节奏或对白…（Enter 发送）`
                }
                onChange={setInputText}
                onSubmit={handleComposerSubmit}
                topBar={
                    <>
                        <span className="inline-flex max-w-[160px] items-center gap-1 rounded-md border border-[var(--studio-line)] bg-[color-mix(in_srgb,var(--studio-ink)_6%,transparent)] px-2 py-0.5 text-[11px] text-[var(--studio-ink)]">
                            <BookOpenText className="size-3 shrink-0 opacity-70" />
                            <span className="truncate">{contextLabel}</span>
                        </span>
                        {selectedAction ? (
                            <span
                                className="inline-flex max-w-[230px] items-center gap-1 rounded-md px-2 py-0.5 text-[11px]"
                                style={{
                                    background: "color-mix(in srgb, #f59e0b 16%, transparent)",
                                    color: "#f59e0b",
                                }}
                            >
                                <Wand2 className="size-3 shrink-0" />
                                <span className="truncate">
                                    {selectedActionLabel} · {selectedActionCreditCost === undefined ? "未定价" : `${selectedActionCreditCost} 积分`}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => setSelectedAction("")}
                                    className="cursor-pointer opacity-75 hover:opacity-100"
                                    title="退出动作模式，切回自由对话"
                                    aria-label="退出动作模式"
                                >
                                    <X className="size-3" />
                                </button>
                            </span>
                        ) : (
                            quickActionOptions.slice(0, 2).map((item) => (
                                <button
                                    key={item.value}
                                    type="button"
                                    onClick={() => setSelectedAction(item.value)}
                                    className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-dashed border-[var(--studio-line)] px-2 py-0.5 text-[11px]! text-[var(--studio-muted)]! transition-colors hover:border-[var(--studio-primary-line)] hover:text-[var(--studio-ink)]!"
                                >
                                    <Wand2 className="size-3 shrink-0 opacity-70" />
                                    <span className="truncate">{item.label}</span>
                                </button>
                            ))
                        )}
                    </>
                }
                extraBar={
                    selectedAction && (showDurationBudget || selectedActionBlockedReason) ? (
                        <div className="space-y-1.5">
                            {showDurationBudget ? (
                                <div className="flex flex-wrap items-center gap-1.5">
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
                    ) : undefined
                }
                leftControls={
                    options.length > 0 ? (
                        <Popover
                            trigger="click"
                            placement="topLeft"
                            open={actionsPopoverOpen}
                            onOpenChange={setActionsPopoverOpen}
                            content={renderActionMenuContent()}
                        >
                            <button
                                type="button"
                                className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-full px-2 text-xs! transition-opacity hover:opacity-100 opacity-85"
                                style={{
                                    color: selectedAction ? "var(--studio-ink)" : "var(--studio-muted)",
                                    background: selectedAction ? "color-mix(in srgb, var(--studio-ink) 10%, transparent)" : "transparent",
                                }}
                            >
                                <SlidersHorizontal className="size-3.5" />
                                <span>动作 ({options.length})</span>
                            </button>
                        </Popover>
                    ) : undefined
                }
                contextUsagePercent={contextUsagePercent}
                rightControls={
                    <ModelPicker
                        config={config}
                        value={model}
                        onChange={setModel}
                        capability="text"
                        showChannel={false}
                        className="h-7 max-w-[168px]"
                        placeholder={translate("canvas.selectTextModel")}
                    />
                }
            />

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
