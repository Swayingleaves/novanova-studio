import type { CanvasStoryboardAsset, CanvasStoryboardAssetGenerationSettings, CanvasStoryboardAssetGenerationState, CanvasStoryboardAssetKind, CanvasStoryboardNode, CanvasStoryboardShot, CanvasStoryboardShotSize } from "../types";
import { isAgnesVideoConfig, readAgnesVideoReferenceImageIssue } from "@/features/generation/lib/agnes-video";
import { isVideoDurationSupported, readVideoDurationRange } from "@/features/generation/lib/video-duration";
import { availableVideoResolutions, quoteVideoGeneration, type VideoGenerationQuote } from "@/features/generation/lib/video-billing";
import type { ReferenceImage } from "@/features/generation/types/image";
import type { ReferenceVideo } from "@/features/generation/types/media";
import type { AiConfig, VideoGenerationMode, VideoResolution } from "@/features/settings/stores/use-config-store";

export const STORYBOARD_SHOT_SIZES: Array<{
    value: CanvasStoryboardShotSize;
    englishPrompt: string;
    frameRange: string;
    promptExample: string;
    usage: string;
}> = [
    { value: "大特写", englishPrompt: "Extreme Close Up (ECU)", frameRange: "局部细节（眼睛、嘴唇、手指、物体纹理）", promptExample: "extreme close-up of eyes, cinematic lighting", usage: "情绪、细节、悬念" },
    { value: "特写", englishPrompt: "Close Up (CU)", frameRange: "头部或关键物体占满画面", promptExample: "close-up portrait of a woman", usage: "表情、情感表达" },
    { value: "近景", englishPrompt: "Medium Close Up (MCU)", frameRange: "胸部以上（头加肩加部分身体）", promptExample: "medium close-up shot, upper body", usage: "对话、人物情绪" },
    { value: "头肩景", englishPrompt: "Head and Shoulders Shot", frameRange: "头部加肩膀", promptExample: "head and shoulders portrait shot", usage: "采访、角色介绍" },
    { value: "中景", englishPrompt: "Medium Shot (MS)", frameRange: "腰部以上", promptExample: "medium shot of a man standing", usage: "人物动作、交流" },
    { value: "中远景", englishPrompt: "Medium Long Shot (MLS) / Cowboy Shot", frameRange: "膝盖以上或大腿以上", promptExample: "medium long shot, full character movement", usage: "动作展示" },
    { value: "全景", englishPrompt: "Full Shot (FS) / Full Body Shot", frameRange: "人物完整身体", promptExample: "full body shot of a warrior", usage: "人物造型、动作" },
    { value: "远景", englishPrompt: "Long Shot (LS) / Wide Shot (WS)", frameRange: "人物较小，环境占主要部分", promptExample: "wide shot of a person in a forest", usage: "环境关系" },
    { value: "大远景", englishPrompt: "Extreme Long Shot (ELS)", frameRange: "人物很小，突出环境", promptExample: "extreme wide shot of mountains and tiny figure", usage: "史诗感、开场" },
    { value: "大全景", englishPrompt: "Extreme Wide Shot", frameRange: "最大范围空间", promptExample: "cinematic extreme wide landscape shot", usage: "世界观建立" },
];

export const STORYBOARD_ASSET_KIND_LABELS: Record<CanvasStoryboardAssetKind, string> = {
    character: "角色",
    scene: "场景",
    prop: "道具",
};

export function readStoryboardModelCost(modelCosts: Array<{ model: string; taskType: string; credits: number }>, model: string): number {
    return modelCosts.find((item) => item.taskType === "text" && item.model === model)?.credits ?? 0;
}

/** 计算当前勾选资产的一次性图片生成预估积分。 */
export function readStoryboardAssetImageCost(modelCosts: Array<{ model: string; taskType: string; credits: number }>, model: string, selectedCount: number): number {
    const unitCost = modelCosts.find((item) => item.taskType === "image" && item.model === model)?.credits ?? 0;
    return Math.max(0, Math.floor(selectedCount)) * Math.max(0, unitCost);
}

/** 分镜批量视频报价结果。 */
export type StoryboardVideoBatchQuote = { available: true; credits: number } | { available: false; reason: string };

/** 根据镜头实际参考素材自动判定视频生成模式：有视频参考（含与图片混合）判为全能参考，仅有图片判为图生视频，无参考判为文生视频。 */
export function readStoryboardVideoGenerationMode(shot: CanvasStoryboardShot, assets: CanvasStoryboardAsset[], referenceVideos: ReferenceVideo[] = []): VideoGenerationMode {
    if (referenceVideos.length) return "reference-to-video";
    return readStoryboardShotReferenceImages(shot, assets).length ? "image-to-video" : "text-to-video";
}

/** 读取一批分镜镜头自动推导出的全部视频生成模式。 */
export function readStoryboardVideoGenerationModes(shots: CanvasStoryboardShot[], assets: CanvasStoryboardAsset[], referenceVideos: ReferenceVideo[] = []): VideoGenerationMode[] {
    return Array.from(new Set(shots.map((shot) => readStoryboardVideoGenerationMode(shot, assets, referenceVideos))));
}

