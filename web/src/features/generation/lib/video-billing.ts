import { creditAmount, creditText } from "@/shared/lib/credit-amounts";
import type { CreditAmount } from "@/shared/lib/credit-amounts";

import { translateMessage as translate } from "@/features/locale/translate";
import type { AiConfig, VideoBillingConfiguration, VideoGenerationMode, VideoResolution } from "@/features/settings/stores/use-config-store";
import { readVideoGenerationConstraintIssue } from "./video-generation-constraints";

/** 按调用方语言生成显示文案，业务值保持不变。 */
export const createVideoGenerationModeOptions = (translator: typeof translate = translate): Array<{ value: VideoGenerationMode; label: string }> => ([
    { value: "text-to-video", get label() { return translator("generation.textToVideo"); } },
    { value: "image-to-video", get label() { return translator("generation.imageToVideo"); } },
    { value: "reference-to-video", get label() { return translator("generation.universalReference"); } },
    { value: "first-last-frame-to-video", get label() { return translator("generation.nativeFirstAndLastFrames"); } },
]);

export const VIDEO_GENERATION_MODE_OPTIONS = createVideoGenerationModeOptions();

/** 管理员配置模型能力时可选择的全部视频模式。 */
/** 按调用方语言生成显示文案，业务值保持不变。 */
export const createVideoGenerationCapabilityOptions = (translator: typeof translate = translate): Array<{ value: VideoGenerationMode; label: string }> => ([
    ...createVideoGenerationModeOptions(translator),
]);

export const VIDEO_GENERATION_CAPABILITY_OPTIONS = createVideoGenerationCapabilityOptions();

export const VIDEO_RESOLUTION_OPTIONS: Array<{ value: VideoResolution; label: string }> = [
    { value: "auto", label: "Auto" },
    { value: "480p", label: "480P" },
    { value: "720p", label: "720P" },
    { value: "768p", label: "768P" },
    { value: "1080p", label: "1080P" },
    { value: "1088p", label: "1088P" },
    { value: "1440p", label: "1440P" },
    { value: "2k", label: "2K" },
    { value: "4k", label: "4K" },
];

/** 返回视频生成模式的界面名称。 */
export function videoGenerationModeLabel(mode: VideoGenerationMode): string {
    return VIDEO_GENERATION_CAPABILITY_OPTIONS.find((item) => item.value === mode)?.label || translate("generation.videoGeneration");
}

export type VideoGenerationQuote =
    | {
          available: true;
          credits: CreditAmount;
          billingUnit: "generation" | "second";
          unitPrice: CreditAmount;
          durationSeconds: number;
          taskCount: number;
      }
    | { available: false; reason: string };

type VideoGenerationQuoteInput = {
    config: AiConfig;
    model: string;
    mode: VideoGenerationMode;
    resolution: string;
    seconds: string | number;
    size?: string;
    imageReferenceCount?: number;
    audioReferenceCount?: number;
    videoReferenceCount?: number;
    taskCount?: number;
    /** 是否把参考素材缺失视为不可报价。预览报价传 false，纯计费预览不受素材影响；真实生成触发默认 true。 */
    requireReferences?: boolean;
};

export const DEFAULT_VIDEO_MAXIMUM_DURATION_SECONDS = 15;
export const UNLIMITED_VIDEO_DURATION_SECONDS = -1;

/** 返回生效的最长时间（秒）；未填或为空默认 15 秒，-1 表示不限制并返回 null。 */
export function resolveBillingMaximumDurationSeconds(configuration?: Pick<VideoBillingConfiguration, "maximumDurationSeconds"> | null): number | null {
    const value = configuration?.maximumDurationSeconds;
    if (value === undefined || value === null) return DEFAULT_VIDEO_MAXIMUM_DURATION_SECONDS;
    return value === UNLIMITED_VIDEO_DURATION_SECONDS ? null : value;
}

export function readVideoModelBillingConfiguration(config: AiConfig, model: string) {
    return config.videoModelBillingConfigurations.find((item) => item.model === model) || null;
}

