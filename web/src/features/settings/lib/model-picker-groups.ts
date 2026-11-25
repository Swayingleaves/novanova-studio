import { modelOptionChannel, type AiConfig, type ModelCapability, type VideoGenerationMode } from "@/features/settings/stores/use-config-store";
import { SEEDANCE_REFERENCE_LIMITS } from "@/features/generation/lib/seedance-video";
import { resolveBillingMaximumDurationSeconds } from "@/features/generation/lib/video-billing";
import { creditAmount, creditText, type CreditAmount } from "@/shared/lib/credit-amounts";

export type ModelChannelGroup = {
    channelId: string;
    channelName: string;
    models: string[];
};

const DEFAULT_CHANNEL_GROUP_ID = "__default__";

/**
 * 将已排序的模型选项按所属渠道聚合为两层菜单分组，保留渠道和模型原有顺序。
 */
export function groupModelOptionsByChannel(
    options: string[],
    config: Pick<AiConfig, "channels">,
    fallbackChannelName: string,
): ModelChannelGroup[] {
    const groups = new Map<string, ModelChannelGroup>();
    for (const model of options) {
        const channel = modelOptionChannel(config as AiConfig, model);
        const channelId = channel?.id || DEFAULT_CHANNEL_GROUP_ID;
        const channelName = channel?.name?.trim() || fallbackChannelName;
        const existing = groups.get(channelId);
        if (existing) {
            existing.models.push(model);
        } else {
            groups.set(channelId, { channelId, channelName, models: [model] });
        }
    }
    return [...groups.values()];
}

/**
 * 计算当前激活的渠道 ID：优先保持用户悬停/点击的渠道，其次定位当前已选模型所属渠道，最后回退首个渠道。
 */
export function resolveActiveChannelId(
    groups: ModelChannelGroup[],
    currentModel: string,
    preferredChannelId?: string | null,
): string {
    if (!groups.length) return "";
    if (preferredChannelId && groups.some((group) => group.channelId === preferredChannelId)) {
        return preferredChannelId;
    }
    const matched = currentModel ? groups.find((group) => group.models.includes(currentModel)) : undefined;
    return matched?.channelId || groups[0].channelId;
}

export type ModelSuccessRateTone = "green" | "yellow" | "red";

/** 根据 0-100 成功率区间映射绿/黄/红三色指示灯（>=80 绿，50-79 黄，<50 红）。 */
export function resolveModelSuccessRateTone(successRate: number): ModelSuccessRateTone {
    if (successRate >= 80) return "green";
    if (successRate >= 50) return "yellow";
    return "red";
}

export type ModelOptionPriceBadge = {
    /** 紧凑展示文案，如 "5/次"、"2~10/次"、"10/秒"、"免费"。 */
    label: string;
    /** 悬停详细说明，如各分辨率/分档价目明细。 */
    title: string;
    /** 是否为 0 积分免费模型。 */
    isFree: boolean;
};

function parseValidCreditAmount(value: CreditAmount | null | undefined) {
    if (value === null || value === undefined || value === "") return null;
    try {
        const amount = creditAmount(value);
        return amount.isFinite() && amount.gte(0) ? amount : null;
    } catch {
        return null;
    }
}

/**
 * 解析模型在选择器中的价格展示文案，支持图片分辨率分档、视频模式/分辨率分档以及按次/按秒计费。
 */
export function resolveModelOptionPrice(
    config: Pick<AiConfig, "modelCosts" | "videoModelBillingConfigurations">,
    model: string,
    capability?: ModelCapability,
): ModelOptionPriceBadge | null {
    const trimmed = model.trim();
    if (!trimmed) return null;

    const costEntry =
        (capability
            ? config.modelCosts?.find((item) => item.model === trimmed && item.taskType === capability)
            : undefined)
        || config.modelCosts?.find((item) => item.model === trimmed);

    const effectiveType = capability || costEntry?.taskType;

    // 1. 视频模型：优先读取分档计费表，汇总区间价格；无分档时回退基础单价。
    if (effectiveType === "video") {
        const videoConfig = config.videoModelBillingConfigurations?.find((item) => item.model === trimmed)?.videoBillingConfiguration;
        const unit = (videoConfig?.billingUnit || costEntry?.unit) === "second" ? "秒" : "次";
        const tieredAmounts: ReturnType<typeof creditAmount>[] = [];
        if (videoConfig?.modePrices) {
            for (const resolutionMap of Object.values(videoConfig.modePrices)) {
                if (!resolutionMap) continue;
                for (const price of Object.values(resolutionMap)) {
                    const parsed = parseValidCreditAmount(price);
                    if (parsed) tieredAmounts.push(parsed);
                }
            }
        }
        if (videoConfig?.referenceVideoInputPrices) {
            for (const price of Object.values(videoConfig.referenceVideoInputPrices)) {
                const parsed = parseValidCreditAmount(price);
                if (parsed) tieredAmounts.push(parsed);
            }
        }
        if (tieredAmounts.length) {
            return buildPriceRangeBadge(tieredAmounts, unit);
        }
        const fallback = parseValidCreditAmount(costEntry?.credits);
        return fallback ? buildPriceRangeBadge([fallback], unit) : null;
    }

    // 2. 图片模型：若配置了 1K/2K/4K 分辨率价目表，展示价格区间并在悬停提示各档明细。
    if (effectiveType === "image") {
        const resolutionEntries: Array<[string, ReturnType<typeof creditAmount>]> = [];
        if (costEntry?.resolutionPrices) {
            for (const [resolution, price] of Object.entries(costEntry.resolutionPrices)) {
                const parsed = parseValidCreditAmount(price);
                if (parsed) resolutionEntries.push([resolution, parsed]);
            }
        }
        if (resolutionEntries.length) {
            const amounts = resolutionEntries.map(([, amount]) => amount);
            const detail = resolutionEntries.map(([res, amount]) => `${res}: ${creditText(amount)}`).join(" · ");
            return buildPriceRangeBadge(amounts, "次", `${detail} 积分/次`);
        }
    }

    // 3. 文本模型及普通按次模型
    const baseAmount = parseValidCreditAmount(costEntry?.credits);
    if (!baseAmount) return null;
    const unit = costEntry?.unit === "second" ? "秒" : "次";
    return buildPriceRangeBadge([baseAmount], unit);
}

