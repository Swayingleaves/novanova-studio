type ImageConversation = {
    rounds: readonly {
        results: readonly {
            status: string;
        }[];
    }[];
};

type VideoConversation = {
    rounds: readonly {
        result?: {
            status: string;
        };
        stages?: readonly { status: string }[];
        tasks?: readonly { status?: string }[];
    }[];
};

type ConversationWithUpdatedAt = {
    updatedAt: number;
};

export function hasPendingImageConversation(conversation: ImageConversation): boolean {
    return conversation.rounds.some((round) => round.results.some((result) => result.status === "pending"));
}

export function hasPendingVideoConversation(conversation: VideoConversation): boolean {
    return conversation.rounds.some((round) => round.result?.status === "pending"
        || round.stages?.some((stage) => stage.status === "pending" || stage.status === "running")
        || round.tasks?.some((task) => task.status === "pending" || task.status === "running"));
}

export function findLatestPendingConversation<Conversation extends ConversationWithUpdatedAt>(
    conversations: readonly Conversation[],
    hasPendingConversation: (conversation: Conversation) => boolean,
): Conversation | null {
    let latestConversation: Conversation | null = null;

    for (const conversation of conversations) {
        if (hasPendingConversation(conversation) && (latestConversation === null || conversation.updatedAt > latestConversation.updatedAt)) {
            latestConversation = conversation;
        }
    }

    return latestConversation;
}