export function videoModelSupportsMode(config: AiConfig, model: string, mode: VideoGenerationMode) {
    const billing = readVideoModelBillingConfiguration(config, model);
    if (!billing?.capabilities.includes(mode)) return false;
    const prices = billing.videoBillingConfiguration?.modePrices?.[mode];
    if (prices && Object.values(prices).some(isValidVideoPrice)) return true;
    if (mode === "reference-to-video") {
        const videoInputPrices = billing.videoBillingConfiguration?.referenceVideoInputPrices;
        if (videoInputPrices && Object.values(videoInputPrices).some(isValidVideoPrice)) return true;
    }
    return false;
}

export function availableVideoModelsForMode(config: AiConfig, mode: VideoGenerationMode) {
    return config.videoModels.filter((model) => videoModelSupportsMode(config, model, mode));
}

export function availableVideoResolutions(config: AiConfig, model: string, mode: VideoGenerationMode) {
    const configuration = readVideoModelBillingConfiguration(config, model)?.videoBillingConfiguration;
    const prices = configuration?.modePrices?.[mode] || {};
    const videoInputPrices = mode === "reference-to-video" ? configuration?.referenceVideoInputPrices || {} : {};
    return VIDEO_RESOLUTION_OPTIONS.filter((option) => isValidVideoPrice(prices[option.value]) || isValidVideoPrice(videoInputPrices[option.value])).map((option) => option.value);
}

/** 根据模式、分辨率和是否包含视频参考输入解析单价；全能参考有视频输入时优先使用独立价格，未配置时回退无视频输入价格。 */
export function resolveVideoUnitPrice(
    configuration: VideoBillingConfiguration | null | undefined,
    mode: VideoGenerationMode,
    resolution: VideoResolution,
    hasVideoReference: boolean,
): CreditAmount | undefined {
    if (mode === "reference-to-video" && hasVideoReference) {
        const videoInputPrice = configuration?.referenceVideoInputPrices?.[resolution];
        if (isValidVideoPrice(videoInputPrice)) return videoInputPrice;
    }
    return configuration?.modePrices?.[mode]?.[resolution];
}

