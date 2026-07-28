import { modelOptionName, resolveModelRequestConfig, type AiConfig } from "@/features/settings/stores/use-config-store";
import type { ReferenceImage } from "@/features/generation/types/image";
import type { ReferenceVideo } from "@/features/generation/types/media";

type SeedanceRatio = "16:9" | "4:3" | "1:1" | "3:4" | "9:16" | "21:9";
type SeedanceResolution = "480p" | "720p" | "1080p";
type ReferenceKind = "image" | "video";

export const SEEDANCE_REFERENCE_LIMITS = {
    images: 9,
    videos: 3,
    imageMaxBytes: 30 * 1024 * 1024,
    videoMaxBytes: 50 * 1024 * 1024,
};

export const seedanceResolutionOptions = [
    { value: "480p", label: "480p" },
    { value: "720p", label: "720p" },
    { value: "1080p", label: "1080p" },
] as const;

export const seedanceRatioOptions = [
    { value: "16:9", label: "横屏" },
    { value: "9:16", label: "竖屏" },
    { value: "1:1", label: "方形" },
    { value: "4:3", label: "标准横屏" },
    { value: "3:4", label: "标准竖屏" },
    { value: "21:9", label: "宽银幕" },
    { value: "adaptive", label: "自适应" },
] as const;

export const seedanceDurationOptions = [-1, 4, 5, 6, 8, 10, 12, 15] as const;

const resolutionValues = new Set<SeedanceResolution>(["480p", "720p", "1080p"]);
const ratioValues = new Set<SeedanceRatio>(["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"]);
const ratioCandidates: Array<{ value: SeedanceRatio; ratio: number }> = [
    { value: "16:9", ratio: 16 / 9 },
    { value: "4:3", ratio: 4 / 3 },
    { value: "1:1", ratio: 1 },
    { value: "3:4", ratio: 3 / 4 },
    { value: "9:16", ratio: 9 / 16 },
    { value: "21:9", ratio: 21 / 9 },
];
const seedancePixelMap: Record<SeedanceResolution, Record<SeedanceRatio, string>> = {
    "480p": {
        "16:9": "864x496",
        "4:3": "752x560",
        "1:1": "640x640",
        "3:4": "560x752",
        "9:16": "496x864",
        "21:9": "992x432",
    },
    "720p": {
        "16:9": "1280x720",
        "4:3": "1112x834",
        "1:1": "960x960",
        "3:4": "834x1112",
        "9:16": "720x1280",
        "21:9": "1470x630",
    },
    "1080p": {
        "16:9": "1920x1080",
        "4:3": "1664x1248",
        "1:1": "1440x1440",
        "3:4": "1248x1664",
        "9:16": "1080x1920",
        "21:9": "2206x946",
    },
};

export function isSeedanceVideoConfig(config: AiConfig | Pick<AiConfig, "model" | "videoModel" | "baseUrl" | "apiFormat">) {
    const requestConfig = "channels" in config ? resolveModelRequestConfig(config, config.model || config.videoModel) : config;
    return requestConfig.apiFormat === "seedance"
        || isSeedanceVideoModel(modelOptionName(requestConfig.model || requestConfig.videoModel))
        || isArkPlanBaseUrl(requestConfig.baseUrl);
}

export function isSeedanceVideoModel(model: string) {
    const name = normalizeText(model);
    return name.includes("seedance") || name.includes("doubao-seedance");
}

export function isSeedanceFastModel(model: string) {
    return isSeedanceVideoModel(model) && normalizeText(model).includes("fast");
}

export function isArkPlanBaseUrl(baseUrl: string) {
    return normalizeText(baseUrl).includes("/api/plan/v3");
}

export function normalizeSeedanceResolution(value: string, model = "") {
    const resolution = normalizeResolutionToken(value);
    if (resolution === "1080p" && isSeedanceFastModel(model)) return "720p";
    return resolutionValues.has(resolution as SeedanceResolution) ? resolution : "720p";
}

export function normalizeResolutionToken(value: string) {
    const token = normalizeText(value);
    if (token === "low") return "480p";
    if (token === "auto" || token === "medium" || token === "high") return "720p";
    const numeric = token.replace(/p$/, "");
    return `${numeric || "720"}p`;
}

export function normalizeSeedanceDuration(value: string) {
    if (String(value).trim() === "-1") return -1;
    const seconds = Math.floor(Number(value) || 5);
    return clamp(seconds, 4, 15);
}

