import type { AgentAttachment } from "@/features/canvas/api/agent";

const RETRY_MESSAGES = new Set(["重试", "再试一次", "重新生成", "再生成一次", "retry", "try again", "regenerate", "generate again"]);

export function isGenerationRetryMessage(message: string): boolean {
    const normalizedMessage = message.trim().toLowerCase().replace(/[。！!？?，,、.\s]+$/, "");
    return RETRY_MESSAGES.has(normalizedMessage);
}

export function selectGenerationAttachments(message: string, currentAttachments: AgentAttachment[], previousAttachments: AgentAttachment[]): AgentAttachment[] {
    if (currentAttachments.length || !isGenerationRetryMessage(message)) return currentAttachments;
    return previousAttachments;
}

/**
 * 选取视频对话本轮实际使用的参考素材：
 * - 当前输入框已选素材时优先使用当前素材；
 * - 文生视频模式要求 0 参考素材，不继承历史素材；
 * - 图生视频 / 首尾帧 / 全能参考模式下，当前未重新选择素材时自动复用本对话已有参考素材，
 *   支持报错后直接输入「重试」或修改提示词重新发送，无需重复选图。
 */
export function selectVideoGenerationAttachments(mode: string, currentAttachments: AgentAttachment[], previousAttachments: AgentAttachment[]): AgentAttachment[] {
    if (currentAttachments.length) return currentAttachments;
    if (mode === "text-to-video" || !previousAttachments.length) return [];
    return previousAttachments;
}