export function quoteVideoGeneration(input: VideoGenerationQuoteInput): VideoGenerationQuote {
    const billing = readVideoModelBillingConfiguration(input.config, input.model);
    if (!input.model || !billing) return { available: false, reason: translate("generation.selectAConfiguredVideoModel") };
    if (!billing.capabilities.includes(input.mode)) return { available: false, reason: translate("generation.selectedVideoModeIsNotConfigured") };
    const constraintIssue = readVideoGenerationConstraintIssue({ config: input.config, model: input.model, mode: input.mode, size: input.size,
        seconds: input.seconds, imageCount: input.imageReferenceCount, videoCount: input.videoReferenceCount, audioCount: input.audioReferenceCount, requireReferences: input.requireReferences });
    if (constraintIssue) return { available: false, reason: constraintIssue };
    const configuration = billing.videoBillingConfiguration;
    if (!configuration) return { available: false, reason: translate("generation.videoTierPricesAreNotConfigured") };
    if (configuration.billingUnit !== "generation" && configuration.billingUnit !== "second") {
        return { available: false, reason: translate("generation.invalidVideoBillingConfiguration") };
    }
    if (input.audioReferenceCount && !input.config.modelCapabilities.find((item) => item.model === input.model)?.capabilities.includes("audio-input")) return { available: false, reason: translate("generation.audioInputIsDisabledForThisModel") };
    const materialIssue = videoGenerationReferenceIssue(input.mode, input.imageReferenceCount || 0, input.videoReferenceCount || 0, input.audioReferenceCount || 0);
    if (input.requireReferences !== false && materialIssue) return { available: false, reason: materialIssue };
    const resolution = input.resolution.trim().toLowerCase() as VideoResolution;
    if (!VIDEO_RESOLUTION_OPTIONS.some((option) => option.value === resolution)) {
        return { available: false, reason: translate("generation.selectedVideoResolutionIsUnsupported") };
    }
    const hasVideoReference = (input.videoReferenceCount || 0) > 0;
    const unitPrice = resolveVideoUnitPrice(configuration, input.mode, resolution, hasVideoReference);
    if (!isValidVideoPrice(unitPrice)) return { available: false, reason: translate("generation.selectedResolutionHasNoPrice") };
    const seconds = parsePositiveInteger(input.seconds);
    if (seconds === null) return { available: false, reason: translate("generation.videoDurationMustBeAPositiveInteger") };
    if (!Number.isSafeInteger(configuration.minimumDurationSeconds) || configuration.minimumDurationSeconds < 1) {
        return { available: false, reason: translate("generation.invalidMinimumVideoDuration") };
    }
    const rawMaximum = configuration.maximumDurationSeconds;
    if (rawMaximum !== undefined && rawMaximum !== null && rawMaximum !== UNLIMITED_VIDEO_DURATION_SECONDS) {
        if (!Number.isSafeInteger(rawMaximum) || rawMaximum < 1 || rawMaximum < configuration.minimumDurationSeconds) {
            return { available: false, reason: translate("generation.invalidMaximumVideoDuration") };
        }
    }
    const effectiveMaximum = resolveBillingMaximumDurationSeconds(configuration);
    if (seconds < configuration.minimumDurationSeconds) {
        return { available: false, reason: translate("generation.videoDurationMustBeAtLeastSeconds", { value0: configuration.minimumDurationSeconds }) };
    }
    if (effectiveMaximum !== null && seconds > effectiveMaximum) {
        return { available: false, reason: translate("generation.videoDurationMustNotExceedSeconds", { value0: effectiveMaximum }) };
    }
    const taskCount = parsePositiveInteger(input.taskCount ?? 1);
    if (taskCount === null) return { available: false, reason: translate("generation.videoTaskCountMustBeAPositiveInteger") };
    const total = creditText(creditAmount(unitPrice).times(configuration.billingUnit === "second" ? seconds : 1).times(taskCount));
    if (!creditAmount(total).isFinite()) return { available: false, reason: translate("generation.generationCreditCalculationExceedsRange") };
    return { available: true, credits: total, billingUnit: configuration.billingUnit, unitPrice, durationSeconds: seconds, taskCount };
}

/**
 * 切换视频模型或生成模式后，自动校准分辨率、画幅比例、生成模式和时长，
 * 避免残留上一个模型不支持的配置导致计费不可用或按钮置灰。
 */
