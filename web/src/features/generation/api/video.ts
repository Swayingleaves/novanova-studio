import axios from "axios";

import { getMediaBlob, uploadMediaFile, type UploadedFile } from "@/features/storage/services/file-storage";
import { agnesVideoDimensions, agnesVideoTiming } from "@/features/generation/lib/agnes-video";
import { boolConfig, buildSeedancePromptText, isSeedanceVideoConfig, normalizeSeedanceDuration, normalizeSeedanceRatio, normalizeSeedanceResolution, seedanceVideoReferenceError, SEEDANCE_REFERENCE_LIMITS } from "@/features/generation/lib/seedance-video";
import { createAiTask, waitAiTask, type ServerAiTaskMediaReference, type ServerGenerationSource } from "@/services/api/server";
import { logApiRequestParameters, logApiResponseParameters } from "@/services/api/request-log";
import { AGNES_VIDEO_MODEL, buildApiUrl, modelOptionName, resolveModelRequestConfig, type AiConfig } from "@/features/settings/stores/use-config-store";
import type { ReferenceImage } from "@/features/generation/types/image";
import type { ReferenceVideo } from "@/features/generation/types/media";

type VideoResponse = { id: string; status?: string; error?: { message?: string } };
type ApiVideoResponse = VideoResponse | { code?: number; data?: VideoResponse | null; msg?: string };
type SeedanceTask = {
    id: string;
    status?: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "expired";
    error?: { code?: string; message?: string } | null;
    content?: { video_url?: string; last_frame_url?: string } | null;
};
type AgnesTask = {
    id?: string;
    task_id?: string;
    video_id?: string;
    model?: string;
    status?: "queued" | "in_progress" | "completed" | "failed";
    progress?: number;
    seconds?: string;
    size?: string;
    remixed_from_video_id?: string;
    error?: { message?: string } | string | null;
};
type ApiEnvelope<T> = T | { code?: number; data?: T | null; msg?: string };
type RequestOptions = { signal?: AbortSignal };

export type VideoGenerationResult = { blob?: Blob; url?: string; mimeType?: string; uploadedFile?: UploadedFile };
export type VideoGenerationTask = { id: string; provider: "openai" | "seedance" | "server"; model: string } | { id: string; provider: "agnes"; model: string; taskId?: string };
export type VideoGenerationTaskState = { status: "pending" } | { status: "completed"; result: VideoGenerationResult } | { status: "failed"; error: string };

function aiApiUrl(config: AiConfig, path: string) {
    return buildApiUrl(config.baseUrl, path);
}

function aiHeaders(config: AiConfig, contentType?: string) {
    return {
        Authorization: `Bearer ${config.apiKey}`,
        ...(contentType ? { "Content-Type": contentType } : {}),
    };
}

export async function requestVideoGeneration(config: AiConfig, prompt: string, references: ReferenceImage[] = [], videoReferences: ReferenceVideo[] = [], generationSource: ServerGenerationSource, options?: RequestOptions & { onProgress?: (progress: number) => void; onTaskCreated?: (taskId: string) => void }): Promise<VideoGenerationResult> {
    return requestServerVideoTask(config, prompt, references, videoReferences, generationSource, options);
}

export async function createVideoGenerationTask(config: AiConfig, prompt: string, references: ReferenceImage[] = [], videoReferences: ReferenceVideo[] = [], options?: RequestOptions): Promise<VideoGenerationTask> {
    const selectedModel = (config.model || config.videoModel).trim();
    const requestConfig = resolveModelRequestConfig(config, selectedModel);
    assertVideoConfig(requestConfig, requestConfig.model);
    assertReferenceImagesUploaded(references);
    if (isSeedanceVideoConfig(requestConfig)) {
        return createSeedanceTask(requestConfig, selectedModel, prompt, references, videoReferences, options);
    }
    if (requestConfig.apiFormat === "agnes") {
        return createAgnesTask(requestConfig, selectedModel, prompt, references, videoReferences, options);
    }
    if (videoReferences.length) {
        throw new Error("当前视频接口不支持参考视频，请切换到 Seedance 2.0 / 火山 Agent Plan 模型，或移除参考素材");
    }
    return createOpenAIVideoTask(requestConfig, selectedModel, prompt, references, options);
}

