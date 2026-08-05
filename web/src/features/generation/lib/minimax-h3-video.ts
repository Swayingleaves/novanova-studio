import { modelOptionName, resolveModelRequestConfig, type AiConfig } from "@/features/settings/stores/use-config-store";

export type MiniMaxH3Resolution = "768p" | "2k";
export type MiniMaxH3Ratio = "adaptive" | "21:9" | "16:9" | "4:3" | "1:1" | "3:4" | "9:16";

export const miniMaxH3ResolutionOptions: MiniMaxH3Resolution[] = ["768p", "2k"];

const MINI_MAX_H3_RATIOS = new Set<MiniMaxH3Ratio>(["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"]);
const PRESET_SIZE_RATIOS: Record<string, MiniMaxH3Ratio> = {
    "1280x720": "16:9",
    "960x720": "4:3",
    "720x720": "1:1",
    "720x960": "3:4",
    "720x1280": "9:16",
    "1680x720": "21:9",
};

export function isMiniMaxH3VideoConfig(config: AiConfig | Pick<AiConfig, "model" | "videoModel" | "baseUrl" | "apiFormat">) {
    const requestConfig = "channels" in config ? resolveModelRequestConfig(config, config.model || config.videoModel) : config;
    return requestConfig.apiFormat === "minimax"
        && normalizeText(modelOptionName(requestConfig.model || requestConfig.videoModel)) === "minimax-h3";
}

export function normalizeMiniMaxH3Resolution(value: string): MiniMaxH3Resolution {
    const normalized = normalizeText(value);
    if (normalized === "2k") return "2k";
    return "768p";
}

export function normalizeMiniMaxH3Ratio(value: string): MiniMaxH3Ratio {
    const normalized = normalizeText(value);
    if (normalized === "auto") return "16:9";
    if (MINI_MAX_H3_RATIOS.has(normalized as MiniMaxH3Ratio)) return normalized as MiniMaxH3Ratio;
    return PRESET_SIZE_RATIOS[normalized] || "16:9";
}

export function normalizeMiniMaxH3Duration(value: string): number {
    const parsed = Math.floor(Number(value));
    if (!Number.isFinite(parsed)) return 5;
    return Math.max(4, Math.min(15, parsed));
}

export function normalizeMiniMaxH3VideoSettings(vquality: string, size: string, videoSeconds: string) {
    return {
        vquality: normalizeMiniMaxH3Resolution(vquality),
        size: normalizeMiniMaxH3Ratio(size),
        videoSeconds: String(normalizeMiniMaxH3Duration(videoSeconds)),
    };
}

function normalizeText(value: string) {
    return String(value || "").trim().toLowerCase().replace(/\s+/g, "");
}
