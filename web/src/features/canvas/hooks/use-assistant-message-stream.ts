"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type AssistantStreamMessage = {
    sessionId: string;
    messageId: string;
    receivedText: string;
};

type UseAssistantMessageStreamOptions = {
    onMessageDrain: (sessionId: string, messageId: string, text: string) => void;
    onDisplayText?: (sessionId: string, messageId: string, text: string) => void;
    onTaskDisplayComplete: () => void;
};

/**
 * 实时汇总画布 Agent 的流式 SSE 文本增量并立即上屏，不再做逐字打字机延迟缓冲，
 * 由前端 StreamingReplyBubble 统一负责平滑弹簧展开与词片显影动效。
 */
export function useAssistantMessageStream({ onMessageDrain, onDisplayText, onTaskDisplayComplete }: UseAssistantMessageStreamOptions) {
    const [displayedTextByMessageId, setDisplayedTextByMessageId] = useState<Record<string, string>>({});
    const streamMessagesRef = useRef(new Map<string, AssistantStreamMessage>());
    const callbacksRef = useRef({ onMessageDrain, onDisplayText, onTaskDisplayComplete });
    callbacksRef.current = { onMessageDrain, onDisplayText, onTaskDisplayComplete };

    const appendTextDelta = useCallback((sessionId: string, messageId: string, delta: string) => {
        const discardedMessageIds: string[] = [];
        for (const currentMessageId of streamMessagesRef.current.keys()) {
            if (currentMessageId !== messageId) {
                streamMessagesRef.current.delete(currentMessageId);
                discardedMessageIds.push(currentMessageId);
            }
        }

        const existing = streamMessagesRef.current.get(messageId);
        const nextText = (existing?.receivedText || "") + delta;
        streamMessagesRef.current.set(messageId, { sessionId, messageId, receivedText: nextText });
        callbacksRef.current.onDisplayText?.(sessionId, messageId, nextText);
        setDisplayedTextByMessageId((previous) => {
            const next = { ...previous };
            discardedMessageIds.forEach((id) => delete next[id]);
            next[messageId] = nextText;
            return next;
        });
    }, []);

    const completeTextMessage = useCallback((sessionId: string, messageId: string, finalText: string) => {
        for (const [currentMessageId, currentStreamMessage] of streamMessagesRef.current) {
            if (currentMessageId !== messageId) {
                callbacksRef.current.onMessageDrain(currentStreamMessage.sessionId, currentMessageId, currentStreamMessage.receivedText);
                streamMessagesRef.current.delete(currentMessageId);
            }
        }
        streamMessagesRef.current.delete(messageId);
        callbacksRef.current.onDisplayText?.(sessionId, messageId, finalText);
        setDisplayedTextByMessageId((previous) => {
            if (!(messageId in previous) && Object.keys(previous).length === 0) {
                return previous;
            }
            const next = { ...previous };
            delete next[messageId];
            return next;
        });
        callbacksRef.current.onTaskDisplayComplete();
    }, []);

    const resetTextStream = useCallback((persistReceivedText = false) => {
        if (persistReceivedText) {
            for (const streamMessage of streamMessagesRef.current.values()) {
                callbacksRef.current.onMessageDrain(streamMessage.sessionId, streamMessage.messageId, streamMessage.receivedText);
            }
        }
        streamMessagesRef.current.clear();
        setDisplayedTextByMessageId({});
    }, []);

    useEffect(() => () => {
        streamMessagesRef.current.clear();
    }, []);

    return { displayedTextByMessageId, appendTextDelta, completeTextMessage, resetTextStream };
}