export async function pollVideoGenerationTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    const requestConfig = resolveModelRequestConfig(config, task.model);
    assertVideoConfig(requestConfig, requestConfig.model);
    if (task.provider === "seedance") return pollSeedanceTask(requestConfig, task, options);
    if (task.provider === "agnes") return pollAgnesTask(requestConfig, task, options);
    return pollOpenAIVideoTask(requestConfig, task, options);
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
        videoApiLog("视频远程结果已登记到媒体表", { "地址": safeLogUrl(result.url), "媒体类型": result.mimeType || file.mimeType });
        return { ...file, mimeType: result.mimeType || file.mimeType };
    }
    throw new Error("视频接口没有返回可播放的视频");
}

async function requestServerVideoTask(config: AiConfig, prompt: string, references: ReferenceImage[] = [], videoReferences: ReferenceVideo[] = [], generationSource: ServerGenerationSource, options?: RequestOptions & { onProgress?: (progress: number) => void; onTaskCreated?: (taskId: string) => void }): Promise<VideoGenerationResult> {
    if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const selectedModel = (config.model || config.videoModel).trim();
    const requestConfig = resolveModelRequestConfig(config, selectedModel);
    const task = await createAiTask({
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
    });
    options?.onTaskCreated?.(task.id);
    const completed = await waitAiTask(task.id, { signal: options?.signal, onProgress: options?.onProgress ? (t) => options.onProgress!(t.progress) : undefined });
    const item = readTaskResultItem(completed.resultData);
    if (!item?.url) throw new Error("视频任务没有返回结果");
    return {
        url: item.url,
        mimeType: item.mimeType || "video/mp4",
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
    const objectStorage = item.objectStorage;
    return {
        id: item.id,
        name: item.name,
        mimeType: item.type,
        storageKey: item.storageKey,
        url: objectStorage?.url || item.url,
    };
}

function readTaskResultItem(resultData: unknown): (UploadedFile & { objectStorage?: UploadedFile["objectStorage"] }) | null {
    if (!resultData || typeof resultData !== "object") return null;
    const value = resultData as { item?: unknown; items?: unknown };
    const item = value.item || (Array.isArray(value.items) ? value.items[0] : null);
    if (!item || typeof item !== "object" || typeof (item as { url?: unknown }).url !== "string") return null;
    return item as UploadedFile;
}

async function createOpenAIVideoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], options?: RequestOptions): Promise<VideoGenerationTask> {
    const requestUrl = aiApiUrl(config, "/videos");
    const requestModel = modelOptionName(model);
    const seconds = normalizeVideoSeconds(config.videoSeconds);
    const size = normalizeVideoSize(config.size);
    const resolution = normalizeVideoResolution(config.vquality);
    const body = new FormData();
    body.append("model", requestModel);
    body.append("prompt", prompt);
    body.append("seconds", seconds);
    if (size) body.append("size", size);
    body.append("resolution_name", resolution);
    body.append("preset", "normal");
    const referenceUrls = references.slice(0, 7).map(referenceImageObjectStorageUrl);
    referenceUrls.forEach((url) => body.append("input_reference[]", url));
    videoApiLog("创建 OpenAI 视频任务", {
        "地址": safeLogUrl(requestUrl),
        "模型": requestModel,
        "提示词": summarizePrompt(prompt),
        "秒数": seconds,
        "尺寸": size || "自动",
        "分辨率": resolution,
        "参考图片": summarizeReferenceImageUrls(referenceUrls),
    });
    try {
        logApiRequestParameters("视频接口", "POST", requestUrl, body);
        const response = await axios.post<ApiVideoResponse>(requestUrl, body, { headers: aiHeaders(config), signal: options?.signal });
        logApiResponseParameters("视频接口", "POST", requestUrl, response.data);
        const created = unwrapVideoResponse(response.data);
        if (!created.id) throw new Error("视频接口没有返回任务 ID");
        videoApiLog("OpenAI 视频任务创建成功", { "任务ID": created.id, "状态": created.status || "未知" });
        return { id: created.id, provider: "openai", model };
    } catch (error) {
        const message = readAxiosError(error, "视频任务创建失败");
        videoApiError("OpenAI 视频任务创建失败", { "地址": safeLogUrl(requestUrl), "模型": requestModel, "错误": message });
        throw new Error(message);
    }
}

