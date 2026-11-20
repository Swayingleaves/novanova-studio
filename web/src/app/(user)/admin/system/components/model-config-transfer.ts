import { creditAmount, creditText } from "@/shared/lib/credit-amounts";
import type { CreditAmount } from "@/shared/lib/credit-amounts";
import { IMAGE_RESOLUTIONS } from "@/features/generation/lib/image-size-mappings";
import type { ImageResolution, ImageSizeMappings } from "@/features/generation/lib/image-size-mappings";
import { VIDEO_ASPECT_RATIOS } from "@/features/generation/lib/video-generation-constraints";
import { VIDEO_RESOLUTION_OPTIONS, createVideoBillingConfiguration } from "@/features/generation/lib/video-billing";
import { MODEL_ICON_OPTIONS } from "@/features/settings/components/model-icon";
import type { CustomModelGroupConfig, ImageBillingConfiguration, ModelCreditUnit, VideoBillingConfiguration, VideoGenerationConstraints, VideoGenerationMode, VideoResolution } from "@/features/settings/stores/use-config-store";
import type { ServerModelConfig } from "@/services/api/server";

import { countCustomGroupFields } from "./model-config-copy";

/** 导出 JSON 的标识，导入时用于识别格式；手工粘贴的裸配置可以不带。 */
export const CUSTOM_MODEL_TRANSFER_KIND = "novanova-custom-model";
/** 导出 JSON 的版本号，结构变化时递增。 */
export const CUSTOM_MODEL_TRANSFER_VERSION = 1;

const IMAGE_MODES = ["text-to-image", "image-to-image"] as const;
const VIDEO_MODES: readonly VideoGenerationMode[] = ["text-to-video", "image-to-video", "reference-to-video", "first-last-frame-to-video"];
const VIDEO_AUDIO_CAPABILITY = "audio-input";
const DURATION_FIELDS = ["minimumDurationSeconds", "maximumDurationSeconds"] as const;
const COUNT_FIELDS = ["minimumImageCount", "maximumImageCount", "maximumVideoCount", "maximumAudioCount"] as const;
const MODEL_ICON_VALUES = new Set(MODEL_ICON_OPTIONS.map((option) => option.value).filter(Boolean));

/** 可跨实例传递的自定义模型配置。渠道、模型名称、启用状态和排序不属于配置本身，不导出。 */
export type CustomModelTransferPayload = {
    kind: string;
    version: number;
    modelType: "image" | "video";
    displayName: string | null;
    modelIcon: string | null;
    creditCost: string;
    creditUnit: ModelCreditUnit;
    requestConcurrency: number;
    capabilities: string[];
    customBodyParameters: Record<string, unknown>;
    customModelConfig: Record<string, CustomModelGroupConfig>;
    videoBillingConfiguration?: VideoBillingConfiguration | null;
    imageBillingConfiguration?: ImageBillingConfiguration | null;
    convertImageSizeToPixels?: boolean;
    imageSizeMappings?: ImageSizeMappings | null;
};

/** 导入失败的分类，界面据此给出具体提示。 */
export type CustomModelTransferIssue = "empty" | "invalid-json" | "invalid-payload" | "model-type-mismatch";

/** 导入前的摘要，用于在弹窗里确认识别到的内容。 */
export type CustomModelTransferSummary = {
    modelType: "image" | "video";
    displayName: string | null;
    capabilityCount: number;
    customModeCount: number;
    priceCount: number;
};

export type CustomModelTransferResult =
    | { ok: true; patch: Partial<ServerModelConfig>; summary: CustomModelTransferSummary }
    | { ok: false; issue: CustomModelTransferIssue; actualType?: string };

/**
 * 把当前模型配置序列化为可分享的 JSON。
 *
 * @param config 当前编辑中的模型配置
 * @return 格式化后的 JSON 文本
 */
export function buildCustomModelTransferJson(config: ServerModelConfig): string {
    const payload: CustomModelTransferPayload = {
        kind: CUSTOM_MODEL_TRANSFER_KIND,
        version: CUSTOM_MODEL_TRANSFER_VERSION,
        modelType: config.modelType === "image" ? "image" : "video",
        displayName: config.displayName || null,
        modelIcon: config.modelIcon || null,
        creditCost: amountText(config.creditCost),
        creditUnit: config.creditUnit === "second" ? "second" : "generation",
        requestConcurrency: Math.max(1, Math.floor(config.requestConcurrency || 1)),
        capabilities: [...config.capabilities],
        customBodyParameters: structuredClone(config.customBodyParameters || {}),
        customModelConfig: structuredClone(config.customModelConfig || {}),
    };
    if (config.modelType === "image") {
        payload.convertImageSizeToPixels = Boolean(config.convertImageSizeToPixels);
        payload.imageSizeMappings = config.imageSizeMappings ? structuredClone(config.imageSizeMappings) : null;
        payload.imageBillingConfiguration = normalizeImageBilling(config.imageBillingConfiguration);
    } else {
        payload.videoBillingConfiguration = normalizeVideoBilling(config.videoBillingConfiguration || createVideoBillingConfiguration());
    }
    return JSON.stringify(payload, null, 2);
}

