"use client";

import { serverGet, serverPost, serverUpload } from "./server";
import type {
    AnalysisReport,
    CharacterRelation,
    EpisodeBodiesJob,
    EpisodeBodiesMode,
    EpisodeBodiesQuote,
    EpisodeDetail,
    MutationResult,
    NovelAdaptationDraftSource,
    NovelAdaptationConsistencyIssue,
    NovelAdaptationImpact,
    NovelAdaptationSettings,
    OutlineSection,
    ProductionReadiness,
    ScriptAiDraft,
    ScriptCharacter,
    ScriptContentType,
    ScriptLocation,
    ScriptOverview,
    ScriptProjectDetail,
    ScriptProjectList,
    ScriptSourceFileEncoding,
    ScriptSourceImportStatus,
    EpisodeBodiesModelPricing,
    ScriptSourceSectionDetail,
    ScriptSourceTree,
    ScriptSourceType,
    ScriptSourceUploadResult,
    StoryBibleItemDetail,
    StoryBibleItemPage,
    StoryBibleItemStatus,
    StoryBibleItemType,
    StoryBibleJob,
    StoryBibleModelPricing,
    StoryBiblePricingTier,
    StoryBibleQuickConfiguration,
    StoryBibleQuote,
    StoryBibleSaveItemInput,
    ScriptTemplate,
    ScriptVersionDetail,
    ScriptVersionSummary,
    StoryEvent,
    WholeBookAdaptationJob,
    WholeBookAdaptationOptions,
    WholeBookAdaptationQuote,
    WorldItem,
    WorldSetting,
} from "@/features/script/types";

const SCRIPT_PATH = "/script";

const NOVEL_ADAPTATION_PATH = `${SCRIPT_PATH}/novelAdaptation`;

const WHOLE_BOOK_ADAPTATION_PATH = `${SCRIPT_PATH}/wholeBookAdaptation`;

const EPISODE_BODIES_PATH = `${SCRIPT_PATH}/episodeBodies`;

/** 全书改编输入：集数不在启动参数里，必须在策略停点确认。 */
type WholeBookAdaptationInput = { projectId: string; expectedRevision: number; model: string; options: WholeBookAdaptationOptions };

export function quoteWholeBookAdaptation(input: WholeBookAdaptationInput) {
    return serverPost<WholeBookAdaptationQuote>(`${WHOLE_BOOK_ADAPTATION_PATH}/quote`, input);
}

export function startWholeBookAdaptation(input: WholeBookAdaptationInput & { clientRequestId: string; expectedCredits: number; expectedFingerprint: string }) {
    return serverPost<WholeBookAdaptationJob>(`${WHOLE_BOOK_ADAPTATION_PATH}/start`, input);
}

export function wholeBookAdaptationStatus(projectId: string, jobId: string) {
    return serverPost<WholeBookAdaptationJob>(`${WHOLE_BOOK_ADAPTATION_PATH}/status`, { projectId, jobId });
}

export function listActiveWholeBookAdaptation(projectId: string) {
    return serverPost<WholeBookAdaptationJob[]>(`${WHOLE_BOOK_ADAPTATION_PATH}/active`, { projectId });
}

/** 策略停点确认最终集数，服务端据此固定全部分集的标识与集号。 */
export function advanceWholeBookAdaptation(input: { projectId: string; jobId: string; expectedRevision: number; expectedRetryCount: number; episodeCount: number }) {
    return serverPost<WholeBookAdaptationJob>(`${WHOLE_BOOK_ADAPTATION_PATH}/advance`, input);
}

/** 统一规划停点应用待审草稿，替换概览、大纲、设定与分集。 */
export function confirmWholeBookAdaptation(projectId: string, jobId: string) {
    return serverPost<WholeBookAdaptationJob>(`${WHOLE_BOOK_ADAPTATION_PATH}/confirm`, { projectId, jobId });
}

/** 从失败处继续，成功单元保留，只重跑未完成单元。 */
export function retryWholeBookAdaptation(projectId: string, jobId: string) {
    return serverPost<WholeBookAdaptationJob>(`${WHOLE_BOOK_ADAPTATION_PATH}/retry`, { projectId, jobId });
}

