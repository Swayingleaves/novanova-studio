import { agnesVideoMaxSeconds, isAgnesVideoConfig } from "./agnes-video";
import { isMiniMaxH3VideoConfig } from "./minimax-h3-video";
import { isSeedanceVideoConfig } from "./seedance-video";
import { resolveModelRequestConfig, type AiConfig } from "@/features/settings/stores/use-config-store";

export type VideoDurationRange = {
    min: number;
    max: number;
};

/**
 * 读取当前视频模型支持的生成时长范围。
 */
export function readVideoDurationRange(config: AiConfig): VideoDurationRange {
    const resolvedConfig = resolveModelRequestConfig(config, config.videoModel || config.model);
    if (isSeedanceVideoConfig(resolvedConfig) || isMiniMaxH3VideoConfig(resolvedConfig)) return { min: 4, max: 15 };
    if (isAgnesVideoConfig(resolvedConfig)) return { min: 1, max: Math.min(15, Math.floor(agnesVideoMaxSeconds(resolvedConfig.vquality))) };
    return { min: 1, max: 15 };
}

/**
 * 判断镜头时长是否被当前视频模型支持。
 */
export function isVideoDurationSupported(config: AiConfig, durationSeconds: number): boolean {
    if (!Number.isSafeInteger(durationSeconds) || durationSeconds < 1) return false;
    const range = readVideoDurationRange(config);
    return durationSeconds >= range.min && durationSeconds <= range.max;
}
