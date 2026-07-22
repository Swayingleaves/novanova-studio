type ImageConversation = {
    rounds: readonly {
        results: readonly {
            status: string;
        }[];
    }[];
};

type VideoConversation = {
    rounds: readonly {
        result: {
            status: string;
        };
    }[];
};

type ConversationWithUpdatedAt = {
    updatedAt: number;
};

export function hasPendingImageConversation(conversation: ImageConversation): boolean {
    return conversation.rounds.some((round) => round.results.some((result) => result.status === "pending"));
}

export function hasPendingVideoConversation(conversation: VideoConversation): boolean {
    return conversation.rounds.some((round) => round.result.status === "pending");
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