async function pollOpenAIVideoTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    const queryUrl = aiApiUrl(config, `/videos/${task.id}`);
    try {
        videoApiLog("查询 OpenAI 视频任务", { "地址": safeLogUrl(queryUrl), "任务ID": task.id });
        logApiRequestParameters("视频接口", "GET", queryUrl);
        const response = await axios.get<ApiVideoResponse>(queryUrl, { headers: aiHeaders(config), signal: options?.signal });
        logApiResponseParameters("视频接口", "GET", queryUrl, response.data);
        const video = unwrapVideoResponse(response.data);
        videoApiLog("OpenAI 视频任务状态", { "任务ID": task.id, "状态": video.status || "未知" });
        if (video.status === "completed") {
            const contentUrl = aiApiUrl(config, `/videos/${task.id}/content`);
            videoApiLog("下载 OpenAI 视频结果", { "地址": safeLogUrl(contentUrl), "任务ID": task.id });
            logApiRequestParameters("视频接口", "GET", contentUrl);
            const content = await axios.get<Blob>(contentUrl, { headers: aiHeaders(config), responseType: "blob", signal: options?.signal });
            logApiResponseParameters("视频接口", "GET", contentUrl, content.data);
            await assertVideoBlob(content.data);
            videoApiLog("OpenAI 视频结果下载完成", { "任务ID": task.id, "文件": summarizeBlob(content.data) });
            return { status: "completed", result: { blob: content.data } };
        }
        if (video.status === "failed" || video.status === "cancelled") {
            videoApiError("OpenAI 视频任务返回失败状态", { "任务ID": task.id, "状态": video.status, "错误": video.error?.message || "视频生成失败" });
            return { status: "failed", error: video.error?.message || "视频生成失败" };
        }
        return { status: "pending" };
    } catch (error) {
        const message = readAxiosError(error, "视频任务查询失败");
        videoApiError("OpenAI 视频任务查询失败", { "地址": safeLogUrl(queryUrl), "任务ID": task.id, "错误": message });
        throw new Error(message);
    }
}

async function createAgnesTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], options?: RequestOptions): Promise<VideoGenerationTask> {
    if (videoReferences.length) throw new Error("Agnes 调用格式暂不支持参考视频，请移除参考素材");
    const requestUrl = aiApiUrl(config, "/videos");
    const requestModel = modelOptionName(model);
    if (requestModel !== AGNES_VIDEO_MODEL) throw new Error(`Agnes 调用格式当前仅支持 ${AGNES_VIDEO_MODEL}`);
    const referenceUrls = references.map(referenceImageObjectStorageUrl);
    const dimensions = agnesVideoDimensions(config.size, config.vquality);
    const timing = agnesVideoTiming(config.videoSeconds, config.vquality);
    const payload: Record<string, unknown> = {
        model: requestModel,
        prompt,
        width: dimensions.width,
        height: dimensions.height,
        num_frames: timing.numFrames,
        frame_rate: timing.frameRate,
    };
    if (referenceUrls.length === 1) payload.image = referenceUrls[0];
    // if (referenceUrls.length > 1) payload.extra_body = { image: referenceUrls, mode: "keyframes" };
    if (referenceUrls.length > 1) payload.extra_body = { image: referenceUrls};

    videoApiLog("创建 Agnes 视频任务", {
        "地址": safeLogUrl(requestUrl),
        "模型": requestModel,
        "提示词": summarizePrompt(prompt),
        "宽度": dimensions.width,
        "高度": dimensions.height,
        "分辨率": dimensions.resolution,
        "比例": dimensions.ratio,
        "目标秒数": timing.seconds,
        "实际秒数": Number(timing.actualSeconds.toFixed(2)),
        "帧数": timing.numFrames,
        "帧率": timing.frameRate,
        "最大帧数": timing.maxFrames,
        "参考图片": summarizeReferenceImageUrls(referenceUrls),
    });
    try {
        logApiRequestParameters("视频接口", "POST", requestUrl, payload);
        const response = await axios.post<ApiEnvelope<AgnesTask>>(requestUrl, payload, { headers: aiHeaders(config, "application/json"), signal: options?.signal });
        logApiResponseParameters("视频接口", "POST", requestUrl, response.data);
        const created = unwrapAgnesTask(response.data);
        const videoId = created.video_id?.trim();
        const taskId = created.task_id?.trim() || created.id?.trim();
        if (!videoId) throw new Error("Agnes 接口没有返回 video_id");
        videoApiLog("Agnes 视频任务创建成功", { "video_id": videoId, "task_id": taskId || "", "状态": created.status || "未知", "进度": created.progress ?? 0 });
        return { id: videoId, taskId, provider: "agnes", model };
    } catch (error) {
        const message = readAxiosError(error, "Agnes 任务创建失败");
        videoApiError("Agnes 视频任务创建失败", { "地址": safeLogUrl(requestUrl), "模型": requestModel, "错误": message });
        throw new Error(message);
    }
}

