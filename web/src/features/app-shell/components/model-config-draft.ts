import type { ModelCapability, ModelChannel } from "@/features/settings/stores/use-config-store";
import type { ServerModelConfig } from "@/services/api/server";

/** 按数据库唯一约束标识模型配置，避免展示名和临时标识影响匹配。 */
export function modelConfigIdentity(configuration: Pick<ServerModelConfig, "channelId" | "modelName" | "modelType">) {
    return JSON.stringify([configuration.channelId, configuration.modelName, configuration.modelType]);
}

/** 拆分渠道与模型，仅切分第一个分隔符，保留模型名称中的双冒号。 */
export function splitModelConfigValue(value: string) {
    const separatorIndex = value.indexOf("::");
    return { channelId: value.slice(0, separatorIndex), modelName: value.slice(separatorIndex + 2) };
}

/** 更新已选模型，取消后重新选择时复用已有配置及其服务端标识。 */
export function updateModelConfigSelection(configurations: ServerModelConfig[], baseline: ServerModelConfig[], modelType: ModelCapability, values: string[], create: (channelId: string, modelName: string, modelType: ModelCapability) => ServerModelConfig) {
    const valueOf = (configuration: ServerModelConfig) => `${configuration.channelId}::${configuration.modelName}`;
    const existing = new Map(configurations.filter((configuration) => configuration.modelType === modelType).map((configuration) => [valueOf(configuration), configuration]));
    const persisted = new Map(baseline.filter((configuration) => configuration.modelType === modelType).map((configuration) => [valueOf(configuration), configuration]));
    const selected = new Set(values);
    let hasDefault = configurations.some((configuration) => configuration.modelType === modelType && selected.has(valueOf(configuration)) && configuration.defaultModel);
    const added = values
        .filter((value) => !existing.has(value))
        .map((value) => {
            const { channelId, modelName } = splitModelConfigValue(value);
            const configuration = persisted.get(value) || create(channelId, modelName, modelType);
            // 恢复原默认模型时，保留用户在草稿中新选的默认模型。
            const defaultModel = configuration.defaultModel && !hasDefault;
            if (defaultModel) hasDefault = true;
            return { ...configuration, defaultModel };
        })
        .reverse();
    return [...configurations.filter((configuration) => configuration.modelType !== modelType), ...added, ...configurations.filter((configuration) => configuration.modelType === modelType && selected.has(valueOf(configuration)))];
}

/** 列出渠道不存在或已从渠道列表移除的模型，不自动删除用户配置。 */
export function modelConfigDependencyIssues(channels: ModelChannel[], configurations: ServerModelConfig[]) {
    const channelsById = new Map(channels.map((channel) => [channel.id, channel]));
    return configurations.flatMap((configuration) => {
        const channel = channelsById.get(configuration.channelId);
        if (channel?.models.includes(configuration.modelName)) return [];
        return [{ configuration, channelName: channel?.name || configuration.channelId, reason: channel ? "模型已不在渠道列表中" : "所属渠道尚未保存或已不存在" }];
    });
}

/** 仅阻止依赖未保存渠道的新增、内容修改和新设默认，旧失效配置可以单独移除。 */
export function blockingModelConfigDependencyIssues(channels: ModelChannel[], configurations: ServerModelConfig[], baseline: ServerModelConfig[], sameContent: (first: ServerModelConfig, second: ServerModelConfig) => boolean) {
    const baselineById = new Map(baseline.map((configuration) => [configuration.id, configuration]));
    return modelConfigDependencyIssues(channels, configurations).filter(({ configuration }) => {
        const existing = baselineById.get(configuration.id);
        return !existing || !sameContent(configuration, existing) || (configuration.defaultModel && !existing.defaultModel);
    });
}

/** 以服务端确认的配置标识恢复草稿，保留尚未保存的内容和选择。 */
export function reconcileModelConfigDraft(configurations: ServerModelConfig[], persistedConfigurations: ServerModelConfig[]) {
    const persistedByIdentity = new Map(persistedConfigurations.map((configuration) => [modelConfigIdentity(configuration), configuration]));
    return configurations.map((configuration) => {
        const persisted = persistedByIdentity.get(modelConfigIdentity(configuration));
        return persisted ? { ...configuration, id: persisted.id } : configuration;
    });
}

/** 逐条创建模型并立即回填成功结果，后续失败不会丢失已创建的标识。 */
export async function createDraftModelConfigs(
    configurations: ServerModelConfig[],
    baseline: ServerModelConfig[],
    create: (configuration: ServerModelConfig) => Promise<ServerModelConfig>,
    onCreated: (configurations: ServerModelConfig[], saved: ServerModelConfig) => void,
) {
    const persistedIds = new Set(baseline.map((configuration) => configuration.id));
    let drafts = reconcileModelConfigDraft(configurations, baseline);
    for (const configuration of drafts) {
        if (persistedIds.has(configuration.id)) continue;
        const saved = await create(configuration);
        drafts = drafts.map((draft) => (draft.id === configuration.id ? { ...draft, id: saved.id } : draft));
        persistedIds.add(saved.id);
        onCreated(drafts, saved);
    }
    return drafts;
}
