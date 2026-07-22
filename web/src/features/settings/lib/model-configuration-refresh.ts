export async function refreshModelConfigurationSnapshot<Channel, ModelConfiguration>(
    loadChannels: () => Promise<{ channels: Channel[] }>,
    loadModelConfigurations: () => Promise<{ modelConfigs: ModelConfiguration[] }>,
    applySnapshot: (channels: Channel[], modelConfigurations: ModelConfiguration[]) => void,
): Promise<void> {
    const [channelResult, modelConfigurationResult] = await Promise.all([loadChannels(), loadModelConfigurations()]);
    applySnapshot(channelResult.channels, modelConfigurationResult.modelConfigs);
}