async function pollAgnesTask(config: AiConfig, task: Extract<VideoGenerationTask, { provider: "agnes" }>, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    const requestUrl = agnesQueryUrl(config, task.id, modelOptionName(task.model));
    try {
        videoApiLog("查询 Agnes 视频任务", { "地址": safeLogUrl(requestUrl), "video_id": task.id, "task_id": task.taskId || "" });
        logApiRequestParameters("视频接口", "GET", requestUrl);
        const response = await axios.get<ApiEnvelope<AgnesTask>>(requestUrl, { headers: aiHeaders(config), signal: options?.signal });
        logApiResponseParameters("视频接口", "GET", requestUrl, response.data);
        const state = unwrapAgnesTask(response.data);
        videoApiLog("Agnes 视频任务状态", { "video_id": task.id, "task_id": state.task_id || state.id || task.taskId || "", "状态": state.status || "未知", "进度": state.progress ?? 0 });
        if (state.status === "completed") {
            const url = state.remixed_from_video_id;
            if (!url) return { status: "failed", error: "Agnes 任务成功但没有返回视频 URL" };
            videoApiLog("Agnes 视频任务返回结果", { "video_id": task.id, "地址": safeLogUrl(url), "秒数": state.seconds || "", "尺寸": state.size || "" });
            return { status: "completed", result: await videoResultFromUrl(url, "Agnes", options) };
        }
        if (state.status === "failed") {
            const message = agnesErrorMessage(state.error) || "Agnes 视频生成失败";
            videoApiError("Agnes 视频任务返回失败状态", { "video_id": task.id, "状态": state.status, "错误": message });
            return { status: "failed", error: message };
        }
        return { status: "pending" };
    } catch (error) {
        const message = readAxiosError(error, "Agnes 任务查询失败");
        videoApiError("Agnes 视频任务查询失败", { "地址": safeLogUrl(requestUrl), "video_id": task.id, "错误": message });
        throw new Error(message);
    }
}

async function createSeedanceTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], options?: RequestOptions): Promise<VideoGenerationTask> {
    assertSeedanceVideoReferences(videoReferences);
    const content = await buildSeedanceContent(prompt, references, videoReferences);
    if (!content.length) throw new Error("请输入视频提示词，或连接参考图片/视频");
    const payload = {
        model: modelOptionName(model),
        content,
        ratio: normalizeSeedanceRatio(config.size),
        resolution: normalizeSeedanceResolution(config.vquality, modelOptionName(model)),
        duration: normalizeSeedanceDuration(config.videoSeconds),
        watermark: boolConfig(config.videoWatermark, false),
    };

    const requestUrl = seedanceApiUrl(config);
    videoApiLog("创建 Seedance 视频任务", {
        "地址": safeLogUrl(requestUrl),
        "模型": payload.model,
        "提示词": summarizePrompt(prompt),
        "比例": payload.ratio,
        "分辨率": payload.resolution,
        "时长": payload.duration,
        "水印": payload.watermark,
        "内容": summarizeSeedanceContent(content),
        "参考图片": summarizeReferenceImages(references),
        "参考视频": summarizeReferenceVideos(videoReferences),
    });
    try {
        logApiRequestParameters("视频接口", "POST", requestUrl, payload);
        const response = await axios.post<ApiEnvelope<SeedanceTask>>(requestUrl, payload, { headers: aiHeaders(config, "application/json"), signal: options?.signal });
        logApiResponseParameters("视频接口", "POST", requestUrl, response.data);
        const created = unwrapSeedanceTask(response.data);
        if (!created.id) throw new Error("Seedance 接口没有返回任务 ID");
        videoApiLog("Seedance 视频任务创建成功", { "任务ID": created.id, "状态": created.status || "未知" });
        return { id: created.id, provider: "seedance", model };
    } catch (error) {
        const message = readAxiosError(error, "Seedance 任务创建失败");
        videoApiError("Seedance 视频任务创建失败", { "地址": safeLogUrl(requestUrl), "模型": payload.model, "错误": message });
        throw new Error(message);
    }
}

