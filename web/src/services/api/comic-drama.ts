import type { CreditAmount } from "@/shared/lib/credit-amounts";
import { serverGet, serverPost, type ServerAiTask } from "./server";
import type { VideoCompositionTask } from "./video-composition";
import type {
    ComicDramaAsset,
    ComicDramaAssetInput,
    ComicDramaAssetVersion,
    ComicDramaAssetVersionInput,
    ComicDramaBatchTask,
    ComicDramaCanvasBinding,
    ComicDramaChangeImpact,
    ComicDramaMediaResult,
    ComicDramaMutationResult,
    ComicDramaProjectList,
    ComicDramaSettings,
    ComicDramaShot,
    ComicDramaShotInput,
    ComicDramaShotDraft,
    ComicDramaVoiceTrack,
    ComicDramaVoiceTrackInput,
    ComicDramaTimelineText,
    ComicDramaTimelineTextInput,
    ComicDramaPromptVersion,
    ComicDramaWorkspace,
} from "@/features/comic-drama/types";

const COMIC_DRAMA_PATH = "/comicDrama";

/** 创建分镜板视频导出任务。 */
export function exportComicDramaVideo(projectId: string, episodeId: string | null) {
    return serverPost<VideoCompositionTask>(`${COMIC_DRAMA_PATH}/exportVideo`, { projectId, episodeId });
}

/** 查询项目最近一次视频导出任务。 */
export function getLatestComicDramaVideoExport(projectId: string) {
    return serverPost<{ task: VideoCompositionTask | null }>(`${COMIC_DRAMA_PATH}/getLatestExportVideoTask`, { projectId });
}

export function listComicDramaProjects(params: { page: number; pageSize: number; keyword?: string }) {
    const query = new URLSearchParams({ page: String(params.page), pageSize: String(params.pageSize) });
    if (params.keyword?.trim()) query.set("keyword", params.keyword.trim());
    return serverGet<ComicDramaProjectList>(`${COMIC_DRAMA_PATH}/listProjects?${query}`);
}

export function getComicDramaWorkspace(projectId: string) {
    return serverPost<ComicDramaWorkspace>(`${COMIC_DRAMA_PATH}/getWorkspace`, { projectId });
}

export function initializeComicDramaProject(input: { scriptProjectId: string; projectType?: string }) {
    return serverPost<ComicDramaWorkspace>(`${COMIC_DRAMA_PATH}/initializeProject`, input);
}

export function updateComicDramaSettings(projectId: string, expectedRevision: number, settings: ComicDramaSettings) {
    return serverPost<ComicDramaMutationResult>(`${COMIC_DRAMA_PATH}/updateSettings`, { projectId, expectedRevision, settings });
}

export function listComicDramaAssets(projectId: string, assetType?: string) {
    return serverPost<ComicDramaAsset[]>(`${COMIC_DRAMA_PATH}/listAssets`, { projectId, assetType });
}

export function saveComicDramaAsset(projectId: string, expectedRevision: number, asset: ComicDramaAssetInput) {
    return serverPost<ComicDramaAsset>(`${COMIC_DRAMA_PATH}/saveAsset`, { projectId, expectedRevision, asset });
}

export function listComicDramaAssetVersions(projectId: string, assetId: string) {
    return serverPost<ComicDramaAssetVersion[]>(`${COMIC_DRAMA_PATH}/listAssetVersions`, { projectId, assetId });
}

export function listComicDramaAssetVersionsByIds(projectId: string, versionIds: string[]) {
    if (versionIds.length === 0) return Promise.resolve([] as ComicDramaAssetVersion[]);
    return serverPost<ComicDramaAssetVersion[]>(`${COMIC_DRAMA_PATH}/listAssetVersionsByIds`, { projectId, versionIds });
}

