import { resolveModelRequestConfig, type AiConfig } from "@/features/settings/stores/use-config-store";

export type AgnesVideoResolution = "480p" | "720p" | "1080p";
export type AgnesVideoRatio = "16:9" | "9:16" | "1:1" | "4:3" | "3:4";

export const agnesVideoRatioOptions: Array<{ value: AgnesVideoRatio; label: string }> = [
    { value: "16:9", label: "横屏" },
    { value: "9:16", label: "竖屏" },
    { value: "1:1", label: "方形" },
    { value: "4:3", label: "标准横屏" },
    { value: "3:4", label: "标准竖屏" },
];

export const agnesVideoDurationOptions = [3, 5, 10, 18];

const AGNES_VIDEO_MIN_FRAME_RATE = 1;
const AGNES_VIDEO_MAX_FRAME_RATE = 60;

const agnesVideoMaxFrames: Record<AgnesVideoResolution, number> = {
    "1080p": 169,
    "720p": 409,
    "480p": 961,
};

const agnesVideoDimensionsByResolution: Record<AgnesVideoResolution, Record<AgnesVideoRatio, { width: number; height: number }>> = {
    "1080p": {
        "16:9": { width: 1920, height: 1088 },
        "9:16": { width: 1088, height: 1920 },
        "1:1": { width: 1472, height: 1472 },
        "4:3": { width: 1664, height: 1216 },
        "3:4": { width: 1216, height: 1664 },
    },
    "720p": {
        "16:9": { width: 1280, height: 704 },
        "9:16": { width: 704, height: 1280 },
        "1:1": { width: 960, height: 960 },
        "4:3": { width: 1088, height: 832 },
        "3:4": { width: 832, height: 1088 },
    },
    "480p": {
        "16:9": { width: 832, height: 480 },
        "9:16": { width: 480, height: 832 },
        "1:1": { width: 640, height: 640 },
        "4:3": { width: 704, height: 512 },
        "3:4": { width: 512, height: 704 },
    },
};

const agnesVideoTimingPresets = [
    { seconds: 3, numFrames: 81, frameRate: 24 },
    { seconds: 5, numFrames: 121, frameRate: 24 },
    { seconds: 10, numFrames: 241, frameRate: 24 },
    { seconds: 18, numFrames: 441, frameRate: 24 },
];

export function isAgnesVideoConfig(config: AiConfig, model = config.videoModel || config.model) {
    return resolveModelRequestConfig(config, model).apiFormat === "agnes";
}

export function normalizeAgnesVideoResolution(value: string): AgnesVideoResolution {
    if (value === "1080p" || value === "1080") return "1080p";
    if (value === "480p" || value === "480" || value === "low") return "480p";
    return "720p";
}

export function normalizeAgnesVideoRatio(value: string): AgnesVideoRatio {
    if (agnesVideoRatioOptions.some((item) => item.value === value)) return value as AgnesVideoRatio;
    const match = String(value || "").match(/^(\d+)x(\d+)$/);
    if (!match) return "16:9";
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!width || !height) return "16:9";
    const ratio = width / height;
    const ratios: Array<[AgnesVideoRatio, number]> = [
        ["16:9", 16 / 9],
        ["9:16", 9 / 16],
        ["1:1", 1],
        ["4:3", 4 / 3],
        ["3:4", 3 / 4],
    ];
    return ratios.reduce((best, item) => (Math.abs(item[1] - ratio) < Math.abs(best[1] - ratio) ? item : best), ratios[0])[0];
}

export function agnesVideoDimensions(size: string, resolution: string) {
    const normalizedResolution = normalizeAgnesVideoResolution(resolution);
    const ratio = normalizeAgnesVideoRatio(size);
    return { ...agnesVideoDimensionsByResolution[normalizedResolution][ratio], resolution: normalizedResolution, ratio };
}

export function agnesVideoPixelLabel(resolution: string, ratio: string) {
    const dimensions = agnesVideoDimensions(ratio, resolution);
    return `${dimensions.width}x${dimensions.height}`;
}

export function agnesVideoMaxSeconds(resolution: string) {
    return agnesVideoMaxFrames[normalizeAgnesVideoResolution(resolution)] / AGNES_VIDEO_MIN_FRAME_RATE;
}

export function normalizeAgnesVideoSeconds(value: string, resolution: string) {
    const seconds = Math.floor(Number(value) || 6);
    return String(Math.max(1, Math.min(15, agnesVideoMaxSeconds(resolution), seconds)));
}

export function agnesVideoTiming(value: string, resolution: string) {
    const normalizedResolution = normalizeAgnesVideoResolution(resolution);
    const maxFrames = agnesVideoMaxFrames[normalizedResolution];
    const seconds = Number(normalizeAgnesVideoSeconds(value, normalizedResolution));
    const preset = agnesVideoTimingPresets.find((item) => item.seconds === seconds && item.numFrames <= maxFrames);
    if (preset) return { seconds, actualSeconds: preset.numFrames / preset.frameRate, numFrames: preset.numFrames, frameRate: preset.frameRate, maxFrames, resolution: normalizedResolution };

    let best = { numFrames: Math.min(maxFrames, 9), frameRate: AGNES_VIDEO_MIN_FRAME_RATE, error: Number.POSITIVE_INFINITY };
    for (let frameRate = AGNES_VIDEO_MIN_FRAME_RATE; frameRate <= AGNES_VIDEO_MAX_FRAME_RATE; frameRate += 1) {
        const numFrames = agnesAlignedFrameCount(seconds, frameRate, maxFrames);
        if (numFrames > maxFrames) continue;
        const error = Math.abs(numFrames / frameRate - seconds);
        if (error < best.error || (error === best.error && frameRate > best.frameRate)) {
            best = { numFrames, frameRate, error };
        }
    }
    return { seconds, actualSeconds: best.numFrames / best.frameRate, numFrames: best.numFrames, frameRate: best.frameRate, maxFrames, resolution: normalizedResolution };
}

function agnesAlignedFrameCount(seconds: number, frameRate: number, maxFrames: number) {
    return Math.max(9, Math.min(maxFrames, agnesRawAlignedFrameCount(seconds, frameRate)));
}

function agnesRawAlignedFrameCount(seconds: number, frameRate: number) {
    return Math.round((seconds * frameRate - 1) / 8) * 8 + 1;
}
