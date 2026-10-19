import type { CreditAmount } from "@/shared/lib/credit-amounts";
export type ScriptStage = "idea" | "outline" | "writing" | "completed" | "production";
export type ScriptContentType = "comicDrama" | "liveActionShort" | "animation" | "advertisement" | "musicVideo" | "storyShort";
export type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error" | "conflict";

export type ScriptTemplateSection = { id: string; title: string; sectionType: string; guidance: string; sortOrder: number };
export type ScriptTemplate = {
    templateKey: string;
    category: string;
    name: string;
    description: string;
    contentType: ScriptContentType;
    genre: string;
    structureType: string;
    recommendedEpisodeCount: number;
    sections: ScriptTemplateSection[];
};

export type ScriptProjectSummary = {
    id: string;
    title: string;
    contentType: ScriptContentType;
    genre: string;
    logline: string;
    stage: ScriptStage;
    completionRate: number;
    episodeCount: number;
    targetEpisodeCount: number;
    productionStarted: boolean;
    revision: number;
    updatedAt: string;
};

export type ScriptProjectList = { projects: ScriptProjectSummary[]; total: number; page: number; pageSize: number };

export type ScriptOverview = {
    title: string;
    contentType: ScriptContentType;
    genre: string;
    logline: string;
    synopsis: string;
    targetDurationSeconds: number;
    targetEpisodeCount: number;
    narrativeStyle: string;
    theme: string;
    mainPlot: string;
    mainConflict: string;
    endingDirection: string;
};

export type OutlineSection = { id: string; sectionType: string; title: string; content: string; sortOrder: number };
export type StoryEvent = {
    id: string;
    outlineSectionId?: string | null;
    episodeId?: string | null;
    sceneId?: string | null;
    eventType: string;
    title: string;
    description: string;
    sortOrder: number;
};

export type ScriptCharacter = {
    id: string;
    name: string;
    identity: string;
    age: string;
    occupation: string;
    roleType: string;
    personality: string;
    valuesDescription: string;
    goal: string;
    desire: string;
    fear: string;
    motivation: string;
    appearanceDescription: string;
    habits: string;
    speechStyle: string;
    backgroundStory: string;
    characterArc: string;
    sortOrder: number;
};

export type CharacterRelation = {
    id: string;
    sourceCharacterId: string;
    targetCharacterId: string;
    relationshipType: string;
    relationshipDirection: "directed" | "bidirectional";
    storyStage: string;
    conflictDescription: string;
    description: string;
    sortOrder: number;
};

export type WorldSetting = { era: string; region: string; socialBackground: string; overallTone: string };
export type WorldItem = { id: string; itemType: string; name: string; description: string; sortOrder: number };
export type ScriptLocation = {
    id: string;
    name: string;
    spacePurpose: string;
    narrativeRole: string;
    defaultTime: string;
    weather: string;
    atmosphere: string;
    keyObjects: string;
    mainEvents: string;
    sortOrder: number;
};

export type EpisodeSummary = {
    id: string;
    episodeNumber: number;
    title: string;
    summary: string;
    keyEvents: string;
    mainConflict: string;
    climax: string;
    endingHook: string;
    targetDurationSeconds: number;
    completionStatus: "planning" | "draft" | "complete";
    sortOrder: number;
};

export type ScriptBlock = { id: string; blockType: "action" | "dialogue" | "narration" | "transition"; characterId?: string | null; content: string; origin?: "original" | "adapted" | null; sortOrder: number };
export type ScriptScene = {
    id: string;
    locationId?: string | null;
    sceneNumber: number;
    title: string;
    interiorExterior: "interior" | "exterior" | "mixed";
    timeDescription: string;
    sceneGoal: string;
    actionSummary: string;
    transitionDescription: string;
    previousRelation: string;
    nextRelation: string;
    sortOrder: number;
    characterIds: string[];
    blocks: ScriptBlock[];
};
export type EpisodeDetail = { episode: EpisodeSummary; scenes: ScriptScene[] };

