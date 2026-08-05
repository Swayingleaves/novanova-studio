export type ImageGenerationSettingsSummaryParts = {
    quality?: string | null;
    resolution?: string | null;
    ratio?: string | null;
    model?: string | null;
};

export type VideoGenerationSettingsSummaryParts = {
    resolution?: string | null;
    ratio?: string | null;
    duration?: string | null;
    model?: string | null;
};

/** 格式化图片页的设置摘要，按画质、清晰度、比例、模型顺序输出。 */
export function formatImageGenerationSettingsSummary(parts: ImageGenerationSettingsSummaryParts): string {
    return joinSummaryParts(imageQualitySummaryLabel(parts.quality), parts.resolution, parts.ratio, parts.model);
}

/** 格式化视频页的设置摘要，按清晰度、比例、时长、模型顺序输出。 */
export function formatVideoGenerationSettingsSummary(parts: VideoGenerationSettingsSummaryParts): string {
    return joinSummaryParts(parts.resolution, parts.ratio, parts.duration, parts.model);
}

/** 将图片画质转换为摘要中的紧凑文案。 */
export function imageQualitySummaryLabel(value?: string | null): string {
    const raw = String(value ?? "").trim();
    const normalized = raw.toLowerCase();
    if (!raw) return "";
    if (normalized === "low" || normalized === "低" || normalized === "低画质") return "低";
    if (normalized === "medium" || normalized === "standard" || normalized === "标准" || normalized === "标准画质") return "标准";
    if (normalized === "high" || normalized === "高" || normalized === "高画质") return "高";
    return raw.endsWith("画质") ? raw.slice(0, -2) : raw;
}

function joinSummaryParts(...parts: Array<string | null | undefined>): string {
    return parts.map(normalizeSummaryPart).filter(Boolean).join("|");
}

function normalizeSummaryPart(value: string | null | undefined): string {
    return String(value ?? "")
        .replaceAll("|", "/")
        .trim();
}