async function pollSeedanceTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    const requestUrl = seedanceApiUrl(config, task.id);
    try {
        videoApiLog("查询 Seedance 视频任务", { "地址": safeLogUrl(requestUrl), "任务ID": task.id });
        logApiRequestParameters("视频接口", "GET", requestUrl);
        const response = await axios.get<ApiEnvelope<SeedanceTask>>(requestUrl, { headers: aiHeaders(config), signal: options?.signal });
        logApiResponseParameters("视频接口", "GET", requestUrl, response.data);
        const state = unwrapSeedanceTask(response.data);
        videoApiLog("Seedance 视频任务状态", { "任务ID": task.id, "状态": state.status || "未知" });
        if (state.status === "succeeded") {
            const url = state.content?.video_url;
            if (!url) return { status: "failed", error: "Seedance 任务成功但没有返回视频 URL" };
            return { status: "completed", result: await videoResultFromUrl(url, "Seedance", options) };
        }
        if (state.status === "failed" || state.status === "cancelled" || state.status === "expired") {
            const message = state.error?.message || `Seedance 视频生成${state.status === "expired" ? "超时" : "失败"}`;
            videoApiError("Seedance 视频任务返回失败状态", { "任务ID": task.id, "状态": state.status, "错误": message });
            return { status: "failed", error: message };
        }
        return { status: "pending" };
    } catch (error) {
        const message = readAxiosError(error, "Seedance 任务查询失败");
        videoApiError("Seedance 视频任务查询失败", { "地址": safeLogUrl(requestUrl), "任务ID": task.id, "错误": message });
        throw new Error(message);
    }
}

function assertSeedanceVideoReferences(videoReferences: ReferenceVideo[]) {
    const error = seedanceVideoReferenceError(videoReferences);
    if (error) throw new Error(error);
    let total = 0;
    for (const video of videoReferences) {
        if (!video.durationMs) continue;
        if (video.durationMs < 2000 || video.durationMs > 15000) throw new Error("Seedance 参考视频单个时长需要在 2-15 秒之间");
        total += video.durationMs;
    }
    if (total > 15000) throw new Error("Seedance 参考视频总时长不能超过 15 秒");
}

function seedanceApiUrl(config: AiConfig, taskId?: string) {
    return buildApiUrl(config.baseUrl, `/contents/generations/tasks${taskId ? `/${encodeURIComponent(taskId)}` : ""}`);
}

async function buildSeedanceContent(prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[]) {
    const content: Array<Record<string, unknown>> = [];
    const text = buildSeedancePromptText(prompt, references, videoReferences);
    if (text) content.push({ type: "text", text });
    for (const image of references.slice(0, SEEDANCE_REFERENCE_LIMITS.images)) {
        content.push({ type: "image_url", image_url: { url: referenceImageObjectStorageUrl(image) }, role: "reference_image" });
    }
    for (const video of videoReferences.slice(0, SEEDANCE_REFERENCE_LIMITS.videos)) {
        content.push({ type: "video_url", video_url: { url: await resolveSeedanceVideoUrl(video) }, role: "reference_video" });
    }
    return content;
}

async function resolveSeedanceVideoUrl(video: ReferenceVideo) {
    if (isPublicMediaUrl(video.url) || video.url.startsWith("asset://")) return video.url;
    let blob: Blob | null = null;
    if (video.storageKey) blob = await getMediaBlob(video.storageKey);
    if (!blob && video.url?.startsWith("blob:")) blob = await (await fetch(video.url)).blob();
    if (!blob) throw new Error("参考视频必须是公网 URL、素材 ID，或本地已保存的视频");
    return blobToDataUrl(blob);
}

async function videoResultFromUrl(url: string, providerLabel: string, options?: RequestOptions): Promise<VideoGenerationResult> {
    try {
        videoApiLog(`下载 ${providerLabel} 视频结果`, { "地址": safeLogUrl(url) });
        const response = await axios.get<Blob>(url, { responseType: "blob", signal: options?.signal });
        await assertVideoBlob(response.data);
        videoApiLog(`${providerLabel} 视频结果下载完成`, { "地址": safeLogUrl(url), "文件": summarizeBlob(response.data) });
        return { blob: response.data };
    } catch (error) {
        if (axios.isCancel(error) || options?.signal?.aborted) throw error;
        videoApiError(`${providerLabel} 视频结果下载失败，改用远程地址`, { "地址": safeLogUrl(url), "错误": readAxiosError(error, "视频结果下载失败") });
        return { url, mimeType: "video/mp4" };
    }
}

