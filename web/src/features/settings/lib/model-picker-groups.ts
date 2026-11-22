import { modelOptionChannel, type AiConfig } from "@/features/settings/stores/use-config-store";

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