/**
 * 解析并校验导入的配置 JSON。
 *
 * @param text 粘贴的 JSON 文本
 * @param targetModelType 当前编辑模型的类型，导入不允许跨类型
 * @return 可应用到编辑器副本的补丁或失败原因
 */
export function parseCustomModelTransfer(text: string, targetModelType: ServerModelConfig["modelType"]): CustomModelTransferResult {
    if (!text.trim()) return { ok: false, issue: "empty" };
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch {
        return { ok: false, issue: "invalid-json" };
    }
    if (!isRecord(raw)) return { ok: false, issue: "invalid-payload" };
    if (raw.kind !== undefined && raw.kind !== CUSTOM_MODEL_TRANSFER_KIND) return { ok: false, issue: "invalid-payload" };
    const modelType = raw.modelType;
    if (modelType !== "image" && modelType !== "video") return { ok: false, issue: "invalid-payload" };
    if (modelType !== targetModelType) return { ok: false, issue: "model-type-mismatch", actualType: modelType };
    if (!Array.isArray(raw.capabilities) || !isRecord(raw.customModelConfig)) return { ok: false, issue: "invalid-payload" };
    const rawCapabilities = new Set(raw.capabilities.filter((capability): capability is string => typeof capability === "string"));
    const rawCustomModelConfig = raw.customModelConfig;

    const capabilities = capabilitiesFor(modelType).filter((capability) => rawCapabilities.has(capability));
    // 没有可识别能力的配置导入后会清空模型能力，按结构错误拒绝，避免误操作。
    if (!capabilities.length) return { ok: false, issue: "invalid-payload" };
    const creditCost = raw.creditCost === undefined ? "0" : readCreditValue(raw.creditCost);
    if (creditCost === null) return { ok: false, issue: "invalid-payload" };
    const requestConcurrency = raw.requestConcurrency === undefined ? 1 : readInteger(raw.requestConcurrency, 1);
    if (requestConcurrency === null) return { ok: false, issue: "invalid-payload" };
    const customBodyParameters = raw.customBodyParameters === undefined ? {} : raw.customBodyParameters;
    if (!isRecord(customBodyParameters)) return { ok: false, issue: "invalid-payload" };

    const modes = modelType === "image" ? IMAGE_MODES : VIDEO_MODES;
    const customModelConfig: Record<string, CustomModelGroupConfig> = {};
    for (const mode of modes) {
        if (!capabilities.includes(mode)) continue;
        const group = rawCustomModelConfig[mode];
        if (group === undefined) continue;
        if (!isRecord(group)) return { ok: false, issue: "invalid-payload" };
        customModelConfig[mode] = parseGroup(group, modelType === "video");
    }

    const patch: Partial<ServerModelConfig> = {
        isCustomModel: true,
        displayName: readNullableText(raw.displayName, 255),
        modelIcon: readModelIcon(raw.modelIcon),
        creditCost,
        requestConcurrency,
        capabilities,
        customBodyParameters: structuredClone(customBodyParameters),
        customModelConfig,
    };

    let priceCount = 0;
    if (modelType === "image") {
        const imageBilling = parseImageBilling(raw.imageBillingConfiguration);
        if (imageBilling === undefined) return { ok: false, issue: "invalid-payload" };
        const imageSizeMappings = parseImageSizeMappings(raw.imageSizeMappings);
        if (imageSizeMappings === undefined) return { ok: false, issue: "invalid-payload" };
        patch.creditUnit = "generation";
        patch.convertImageSizeToPixels = raw.convertImageSizeToPixels === true;
        patch.imageSizeMappings = imageSizeMappings;
        patch.imageBillingConfiguration = imageBilling;
        patch.videoBillingConfiguration = null;
        priceCount = Object.keys(imageBilling?.resolutionPrices || {}).length;
    } else {
        const videoBilling = parseVideoBilling(raw.videoBillingConfiguration, capabilities);
        if (videoBilling === undefined) return { ok: false, issue: "invalid-payload" };
        patch.creditUnit = videoBilling.billingUnit;
        patch.videoBillingConfiguration = videoBilling;
        patch.imageBillingConfiguration = null;
        patch.convertImageSizeToPixels = false;
        patch.imageSizeMappings = null;
        priceCount = Object.values(videoBilling.modePrices || {}).reduce((total, prices) => total + Object.keys(prices || {}).length, 0);
    }

    return {
        ok: true,
        patch,
        summary: {
            modelType,
            displayName: patch.displayName ?? null,
            capabilityCount: capabilities.length,
            customModeCount: Object.values(customModelConfig).filter((group) => countCustomGroupFields(group) > 0).length,
            priceCount,
        },
    };
}

