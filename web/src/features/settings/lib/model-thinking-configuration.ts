export const reasoningEffortOptions: Array<{ value: "high" | "max"; label: string }> = [
    { value: "high", label: "high" },
    { value: "max", label: "max" },
];

export function supportsThinkingConfiguration(
    model: { modelType: string },
) {
    return model.modelType === "text";
}

export function isReasoningEffortDisabled(isSaving: boolean, thinkingEnabled: boolean) {
    return isSaving || !thinkingEnabled;
}