export function cancelWholeBookAdaptation(projectId: string, jobId: string) {
    return serverPost<WholeBookAdaptationJob>(`${WHOLE_BOOK_ADAPTATION_PATH}/cancel`, { projectId, jobId });
}

// ---- 逐集正文批量生成：分集身份由全书改编固定，这里只按已固定的分集生成场次与正文 ----

/** 批量生成输入：分集范围、文本模型与生成模式，报价与启动必须完全一致。 */
type EpisodeBodiesInput = { projectId: string; expectedRevision: number; model: string; mode: EpisodeBodiesMode; episodeIds: string[] };

/** 所选文本模型的每集积分，尚未在后台定价时 unitPrice 为空。 */
export function episodeBodiesUnitPrice(model: string) {
    return serverPost<{ unitPrice: number | null }>(`${EPISODE_BODIES_PATH}/unitPrice`, { model });
}

export function quoteEpisodeBodies(input: EpisodeBodiesInput) {
    return serverPost<EpisodeBodiesQuote>(`${EPISODE_BODIES_PATH}/quote`, input);
}

export function startEpisodeBodies(input: EpisodeBodiesInput & { clientRequestId: string; expectedCredits: number; expectedFingerprint: string }) {
    return serverPost<EpisodeBodiesJob>(`${EPISODE_BODIES_PATH}/start`, input);
}

export function episodeBodiesStatus(projectId: string, jobId: string) {
    return serverPost<EpisodeBodiesJob>(`${EPISODE_BODIES_PATH}/status`, { projectId, jobId });
}

/** 项目最近一次正文批量任务，刷新后恢复进度；项目还没有任务时服务端返回空响应体。 */
export function latestEpisodeBodies(projectId: string) {
    return serverPost<EpisodeBodiesJob | undefined>(`${EPISODE_BODIES_PATH}/latest`, { projectId }, { allowEmpty: true });
}

/** 从失败或取消处继续，已完成分集保留，只重做未完成分集且不重复扣费。 */
export function retryEpisodeBodies(projectId: string, jobId: string) {
    return serverPost<EpisodeBodiesJob>(`${EPISODE_BODIES_PATH}/retry`, { projectId, jobId });
}

export function cancelEpisodeBodies(projectId: string, jobId: string) {
    return serverPost<EpisodeBodiesJob>(`${EPISODE_BODIES_PATH}/cancel`, { projectId, jobId });
}

export function listNovelAdaptationDraftSources(projectId: string) {
    return serverPost<NovelAdaptationDraftSource[]>(`${NOVEL_ADAPTATION_PATH}/listDraftSources`, { projectId });
}

export function listNovelAdaptationImpacts(projectId: string) {
    return serverPost<NovelAdaptationImpact[]>(`${NOVEL_ADAPTATION_PATH}/listSourceImpacts`, { projectId });
}

export function checkNovelAdaptationConsistency(projectId: string) {
    return serverPost<NovelAdaptationConsistencyIssue[]>(`${NOVEL_ADAPTATION_PATH}/checkConsistency`, { projectId });
}

export function analyzeNovelAdaptationConsistency(input: { projectId: string; expectedRevision: number; factIds: string[]; model: string }) {
    return serverPost<AnalysisReport>(`${NOVEL_ADAPTATION_PATH}/analyzeConsistency`, input);
}

export function listScriptProjects(params: { page: number; pageSize: number; keyword?: string; stage?: string; contentType?: string }) {
    const query = new URLSearchParams({ page: String(params.page), pageSize: String(params.pageSize) });
    if (params.keyword) query.set("keyword", params.keyword);
    if (params.stage) query.set("stage", params.stage);
    if (params.contentType) query.set("contentType", params.contentType);
    return serverGet<ScriptProjectList>(`${SCRIPT_PATH}/listProjects?${query}`);
}

export function listScriptTemplates() {
    return serverGet<ScriptTemplate[]>(`${SCRIPT_PATH}/listTemplates`);
}

