export type CanvasAgentChatAttachment = {
    id: string;
    name: string;
    url: string;
};

export type CanvasAgentChatMessage = {
    id: string;
    role: "user" | "assistant" | "system" | "tool" | "error";
    title?: string;
    text: string;
    meta?: string;
    detail?: unknown;
    attachments?: CanvasAgentChatAttachment[];
};

export type CanvasAgentMessageGroup = {
    role: CanvasAgentChatMessage["role"];
    messages: CanvasAgentChatMessage[];
};

export function groupCanvasAgentMessages(messages: readonly CanvasAgentChatMessage[]): CanvasAgentMessageGroup[] {
    return messages.reduce<CanvasAgentMessageGroup[]>((groups, message) => {
        const currentGroup = groups.at(-1);
        if (currentGroup?.role === message.role) {
            currentGroup.messages.push(message);
            return groups;
        }
        groups.push({ role: message.role, messages: [message] });
        return groups;
    }, []);
}

export function buildCanvasAgentAttachmentSummary(message: CanvasAgentChatMessage): string {
    const attachments = message.attachments ?? [];
    if (attachments.length === 0) return "";
    return `${attachments.length} 个附件：${attachments.map((attachment) => attachment.name).join("、")}`;
}