/** 模型类型支持的能力，顺序固定，导入后与界面勾选顺序一致。 */
function capabilitiesFor(modelType: "image" | "video"): string[] {
    return modelType === "image" ? [...IMAGE_MODES] : [...VIDEO_MODES, VIDEO_AUDIO_CAPABILITY];
}

/** 解析单个能力的请求与查询配置，缺失字段按编辑器默认值补齐。 */
function parseGroup(raw: Record<string, unknown>, video: boolean): CustomModelGroupConfig {
    const group: CustomModelGroupConfig = {
        requestPath: readText(raw.requestPath),
        requestMethod: raw.requestMethod === "GET" ? "GET" : "POST",
        requestModelName: readText(raw.requestModelName),
        requestTemplate: readText(raw.requestTemplate),
        aiRequestPrompt: readText(raw.aiRequestPrompt),
        responseExample: readText(raw.responseExample),
        resultPath: readText(raw.resultPath),
        queryPath: readText(raw.queryPath),
        queryMethod: raw.queryMethod === "POST" ? "POST" : "GET",
        queryRequestTemplate: readText(raw.queryRequestTemplate),
        aiQueryPrompt: readText(raw.aiQueryPrompt),
        queryResponseExample: readText(raw.queryResponseExample),
        queryResultPath: readText(raw.queryResultPath),
    };
    if (typeof raw.asyncQuery === "boolean") group.asyncQuery = raw.asyncQuery;
    if (video) group.videoGenerationConstraints = parseConstraints(raw.videoGenerationConstraints);
    return group;
}

/** 解析视频模式的素材与时长限制，未知比例直接丢弃。 */
function parseConstraints(value: unknown): VideoGenerationConstraints | null {
    if (!isRecord(value)) return null;
    const constraints: VideoGenerationConstraints = {};
    for (const field of DURATION_FIELDS) {
        const parsed = readInteger(value[field], 1);
        if (parsed !== null) constraints[field] = parsed;
    }
    for (const field of COUNT_FIELDS) {
        const parsed = readInteger(value[field], 0);
        if (parsed !== null) constraints[field] = parsed;
    }
    if (Array.isArray(value.supportedAspectRatios)) {
        const ratios = value.supportedAspectRatios.filter((ratio): ratio is string => typeof ratio === "string" && VIDEO_ASPECT_RATIOS.includes(ratio as typeof VIDEO_ASPECT_RATIOS[number]));
        constraints.supportedAspectRatios = [...new Set(ratios)];
    }
    return constraints;
}

/** 解析视频计费配置，只保留已启用模式与界面支持的清晰度。 */
function parseVideoBilling(value: unknown, capabilities: string[]): VideoBillingConfiguration | undefined {
    if (value === undefined) return createVideoBillingConfiguration();
    if (value === null) return createVideoBillingConfiguration();
    if (!isRecord(value)) return undefined;
    const billingUnit: ModelCreditUnit = value.billingUnit === "second" ? "second" : "generation";
    const minimumDurationSeconds = value.minimumDurationSeconds === undefined ? 3 : readInteger(value.minimumDurationSeconds, 1);
    if (minimumDurationSeconds === null) return undefined;
    const modePrices: VideoBillingConfiguration["modePrices"] = {};
    const sourcePrices = isRecord(value.modePrices) ? value.modePrices : {};
    for (const mode of VIDEO_MODES) {
        if (!capabilities.includes(mode)) continue;
        const prices = sourcePrices[mode];
        if (!isRecord(prices)) continue;
        const resolutionPrices: Partial<Record<VideoResolution, CreditAmount>> = {};
        for (const { value: resolution } of VIDEO_RESOLUTION_OPTIONS) {
            const price = readCreditValue(prices[resolution]);
            if (price !== null) resolutionPrices[resolution] = price;
        }
        modePrices[mode] = resolutionPrices;
    }
    return { billingUnit, minimumDurationSeconds, modePrices };
}