export function createScriptProject(input: { title: string; templateKey?: string; contentType: string; logline?: string }) {
    return serverPost<ScriptProjectDetail>(`${SCRIPT_PATH}/createProject`, input);
}

export function getScriptProject(projectId: string) {
    return serverPost<ScriptProjectDetail>(`${SCRIPT_PATH}/getProject`, { projectId });
}

export function deleteScriptProjects(projects: Array<{ projectId: string; expectedRevision: number }>) {
    return serverPost<Array<{ projectId: string; revision: number; updatedAt: string }>>(`${SCRIPT_PATH}/deleteProjects`, { projects });
}

export function saveScriptOverview(projectId: string, expectedRevision: number, overview: ScriptOverview) {
    return serverPost<MutationResult>(`${SCRIPT_PATH}/saveOverview`, { projectId, expectedRevision, overview });
}

export function saveScriptOutline(projectId: string, expectedRevision: number, sections: OutlineSection[], events: StoryEvent[]) {
    return serverPost<MutationResult>(`${SCRIPT_PATH}/saveOutline`, { projectId, expectedRevision, sections, events });
}

export function saveScriptCharacters(projectId: string, expectedRevision: number, characters: ScriptCharacter[], relations: CharacterRelation[]) {
    return serverPost<MutationResult>(`${SCRIPT_PATH}/saveCharacters`, { projectId, expectedRevision, characters, relations });
}

export function saveScriptWorld(projectId: string, expectedRevision: number, worldSetting: WorldSetting, worldItems: WorldItem[], locations: ScriptLocation[]) {
    return serverPost<MutationResult>(`${SCRIPT_PATH}/saveWorld`, { projectId, expectedRevision, worldSetting, worldItems, locations });
}

export function getScriptEpisode(projectId: string, episodeId: string) {
    return serverPost<EpisodeDetail>(`${SCRIPT_PATH}/getEpisode`, { projectId, episodeId });
}

export function saveScriptEpisode(projectId: string, expectedRevision: number, episodeDetail: EpisodeDetail) {
    return serverPost<MutationResult>(`${SCRIPT_PATH}/saveEpisode`, { projectId, expectedRevision, episodeDetail });
}

export function reorderScriptEpisodes(projectId: string, expectedRevision: number, episodeIds: string[]) {
    return serverPost<MutationResult>(`${SCRIPT_PATH}/reorderEpisodes`, { projectId, expectedRevision, episodeIds });
}

export function deleteScriptEpisode(projectId: string, expectedRevision: number, episodeId: string) {
    return serverPost<MutationResult>(`${SCRIPT_PATH}/deleteEpisode`, { projectId, expectedRevision, episodeId });
}

export function generateScriptDraft(input: { projectId: string; expectedRevision: number; actionType: string; targetType: string; targetId?: string; instruction?: string; model: string }) {
    return serverPost<ScriptAiDraft>(`${SCRIPT_PATH}/generateDraft`, input);
}

export function listScriptAiDrafts(projectId: string) {
    return serverGet<ScriptAiDraft[]>(`${SCRIPT_PATH}/listAiDrafts?projectId=${encodeURIComponent(projectId)}`);
}

export function applyScriptAiDraft(input: { projectId: string; expectedRevision: number; draftId: string; draftData: Record<string, unknown>; selectedTargetIds?: string[] }) {
    return serverPost<MutationResult>(`${SCRIPT_PATH}/applyAiDraft`, input);
}

export function discardScriptAiDraft(projectId: string, expectedRevision: number, draftId: string) {
    return serverPost<MutationResult>(`${SCRIPT_PATH}/discardAiDraft`, { projectId, expectedRevision, draftId });
}

export function listScriptVersions(projectId: string) {
    return serverGet<ScriptVersionSummary[]>(`${SCRIPT_PATH}/listVersions?projectId=${encodeURIComponent(projectId)}`);
}

export function createScriptVersion(projectId: string, expectedRevision: number, versionName: string, changeSummary?: string) {
    return serverPost<ScriptVersionSummary>(`${SCRIPT_PATH}/createVersion`, { projectId, expectedRevision, versionName, changeSummary });
}