export function saveComicDramaAssetVersion(projectId: string, expectedRevision: number, version: ComicDramaAssetVersionInput) {
    return serverPost<ComicDramaAssetVersion>(`${COMIC_DRAMA_PATH}/saveAssetVersion`, { projectId, expectedRevision, version });
}

export function getComicDramaReadiness(projectId: string) {
    return serverPost<ComicDramaWorkspace["readiness"]>(`${COMIC_DRAMA_PATH}/getReadiness`, { projectId });
}

export function generateComicDramaShotDraft(input: { projectId: string; episodeId?: string; sceneId?: string; shotCount?: number; rhythm: string; focus: string; model: string; confirmed: true }) {
    return serverPost<ComicDramaShotDraft>(`${COMIC_DRAMA_PATH}/generateShotDraft`, input);
}

export function confirmComicDramaShotDraft(projectId: string, expectedRevision: number, draftId: string) {
    return serverPost<ComicDramaMutationResult>(`${COMIC_DRAMA_PATH}/confirmShotDraft`, { projectId, expectedRevision, draftId });
}

export function updateComicDramaShotDraft(projectId: string, expectedRevision: number, draftId: string, draftData: Record<string, unknown>) {
    return serverPost<ComicDramaShotDraft>(`${COMIC_DRAMA_PATH}/updateShotDraft`, { projectId, expectedRevision, draftId, draftData });
}

export function discardComicDramaShotDraft(projectId: string, expectedRevision: number, draftId: string) {
    return serverPost<ComicDramaMutationResult>(`${COMIC_DRAMA_PATH}/discardShotDraft`, { projectId, expectedRevision, draftId });
}

export function listComicDramaShots(projectId: string, episodeId?: string, sceneId?: string) {
    return serverPost<ComicDramaShot[]>(`${COMIC_DRAMA_PATH}/listShots`, { projectId, episodeId, sceneId });
}

export function saveComicDramaShot(projectId: string, expectedRevision: number, shot: ComicDramaShotInput) {
    return serverPost<ComicDramaShot>(`${COMIC_DRAMA_PATH}/saveShot`, { projectId, expectedRevision, shot });
}

export function reorderComicDramaShots(projectId: string, expectedRevision: number, shotIds: string[]) {
    return serverPost<{ revision: number }>(`${COMIC_DRAMA_PATH}/reorderShots`, { projectId, expectedRevision, shotIds });
}

export function deleteComicDramaShot(projectId: string, expectedRevision: number, shotId: string, confirm = false) {
    return serverPost<ComicDramaMutationResult>(`${COMIC_DRAMA_PATH}/deleteShot`, { projectId, expectedRevision, shotId, confirm });
}

export function getComicDramaShotDeleteImpact(projectId: string, shotId: string) {
    return serverPost<{ shotId: string; affectedMediaCount: number; mediaIds: string[]; requiresConfirmation: boolean }>(`${COMIC_DRAMA_PATH}/getShotDeleteImpact`, { projectId, shotId });
}

export function composeComicDramaPrompt(projectId: string, shotId: string, model: string, expectedPricingRevision: number, confirmed: true) {
    return serverPost<ComicDramaPromptVersion>(`${COMIC_DRAMA_PATH}/composePrompt`, { projectId, shotId, model, expectedPricingRevision, confirmed });
}

export type ComicDramaComposePromptsResult = {
    succeededShotIds: string[];
    failedShotIds: string[];
    failureMessage: string;
    chargedCredits: CreditAmount;
};

/** 批量合成并采用多个镜头的最终提示词，服务端并发请求模型。 */
export function composeComicDramaPrompts(input: { projectId: string; expectedRevision: number; shotIds: string[]; model: string; expectedPricingRevision: number; confirmed: true }) {
    return serverPost<ComicDramaComposePromptsResult>(`${COMIC_DRAMA_PATH}/composePrompts`, input);
}

/** 漫剧最终提示词专项价格，未配置时积分为空。 */
export type ComicDramaFinalPromptPricing = {
    modelConfigId: string;
    model: string;
    displayName: string;
    credits?: CreditAmount | null;
    revision: number;
    editable: boolean;
};