export type ScriptProjectDetail = {
    id: string;
    overview: ScriptOverview;
    outlineSections: OutlineSection[];
    storyEvents: StoryEvent[];
    characters: ScriptCharacter[];
    characterRelations: CharacterRelation[];
    worldSetting: WorldSetting;
    worldItems: WorldItem[];
    locations: ScriptLocation[];
    episodes: EpisodeSummary[];
    stage: ScriptStage;
    completionRate: number;
    productionStarted: boolean;
    revision: number;
    createdAt: string;
    updatedAt: string;
};

export type MutationResult = { revision: number; stage: ScriptStage; completionRate: number; updatedAt: string };
export type ScriptVersionSummary = { id: string; versionName: string; changeSource: "manual" | "ai"; changeSummary: string; sourceRevision: number; createdAt: string };
export type ScriptVersionDetail = ScriptVersionSummary & { snapshotData: Record<string, unknown> };
export type ScriptAiDraft = {
    id: string;
    projectId: string;
    actionType: string;
    targetType: string;
    targetId?: string | null;
    baseRevision: number;
    instruction: string;
    sourceData: Record<string, unknown>;
    draftData: Record<string, unknown>;
    model: string;
    chargedCredits: CreditAmount;
    status: "pending" | "applied" | "discarded";
    createdAt: string;
};
export type AnalysisIssue = { id: string; category: string; severity: "info" | "warning" | "important"; episodeId?: string; sceneId?: string; blockId?: string; title: string; reason: string; suggestion: string; sortOrder: number };
export type AnalysisReport = { id: string; projectId: string; scopeType: "project" | "episode"; scopeId?: string; summary: string; model: string; chargedCredits: CreditAmount; sourceRevision: number; createdAt: string; issues: AnalysisIssue[] };
export type ReadinessItem = { key: string; status: "ready" | "suggested" | "missing"; title: string; description: string; targetSection: string };
export type ProductionReadiness = { projectId: string; ready: boolean; items: ReadinessItem[] };

export type ScriptWorkspaceSection = "overview" | "outline" | "characters" | "world" | "episodes" | "source" | "storyBible" | "adaptation" | "versions";

export type NovelAdaptationSettings = {
    format: ScriptContentType;
    episodeCount: number;
    episodeDurationSeconds: number;
    pacing: "slow" | "balanced" | "fast";
    adaptationLevel: "faithful" | "balanced" | "bold";
};
/** 改编输入使用的原文片段：只有位置与引文，标识字段不进入上下文。 */
export type NovelAdaptationFactEvidence = { startOffset: number; endOffset: number; quote: string };
export type NovelAdaptationFact = { id: string; revision: number; itemType: StoryBibleItemType; name: string; summary: string; storyTime: string; evidences: NovelAdaptationFactEvidence[] };
export type NovelAdaptationDraftSource = { draftId: string; stage: "outline" | "episodes" | "episode"; settings: NovelAdaptationSettings; facts: NovelAdaptationFact[]; status: ScriptAiDraft["status"] };
export type NovelAdaptationImpact = { targetType: string; targetId: string; factId: string; factName: string | null; factRevision: number; currentRevision: number | null; needsReview: boolean };
export type NovelAdaptationConsistencyIssue = { category: string; severity: "info" | "warning"; title: string; description: string; factId: string; targetType: string; targetId: string };

