import { agnesVideoMaxSeconds, isAgnesVideoConfig } from "./agnes-video";
import { isMiniMaxH3VideoConfig } from "./minimax-h3-video";
import { isSeedanceVideoConfig } from "./seedance-video";
import { resolveModelRequestConfig, type AiConfig } from "@/features/settings/stores/use-config-store";
import { DEFAULT_VIDEO_MAXIMUM_DURATION_SECONDS, resolveBillingMaximumDurationSeconds } from "./video-billing";
import { readCustomVideoConstraints, readVideoModelConfiguration } from "./video-generation-constraints";

export type VideoDurationRange = {
    min: number;
    max: number;
    unlimited?: boolean;
};

/**
 * 读取当前视频模型支持的生成时长范围。
 */
export function readVideoDurationRange(config: AiConfig): VideoDurationRange {
    const model = readVideoModelConfiguration(config);
    const billingMax = resolveBillingMaximumDurationSeconds(model?.videoBillingConfiguration);
    if (model?.isCustomModel) {
        const constraints = readCustomVideoConstraints(config);
        const constraintMax = constraints?.maximumDurationSeconds ?? 0;
        const max = billingMax !== null && constraintMax ? Math.min(constraintMax, billingMax) : constraintMax || billingMax || 0;
        return { min: Math.max(constraints?.minimumDurationSeconds ?? 0, model.videoBillingConfiguration?.minimumDurationSeconds || 1), max };
    }
    const resolvedConfig = resolveModelRequestConfig(config, config.videoModel || config.model);
    if (isSeedanceVideoConfig(resolvedConfig) || isMiniMaxH3VideoConfig(resolvedConfig)) {
        return billingMax === null ? { min: 4, max: DEFAULT_VIDEO_MAXIMUM_DURATION_SECONDS, unlimited: true } : { min: 4, max: billingMax };
    }
    if (isAgnesVideoConfig(resolvedConfig)) {
        const defaultAgnesMax = Math.min(DEFAULT_VIDEO_MAXIMUM_DURATION_SECONDS, Math.floor(agnesVideoMaxSeconds(resolvedConfig.vquality)));
        return billingMax === null ? { min: 1, max: defaultAgnesMax, unlimited: true } : { min: 1, max: billingMax };
    }
    return billingMax === null ? { min: 1, max: DEFAULT_VIDEO_MAXIMUM_DURATION_SECONDS, unlimited: true } : { min: 1, max: billingMax };
}

/**
 * 判断镜头时长是否被当前视频模型支持。
 */
export function isVideoDurationSupported(config: AiConfig, durationSeconds: number): boolean {
    if (!Number.isSafeInteger(durationSeconds) || durationSeconds < 1) return false;
    const range = readVideoDurationRange(config);
    return durationSeconds >= range.min && (Boolean(range.unlimited) || durationSeconds <= range.max);
}