export function getScriptVersion(projectId: string, versionId: string) {
    return serverPost<ScriptVersionDetail>(`${SCRIPT_PATH}/getVersion`, { projectId, versionId });
}

export function restoreScriptVersion(projectId: string, expectedRevision: number, versionId: string) {
    return serverPost<MutationResult>(`${SCRIPT_PATH}/restoreVersion`, { projectId, expectedRevision, versionId });
}

export function getScriptProductionReadiness(projectId: string) {
    return serverPost<ProductionReadiness>(`${SCRIPT_PATH}/getProductionReadiness`, { projectId });
}

export function enterComicDrama(projectId: string, expectedRevision: number) {
    return serverPost<MutationResult>(`${SCRIPT_PATH}/enterComicDrama`, { projectId, expectedRevision });
}

// ---- 原文导入与人工校对 ----

const SOURCE_PATH = `${SCRIPT_PATH}/source`;

export function uploadScriptSource(input: { file: File; sourceType: ScriptSourceType; contentType: ScriptContentType; title: string; encoding?: ScriptSourceFileEncoding; clientRequestId: string }) {
    const formData = new FormData();
    formData.set("file", input.file, input.file.name);
    formData.set("sourceType", input.sourceType);
    formData.set("contentType", input.contentType);
    formData.set("title", input.title);
    if (input.encoding) formData.set("encoding", input.encoding);
    formData.set("clientRequestId", input.clientRequestId);
    return serverUpload<ScriptSourceUploadResult>(`${SOURCE_PATH}/uploadSource`, formData);
}

export function getScriptSourceImportStatus(projectId: string) {
    return serverPost<ScriptSourceImportStatus>(`${SOURCE_PATH}/getImportStatus`, { projectId });
}

export function retryScriptSourceImport(projectId: string, encoding?: ScriptSourceFileEncoding) {
    return serverPost<ScriptSourceImportStatus>(`${SOURCE_PATH}/retryImport`, { projectId, encoding });
}

export function getScriptSourceTree(projectId: string) {
    return serverPost<ScriptSourceTree>(`${SOURCE_PATH}/getSourceTree`, { projectId });
}

export function getScriptSourceSection(projectId: string, sectionId: string) {
    return serverPost<ScriptSourceSectionDetail>(`${SOURCE_PATH}/getSourceSection`, { projectId, sectionId });
}

export function renameScriptSourceSection(projectId: string, sectionId: string, expectedRevision: number, title: string) {
    return serverPost<MutationResult>(`${SOURCE_PATH}/renameSection`, { projectId, sectionId, expectedRevision, title });
}

export function splitScriptSourceSection(projectId: string, sectionId: string, expectedRevision: number, splitOffset: number, title: string) {
    return serverPost<MutationResult>(`${SOURCE_PATH}/splitSection`, { projectId, sectionId, expectedRevision, splitOffset, title });
}

export function confirmScriptSourceStructure(projectId: string, expectedRevision: number) {
    return serverPost<ScriptSourceImportStatus>(`${SOURCE_PATH}/confirmStructure`, { projectId, expectedRevision });
}

export function mergeScriptSourceSections(projectId: string, firstSectionId: string, secondSectionId: string, expectedRevision: number) {
    return serverPost<MutationResult>(`${SOURCE_PATH}/mergeSections`, { projectId, firstSectionId, secondSectionId, expectedRevision });
}

const STORY_BIBLE_PATH = `${SCRIPT_PATH}/storyBible`;

export function quoteStoryBibleAnalysis(projectId: string, model: string, sectionIds: string[]) {
    return serverPost<StoryBibleQuote>(`${STORY_BIBLE_PATH}/quoteAnalysis`, { projectId, model, sectionIds });
}

export function startStoryBibleAnalysis(input: { projectId: string; model: string; sectionIds: string[]; clientRequestId: string; expectedCredits: number; expectedSourceRevision: number; expectedPricingRevision: number }) {
    return serverPost<StoryBibleJob>(`${STORY_BIBLE_PATH}/startAnalysis`, input);
}

