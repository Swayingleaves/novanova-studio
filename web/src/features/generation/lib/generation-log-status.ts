import type { CreationConversationStatus } from "@/features/generation/components/creation-workspace-types";

export type GenerationLogStatusFields = {
    generationStatus?: "idle" | "running" | "success" | "failed";
    generationCompletedAt?: string | null;
    generationViewedAt?: string | null;
};

export function getGenerationConversationStatus(log: GenerationLogStatusFields): CreationConversationStatus {
    if (log.generationStatus === "running") return "running";
    if (log.generationStatus !== "success" && log.generationStatus !== "failed") return "none";
    if (!log.generationCompletedAt) return "none";
    if (log.generationViewedAt && Date.parse(log.generationViewedAt) >= Date.parse(log.generationCompletedAt)) return "none";
    return log.generationStatus === "failed" ? "unreadFailed" : "unreadSuccess";
}

export function hasRunningGeneration(logs: GenerationLogStatusFields[]): boolean {
    return logs.some((log) => log.generationStatus === "running");
}