function agnesQueryUrl(config: AiConfig, videoId: string, model: string) {
    const baseUrl = normalizeAgnesBaseUrl(config.baseUrl);
    const params = new URLSearchParams({ video_id: videoId, model_name: model });
    return `${baseUrl}/agnesapi?${params.toString()}`;
}

function normalizeAgnesBaseUrl(baseUrl: string) {
    return baseUrl.trim().replace(/\/+$/, "").replace(/\/v1$/i, "");
}

function agnesErrorMessage(error: AgnesTask["error"]) {
    if (!error) return "";
    return typeof error === "string" ? error : error.message || "";
}

function assertVideoConfig(config: AiConfig, model: string) {
    if (!model) throw new Error("请先配置视频模型");
    if (!config.baseUrl.trim()) throw new Error("请先配置 Base URL");
    if (!config.apiKey.trim()) throw new Error("请先配置 API Key");
    if (config.apiFormat === "gemini") throw new Error("Gemini 调用格式暂不支持视频生成，请使用 OpenAI 格式渠道");
}

function normalizeVideoSeconds(value: string) {
    const seconds = Math.floor(Number(value) || 6);
    return String(Math.max(1, Math.min(15, seconds)));
}

function normalizeVideoSize(value: string) {
    if (value === "auto") return null;
    const size = value || "1280x720";
    if (/^\d+x\d+$/.test(size)) return size;
    return ["9:16", "2:3", "3:4"].includes(size) ? "720x1280" : "1280x720";
}

function normalizeVideoResolution(value: string) {
    if (value === "low") return "480p";
    if (value === "auto" || value === "high" || value === "medium") return "720p";
    const resolution = value.replace(/p$/i, "") || "720";
    return `${resolution}p`;
}

function unwrapVideoResponse(payload: ApiVideoResponse) {
    return unwrapEnvelope(payload, "接口没有返回视频任务");
}

function unwrapSeedanceTask(payload: ApiEnvelope<SeedanceTask>) {
    return unwrapEnvelope(payload, "Seedance 接口没有返回任务");
}

function unwrapAgnesTask(payload: ApiEnvelope<AgnesTask>) {
    return unwrapEnvelope(payload, "Agnes 接口没有返回任务");
}

function unwrapEnvelope<T>(payload: ApiEnvelope<T>, emptyMessage: string): T {
    if (!payload) throw new Error(emptyMessage);
    if (typeof payload === "object" && "code" in payload && typeof payload.code === "number") {
        if (payload.code !== 0) throw new Error(payload.msg || "请求失败");
        if (!payload.data) throw new Error(emptyMessage);
        return payload.data;
    }
    return payload as T;
}

function readAxiosError(error: unknown, fallback: string) {
    if (axios.isCancel(error)) return "请求已取消";
    if (axios.isAxiosError<{ error?: { message?: string } | string; message?: string; msg?: string; detail?: string; code?: number }>(error)) {
        const responseData = error.response?.data;
        const errorMessage = typeof responseData?.error === "string" ? responseData.error : responseData?.error?.message;
        return responseData?.msg || errorMessage || responseData?.message || responseData?.detail || statusMessage(error.response?.status, fallback);
    }
    if (error instanceof DOMException && error.name === "AbortError") return "请求已取消";
    return error instanceof Error ? error.message : fallback;
}

function statusMessage(status: number | undefined, fallback: string) {
    if (status === 401 || status === 403) return "鉴权失败，请检查 API Key、套餐权限或模型权限";
    if (status === 429) return "请求被限流或额度不足，请稍后重试";
    return status ? `${fallback}（${status}）` : fallback;
}

async function assertVideoBlob(blob: Blob) {
    if (!blob.type.includes("json")) return;
    let payload: { code?: number; msg?: string; error?: { message?: string } };
    try {
        payload = JSON.parse(await blob.text()) as { code?: number; msg?: string; error?: { message?: string } };
    } catch {
        return;
    }
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(payload.msg || "视频下载失败");
    if (payload.error?.message) throw new Error(payload.error.message);
}

function isPublicMediaUrl(value: string) {
    return /^https?:\/\//i.test(value || "");
}