export function getComicDramaFinalPromptPricing() {
    return serverGet<ComicDramaFinalPromptPricing[]>("/admin/comicDramaFinalPrompt/getPricing");
}

export function saveComicDramaFinalPromptPricing(modelConfigId: string, expectedRevision: number, credits: CreditAmount) {
    return serverPost<ComicDramaFinalPromptPricing>("/admin/comicDramaFinalPrompt/savePricing", { modelConfigId, expectedRevision, credits });
}

export function getComicDramaFinalPromptUnitPrice(model: string) {
    return serverPost<{ unitPrice?: CreditAmount | null; revision: number }>(`${COMIC_DRAMA_PATH}/getFinalPromptUnitPrice`, { model });
}

export function saveComicDramaPrompt(projectId: string, expectedRevision: number, shotId: string, prompt: string, expectedPromptVersion?: number, sourcePromptVersionId?: string) {
    return serverPost<ComicDramaPromptVersion>(`${COMIC_DRAMA_PATH}/savePrompt`, { projectId, expectedRevision, shotId, prompt, expectedPromptVersion, sourcePromptVersionId });
}

export type ComicDramaGenerationEstimate = { targetType: string; taskCount: number; estimatedCredits: CreditAmount; model: string; settings: Record<string, unknown> };

export function estimateComicDramaGeneration(input: { projectId: string; targetType: string; targetIds: string[]; model: string; settings: Record<string, unknown> }) {
    return serverPost<ComicDramaGenerationEstimate>(`${COMIC_DRAMA_PATH}/estimateGeneration`, input);
}

export function createComicDramaGenerationTask(input: { projectId: string; expectedRevision: number; targetType: string; targetIds: string[]; model: string; settings: Record<string, unknown>; confirmed: true }) {
    return serverPost<{ mediaResults: ComicDramaMediaResult[]; taskCount: number }>(`${COMIC_DRAMA_PATH}/createGenerationTask`, input);
}

export function listComicDramaMedia(projectId: string, filters: { shotId?: string; assetId?: string } = {}) {
    return serverPost<ComicDramaMediaResult[]>(`${COMIC_DRAMA_PATH}/listMedia`, { projectId, ...filters });
}

export function adoptComicDramaMedia(projectId: string, expectedRevision: number, mediaId: string) {
    return serverPost<ComicDramaMutationResult>(`${COMIC_DRAMA_PATH}/adoptMedia`, { projectId, expectedRevision, mediaId });
}

export function listComicDramaImpacts(projectId: string) {
    return serverGet<ComicDramaChangeImpact[]>(`${COMIC_DRAMA_PATH}/listImpacts?projectId=${encodeURIComponent(projectId)}`);
}

/** 确认处理上游变化；sourceType/sourceId 用于只关掉某一次上游变更产生的影响项。 */
export function confirmComicDramaUpdate(projectId: string, expectedRevision: number, scope: string, targetId: string | null, resolution: "keepOld" | "update", confirmed: boolean, source?: { sourceType: string; sourceId: string }) {
    return serverPost<ComicDramaMutationResult>(`${COMIC_DRAMA_PATH}/confirmUpdate`, { projectId, expectedRevision, scope, targetId, resolution, confirmed, sourceType: source?.sourceType ?? null, sourceId: source?.sourceId ?? null });
}

export function listComicDramaVoiceTracks(projectId: string, shotId?: string) {
    return serverPost<ComicDramaVoiceTrack[]>(`${COMIC_DRAMA_PATH}/listVoiceTracks`, { projectId, shotId });
}

export function saveComicDramaVoiceTrack(projectId: string, expectedRevision: number, voiceTrack: ComicDramaVoiceTrackInput) {
    return serverPost<ComicDramaVoiceTrack>(`${COMIC_DRAMA_PATH}/saveVoiceTrack`, { projectId, expectedRevision, voiceTrack });
}

