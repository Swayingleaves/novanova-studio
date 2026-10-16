
import { translateMessage as translate } from "@/features/locale/translate";
import type { AiConfig, VideoBillingConfiguration, VideoGenerationMode, VideoResolution } from "@/features/settings/stores/use-config-store";

/** 按调用方语言生成显示文案，业务值保持不变。 */
export const createVideoGenerationModeOptions = (translator: typeof translate = translate): Array<{ value: VideoGenerationMode; label: string }> => ([
    { value: "text-to-video", get label() { return translator("generation.textToVideo"); } },
    { value: "image-to-video", get label() { return translator("generation.imageToVideo"); } },
    { value: "reference-to-video", get label() { return translator("generation.universalReference"); } },
]);

export const VIDEO_GENERATION_MODE_OPTIONS = createVideoGenerationModeOptions();

/** 管理员配置模型能力时可选择的全部视频模式。 */
/** 按调用方语言生成显示文案，业务值保持不变。 */
export const createVideoGenerationCapabilityOptions = (translator: typeof translate = translate): Array<{ value: VideoGenerationMode; label: string }> => ([
    ...createVideoGenerationModeOptions(translator),
    { value: "first-last-frame-to-video", get label() { return translator("generation.nativeFirstAndLastFrames"); } },
]);

export const VIDEO_GENERATION_CAPABILITY_OPTIONS = createVideoGenerationCapabilityOptions();

export const VIDEO_RESOLUTION_OPTIONS: Array<{ value: VideoResolution; label: string }> = [
    { value: "auto", label: "Auto" },
    { value: "480p", label: "480P" },
    { value: "720p", label: "720P" },
    { value: "768p", label: "768P" },
    { value: "1080p", label: "1080P" },
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
          credits: number;
          billingUnit: "generation" | "second";
          unitPrice: number;
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
    imageReferenceCount?: number;
    audioReferenceCount?: number;
    videoReferenceCount?: number;
    taskCount?: number;
    /** 是否把参考素材缺失视为不可报价。预览报价传 false，纯计费预览不受素材影响；真实生成触发默认 true。 */
    requireReferences?: boolean;
};

export function readVideoModelBillingConfiguration(config: AiConfig, model: string) {
    return config.videoModelBillingConfigurations.find((item) => item.model === model) || null;
}

export function videoModelSupportsMode(config: AiConfig, model: string, mode: VideoGenerationMode) {
    const billing = readVideoModelBillingConfiguration(config, model);
    const prices = billing?.videoBillingConfiguration?.modePrices?.[mode];
    return Boolean(billing?.capabilities.includes(mode) && prices && Object.values(prices).some(isValidVideoPrice));
}

export function availableVideoModelsForMode(config: AiConfig, mode: VideoGenerationMode) {
    return config.videoModels.filter((model) => videoModelSupportsMode(config, model, mode));
}

export function availableVideoResolutions(config: AiConfig, model: string, mode: VideoGenerationMode) {
    const prices = readVideoModelBillingConfiguration(config, model)?.videoBillingConfiguration?.modePrices?.[mode] || {};
    return VIDEO_RESOLUTION_OPTIONS.filter((option) => isValidVideoPrice(prices[option.value])).map((option) => option.value);
}

export function quoteVideoGeneration(input: VideoGenerationQuoteInput): VideoGenerationQuote {
    const billing = readVideoModelBillingConfiguration(input.config, input.model);
    if (!input.model || !billing) return { available: false, reason: translate("generation.selectAConfiguredVideoModel") };
    if (!billing.capabilities.includes(input.mode)) return { available: false, reason: translate("generation.selectedVideoModeIsNotConfigured") };
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
    const unitPrice = configuration.modePrices?.[input.mode]?.[resolution];
    if (!isValidVideoPrice(unitPrice)) return { available: false, reason: translate("generation.selectedResolutionHasNoPrice") };
    const seconds = parsePositiveInteger(input.seconds);
    if (seconds === null) return { available: false, reason: translate("generation.videoDurationMustBeAPositiveInteger") };
    if (!Number.isSafeInteger(configuration.minimumDurationSeconds) || configuration.minimumDurationSeconds < 1) {
        return { available: false, reason: translate("generation.invalidMinimumVideoDuration") };
    }
    if (seconds < configuration.minimumDurationSeconds) {
        return { available: false, reason: translate("generation.videoDurationMustBeAtLeastSeconds", { value0: configuration.minimumDurationSeconds }) };
    }
    const taskCount = parsePositiveInteger(input.taskCount ?? 1);
    if (taskCount === null) return { available: false, reason: translate("generation.videoTaskCountMustBeAPositiveInteger") };
    const total = configuration.billingUnit === "second" ? unitPrice * seconds * taskCount : unitPrice * taskCount;
    if (!Number.isSafeInteger(total)) return { available: false, reason: translate("generation.generationCreditCalculationExceedsRange") };
    return { available: true, credits: total, billingUnit: configuration.billingUnit, unitPrice, durationSeconds: seconds, taskCount };
}

export function createVideoBillingConfiguration(): VideoBillingConfiguration {
    return {
        billingUnit: "generation",
        minimumDurationSeconds: 3,
        modePrices: {
            "text-to-video": {},
            "image-to-video": {},
            "reference-to-video": {},
            "first-last-frame-to-video": {},
        },
    };
}

/** 返回视频生成模式与参考素材不匹配的原因；空字符串表示可提交。 */
export function videoGenerationReferenceIssue(mode: VideoGenerationMode, imageReferenceCount: number, videoReferenceCount: number, audioReferenceCount = 0) {
    if (audioReferenceCount && mode !== "reference-to-video") return translate("generation.audioInputRequiresUniversalReferenceMode");
    if (mode === "text-to-video" && (imageReferenceCount || videoReferenceCount)) return translate("generation.textToVideoCannotIncludeReferences");
    if (mode === "image-to-video" && imageReferenceCount < 1) return translate("generation.imageToVideoNeedsAtLeastOneImage");
    if (mode === "image-to-video" && videoReferenceCount) return translate("generation.imageToVideoCannotIncludeVideoReferences");
    if (mode === "reference-to-video" && imageReferenceCount + videoReferenceCount + audioReferenceCount < 1) return translate("generation.universalReferenceNeedsAtLeastOneAsset");
    return "";
}

function parsePositiveInteger(value: string | number) {
    const text = String(value).trim();
    if (!/^\d+$/.test(text)) return null;
    const number = Number(text);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function isValidVideoPrice(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
