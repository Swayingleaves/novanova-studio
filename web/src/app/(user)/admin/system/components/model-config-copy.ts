import type { CustomModelGroupConfig, VideoGenerationConstraints, VideoGenerationMode } from "@/features/settings/stores/use-config-store";
import type { ServerModelConfig } from "@/services/api/server";

import { modelConfigIdentity } from "./model-config-draft";

/** 图片自定义模型的能力模式，与 MODEL_CAPABILITY_OPTIONS.image 的取值一致。 */
export type ImageGenerationMode = "text-to-image" | "image-to-image";

/** 自定义调用配置可复制的模式：图片的文生图、图生图与视频的四种生成模式。 */
export type CustomModelMode = ImageGenerationMode | VideoGenerationMode;

/** 视频自定义模型可复制的全部能力模式，顺序用于规范化 capabilities，保证重复复制幂等。 */
export const COPYABLE_VIDEO_MODES: readonly VideoGenerationMode[] = ["text-to-video", "image-to-video", "reference-to-video", "first-last-frame-to-video"];

/** 按模型类型给出可复制的模式，图片模型只复制图片能力，视频模型只复制视频能力。 */
export const COPYABLE_CUSTOM_MODES: Record<"image" | "video", readonly CustomModelMode[]> = {
    image: ["text-to-image", "image-to-image"],
    video: COPYABLE_VIDEO_MODES,
};

/** 自定义调用配置里可复制的字段；请求方法单独处理，默认 POST 无法区分是否填写。 */
export type CustomGroupField = Exclude<keyof CustomModelGroupConfig, "requestMethod" | "queryMethod">;

export const CUSTOM_GROUP_FIELDS: readonly CustomGroupField[] = [
    "requestPath",
    "requestModelName",
    "requestTemplate",
    "aiRequestPrompt",
    "responseExample",
    "resultPath",
    "queryPath",
    "queryRequestTemplate",
    "aiQueryPrompt",
    "queryResponseExample",
    "queryResultPath",
    "videoGenerationConstraints",
];

/** 复制源：当前空间草稿里同类型的其他自定义模型（图片对图片、视频对视频）。 */
export function copyableCustomSourceModels(configs: ServerModelConfig[], target: Pick<ServerModelConfig, "channelId" | "modelName" | "modelType">) {
    const targetIdentity = modelConfigIdentity(target);
    return configs.filter((config) => config.modelType === target.modelType && config.isCustomModel && modelConfigIdentity(config) !== targetIdentity);
}

/** 单个模式自定义调用配置里已填写的字段数。 */
export function countCustomGroupFields(group: CustomModelGroupConfig | null | undefined) {
    if (!group) return 0;
    return CUSTOM_GROUP_FIELDS.filter((field) => hasCustomGroupFieldValue(group[field], field)).length;
}

/** 自定义调用配置是否整体空白；请求方法不参与判定，避免默认值让分组永远非空。 */
export function isCustomGroupBlank(group: CustomModelGroupConfig | null | undefined) {
    return countCustomGroupFields(group) === 0;
}

/** 模型全部模式已填写的自定义字段总数，用于来源摘要。 */
export function countCustomConfigFields(config: ServerModelConfig) {
    return copyableModes(config).reduce((total, mode) => total + countCustomGroupFields(config.customModelConfig?.[mode]), 0);
}

/** 某个模式已填写的字段名列表，用于提示具体会被覆盖哪些内容。 */
export function customGroupFilledFields(group: CustomModelGroupConfig | null | undefined): CustomGroupField[] {
    if (!group) return [];
    return CUSTOM_GROUP_FIELDS.filter((field) => hasCustomGroupFieldValue(group[field], field));
}

/** 该模型类型可复制的模式；文本模型没有自定义调用配置。 */
function copyableModes(config: Pick<ServerModelConfig, "modelType">): readonly CustomModelMode[] {
    return config.modelType === "image" || config.modelType === "video" ? COPYABLE_CUSTOM_MODES[config.modelType] : [];
}

/** 判断文本字段和嵌套的视频限制对象是否实际填写。 */
function hasCustomGroupFieldValue(value: unknown, field: CustomGroupField) {
    if (field === "videoGenerationConstraints") return CONSTRAINT_FIELDS.some((item) => hasConstraintValue(value as VideoGenerationConstraints | null | undefined, item));
    return typeof value === "string" ? value.trim() !== "" : value !== null && value !== undefined;
}

/** 视频限制的可合并字段，避免来源带回未知键。 */
const CONSTRAINT_FIELDS = ["minimumDurationSeconds", "maximumDurationSeconds", "minimumImageCount", "maximumImageCount", "supportedAspectRatios", "maximumVideoCount", "maximumAudioCount"] as const;

/** 判断视频限制的单个字段是否已填写；比例数组为空视为未填写。 */
function hasConstraintValue(constraints: VideoGenerationConstraints | null | undefined, field: typeof CONSTRAINT_FIELDS[number]) {
    const value = constraints?.[field] as unknown;
    return Array.isArray(value) ? value.length > 0 : value !== null && value !== undefined && value !== "";
}

/** 自动填充可选的来源模式：当前编辑模式之外的全部视频生成模式。 */
export const AUTO_FILL_SOURCE_MODES: readonly VideoGenerationMode[] = COPYABLE_VIDEO_MODES;

export type CustomConfigAutoFillRow = {
    mode: VideoGenerationMode;
    /** 来源可填充的已填写字段。 */
    sourceFilledFields: CustomGroupField[];
    /** 目标该字段为空、会被填充。 */
    fillableFields: CustomGroupField[];
};