/** 改编阶段，与后端 GenerateRequest.stage 取值一致。 */
export type NovelAdaptationStage = "overview" | "characters" | "world" | "outline" | "episodes" | "episode";
/** 全书改编任务状态。 */
export type NovelAdaptationJobStatus = "queued" | "running" | "awaiting" | "completed" | "failed" | "canceled";
/** 全书改编设置：不含集数，集数在全书策略生成后由用户确认锁定。 */
export type WholeBookAdaptationOptions = {
    format: ScriptContentType;
    episodeDurationSeconds: number;
    pacing: "slow" | "balanced" | "fast";
    adaptationLevel: "faithful" | "balanced" | "bold";
};
/** 模型建议的故事阶段，recommendedEpisodes 只是建议值。 */
export type WholeBookAdaptationArc = { title: string; summary: string; sourceKeys: string[]; recommendedEpisodes: number };
/** 全书统一策略，是确认集数的唯一依据。 */
export type WholeBookAdaptationStrategy = { mainPlot: string; ending: string; reasoning: string; compression: string; arcs: WholeBookAdaptationArc[] };
/** 服务端固定生成的分集身份，模型只能填写内容。 */
export type WholeBookAdaptationSlot = { id: string; episodeNumber: number; sortOrder: number; arcIndex: number };
export type WholeBookAdaptationQuote = { revision: number; phase: string; calls: number; credits: CreditAmount; fingerprint: string };
/** 全书改编任务视图，素材与策略阶段的进度、策略与锁定集数都在这里。 */
export type WholeBookAdaptationJob = {
    jobId: string;
    phase: "materials" | "planning" | "drafts";
    stage: string;
    status: NovelAdaptationJobStatus;
    totalUnits: number;
    processedUnits: number;
    credits: CreditAmount;
    refundedCredits: CreditAmount;
    errorMessage: string;
    revision: number;
    retryCount: number;
    options: WholeBookAdaptationOptions;
    strategy: WholeBookAdaptationStrategy | null;
    lockedEpisodeCount: number;
    slots: WholeBookAdaptationSlot[];
    /** 升级前遗留的分阶段任务，不承接新的确认操作。 */
    historical: boolean;
};

/** 逐集正文生成模式：只出草稿先审阅，或生成后立即写入正式剧本。 */
export type EpisodeBodiesMode = "draft" | "apply";
/** 逐集正文批量报价：本次要生成的分集、调用次数与预扣积分。 */
export type EpisodeBodiesQuote = { revision: number; episodes: number; calls: number; credits: CreditAmount; fingerprint: string; episodeIds: string[] };
/** 逐集正文批量任务进度，分集身份由全书改编固定，这里只反映生成到第几集。 */
export type EpisodeBodiesJob = {
    jobId: string;
    phase: string;
    status: NovelAdaptationJobStatus;
    /** 本次任务的生成模式，用于区分结果去向。 */
    mode: EpisodeBodiesMode;
    totalEpisodes: number;
    processedEpisodes: number;
    credits: CreditAmount;
    refundedCredits: CreditAmount;
    errorMessage: string;
    revision: number;
    retryCount: number;
    /** 失败或取消后仍未完成的分集，续跑只重做这些分集。 */
    failedEpisodeIds: string[];
};

export type ScriptSourceType = "novel" | "script";
export type ScriptSourceFileEncoding = "UTF-8" | "GB18030";
/** 原文导入任务状态，与 script_source_import_tasks.status 对齐。 */
export type ScriptSourceImportTaskStatus = "queued" | "running" | "completed" | "failed";
/** 原文章节或场次，偏移基于规范化正文。 */
export type ScriptSourceSection = {
    id: string;
    parentId: string | null;
    sectionType: "chapter" | "scene";
    title: string;
    startOffset: number;
    endOffset: number;
    sortOrder: number;
    needsReview: boolean;
};
export type ScriptSourceTree = {
    documentId: string;
    sourceType: ScriptSourceType;
    fileName: string;
    revision: number;
    /** 用户确认过的结构修订号，与 revision 相等才允许启动故事知识库分析。 */
    confirmedRevision: number | null;
    warning: string;
    sections: ScriptSourceSection[];
};
export type ScriptSourceSectionDetail = { section: ScriptSourceSection; content: string; revision: number };
export type ScriptSourceImportStatus = {
    projectId: string;
    documentId: string;
    taskId: string;
    status: ScriptSourceImportTaskStatus;
    stage: string;
    processedSections: number;
    totalSections: number;
    errorMessage: string;
    warning: string;
    fileName: string;
    /** TXT 采用的明确编码，DOCX 与 DOC 为 null。 */
    textEncoding: string | null;
    revision: number;
    confirmedRevision: number | null;
};
export type ScriptSourceUploadResult = { projectId: string; documentId: string; taskId: string };

