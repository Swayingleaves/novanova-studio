export const reasoningEffortOptions: Array<{ value: "high" | "max"; label: string }> = [
    { value: "high", label: "high" },
    { value: "max", label: "max" },
];

export function isOpenAiTextModel(
    model: { modelType: string; channelId: string },
    channels: Array<{ id: string; apiFormat: string }>,
) {
    return model.modelType === "text" && channels.find((channel) => channel.id === model.channelId)?.apiFormat === "openai";
}

export function isReasoningEffortDisabled(isSaving: boolean, thinkingEnabled: boolean) {
    return isSaving || !thinkingEnabled;
}