/** 逐模式给出自动填充会补上的字段，来源为空或目标已填满时该模式不可用。 */
export function planCustomConfigAutoFill(target: ServerModelConfig, source: ServerModelConfig, currentMode: VideoGenerationMode): CustomConfigAutoFillRow[] {
    return AUTO_FILL_SOURCE_MODES.filter((mode) => mode !== currentMode).map((mode) => {
        const sourceFilledFields = customGroupFilledFields(source.customModelConfig?.[mode]);
        const targetGroup = target.customModelConfig?.[currentMode];
        return { mode, sourceFilledFields, fillableFields: sourceFilledFields.filter((field) => !hasCustomGroupFieldValue(targetGroup?.[field], field)) };
    });
}

/**
 * 把来源模式已填写的内容补进当前模式的空字段，已有内容和请求方法默认值保持不变。
 * 视频限制逐项合并，来源只填了其中几项时只补这几项对应的空值。
 */
export function applyCustomConfigAutoFill(target: ServerModelConfig, currentMode: VideoGenerationMode, sourceGroup: CustomModelGroupConfig | null | undefined) {
    const currentGroup = { ...target.customModelConfig?.[currentMode] } as CustomModelGroupConfig;
    const filledFields: CustomGroupField[] = [];
    CUSTOM_GROUP_FIELDS.forEach((field) => {
        if (field === "videoGenerationConstraints" || !hasCustomGroupFieldValue(sourceGroup?.[field], field) || hasCustomGroupFieldValue(currentGroup[field], field)) return;
        currentGroup[field] = structuredClone(sourceGroup?.[field]) as never;
        filledFields.push(field);
    });
    const sourceConstraints = sourceGroup?.videoGenerationConstraints;
    const currentConstraints = currentGroup.videoGenerationConstraints as VideoGenerationConstraints | null | undefined;
    if (sourceConstraints) {
        const merged = { ...(currentConstraints || {}) } as VideoGenerationConstraints;
        let touched = false;
        CONSTRAINT_FIELDS.forEach((field) => {
            if (!hasConstraintValue(sourceConstraints, field) || hasConstraintValue(merged, field)) return;
            merged[field] = structuredClone(sourceConstraints[field]) as never;
            touched = true;
        });
        if (touched) {
            currentGroup.videoGenerationConstraints = merged;
            // 来源整段为空时，逐项补上的字段也要计入本次填充结果。
            if (!filledFields.includes("videoGenerationConstraints")) filledFields.push("videoGenerationConstraints");
        }
    }
    return { config: { ...target, customModelConfig: { ...(target.customModelConfig || {}), [currentMode]: currentGroup } }, filledFields };
}

export type CustomConfigCopyRow = {
    mode: CustomModelMode;
    /** 来源该模式已填写的字段数，为 0 表示来源没有可复制的配置。 */
    sourceFilledFieldCount: number;
    /** 目标该模式已填写的字段数，大于 0 表示复制会覆盖已有内容。 */
    targetFilledFieldCount: number;
    sourceFilledFields: CustomGroupField[];
    targetFilledFields: CustomGroupField[];
    /** 来源该模式是否已启用能力开关。 */
    sourceEnabled: boolean;
};

/** 逐模式状态，供弹窗展示来源摘要与覆盖确认。 */
export function planCustomConfigCopy(source: ServerModelConfig, target: ServerModelConfig): CustomConfigCopyRow[] {
    return copyableModes(target).map((mode) => {
        const sourceGroup = source.customModelConfig?.[mode];
        const targetGroup = target.customModelConfig?.[mode];
        return {
            mode,
            sourceFilledFieldCount: countCustomGroupFields(sourceGroup),
            targetFilledFieldCount: countCustomGroupFields(targetGroup),
            sourceFilledFields: customGroupFilledFields(sourceGroup),
            targetFilledFields: customGroupFilledFields(targetGroup),
            sourceEnabled: source.capabilities.includes(mode),
        };
    });
}

/**
 * 复制来源模型的自定义调用配置到目标模型。
 * 只覆盖选中的模式，且仅当来源该模式确实填写了内容时才覆盖；
 * 同时把来源已启用的模式补进目标能力开关，否则保存时该模式的模板会被清理掉。
 * 价格、计费单位、并发数等其余配置保持目标原值。
 */
export function applyCustomConfigCopy(target: ServerModelConfig, source: ServerModelConfig, modes: CustomModelMode[]) {
    const customModelConfig = { ...(target.customModelConfig || {}) };
    const capabilitySet = new Set(target.capabilities);
    const copiedModes: CustomModelMode[] = [];
    const overwrittenModes: CustomModelMode[] = [];

    modes.forEach((mode) => {
        const group = source.customModelConfig?.[mode];
        if (isCustomGroupBlank(group)) return;
        if (countCustomGroupFields(target.customModelConfig?.[mode]) > 0) overwrittenModes.push(mode);
        customModelConfig[mode] = structuredClone(group as CustomModelGroupConfig);
        // 保存时未启用能力的配置会被清理，复制配置必须同时开启该能力。
        capabilitySet.add(mode);
        copiedModes.push(mode);
    });

    if (!copiedModes.length) return { config: target, copiedModes, overwrittenModes };

    // 音频开关与复制来的数量限制保持一致，避免开关和上限互相冲突。
    if (copiedModes.includes("reference-to-video")) {
        if (source.capabilities.includes("audio-input")) capabilitySet.add("audio-input");
        else capabilitySet.delete("audio-input");
    }

    const orderedModes = copyableModes(target);
    const capabilities = [
        ...orderedModes.filter((mode) => capabilitySet.has(mode)),
        ...Array.from(capabilitySet).filter((capability) => !orderedModes.includes(capability as CustomModelMode)),
    ];

    return {
        config: { ...target, capabilities, customModelConfig },
        copiedModes,
        overwrittenModes,
    };
}
