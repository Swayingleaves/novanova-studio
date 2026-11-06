import type { CreationStyleOption } from "@/features/generation/components/creation-workspace-types";
import type { CreationMode } from "@/features/generation/lib/creation-mode-preference";
import type { ReferenceImage } from "@/features/generation/types/image";
import type { ReferenceVideo } from "@/features/generation/types/media";
import type { AiConfig, VideoGenerationMode } from "@/features/settings/stores/use-config-store";
import type { SkillOption } from "@/services/api/server";

export type HomepageCreationTarget = "image" | "video";

export type HomepageImageSettings = {
    quality: string;
    imageResolution: string;
    size: string;
    count: string;
    imageModel: string;
};

export type HomepageVideoSettings = {
    videoGenerationMode: VideoGenerationMode;
    vquality: string;
    size: string;
    videoSeconds: string;
    videoWatermark: string;
    videoModel: string;
};

/** 首页提交后交给图片或视频页启动任务的草稿。设置随草稿走，避免整页跳转后内存配置丢失。 */
export type HomepageCreationDraft = {
    target: HomepageCreationTarget;
    prompt: string;
    creationMode: CreationMode;
    styles: CreationStyleOption[];
    skill: SkillOption | null;
    images: ReferenceImage[];
    videos: ReferenceVideo[];
    imageSettings?: HomepageImageSettings;
    videoSettings?: HomepageVideoSettings;
};

const STORAGE_KEY = "novanova:homepage-creation-handoff";
const videoModes = new Set<VideoGenerationMode>(["text-to-video", "image-to-video", "reference-to-video", "first-last-frame-to-video"]);

function readStorage(): Storage | null {
    try {
        return typeof sessionStorage === "undefined" ? null : sessionStorage;
    } catch {
        return null;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object";
}

function readText(record: Record<string, unknown>, key: string): string | null {
    return typeof record[key] === "string" ? record[key] : null;
}

function isRemoteUrl(value: string): boolean {
    return value.length > 0 && !value.startsWith("blob:");
}

function isStyle(value: unknown): value is CreationStyleOption {
    return isRecord(value) && typeof value.id === "number" && typeof value.name === "string";
}

function isSkill(value: unknown): value is SkillOption {
    return isRecord(value) && typeof value.id === "number" && typeof value.name === "string";
}

function isImage(value: unknown): value is ReferenceImage {
    return isRecord(value) && typeof value.id === "string" && typeof value.name === "string" && typeof value.type === "string" && typeof value.dataUrl === "string" && isRemoteUrl(value.dataUrl);
}

function isVideo(value: unknown): value is ReferenceVideo {
    return isRecord(value) && typeof value.id === "string" && typeof value.name === "string" && typeof value.type === "string" && typeof value.url === "string" && isRemoteUrl(value.url);
}

function readImageSettings(value: unknown): HomepageImageSettings | undefined {
    if (!isRecord(value)) return undefined;
    const quality = readText(value, "quality");
    const imageResolution = readText(value, "imageResolution");
    const size = readText(value, "size");
    const count = readText(value, "count");
    const imageModel = readText(value, "imageModel");
    if (!quality || !imageResolution || !size || !count || imageModel === null) return undefined;
    return { quality, imageResolution, size, count, imageModel };
}

function readVideoSettings(value: unknown): HomepageVideoSettings | undefined {
    if (!isRecord(value)) return undefined;
    const videoGenerationMode = value.videoGenerationMode;
    const vquality = readText(value, "vquality");
    const size = readText(value, "size");
    const videoSeconds = readText(value, "videoSeconds");
    const videoWatermark = readText(value, "videoWatermark");
    const videoModel = readText(value, "videoModel");
    if (!videoModes.has(videoGenerationMode as VideoGenerationMode) || !vquality || !size || !videoSeconds || !videoWatermark || videoModel === null) return undefined;
    return { videoGenerationMode: videoGenerationMode as VideoGenerationMode, vquality, size, videoSeconds, videoWatermark, videoModel };
}

export function parseHomepageCreationDraft(value: unknown): HomepageCreationDraft | null {
    if (!isRecord(value) || (value.target !== "image" && value.target !== "video") || typeof value.prompt !== "string" || !value.prompt.trim()) return null;
    return {
        target: value.target,
        prompt: value.prompt,
        creationMode: value.creationMode === "chat" ? "chat" : "agent",
        styles: Array.isArray(value.styles) ? value.styles.filter(isStyle) : [],
        skill: isSkill(value.skill) ? value.skill : null,
        images: Array.isArray(value.images) ? value.images.filter(isImage) : [],
        videos: Array.isArray(value.videos) ? value.videos.filter(isVideo) : [],
        imageSettings: readImageSettings(value.imageSettings),
        videoSettings: readVideoSettings(value.videoSettings),
    };
}

function readDraft(): HomepageCreationDraft | null {
    const stored = readStorage()?.getItem(STORAGE_KEY);
    if (!stored) return null;
    try {
        return parseHomepageCreationDraft(JSON.parse(stored));
    } catch {
        return null;
    }
}

/** 只读取对应页面的草稿，不删除，方便刷新前重复挂载。 */
export function peekHomepageCreationHandoff(target: HomepageCreationTarget): HomepageCreationDraft | null {
    const draft = readDraft();
    return draft?.target === target ? draft : null;
}

/** 页面确认开始生成后删除草稿，避免刷新再次提交。 */
export function consumeHomepageCreationHandoff(target: HomepageCreationTarget): HomepageCreationDraft | null {
    const draft = peekHomepageCreationHandoff(target);
    if (!draft) return null;
    readStorage()?.removeItem(STORAGE_KEY);
    return draft;
}

export function clearHomepageCreationHandoff() {
    readStorage()?.removeItem(STORAGE_KEY);
}

/** 本地临时地址不能带去下一个页面；存在未上传完成的素材时拒绝保存。 */
export function storeHomepageCreationHandoff(draft: HomepageCreationDraft): boolean {
    const images = draft.images.filter(isImage);
    const videos = draft.videos.filter(isVideo);
    if (images.length !== draft.images.length || videos.length !== draft.videos.length) return false;
    const storage = readStorage();
    if (!storage) return false;
    try {
        storage.setItem(STORAGE_KEY, JSON.stringify({ ...draft, images, videos }));
        return true;
    } catch {
        return false;
    }
}

/** 跳转后的页面用草稿覆盖当前配置。模型留空时保留登录后从服务端恢复的模型。 */
export function applyHomepageCreationSettings(draft: HomepageCreationDraft, updateConfig: <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void) {
    const image = draft.target === "image" ? draft.imageSettings : undefined;
    if (image) {
        updateConfig("quality", image.quality);
        updateConfig("imageResolution", image.imageResolution);
        updateConfig("size", image.size);
        updateConfig("count", image.count);
        if (image.imageModel) updateConfig("imageModel", image.imageModel);
    }
    const video = draft.target === "video" ? draft.videoSettings : undefined;
    if (video) {
        updateConfig("videoGenerationMode", video.videoGenerationMode);
        updateConfig("vquality", video.vquality);
        updateConfig("size", video.size);
        updateConfig("videoSeconds", video.videoSeconds);
        updateConfig("videoWatermark", video.videoWatermark);
        if (video.videoModel) updateConfig("videoModel", video.videoModel);
    }
}
