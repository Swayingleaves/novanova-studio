import type { EpisodeDetail, EpisodeSummary, ProductionReadiness, ScriptCharacter, ScriptLocation, ScriptProjectDetail, ScriptScene } from "@/features/script/types";

/** 漫剧生产阶段。 */
export type ComicDramaStage = "readiness" | "settings" | "assets" | "shots" | "storyboard" | "media" | "sound" | "canvas" | "updates";
/** 漫剧项目类型。 */
export type ComicDramaProjectType = "comicDrama" | "liveActionShort" | "animation" | "advertisement" | "musicVideo" | "storyShort";
/** 视觉资产类型。 */
export type ComicDramaAssetType = "character" | "scene" | "prop";
/** 漫剧设置，字段与后端 ProductionSettings 对齐。 */
export type ComicDramaSettings = { projectType: ComicDramaProjectType; targetEpisodeCount: number; episodeTargetDuration: number; overallDuration: number; orientation: "landscape" | "portrait" | "square"; aspectRatio: string; visualStyle: string; eraAtmosphere: string; targetPlatform: string; useCase: string };
/** 视觉资产。 */
export type ComicDramaAsset = { id: string; assetType: ComicDramaAssetType; sourceEntityId?: string | null; name: string; description: string; voicePreference: Record<string, unknown>; usageStatus: "active" | "archived" | "needsUpdate"; revision: number; createdAt?: string; updatedAt?: string };
/** 保存视觉资产所需字段。 */
export type ComicDramaAssetInput = Omit<ComicDramaAsset, "createdAt" | "updatedAt">;
/** 视觉资产版本。 */
export type ComicDramaAssetVersion = { id: string; assetId: string; versionName: string; variantType: string; appearanceDescription: string; referenceMedia: Array<Record<string, unknown>>; attributes: Record<string, unknown>; status: "draft" | "active" | "archived" | "needsUpdate"; revision: number; createdAt?: string; updatedAt?: string };
/** 保存视觉资产版本所需字段。 */
export type ComicDramaAssetVersionInput = Omit<ComicDramaAssetVersion, "createdAt" | "updatedAt">;
/** 正式镜头。 */
export type ComicDramaShot = { id: string; sourceEpisodeId?: string | null; sourceSceneId?: string | null; sourceScriptExcerpt: string; shotNumber: number; sortOrder: number; durationSeconds: number; shotSize: string; composition: string; visualDescription: string; actionDescription: string; cameraMovement: string; lightingAtmosphere: string; dialogueVoiceover: string; soundDescription: string; styleOverride: string; productionStatus: "draft" | "ready" | "generating" | "completed" | "failed" | "needsUpdate"; assetVersionIds: string[]; revision: number; createdAt?: string; updatedAt?: string };
/** 保存正式镜头所需字段。 */
export type ComicDramaShotInput = Omit<ComicDramaShot, "createdAt" | "updatedAt">;
/** 镜头拆分草稿。 */
export type ComicDramaShotDraft = { id: string; projectId: string; scopeType: string; scopeId?: string | null; baseProjectRevision: number; baseScriptRevision: number; instruction: string; model: string; draftData: Record<string, unknown>; chargedCredits: number; status: "pending" | "confirmed" | "discarded"; createdAt?: string; confirmedAt?: string | null };
/** 提示词版本。 */
export type ComicDramaPromptVersion = { id: string; shotId: string; versionNumber: number; sourceType: "ai" | "manual"; prompt: string; sourceSnapshot: Record<string, unknown>; model: string; chargedCredits: number; status: "draft" | "adopted" | "superseded" | "needsUpdate"; createdAt?: string };
/** 媒体结果。 */
export type ComicDramaMediaResult = { id: string; targetType: string; targetId: string; mediaType: "image" | "video" | "audio" | "composite"; taskId?: string | null; inputSnapshot: Record<string, unknown>; resultData: Record<string, unknown>; status: "quoted" | "queued" | "processing" | "completed" | "failed" | "needsUpdate"; adopted: boolean; failureReason?: string | null; createdAt?: string; updatedAt?: string };
/** 上游变化影响。 */
export type ComicDramaChangeImpact = { id: string; sourceType: string; sourceId?: string | null; targetType: string; targetId: string; changeSummary: string; impactSnapshot: Record<string, unknown>; status: "pending" | "accepted" | "keptOld"; createdAt?: string; resolvedAt?: string | null };
/** 结构化声音条目。 */
export type ComicDramaVoiceTrack = { id: string; shotId?: string | null; sourceBlockId?: string | null; characterId?: string | null; trackType: "dialogue" | "narration" | "ambient" | "soundEffect" | "music"; content: string; voiceModel: string; speechRate: number; tone: string; emotion: string; status: "draft" | "ready" | "generating" | "completed" | "failed" | "needsUpdate"; revision: number; createdAt?: string; updatedAt?: string };
/** 保存结构化声音轨所需字段。 */
export type ComicDramaVoiceTrackInput = Omit<ComicDramaVoiceTrack, "createdAt" | "updatedAt">;
/** 批量任务。 */
export type ComicDramaBatchTask = { id: string; batchType: string; scopeType: string; scope: Record<string, unknown>; modelSettings: Record<string, unknown>; estimatedCredits: number; totalCount: number; queuedCount: number; processingCount: number; completedCount: number; failedCount: number; needsUpdateCount: number; status: string; confirmedAt?: string | null; createdAt?: string; updatedAt?: string };
/** 画布绑定。 */
export type ComicDramaCanvasBinding = { id: string; entityType: string; entityId: string; canvasProjectId: string; nodeId: string; bindingData: Record<string, unknown>; createdAt?: string; updatedAt?: string };
/** 连续性问题。 */
export type ComicDramaContinuityIssue = { type: string; severity: string; previousShotId?: string | null; shotId: string; title: string; description: string; suggestion: string };
/** 漫剧工作区聚合数据。 */
export type ComicDramaWorkspace = { projectId: string; scriptProjectId: string; scriptProject: ScriptProjectDetail; settings: ComicDramaSettings; revision: number; completionRate: number; productionProgress: { assetCount: number; readyAssetCount: number; shotCount: number; completedShotCount: number; pendingUpdateCount: number; runningTaskCount: number }; readiness: ProductionReadiness; assets: ComicDramaAsset[]; shots: ComicDramaShot[]; shotDrafts: ComicDramaShotDraft[]; promptVersions: ComicDramaPromptVersion[]; media: ComicDramaMediaResult[]; impacts: ComicDramaChangeImpact[]; voiceTracks: ComicDramaVoiceTrack[]; batchTasks: ComicDramaBatchTask[]; canvasBindings: ComicDramaCanvasBinding[]; continuityIssues: ComicDramaContinuityIssue[] };
/** 项目库摘要。 */
export type ComicDramaProjectSummary = { projectId: string; scriptProjectId: string; title: string; projectType: ComicDramaProjectType; stage: string; completionRate: number; assetCount: number; shotCount: number; completedShotCount: number; pendingUpdateCount: number; runningTaskCount: number; readiness: "ready" | "attention" | "missing"; revision: number; updatedAt: string };
export type ComicDramaProjectList = { projects: ComicDramaProjectSummary[]; total: number; page: number; pageSize: number };
/** 项目级写操作的最新修订信息。 */
export type ComicDramaMutationResult = { projectId: string; revision: number; updatedAt: string };
/** 共享剧本来源类型。 */
export type ComicDramaScriptSource = { episodes: EpisodeSummary[]; characters: ScriptCharacter[]; locations: ScriptLocation[]; episodeDetails: Record<string, EpisodeDetail>; scenes: ScriptScene[] };
