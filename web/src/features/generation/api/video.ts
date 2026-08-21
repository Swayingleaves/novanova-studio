import { uploadMediaFile, type UploadedFile } from "@/features/storage/services/file-storage";
import { boolConfig } from "@/features/generation/lib/seedance-video";
import { createAiTask, getAiTaskInfo, waitAiTask, type GenerationStyleSnapshot, type ServerAiTask, type ServerAiTaskMediaReference, type ServerGenerationSource } from "@/services/api/server";
import type { AiConfig } from "@/features/settings/stores/use-config-store";
import type { ReferenceImage } from "@/features/generation/types/image";
import type { ReferenceVideo } from "@/features/generation/types/media";

type RequestOptions = {
    signal?: AbortSignal;
    onProgress?: (progress: number) => void;
    onTaskCreated?: (taskId: string) => void;
    generationSource?: ServerGenerationSource;
    generationStyleIds?: number[];
    generationStyleSnapshots?: GenerationStyleSnapshot[];
};

export type VideoGenerationResult = {
    blob?: Blob;
    url?: string;
    mimeType?: string;
    uploadedFile?: UploadedFile;
    generationStyleSnapshots?: GenerationStyleSnapshot[];
};

export type VideoGenerationTask = {
    id: string;
    provider: "server";
    model: string;
};

export type VideoGenerationTaskState = { status: "pending" } | { status: "completed"; result: VideoGenerationResult } | { status: "failed"; error: string };

/**
 * 创建视频生成任务并等待服务端任务完成。
 *
 * 服务端负责模式、素材、分辨率、时长和积分校验，前端不再直连任何视频供应商。
 */
export async function requestVideoGeneration(config: AiConfig, prompt: string, references: ReferenceImage[] = [], videoReferences: ReferenceVideo[] = [], generationSource: ServerGenerationSource, options?: RequestOptions): Promise<VideoGenerationResult> {
    if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const task = await createServerVideoTask(config, prompt, references, videoReferences, generationSource, options);
    options?.onTaskCreated?.(task.id);
    const completed = await waitAiTask(task.id, {
        signal: options?.signal,
        onProgress: options?.onProgress ? (current) => options.onProgress?.(current.progress) : undefined,
    });
    return videoResultFromTask(completed);
}

/**
 * 创建可由旧轮询流程继续消费的视频任务。
 *
 * 该兼容入口同样只创建服务端任务，避免绕过统一报价和扣费逻辑。
 */
export async function createVideoGenerationTask(config: AiConfig, prompt: string, references: ReferenceImage[] = [], videoReferences: ReferenceVideo[] = [], options?: RequestOptions): Promise<VideoGenerationTask> {
    if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const task = await createServerVideoTask(config, prompt, references, videoReferences, options?.generationSource || "videoPage", options);
    options?.onTaskCreated?.(task.id);
    return { id: task.id, provider: "server", model: task.model };
}

/**
 * 查询服务端视频任务状态。
 *
 * 轮询结果与直接等待入口使用同一结果解析，保证重试和历史任务不会重新调用供应商。
 */
export async function pollVideoGenerationTask(_config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const current = await getAiTaskInfo(task.id);
    options?.onProgress?.(current.progress);
    if (current.status === "pending" || current.status === "running") return { status: "pending" };
    if (current.status !== "success") return { status: "failed", error: current.errorMessage || "视频生成失败" };
    try {
        return { status: "completed", result: videoResultFromTask(current) };
    } catch (error) {
        return { status: "failed", error: error instanceof Error ? error.message : "视频任务没有返回结果" };
    }
}