/** 读取同时适用于全部选中镜头的可报价分辨率。 */
export function readStoryboardVideoResolutionOptions(config: AiConfig, model: string, shots: CanvasStoryboardShot[], assets: CanvasStoryboardAsset[], referenceVideos: ReferenceVideo[] = []): VideoResolution[] {
    const modes = readStoryboardVideoGenerationModes(shots, assets, referenceVideos);
    if (!model || !modes.length) return [];
    const [firstMode, ...remainingModes] = modes;
    return availableVideoResolutions(config, model, firstMode).filter((resolution) => remainingModes.every((mode) => availableVideoResolutions(config, model, mode).includes(resolution)));
}

/** 计算单个分镜镜头的视频分档报价。 */
export function quoteStoryboardVideo(config: AiConfig, model: string, videoConfig: AiConfig, shot: CanvasStoryboardShot, assets: CanvasStoryboardAsset[], referenceVideos: ReferenceVideo[] = []): VideoGenerationQuote {
    const referenceImages = readStoryboardShotReferenceImages(shot, assets);
    return quoteVideoGeneration({
        config,
        model,
        mode: readStoryboardVideoGenerationMode(shot, assets, referenceVideos),
        resolution: videoConfig.vquality,
        seconds: shot.durationSeconds,
        imageReferenceCount: referenceImages.length,
        videoReferenceCount: referenceVideos.length,
    });
}

/** 计算已选分镜镜头的视频分档报价，任何一个镜头不可报价时整批不可提交。 */
export function readStoryboardVideoCost(config: AiConfig, model: string, videoConfig: AiConfig, shots: CanvasStoryboardShot[], assets: CanvasStoryboardAsset[], referenceVideos: ReferenceVideo[] = []): StoryboardVideoBatchQuote {
    let credits = 0;
    for (const shot of shots) {
        const quote = quoteStoryboardVideo(config, model, videoConfig, shot, assets, referenceVideos);
        if (!quote.available) return { available: false, reason: `镜号 ${shot.shotNumber} 无法报价：${quote.reason}` };
        if (!Number.isSafeInteger(credits + quote.credits)) return { available: false, reason: "分镜视频积分计算超出范围" };
        credits += quote.credits;
    }
    return { available: true, credits };
}

/** 返回镜头无法生成视频的原因；空字符串表示可以生成。 */
export function readStoryboardVideoShotIssue(shot: CanvasStoryboardShot, config: AiConfig): string {
    if (!shot.finalPrompt.trim()) return "请先生成最终提示词";
    if (!isPositiveDurationSeconds(shot.durationSeconds)) return "镜头时长无效";
    if (isVideoDurationSupported(config, shot.durationSeconds)) return "";
    const range = readVideoDurationRange(config);
    return `当前模型仅支持 ${range.min}-${range.max} 秒视频`;
}

/** 读取镜头关联且已生成图片的资产，作为视频生成参考图。 */
export function readStoryboardShotReferenceImages(shot: CanvasStoryboardShot, assets: CanvasStoryboardAsset[]): ReferenceImage[] {
    const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
    const seenAssetIds = new Set<string>();
    const references: ReferenceImage[] = [];

    for (const assetId of shot.assetIds) {
        if (seenAssetIds.has(assetId)) continue;
        seenAssetIds.add(assetId);
        const asset = assetsById.get(assetId);
        const image = asset?.image;
        if (!asset || !image?.source.trim()) continue;
        references.push({
            id: asset.id,
            name: `${STORYBOARD_ASSET_KIND_LABELS[asset.kind]}-${asset.name.trim() || "未命名资产"}`,
            type: image.mimeType?.trim() || "image/png",
            dataUrl: image.source,
            storageKey: image.storageKey,
            objectStorage: image.objectStorage,
        });
    }

    return references;
}

/** 返回镜头关联图片与当前视频模型不兼容的原因；空字符串表示可调用。 */
export function readStoryboardVideoReferenceIssue(shot: CanvasStoryboardShot, assets: CanvasStoryboardAsset[], config: AiConfig): string {
    if (!isAgnesVideoConfig(config)) return "";
    return readAgnesVideoReferenceImageIssue(readStoryboardShotReferenceImages(shot, assets).length);
}

/** 判断分镜视频时长是否为正整数秒。 */
function isPositiveDurationSeconds(value: unknown): boolean {
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** 创建可持久化的分镜资产批量生成状态。 */
export function createStoryboardAssetGenerationState(assetIds: string[], settings: CanvasStoryboardAssetGenerationSettings, startedAt: string): CanvasStoryboardAssetGenerationState {
    return {
        phase: "running",
        selectedAssetIds: [...assetIds],
        taskIds: {},
        statuses: Object.fromEntries(assetIds.map((assetId) => [assetId, "pending"])),
        errors: {},
        settings,
        progress: 0,
        startedAt,
    };
}

/** 计算批量资产任务已处理进度。 */
export function readStoryboardAssetGenerationProgress(state: CanvasStoryboardAssetGenerationState): number {
    if (!state.selectedAssetIds.length) return 0;
    const completedCount = state.selectedAssetIds.filter((assetId) => state.statuses[assetId] === "succeeded" || state.statuses[assetId] === "failed").length;
    return Math.round((completedCount / state.selectedAssetIds.length) * 100);
}

/** 删除资产并同步清理所有镜头中的关联标识。 */
export function removeStoryboardAssetAndAssociations(storyboard: CanvasStoryboardNode["storyboard"], assetId: string): CanvasStoryboardNode["storyboard"] {
    return {
        ...storyboard,
        assets: storyboard.assets.filter((asset) => asset.id !== assetId),
        shots: storyboard.shots.map((shot) => ({ ...shot, assetIds: shot.assetIds.filter((id) => id !== assetId) })),
    };
}
