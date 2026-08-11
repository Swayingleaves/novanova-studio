import type { CanvasStoryboardAsset, CanvasStoryboardAssetGenerationSettings, CanvasStoryboardAssetImage, CanvasStoryboardShot } from "@/features/canvas/types";
import { createAiTask, serverPost, type ServerAiTask } from "./server";

export type GenerateStoryboardParams = {
    scriptContent: string;
    instruction: string;
    visualStyle: string;
    model: string;
};

export type StoryboardComposeAsset = Pick<CanvasStoryboardAsset, "id" | "kind" | "name" | "description">;

export type ComposeStoryboardPromptsParams = GenerateStoryboardParams & {
    shots: CanvasStoryboardShot[];
    assets: StoryboardComposeAsset[];
};

export type StoryboardGenerationResult = {
    shots: CanvasStoryboardShot[];
    assets: CanvasStoryboardAsset[];
    chargedCredits: number;
};

export type StoryboardPromptCompositionResult = {
    prompts: Array<{ shotId: string; finalPrompt: string }>;
    chargedCredits: number;
};

/** 创建分镜资产图片任务，费用由通用任务服务按所选图片模型计算。 */
export function createStoryboardAssetImageTask(
    nodeId: string,
    asset: CanvasStoryboardAsset,
    settings: CanvasStoryboardAssetGenerationSettings,
    visualStyle: string,
): Promise<ServerAiTask> {
    const kindLabel = asset.kind === "character" ? "角色" : asset.kind === "scene" ? "场景" : "道具";
    const description = asset.description.trim();
    const prompt = [`${kindLabel}：${asset.name.trim()}`, description && `描述：${description}`, `视觉风格：${visualStyle.trim()}`].filter(Boolean).join("\n");
    return createAiTask({
        taskType: "image",
        prompt,
        model: settings.model,
        parameters: {
            count: 1,
            quality: settings.quality,
            resolution: settings.imageResolution,
            size: settings.size,
            storyboardNodeId: nodeId,
            storyboardAssetId: asset.id,
        },
        generationSource: "storyboard",
    });
}

/** 读取图片任务返回的第一张图片，并转换为分镜资产图片结构。 */
export function readStoryboardAssetImage(task: ServerAiTask): CanvasStoryboardAssetImage {
    const resultData = task.resultData && typeof task.resultData === "object" ? task.resultData as Record<string, unknown> : {};
    const item = resultData.item && typeof resultData.item === "object"
        ? resultData.item as Record<string, unknown>
        : Array.isArray(resultData.items) && resultData.items[0] && typeof resultData.items[0] === "object"
          ? resultData.items[0] as Record<string, unknown>
          : null;
    const source = typeof item?.url === "string" ? item.url.trim() : "";
    if (!source) throw new Error("图片任务已完成，但没有返回图片地址");
    return {
        source,
        ...(typeof item?.storageKey === "string" && item.storageKey.trim() ? { storageKey: item.storageKey } : {}),
        ...(typeof item?.mimeType === "string" && item.mimeType.trim() ? { mimeType: item.mimeType } : {}),
        ...(item?.objectStorage && typeof item.objectStorage === "object" ? { objectStorage: item.objectStorage as CanvasStoryboardAssetImage["objectStorage"] } : {}),
    };
}

export function generateStoryboard(params: GenerateStoryboardParams): Promise<StoryboardGenerationResult> {
    return serverPost<StoryboardGenerationResult>("/ai/storyboard/generateStoryboard", params);
}

export function composeStoryboardPrompts(params: ComposeStoryboardPromptsParams): Promise<StoryboardPromptCompositionResult> {
    return serverPost<StoryboardPromptCompositionResult>("/ai/storyboard/composePrompts", params);
}
