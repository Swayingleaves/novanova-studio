import type { AgentAttachment } from "@/features/canvas/api/agent";

const RETRY_MESSAGES = new Set(["重试", "再试一次", "重新生成", "再生成一次"]);

export function isGenerationRetryMessage(message: string): boolean {
    const normalizedMessage = message.trim().replace(/[。！!？?，,、\s]+$/, "");
    return RETRY_MESSAGES.has(normalizedMessage);
}

export function selectGenerationAttachments(message: string, currentAttachments: AgentAttachment[], previousAttachments: AgentAttachment[]): AgentAttachment[] {
    if (currentAttachments.length || !isGenerationRetryMessage(message)) return currentAttachments;
    return previousAttachments;
}