function buildPriceRangeBadge(
    amounts: Array<ReturnType<typeof creditAmount>>,
    unit: "次" | "秒",
    customTitle?: string,
): ModelOptionPriceBadge {
    let min = amounts[0];
    let max = amounts[0];
    for (const amount of amounts) {
        if (amount.lt(min)) min = amount;
        if (amount.gt(max)) max = amount;
    }
    if (max.eq(0)) {
        return { label: "免费", title: customTitle || "免费使用（0 积分）", isFree: true };
    }
    if (min.eq(max)) {
        const text = creditText(min);
        return {
            label: `${text}/${unit}`,
            title: customTitle || `消耗 ${text} 积分/${unit}`,
            isFree: false,
        };
    }
    const minText = creditText(min);
    const maxText = creditText(max);
    return {
        label: `${minText}~${maxText}/${unit}`,
        title: customTitle || `消耗 ${minText}~${maxText} 积分/${unit}`,
        isFree: false,
    };
}

export type ModelOptionSpecs = {
    /** 支持的最大时长文案，如 "最长 30s"、"时长不限" */
    maxDurationLabel: string | null;
    /** 支持输入的最大图片数量 */
    maxImageCount: number;
    /** 支持输入的最大视频数量 */
    maxVideoCount: number;
    /** 支持输入的最大音频数量 */
    maxAudioCount: number;
};

const BUILTIN_VIDEO_MAX_AUDIO_COUNT = 3;

/**
 * 解析模型在选择器中的规格能力摘要：最大时长以及支持输入的图片、视频、音频数量上限。
 */
export function resolveModelOptionSpecs(
    config: Pick<AiConfig, "videoModelBillingConfigurations">,
    model: string,
    capability?: ModelCapability,
): ModelOptionSpecs | null {
    const trimmed = model.trim();
    if (!trimmed) return null;
    if (capability && capability !== "video") return null;

    const entry = config.videoModelBillingConfigurations?.find((item) => item.model === trimmed);
    if (!entry) return null;

    const billingMax = entry.videoBillingConfiguration
        ? resolveBillingMaximumDurationSeconds(entry.videoBillingConfiguration)
        : undefined;
    const capabilities = entry.capabilities || [];
    const constraintsMap = entry.videoGenerationConstraints || {};
    const constraintEntries = (Object.entries(constraintsMap) as Array<[VideoGenerationMode, NonNullable<typeof constraintsMap[VideoGenerationMode]>]>)
        .filter(([mode, value]) => Boolean(value) && (!capabilities.length || capabilities.includes(mode)));

    // 1. 最大时长：自定义模型结合各模式约束上限与计费上限；内置模型直接取计费配置上限
    let maxDurationLabel: string | null = null;
    if (entry.isCustomModel && constraintEntries.length) {
        const constraintMaxValues = constraintEntries
            .map(([, item]) => item.maximumDurationSeconds)
            .filter((value): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0);
        if (constraintMaxValues.length) {
            const constraintMax = Math.max(...constraintMaxValues);
            const effectiveMax = typeof billingMax === "number" ? Math.min(constraintMax, billingMax) : constraintMax;
            maxDurationLabel = `最长 ${effectiveMax}s`;
        }
    }
    if (!maxDurationLabel && billingMax !== undefined) {
        maxDurationLabel = billingMax === null ? "时长不限" : `最长 ${billingMax}s`;
    }

    // 2. 支持输入的图片、视频、音频数量上限
    let maxImageCount = 0;
    let maxVideoCount = 0;
    let maxAudioCount = 0;
    if (entry.isCustomModel && constraintEntries.length) {
        const audioAllowed = capabilities.includes("audio-input");
        for (const [mode, item] of constraintEntries) {
            if (typeof item.maximumImageCount === "number" && Number.isSafeInteger(item.maximumImageCount) && item.maximumImageCount > maxImageCount) {
                maxImageCount = item.maximumImageCount;
            }
            if (mode === "reference-to-video") {
                if (typeof item.maximumVideoCount === "number" && Number.isSafeInteger(item.maximumVideoCount) && item.maximumVideoCount > maxVideoCount) {
                    maxVideoCount = item.maximumVideoCount;
                }
                if (audioAllowed && typeof item.maximumAudioCount === "number" && Number.isSafeInteger(item.maximumAudioCount) && item.maximumAudioCount > maxAudioCount) {
                    maxAudioCount = item.maximumAudioCount;
                }
            }
        }
    } else {
        const supportsReference = capabilities.includes("reference-to-video");
        maxImageCount = supportsReference
            ? SEEDANCE_REFERENCE_LIMITS.images
            : capabilities.includes("first-last-frame-to-video")
                ? 2
                : capabilities.includes("image-to-video")
                    ? 1
                    : 0;
        maxVideoCount = supportsReference ? SEEDANCE_REFERENCE_LIMITS.videos : 0;
        maxAudioCount = supportsReference && capabilities.includes("audio-input") ? BUILTIN_VIDEO_MAX_AUDIO_COUNT : 0;
    }

    return {
        maxDurationLabel,
        maxImageCount,
        maxVideoCount,
        maxAudioCount,
    };
}