/** 导出时把视频价格统一成普通十进制字符串。 */
function normalizeVideoBilling(configuration: VideoBillingConfiguration): VideoBillingConfiguration {
    const modePrices: VideoBillingConfiguration["modePrices"] = {};
    for (const mode of VIDEO_MODES) {
        const prices = configuration.modePrices?.[mode];
        if (!prices) continue;
        const normalized: Partial<Record<VideoResolution, CreditAmount>> = {};
        for (const [resolution, price] of Object.entries(prices)) {
            if (String(price ?? "").trim() !== "") normalized[resolution as VideoResolution] = amountText(price);
        }
        if (Object.keys(normalized).length) modePrices[mode] = normalized;
    }
    return {
        billingUnit: configuration.billingUnit === "second" ? "second" : "generation",
        minimumDurationSeconds: Math.max(1, Math.floor(configuration.minimumDurationSeconds || 1)),
        modePrices,
    };
}

/** 解析图片清晰度价格，空对象归一为 null（沿用模型单价）。 */
function parseImageBilling(value: unknown): ImageBillingConfiguration | null | undefined {
    if (value === undefined || value === null) return null;
    if (!isRecord(value)) return undefined;
    if (value.resolutionPrices !== undefined && !isRecord(value.resolutionPrices)) return undefined;
    const resolutionPrices: Partial<Record<ImageResolution, CreditAmount>> = {};
    for (const resolution of IMAGE_RESOLUTIONS) {
        const price = readCreditValue((value.resolutionPrices as Record<string, unknown> | undefined)?.[resolution]);
        if (price !== null) resolutionPrices[resolution] = price;
    }
    return Object.keys(resolutionPrices).length ? { resolutionPrices } : null;
}

/** 导出时把图片清晰度价格统一成普通十进制字符串。 */
function normalizeImageBilling(configuration: ImageBillingConfiguration | null | undefined): ImageBillingConfiguration | null {
    const resolutionPrices: Partial<Record<ImageResolution, CreditAmount>> = {};
    for (const resolution of IMAGE_RESOLUTIONS) {
        const price = configuration?.resolutionPrices?.[resolution];
        if (price === null || price === undefined || String(price).trim() === "") continue;
        resolutionPrices[resolution] = amountText(price);
    }
    return Object.keys(resolutionPrices).length ? { resolutionPrices } : null;
}

/** 解析图片尺寸映射，非法比例或像素尺寸让整份配置导入失败。 */
function parseImageSizeMappings(value: unknown): ImageSizeMappings | null | undefined {
    if (value === undefined || value === null) return null;
    if (!isRecord(value)) return undefined;
    const mappings: ImageSizeMappings = {};
    for (const [ratio, sizes] of Object.entries(value)) {
        if (!/^[1-9]\d*:[1-9]\d*$/.test(ratio) || !isRecord(sizes)) return undefined;
        const resolutionSizes: Partial<Record<ImageResolution, string>> = {};
        for (const resolution of IMAGE_RESOLUTIONS) {
            const size = sizes[resolution];
            if (typeof size !== "string" || !size.trim()) continue;
            if (!/^[1-9]\d*\s*[xX×]\s*[1-9]\d*$/.test(size.trim())) return undefined;
            resolutionSizes[resolution] = size.trim().replace(/\s*[xX×]\s*/, "x");
        }
        mappings[ratio] = resolutionSizes;
    }
    return mappings;
}

/** 读取非负积分金额，非法值返回 null。 */
function readCreditValue(value: unknown): string | null {
    if (typeof value !== "number" && typeof value !== "string") return null;
    try {
        const amount = creditAmount(value);
        return amount.isFinite() && !amount.isNegative() ? creditText(amount) : null;
    } catch {
        return null;
    }
}

/** 导出金额时容忍空值或非法草稿值，避免整份复制失败。 */
function amountText(value: CreditAmount | null | undefined): string {
    try {
        return creditText(value ?? 0);
    } catch {
        return "0";
    }
}

/** 读取不小于最小值的整数，非法值返回 null。 */
function readInteger(value: unknown, minimum: number): number | null {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= 2147483647 ? value : null;
}

/** 读取普通字符串字段，非字符串按空串处理。 */
function readText(value: unknown): string {
    return typeof value === "string" ? value : "";
}

/** 读取可空的展示文案，超过长度上限时截断。 */
function readNullableText(value: unknown, maxLength: number): string | null {
    if (typeof value !== "string") return null;
    const text = value.trim();
    return text ? text.slice(0, maxLength) : null;
}

/** 只接受当前版本支持的展示图标，未知图标回退为自动匹配。 */
function readModelIcon(value: unknown): string | null {
    const icon = readNullableText(value, 64);
    return icon && MODEL_ICON_VALUES.has(icon) ? icon : null;
}

/** 判断是否为普通 JSON 对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