export function getStoryBibleAnalysisStatus(projectId: string, jobId?: string) {
    return serverPost<StoryBibleJob | null>(`${STORY_BIBLE_PATH}/getAnalysisStatus`, { projectId, jobId });
}

export function retryStoryBibleAnalysis(projectId: string, jobId: string) {
    return serverPost<StoryBibleJob>(`${STORY_BIBLE_PATH}/retryAnalysis`, { projectId, jobId });
}

export function cancelStoryBibleAnalysis(projectId: string, jobId: string) {
    return serverPost<StoryBibleJob>(`${STORY_BIBLE_PATH}/cancelAnalysis`, { projectId, jobId });
}

export function listStoryBibleItems(input: { projectId: string; itemType?: StoryBibleItemType; status?: StoryBibleItemStatus; keyword?: string; order?: "narrative" | "story"; page: number; pageSize: number }) {
    return serverPost<StoryBibleItemPage>(`${STORY_BIBLE_PATH}/listItems`, input);
}

export function getStoryBibleItem(projectId: string, itemId: string) {
    return serverPost<StoryBibleItemDetail>(`${STORY_BIBLE_PATH}/getItem`, { projectId, itemId });
}

export function saveStoryBibleItem(input: StoryBibleSaveItemInput) {
    return serverPost<StoryBibleItemDetail>(`${STORY_BIBLE_PATH}/saveItem`, input);
}

export function confirmStoryBibleItem(projectId: string, itemId: string, expectedRevision: number) {
    return serverPost<StoryBibleItemDetail>(`${STORY_BIBLE_PATH}/confirmItem`, { projectId, itemId, expectedRevision });
}

export function confirmStoryBibleItems(projectId: string, items: Array<{ itemId: string; expectedRevision: number }>) {
    return serverPost<{ confirmedItemIds: string[]; confirmedCount: number }>(`${STORY_BIBLE_PATH}/confirmItems`, { projectId, items });
}

/** 全量确认某个条目类型下的所有待确认内容，不受分页与筛选影响。 */
export function confirmAllStoryBibleItems(projectId: string, itemType: StoryBibleItemType) {
    return serverPost<{ confirmedItemIds: string[]; confirmedCount: number }>(`${STORY_BIBLE_PATH}/confirmAllItems`, { projectId, itemType });
}

export function rejectStoryBibleItem(projectId: string, itemId: string, expectedRevision: number) {
    return serverPost<StoryBibleItemDetail>(`${STORY_BIBLE_PATH}/rejectItem`, { projectId, itemId, expectedRevision });
}

export function mergeStoryBibleEntities(input: { projectId: string; targetItemId: string; targetRevision: number; sourceItemId: string; sourceRevision: number }) {
    return serverPost<StoryBibleItemDetail>(`${STORY_BIBLE_PATH}/mergeEntities`, input);
}

export function splitStoryBibleEntity(input: { projectId: string; itemId: string; expectedRevision: number; name: string; aliasIds: string[]; evidenceIds: string[] }) {
    return serverPost<StoryBibleItemDetail>(`${STORY_BIBLE_PATH}/splitEntity`, input);
}

export function getStoryBiblePricing() {
    return serverGet<StoryBibleModelPricing[]>("/admin/storyBible/getPricing");
}

export function saveStoryBiblePricing(modelConfigId: string, expectedRevision: number, tiers: StoryBiblePricingTier[], quickConfiguration: StoryBibleQuickConfiguration | null) {
    return serverPost<StoryBibleModelPricing>("/admin/storyBible/savePricing", { modelConfigId, expectedRevision, tiers, quickConfiguration });
}

export function getEpisodeBodiesPricing() {
    return serverGet<EpisodeBodiesModelPricing[]>("/admin/episodeBodies/getPricing");
}

export function saveEpisodeBodiesPricing(modelConfigId: string, expectedRevision: number, credits: number) {
    return serverPost<EpisodeBodiesModelPricing>("/admin/episodeBodies/savePricing", { modelConfigId, expectedRevision, credits });
}