function assertReferenceImagesUploaded(references: ReferenceImage[]) {
    const missing = references.filter((image) => !image.objectStorage?.url);
    if (missing.length) throw new Error("参考图片需先上传到 COS");
}

function referenceImageObjectStorageUrl(image: ReferenceImage) {
    const url = image.objectStorage?.url?.trim();
    if (!url) throw new Error("参考图片需先上传到 COS");
    return url;
}

function videoApiLog(message: string, detail?: unknown) {
    console.log(`[视频生成] ${message}`, detail ?? {});
}

function videoApiError(message: string, detail?: unknown) {
    console.error(`[视频生成] ${message}`, detail ?? {});
}

function summarizePrompt(prompt: string) {
    return { "长度": prompt.length, "预览": prompt.length > 120 ? `${prompt.slice(0, 120)}...` : prompt };
}

function summarizeReferenceImages(references: ReferenceImage[]) {
    return references.map((item, index) => ({
        "序号": index + 1,
        "名称": item.name,
        "类型": item.type,
        "存储键": item.storageKey || "",
        "COS地址": item.objectStorage?.url ? safeLogUrl(item.objectStorage.url) : "",
        "COS对象键": item.objectStorage?.key || "",
    }));
}

function summarizeReferenceImageUrls(urls: string[]) {
    return urls.map((url, index) => ({ "序号": index + 1, "COS地址": safeLogUrl(url) }));
}

function summarizeReferenceVideos(references: ReferenceVideo[]) {
    return references.map((item, index) => ({
        "序号": index + 1,
        "名称": item.name,
        "类型": item.type,
        "存储键": item.storageKey || "",
        "字节数": item.bytes,
        "宽度": item.width,
        "高度": item.height,
        "时长毫秒": item.durationMs,
        "来源": summarizeMediaSource(item.url),
    }));
}

function summarizeSeedanceContent(content: Array<Record<string, unknown>>) {
    return content.map((item, index) => {
        const type = typeof item.type === "string" ? item.type : "未知";
        if (type === "text") return { "序号": index + 1, "类型": type, "文本": summarizePrompt(String(item.text || "")) };
        if (type === "image_url") return { "序号": index + 1, "类型": type, "角色": item.role, "地址": summarizeNestedMediaUrl(item, "image_url") };
        if (type === "video_url") return { "序号": index + 1, "类型": type, "角色": item.role, "地址": summarizeNestedMediaUrl(item, "video_url") };
        return { "序号": index + 1, "类型": type };
    });
}

function summarizeNestedMediaUrl(item: Record<string, unknown>, key: string) {
    const value = item[key];
    if (!value || typeof value !== "object" || !("url" in value)) return "";
    return summarizeMediaSource(String(value.url || ""));
}

function summarizeMediaSource(value = "") {
    if (!value) return "";
    if (value.startsWith("data:")) return summarizeDataUrl(value);
    if (value.startsWith("blob:")) return "blob:本地临时地址";
    if (value.startsWith("asset://")) return value;
    return safeLogUrl(value);
}

function summarizeDataUrl(value: string) {
    const match = value.match(/^data:([^;]+);base64,(.*)$/);
    if (!match) return "data:未知格式";
    return `data:${match[1]};base64,<${estimateBase64Bytes(match[2])}B>`;
}

function estimateBase64Bytes(value: string) {
    const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
    return Math.max(0, Math.floor((value.length * 3) / 4) - padding);
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

function summarizeVideoResult(result: VideoGenerationResult) {
    if (result.blob) return { "类型": "本地文件", "文件": summarizeBlob(result.blob) };
    if (result.url) return { "类型": "远程地址", "地址": safeLogUrl(result.url), "媒体类型": result.mimeType || "video/mp4" };
    return { "类型": "空结果" };
}

function summarizeBlob(blob: Blob) {
    return { "类型": blob.type || "未知", "字节数": blob.size };
}

function summarizeUploadedFile(file: UploadedFile) {
    return {
        "存储键": file.storageKey,
        "字节数": file.bytes,
        "媒体类型": file.mimeType,
        "宽度": file.width,
        "高度": file.height,
        "时长毫秒": file.durationMs,
    };
}

function delay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
        }
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener(
            "abort",
            () => {
                clearTimeout(timer);
                reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
        );
    });
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("读取本地素材失败"));
        reader.readAsDataURL(blob);
    });
}