export function listComicDramaTimelineTexts(projectId: string) {
    return serverPost<ComicDramaTimelineText[]>(`${COMIC_DRAMA_PATH}/listTimelineTexts`, { projectId });
}

export function saveComicDramaTimelineText(projectId: string, expectedRevision: number, timelineText: ComicDramaTimelineTextInput) {
    return serverPost<ComicDramaTimelineText>(`${COMIC_DRAMA_PATH}/saveTimelineText`, { projectId, expectedRevision, timelineText });
}

export function reorderComicDramaTimelineTexts(projectId: string, expectedRevision: number, timelineTexts: ComicDramaTimelineTextInput[]) {
    return serverPost<ComicDramaTimelineText[]>(`${COMIC_DRAMA_PATH}/reorderTimelineTexts`, { projectId, expectedRevision, timelineTexts });
}

export function deleteComicDramaTimelineText(projectId: string, expectedRevision: number, timelineTextId: string) {
    return serverPost<ComicDramaMutationResult>(`${COMIC_DRAMA_PATH}/deleteTimelineText`, { projectId, expectedRevision, timelineTextId });
}

export function deleteComicDramaTextTrack(projectId: string, expectedRevision: number, trackNumber: number) {
    return serverPost<ComicDramaMutationResult>(`${COMIC_DRAMA_PATH}/deleteTextTrack`, { projectId, expectedRevision, trackNumber });
}

export function listComicDramaBatchTasks(projectId: string) {
    return serverGet<ComicDramaBatchTask[]>(`${COMIC_DRAMA_PATH}/listBatchTasks?projectId=${encodeURIComponent(projectId)}`);
}

export function createComicDramaBatchTask(input: { projectId: string; expectedRevision: number; scope: string; targetIds: string[]; taskType: string; model: string; settings: Record<string, unknown>; confirmed: true }) {
    return serverPost<ComicDramaBatchTask>(`${COMIC_DRAMA_PATH}/createBatchTask`, input);
}

export function listComicDramaCanvasBindings(projectId: string) {
    return serverGet<ComicDramaCanvasBinding[]>(`${COMIC_DRAMA_PATH}/listCanvasBindings?projectId=${encodeURIComponent(projectId)}`);
}

export function bindComicDramaCanvas(input: { projectId: string; expectedRevision: number; canvasProjectId: string; entityType: string; entityId: string; nodeId: string }) {
    return serverPost<ComicDramaCanvasBinding>(`${COMIC_DRAMA_PATH}/bindCanvas`, input);
}

/** 读取漫剧媒体结果里的首个媒体地址：图片任务结果为 { items: [{ url }] }，视频任务结果为 { item: { url } }。 */
export function readComicDramaMediaUrl(resultData: Record<string, unknown>): string {
    const items = Array.isArray(resultData.items) ? (resultData.items as Record<string, unknown>[]) : [];
    const candidate = resultData.item && typeof resultData.item === "object"
        ? resultData.item as Record<string, unknown>
        : items[0];
    const url = candidate?.url;
    return typeof url === "string" ? url : "";
}

/** 将通用 AI 任务结果转成媒体来源，供工作台轮询完成后落库。 */
export function readComicDramaTaskMedia(task: ServerAiTask) {
    const result = task.resultData && typeof task.resultData === "object" ? task.resultData as Record<string, unknown> : {};
    const item = result.item && typeof result.item === "object" ? result.item as Record<string, unknown> : Array.isArray(result.items) && result.items[0] && typeof result.items[0] === "object" ? result.items[0] as Record<string, unknown> : {};
    return {
        source: typeof item.url === "string" ? item.url : "",
        storageKey: typeof item.storageKey === "string" ? item.storageKey : undefined,
        mimeType: typeof item.mimeType === "string" ? item.mimeType : undefined,
    };
}
