import type { CustomModelGroupConfig, VideoGenerationMode } from "@/features/settings/stores/use-config-store";
import type { ServerModelConfig } from "@/services/api/server";

import { modelConfigIdentity } from "./model-config-draft";

/** 视频自定义模型可复制的全部能力模式，顺序用于规范化 capabilities，保证重复复制幂等。 */
export const COPYABLE_VIDEO_MODES: readonly VideoGenerationMode[] = ["text-to-video", "image-to-video", "reference-to-video", "first-last-frame-to-video"];

/** 自定义调用配置里的文本字段；请求方法单独处理，默认 POST 无法区分是否填写。 */
export type CustomGroupTextField = Exclude<keyof CustomModelGroupConfig, "requestMethod" | "queryMethod">;

export const CUSTOM_GROUP_TEXT_FIELDS: readonly CustomGroupTextField[] = [
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
];

/** 视频自定义模型的复制源：当前空间草稿里的其他视频自定义模型。 */
export function copyableVideoSourceModels(configs: ServerModelConfig[], target: Pick<ServerModelConfig, "channelId" | "modelName" | "modelType">) {
    const targetIdentity = modelConfigIdentity(target);
    return configs.filter((config) => config.modelType === "video" && config.isCustomModel && modelConfigIdentity(config) !== targetIdentity);
}

/** 单个模式自定义调用配置里已填写的文本字段数。 */
export function countCustomGroupFields(group: CustomModelGroupConfig | null | undefined) {
    if (!group) return 0;
    return CUSTOM_GROUP_TEXT_FIELDS.filter((field) => String(group[field] || "").trim() !== "").length;
}

/** 自定义调用配置是否整体空白；请求方法不参与判定，避免默认值让分组永远非空。 */
export function isCustomGroupBlank(group: CustomModelGroupConfig | null | undefined) {
    return countCustomGroupFields(group) === 0;
}

/** 模型全部模式已填写的自定义字段总数，用于来源摘要。 */
export function countCustomConfigFields(config: ServerModelConfig) {
    return COPYABLE_VIDEO_MODES.reduce((total, mode) => total + countCustomGroupFields(config.customModelConfig?.[mode]), 0);
}

/** 某个模式已填写的字段名列表，用于提示具体会被覆盖哪些内容。 */
export function customGroupFilledFields(group: CustomModelGroupConfig | null | undefined): CustomGroupTextField[] {
    if (!group) return [];
    return CUSTOM_GROUP_TEXT_FIELDS.filter((field) => String(group[field] || "").trim() !== "");
}

export type CustomConfigCopyRow = {
    mode: VideoGenerationMode;
    /** 来源该模式已填写的字段数，为 0 表示来源没有可复制的配置。 */
    sourceFilledFieldCount: number;
    /** 目标该模式已填写的字段数，大于 0 表示复制会覆盖已有内容。 */
    targetFilledFieldCount: number;
    sourceFilledFields: CustomGroupTextField[];
    targetFilledFields: CustomGroupTextField[];
    /** 来源该模式是否已启用能力开关。 */
    sourceEnabled: boolean;
};

/** 逐模式状态，供弹窗展示来源摘要与覆盖确认。 */
export function planCustomConfigCopy(source: ServerModelConfig, target: ServerModelConfig): CustomConfigCopyRow[] {
    return COPYABLE_VIDEO_MODES.map((mode) => {
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
export function applyCustomConfigCopy(target: ServerModelConfig, source: ServerModelConfig, modes: VideoGenerationMode[]) {
    const customModelConfig = { ...(target.customModelConfig || {}) };
    const capabilitySet = new Set(target.capabilities);
    const copiedModes: VideoGenerationMode[] = [];
    const overwrittenModes: VideoGenerationMode[] = [];

    modes.forEach((mode) => {
        const group = source.customModelConfig?.[mode];
        if (isCustomGroupBlank(group)) return;
        if (countCustomGroupFields(target.customModelConfig?.[mode]) > 0) overwrittenModes.push(mode);
        customModelConfig[mode] = { ...(group as CustomModelGroupConfig) };
        // 保存时未启用能力的配置会被清理，复制配置必须同时开启该能力。
        capabilitySet.add(mode);
        copiedModes.push(mode);
    });

    if (!copiedModes.length) return { config: target, copiedModes, overwrittenModes };

    // 音频输入是全能参考的附属开关，来源开启时一并开启，否则复制来的音频配置不会生效。
    if (copiedModes.includes("reference-to-video") && source.capabilities.includes("audio-input")) capabilitySet.add("audio-input");

    const capabilities = [
        ...COPYABLE_VIDEO_MODES.filter((mode) => capabilitySet.has(mode)),
        ...Array.from(capabilitySet).filter((capability) => !COPYABLE_VIDEO_MODES.includes(capability as VideoGenerationMode)),
    ];

    return {
        config: { ...target, capabilities, customModelConfig },
        copiedModes,
        overwrittenModes,
    };
}