export function normalizeSeedanceRatio(value: string) {
    const token = normalizeText(value).replace(/\s+/g, "");
    if (!token || token === "auto" || token === "adaptive") return "adaptive";
    if (ratioValues.has(token as SeedanceRatio)) return token;
    const size = token.match(/^(\d+)x(\d+)$/i);
    if (!size) return "adaptive";
    const width = Number(size[1]);
    const height = Number(size[2]);
    if (width <= 0 || height <= 0) return "adaptive";
    return nearestRatio(width / height);
}

export function seedancePixelLabel(resolution: string, ratio: string) {
    const normalizedRatio = normalizeSeedanceRatio(ratio);
    if (normalizedRatio === "adaptive") return "自动匹配";
    const normalizedResolution = normalizeSeedanceResolution(resolution) as SeedanceResolution;
    return seedancePixelMap[normalizedResolution][normalizedRatio as SeedanceRatio] || "";
}

export function boolConfig(value: string | undefined, fallback: boolean) {
    const normalized = normalizeText(value ?? "");
    if (normalized === "true") return true;
    if (normalized === "false") return false;
    return fallback;
}

export function seedanceReferenceLabel(kind: ReferenceKind, index: number) {
    const prefix: Record<ReferenceKind, string> = { image: "图片", video: "视频" };
    return `${prefix[kind]}${index + 1}`;
}

export function buildSeedancePromptText(prompt: string, images: ReferenceImage[], videos: ReferenceVideo[]) {
    const labels = [
        ...labelsForKind("image", images.length),
        ...labelsForKind("video", videos.length),
    ];
    const text = prompt.trim();
    if (!labels.length) return text;
    return `参考素材编号：${labels.join("、")}。请按这些编号理解提示词中的图片和视频引用。\n\n${text}`;
}

export function seedanceVideoReferenceError(videos: ReferenceVideo[]) {
    if (videos.length > SEEDANCE_REFERENCE_LIMITS.videos) return `Seedance 参考视频最多 ${SEEDANCE_REFERENCE_LIMITS.videos} 个`;
    let totalDurationMs = 0;
    for (const [index, video] of videos.entries()) {
        const label = seedanceReferenceLabel("video", index);
        const fileError = referenceFileError(label, video.bytes, SEEDANCE_REFERENCE_LIMITS.videoMaxBytes, "50MB");
        if (fileError) return fileError;
        const durationError = referenceDurationError(label, video.durationMs);
        if (durationError) return durationError;
        totalDurationMs += video.durationMs || 0;
        const sizeError = videoGeometryError(label, video.width, video.height);
        if (sizeError) return sizeError;
    }
    if (totalDurationMs > 15_000) return "Seedance 参考视频总时长不能超过 15 秒";
    return "";
}

export const seedanceVideoReferenceHint = "参考视频需为 mp4/mov，H.264/H.265，FPS 24-60；含真人人脸素材请使用火山授权 asset:// 素材。";

function labelsForKind(kind: ReferenceKind, count: number) {
    return Array.from({ length: count }, (_, index) => seedanceReferenceLabel(kind, index));
}

function nearestRatio(value: number) {
    return ratioCandidates.reduce((best, item) => (Math.abs(item.ratio - value) < Math.abs(best.ratio - value) ? item : best), ratioCandidates[0]).value;
}

function referenceFileError(label: string, bytes: number | undefined, maxBytes: number, readableSize: string) {
    return bytes && bytes > maxBytes ? `${label} 超过 ${readableSize}，请压缩后再上传` : "";
}

function referenceDurationError(label: string, durationMs: number | undefined) {
    if (!durationMs) return "";
    return durationMs < 2_000 || durationMs > 15_000 ? `${label} 时长需要在 2-15 秒之间` : "";
}

function videoGeometryError(label: string, width: number | undefined, height: number | undefined) {
    if (!width || !height) return "";
    if (width < 300 || width > 6000 || height < 300 || height > 6000) return `${label} 宽高需要在 300-6000px 之间`;
    const ratio = width / height;
    if (ratio < 0.4 || ratio > 2.5) return `${label} 宽高比需要在 0.4-2.5 之间`;
    const pixels = width * height;
    if (pixels < 640 * 640 || pixels > 2206 * 946) return `${label} 像素总量不符合 Seedance 要求，请转成 480p/720p/1080p 后再上传`;
    return "";
}

function normalizeText(value: string) {
    return String(value || "").trim().toLowerCase();
}

function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
}
