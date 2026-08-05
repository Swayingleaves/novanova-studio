import { nanoid } from "nanoid";

import { buildImageReferencePromptText } from "@/features/generation/lib/image-reference-prompt";
import type { ReferenceImage } from "@/features/generation/types/image";
import type { AiConfig } from "@/features/settings/stores/use-config-store";
import { createAiTask, waitAiTask, type ServerAiTaskMediaReference, type ServerGenerationSource } from "@/services/api/server";

import type { ImageRequestOptions } from "./image-contracts";
import { normalizeImageTaskResult } from "./image-task-result";

export async function requestServerGeneratedImages(config: AiConfig, prompt: string, references: ReferenceImage[], mask: ReferenceImage | undefined, generationSource: ServerGenerationSource, options?: ImageRequestOptions) {
    if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (mask) throw new Error("服务端任务系统暂不支持蒙版编辑");
    const model = config.model || config.imageModel;
    const count = normalizeImageCount(config.count);
    const task = await createAiTask({
        taskType: "image",
        prompt: references.length ? buildImageReferencePromptText(prompt, references) : prompt,
        model,
        parameters: { count, quality: config.quality, resolution: config.imageResolution, size: config.size },
        references: references.map(toServerReference),
        generationSource,
        generationStyleIds: options?.generationStyleIds,
        generationStyleSnapshots: options?.generationStyleSnapshots,
    });
    const completed = await waitAiTask(task.id, { signal: options?.signal });
    const snapshots = readGenerationStyleSnapshots(completed.requestData);
    return normalizeImageTaskResult(completed.resultData, nanoid).map((item) => ({ ...item, generationStyleSnapshots: snapshots }));
}

function readGenerationStyleSnapshots(value: unknown) {
    if (!value || typeof value !== "object") return [];
    const snapshots = (value as { generationStyleSnapshots?: unknown }).generationStyleSnapshots;
    return Array.isArray(snapshots) ? snapshots as import("@/services/api/server").GenerationStyleSnapshot[] : [];
}

function normalizeImageCount(value: string): number {
    return Math.max(1, Math.min(15, Math.floor(Math.abs(Number(value)) || 1)));
}

function toServerReference(image: ReferenceImage): ServerAiTaskMediaReference {
    return {
        id: image.id,
        name: image.name,
        mimeType: image.type,
        storageKey: image.storageKey,
        url: image.objectStorage?.url || image.url || (/^https?:\/\//i.test(image.dataUrl) ? image.dataUrl : undefined),
    };
}