/** 原文定位请求，偏移为规范化正文 UTF-16 起点含、终点不含；key 变化时重新定位。 */
export type ScriptSourceFocus = { start: number; end: number; key: string };

export type StoryBibleItemType = "character" | "location" | "relationship" | "event" | "storyline";
export type StoryBibleItemStatus = "pending" | "confirmed" | "rejected";
/** 分析任务状态，与 story_bible_analysis_jobs.status 对齐。 */
export type StoryBibleJobStatus = "queued" | "running" | "retryable" | "completed" | "partial" | "failed" | "canceled";
export type StoryBibleQuickConfiguration = { contextWindowTokens: number; maximumInputCharacters: number; maximumOutputTokens: number; maximumSupplementCalls: number };
export type StoryBibleAnalysisGap = { sectionId: string; title: string; startOffset: number; endOffset: number; reason: string };
export type StoryBibleQuote = { model: string; billableChars: number; credits: CreditAmount; tierMinChars: number; tierMaxChars: number | null; sourceRevision: number; pricingRevision: number; estimatedBatches: number; quickConfiguration: StoryBibleQuickConfiguration };
export type StoryBibleJob = {
    jobId: string;
    status: StoryBibleJobStatus;
    stage: string;
    processedUnits: number;
    totalUnits: number;
    model: string;
    billableChars: number;
    credits: CreditAmount;
    sectionIds: string[];
    errorMessage: string;
    createdAt: string | null;
    creditBalance: CreditAmount | null;
    supplementCalls: number;
    gaps: StoryBibleAnalysisGap[];
    refundedCredits: CreditAmount;
};
export type StoryBibleItem = {
    id: string;
    itemType: StoryBibleItemType;
    name: string;
    summary: string;
    attributes: Record<string, unknown>;
    origin: "ai" | "manual";
    status: StoryBibleItemStatus;
    locked: boolean;
    suggestForItemId: string | null;
    narrativeOffset: number | null;
    storyTime: string;
    storyTimeStatus: "known" | "uncertain";
    storyOrder: number | null;
    revision: number;
    aliases: string[];
    evidenceCount: number;
    suggestionCount: number;
};
export type StoryBibleItemPage = { items: StoryBibleItem[]; total: number; page: number; pageSize: number };
export type StoryBibleLinkRole = "relation_source" | "relation_target" | "participant" | "location" | "storyline_event";
export type StoryBibleLink = { relatedItemId: string; relatedName: string; relatedType: StoryBibleItemType; role: StoryBibleLinkRole };
export type StoryBibleEvidence = { id: string; aliasId: string | null; startOffset: number; endOffset: number; quote: string };
export type StoryBibleItemDetail = {
    item: StoryBibleItem;
    aliases: Array<{ id: string; alias: string }>;
    links: StoryBibleLink[];
    referencedBy: StoryBibleLink[];
    evidences: StoryBibleEvidence[];
    suggestions: StoryBibleItemDetail[];
};
export type StoryBibleSaveItemInput = {
    projectId: string;
    itemId?: string;
    expectedRevision: number;
    itemType: StoryBibleItemType;
    name: string;
    summary: string;
    attributes: Record<string, unknown>;
    aliases: string[];
    links?: Array<{ relatedItemId: string; role: StoryBibleLinkRole }>;
    storyTime: string;
    storyTimeStatus: "known" | "uncertain";
    storyOrder: number | null;
};
export type StoryBiblePricingTier = { minChars: number; maxChars: number | null; credits: CreditAmount };
export type StoryBibleModelPricing = { modelConfigId: string; model: string; displayName: string; tiers: StoryBiblePricingTier[]; revision: number; quickConfiguration: StoryBibleQuickConfiguration | null };

/** 分集正文生成定价：一集一次调用，所以每集一个固定积分。 */
export type EpisodeBodiesModelPricing = { modelConfigId: string; model: string; displayName: string; credits: CreditAmount; revision: number };
