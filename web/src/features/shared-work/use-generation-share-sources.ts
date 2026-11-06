import { useEffect } from "react";
import { useSharedWorkStore } from "./stores/use-shared-work-store";
import type { SharedWorkSource } from "@/services/api/shared-work";

/** 将当前已加载生成记录的媒体标识映射回真实记录，不向服务端提交客户端媒体。 */
export function useGenerationShareSources(conversations: readonly { id: string; rounds: unknown }[], workType: "image" | "video") {
    useEffect(() => {
        useSharedWorkStore.setState({ generationSources: collectGenerationShareSources(conversations, workType) });
        return () => { useSharedWorkStore.setState({ generationSources: {} }); };
    }, [conversations, workType]);
}

/** 服务端结果以父记录标识定位，媒体的独立标识和存储标识都可以供结果卡片查询。 */
export function collectGenerationShareSources(conversations: readonly { id: string; rounds: unknown }[], workType: "image" | "video") {
    const sources: Record<string, SharedWorkSource> = {};
    for (const conversation of conversations) {
        if (!Array.isArray(conversation.rounds)) continue;
        for (const round of conversation.rounds) {
            const visit = (value: unknown) => {
                if (!value || typeof value !== "object") return;
                if (Array.isArray(value)) { value.forEach(visit); return; }
                const record = value as Record<string, unknown>;
                const media = record[workType] as { id?: string; storageKey?: string } | undefined;
                if (media && typeof record.id === "string") {
                    const source: SharedWorkSource = { sourceType: "generation", sourceId: conversation.id, workType, roundId: round.id, resultId: record.id };
                    if (media.id) sources[media.id] = source;
                    if (media.storageKey) sources[media.storageKey] = source;
                }
                for (const key of ["results", "result", "outputs", "stages"]) visit(record[key]);
            };
            visit(round);
            const outputs = (items: unknown, prefix: string) => {
                if (!Array.isArray(items)) return;
                items.forEach((output: { id?: string; storageKey?: string; url?: string; taskType?: string; mimeType?: string }, index) => {
                    const kind = output.taskType === "image" || output.mimeType?.startsWith("image/") ? "image" : output.taskType === "video" || output.mimeType?.startsWith("video/") ? "video" : null;
                    if (!kind || !output.url) return;
                    const source: SharedWorkSource = { sourceType: "generation", sourceId: conversation.id, workType: kind, roundId: round.id, resultId: `${prefix}:${index + 1}` };
                    for (const identity of [output.id, output.storageKey, output.url]) if (identity) sources[identity] = source;
                });
            };
            outputs(round.outputs, "output");
            if (Array.isArray(round.stages)) round.stages.forEach((stage: { status?: string; outputs?: unknown }, index: number) => { if (stage.status === "success") outputs(stage.outputs, `stage:${index + 1}`); });
        }
    }
    return sources;
}