export function reconcileVideoSettingsForModel(
    config: AiConfig,
    nextModel: string,
    nextMode?: VideoGenerationMode,
    resolutionOptionsOverride?: VideoResolution[],
): {
    videoGenerationMode?: VideoGenerationMode;
    vquality?: VideoResolution;
    size?: string;
    videoSeconds?: string;
} {
    const trimmedModel = (nextModel || "").trim();
    if (!trimmedModel) return {};

    const patch: {
        videoGenerationMode?: VideoGenerationMode;
        vquality?: VideoResolution;
        size?: string;
        videoSeconds?: string;
    } = {};

    // 1. 生成模式：新模型不支持当前模式时，回退到该模型支持的首个模式
    const currentMode = nextMode || config.videoGenerationMode;
    let effectiveMode = currentMode;
    const allModes: VideoGenerationMode[] = ["text-to-video", "image-to-video", "reference-to-video", "first-last-frame-to-video"];
    if (!videoModelSupportsMode(config, trimmedModel, currentMode)) {
        const fallbackMode = allModes.find((mode) => videoModelSupportsMode(config, trimmedModel, mode));
        if (fallbackMode && fallbackMode !== currentMode) {
            effectiveMode = fallbackMode;
            patch.videoGenerationMode = fallbackMode;
        }
    }

    // 2. 分辨率：当前分辨率不在新模型/模式的计费档位内时，回退到首个可用分辨率
    const pricedResolutions = resolutionOptionsOverride || availableVideoResolutions(config, trimmedModel, effectiveMode);
    const currentRes = (config.vquality || "").trim().toLowerCase();
    if (pricedResolutions.length > 0 && !pricedResolutions.includes(currentRes as VideoResolution)) {
        patch.vquality = pricedResolutions[0];
    }

    // 3. 画幅比例：若新模型配置了支持比例清单且当前比例不在其中，回退到首个支持比例
    const billingEntry = readVideoModelBillingConfiguration(config, trimmedModel);
    const constraints = billingEntry?.videoGenerationConstraints?.[effectiveMode];
    const supportedRatios = constraints?.supportedAspectRatios;
    if (supportedRatios?.length) {
        const rawSize = (config.size || "").trim();
        const normalizedSize = rawSize === "adaptive" ? "auto" : rawSize;
        if (!supportedRatios.includes(normalizedSize)) {
            patch.size = supportedRatios[0];
        }
    }

    // 4. 时长：将当前时长钳制到新模型（含计费与模式约束）的有效区间内
    const billingMin = billingEntry?.videoBillingConfiguration?.minimumDurationSeconds || 1;
    const billingMax = resolveBillingMaximumDurationSeconds(billingEntry?.videoBillingConfiguration);
    const customMin = constraints?.minimumDurationSeconds;
    const customMax = constraints?.maximumDurationSeconds;
    const effectiveMin = typeof customMin === "number" && Number.isSafeInteger(customMin) && customMin > 0
        ? Math.max(customMin, billingMin)
        : billingMin;
    const effectiveMax = typeof customMax === "number" && Number.isSafeInteger(customMax) && customMax > 0
        ? (billingMax !== null ? Math.min(customMax, billingMax) : customMax)
        : billingMax;
    const parsedSeconds = parsePositiveInteger(config.videoSeconds);
    if (parsedSeconds !== null && (effectiveMax === null || effectiveMin <= effectiveMax)) {
        const clamped = effectiveMax !== null
            ? Math.min(effectiveMax, Math.max(effectiveMin, parsedSeconds))
            : Math.max(effectiveMin, parsedSeconds);
        if (clamped !== parsedSeconds) {
            patch.videoSeconds = String(clamped);
        }
    }

    return patch;
}

export function createVideoBillingConfiguration(): VideoBillingConfiguration {
    return {
        billingUnit: "generation",
        minimumDurationSeconds: 3,
        maximumDurationSeconds: DEFAULT_VIDEO_MAXIMUM_DURATION_SECONDS,
        modePrices: {
            "text-to-video": {},
            "image-to-video": {},
            "reference-to-video": {},
            "first-last-frame-to-video": {},
        },
        referenceVideoInputPrices: {},
    };
}

/** 返回视频生成模式与参考素材不匹配的原因；空字符串表示可提交。 */
export function videoGenerationReferenceIssue(mode: VideoGenerationMode, imageReferenceCount: number, videoReferenceCount: number, audioReferenceCount = 0) {
    if (audioReferenceCount && mode !== "reference-to-video") return translate("generation.audioInputRequiresUniversalReferenceMode");
    if (mode === "text-to-video" && (imageReferenceCount || videoReferenceCount)) return translate("generation.textToVideoCannotIncludeReferences");
    if (mode === "image-to-video" && imageReferenceCount < 1) return translate("generation.imageToVideoNeedsAtLeastOneImage");
    if (mode === "image-to-video" && videoReferenceCount) return translate("generation.imageToVideoCannotIncludeVideoReferences");
    if (mode === "first-last-frame-to-video" && (imageReferenceCount !== 2 || videoReferenceCount)) return translate("generation.videoConstraintImageModeConflict");
    if (mode === "reference-to-video" && imageReferenceCount + videoReferenceCount + audioReferenceCount < 1) return translate("generation.universalReferenceNeedsAtLeastOneAsset");
    return "";
}

function parsePositiveInteger(value: string | number) {
    const text = String(value).trim();
    if (!/^\d+$/.test(text)) return null;
    const number = Number(text);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function isValidVideoPrice(value: unknown): value is CreditAmount {
    return (typeof value === "number" || typeof value === "string") && creditAmount(value).isFinite() && !creditAmount(value).isNegative();
}