export async function storeGeneratedVideo(result: VideoGenerationResult): Promise<UploadedFile> {
    if (result.uploadedFile) return result.uploadedFile;
    if (result.blob) {
        const file = await uploadMediaFile(result.blob, "video");
        videoApiLog("视频已保存到后端媒体库", summarizeUploadedFile(file));
        return file;
    }
    if (result.url) {
        const file = await uploadMediaFile(result.url, "video", { mimeType: result.mimeType || "video/mp4" });
        videoApiLog("视频远程结果已登记到媒体表", { 地址: safeLogUrl(result.url), 媒体类型: result.mimeType || file.mimeType });
        return { ...file, mimeType: result.mimeType || file.mimeType };
    }
    throw new Error("视频接口没有返回可播放的视频");
}

async function createServerVideoTask(config: AiConfig, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], generationSource: ServerGenerationSource, options?: RequestOptions): Promise<ServerAiTask> {
    const selectedModel = (config.model || config.videoModel).trim();
    return createAiTask({
        taskType: "video",
        prompt,
        model: selectedModel,
        parameters: {
            seconds: config.videoSeconds,
            size: config.size,
            resolution: config.vquality,
            watermark: boolConfig(config.videoWatermark, false),
        },
        references: references.map(toServerImageReference),
        videoReferences: videoReferences.map(toServerMediaReference),
        generationSource,
        generationStyleIds: options?.generationStyleIds,
        generationStyleSnapshots: options?.generationStyleSnapshots,
        videoGenerationMode: config.videoGenerationMode || "text-to-video",
    });
}

function videoResultFromTask(task: ServerAiTask): VideoGenerationResult {
    const item = readTaskResultItem(task.resultData);
    if (!item?.url) throw new Error("视频任务没有返回结果");
    return {
        url: item.url,
        mimeType: item.mimeType || "video/mp4",
        generationStyleSnapshots: readGenerationStyleSnapshots(task.requestData),
        uploadedFile: {
            url: item.url,
            storageKey: item.storageKey || "",
            bytes: item.bytes || 0,
            mimeType: item.mimeType || "video/mp4",
            width: item.width,
            height: item.height,
            durationMs: item.durationMs,
            objectStorage: item.objectStorage,
        },
    };
}

function readGenerationStyleSnapshots(value: unknown): GenerationStyleSnapshot[] {
    if (!value || typeof value !== "object") return [];
    const snapshots = (value as { generationStyleSnapshots?: unknown }).generationStyleSnapshots;
    return Array.isArray(snapshots) ? (snapshots as GenerationStyleSnapshot[]) : [];
}

function toServerImageReference(image: ReferenceImage): ServerAiTaskMediaReference {
    return {
        id: image.id,
        name: image.name,
        mimeType: image.type,
        storageKey: image.storageKey,
        url: image.objectStorage?.url || image.url || (/^https?:\/\//i.test(image.dataUrl || "") ? image.dataUrl : undefined),
    };
}

function toServerMediaReference(item: ReferenceVideo): ServerAiTaskMediaReference {
    return {
        id: item.id,
        name: item.name,
        mimeType: item.type,
        storageKey: item.storageKey,
        url: item.objectStorage?.url || item.url,
    };
}

function readTaskResultItem(resultData: unknown): UploadedFile | null {
    if (!resultData || typeof resultData !== "object") return null;
    const value = resultData as { item?: unknown; items?: unknown };
    const item = value.item || (Array.isArray(value.items) ? value.items[0] : null);
    if (!item || typeof item !== "object" || typeof (item as { url?: unknown }).url !== "string") return null;
    return item as UploadedFile;
}

function videoApiLog(message: string, detail?: unknown) {
    console.log(`[视频生成] ${message}`, detail ?? {});
}

function summarizeUploadedFile(file: UploadedFile) {
    return {
        存储键: file.storageKey,
        字节数: file.bytes,
        媒体类型: file.mimeType,
        宽度: file.width,
        高度: file.height,
        时长毫秒: file.durationMs,
    };
}

function safeLogUrl(value: string) {
    try {
        const url = new URL(value);
        url.username = "";
        url.password = "";
        url.search = "";
        url.hash = "";
        return url.toString();
    } catch {
        return value.split("?")[0].split("#")[0];
    }
}
