"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const TYPEWRITER_CHARACTER_COUNT_PER_FRAME = 1;
const TYPEWRITER_INTERVAL_MILLISECONDS = 6;

type AssistantStreamMessage = {
    sessionId: string;
    messageId: string;
    receivedText: string;
    displayedText: string;
    finalText?: string;
    removeAfterDrain: boolean;
};

type UseAssistantMessageStreamOptions = {
    onMessageDrain: (sessionId: string, messageId: string, text: string) => void;
    onDisplayText?: (sessionId: string, messageId: string, text: string) => void;
    onTaskDisplayComplete: () => void;
};

/**
 * 将高频 SSE 文本增量缓冲到固定节奏的动画帧中显示，避免完成事件让回复瞬间跳到全文。
 */
export function useAssistantMessageStream({ onMessageDrain, onDisplayText, onTaskDisplayComplete }: UseAssistantMessageStreamOptions) {
    const [displayedTextByMessageId, setDisplayedTextByMessageId] = useState<Record<string, string>>({});
    const streamMessagesRef = useRef(new Map<string, AssistantStreamMessage>());
    const animationFrameIdentifierRef = useRef<number | null>(null);
    const lastRenderTimestampRef = useRef<number | null>(null);
    const taskCompletionPendingRef = useRef(false);
    const callbacksRef = useRef({ onMessageDrain, onDisplayText, onTaskDisplayComplete });
    callbacksRef.current = { onMessageDrain, onDisplayText, onTaskDisplayComplete };

    const renderNextFrame = useCallback((timestamp: number) => {
        animationFrameIdentifierRef.current = null;
        if (lastRenderTimestampRef.current !== null && timestamp - lastRenderTimestampRef.current < TYPEWRITER_INTERVAL_MILLISECONDS) {
            animationFrameIdentifierRef.current = requestAnimationFrame(renderNextFrame);
            return;
        }
        lastRenderTimestampRef.current = timestamp;
        let shouldContinueRendering = false;
        const displayedTextChanges = new Map<string, string | null>();

        for (const [messageId, streamMessage] of streamMessagesRef.current) {
            const remainingLength = streamMessage.receivedText.length - streamMessage.displayedText.length;
            if (remainingLength > 0) {
                const nextTextEnd = findNextTextEnd(streamMessage.receivedText, streamMessage.displayedText.length, TYPEWRITER_CHARACTER_COUNT_PER_FRAME);
                streamMessage.displayedText = streamMessage.receivedText.slice(0, nextTextEnd);
                displayedTextChanges.set(messageId, streamMessage.displayedText);
                callbacksRef.current.onDisplayText?.(streamMessage.sessionId, messageId, streamMessage.displayedText);
            }

            if (streamMessage.displayedText.length < streamMessage.receivedText.length) {
                shouldContinueRendering = true;
                continue;
            }

            if (streamMessage.finalText !== undefined) {
                streamMessagesRef.current.delete(messageId);
                displayedTextChanges.set(messageId, null);
                continue;
            }

            if (streamMessage.removeAfterDrain) {
                callbacksRef.current.onMessageDrain(streamMessage.sessionId, messageId, streamMessage.receivedText);
                streamMessagesRef.current.delete(messageId);
                displayedTextChanges.set(messageId, null);
            }
        }

        if (displayedTextChanges.size > 0) {
            setDisplayedTextByMessageId((previousDisplayedText) => applyDisplayedTextChanges(previousDisplayedText, displayedTextChanges));
        }

        if (taskCompletionPendingRef.current && streamMessagesRef.current.size === 0) {
            taskCompletionPendingRef.current = false;
            callbacksRef.current.onTaskDisplayComplete();
        }

        if (shouldContinueRendering) {
            animationFrameIdentifierRef.current = requestAnimationFrame(renderNextFrame);
        }
    }, []);

    const scheduleRendering = useCallback(() => {
        if (animationFrameIdentifierRef.current === null) {
            animationFrameIdentifierRef.current = requestAnimationFrame(renderNextFrame);
        }
    }, [renderNextFrame]);

    const appendTextDelta = useCallback((sessionId: string, messageId: string, delta: string) => {
        const discardedMessageIds: string[] = [];
        // Agent 工具调用轮次可能先输出临时片段，最终答复使用新 messageId；丢弃未完成片段避免生成额外气泡。
        for (const [currentMessageId, currentStreamMessage] of streamMessagesRef.current) {
            if (currentMessageId !== messageId && currentStreamMessage.finalText === undefined) {
                streamMessagesRef.current.delete(currentMessageId);
                discardedMessageIds.push(currentMessageId);
            }
        }

        if (discardedMessageIds.length > 0) {
            setDisplayedTextByMessageId((previousDisplayedText) => {
                const nextDisplayedText = { ...previousDisplayedText };
                discardedMessageIds.forEach((discardedMessageId) => delete nextDisplayedText[discardedMessageId]);
                return nextDisplayedText;
            });
        }

        const existingStreamMessage = streamMessagesRef.current.get(messageId);
        const streamMessage = existingStreamMessage || {
            sessionId,
            messageId,
            receivedText: "",
            displayedText: "",
            removeAfterDrain: false,
        };
        if (streamMessage.finalText !== undefined) return;
        streamMessage.receivedText += delta;
        streamMessagesRef.current.set(messageId, streamMessage);
        if (!existingStreamMessage) {
            setDisplayedTextByMessageId((previousDisplayedText) => ({ ...previousDisplayedText, [messageId]: "" }));
        }
        scheduleRendering();
    }, [scheduleRendering]);

    const completeTextMessage = useCallback((sessionId: string, messageId: string, finalText: string) => {
        for (const [currentMessageId, currentStreamMessage] of streamMessagesRef.current) {
            if (currentMessageId !== messageId) {
                currentStreamMessage.removeAfterDrain = true;
            }
        }

        const streamMessage = streamMessagesRef.current.get(messageId) || {
            sessionId,
            messageId,
            receivedText: "",
            displayedText: "",
            removeAfterDrain: false,
        };
        if (!finalText.startsWith(streamMessage.displayedText)) {
            streamMessage.displayedText = finalText.slice(0, findCommonPrefixLength(streamMessage.displayedText, finalText));
        }
        streamMessage.receivedText = finalText;
        streamMessage.finalText = finalText;
        streamMessage.removeAfterDrain = false;
        streamMessagesRef.current.set(messageId, streamMessage);
        taskCompletionPendingRef.current = true;
        setDisplayedTextByMessageId((previousDisplayedText) => ({ ...previousDisplayedText, [messageId]: streamMessage.displayedText }));
        scheduleRendering();
    }, [scheduleRendering]);

    const resetTextStream = useCallback((persistReceivedText = false) => {
        if (animationFrameIdentifierRef.current !== null) {
            cancelAnimationFrame(animationFrameIdentifierRef.current);
            animationFrameIdentifierRef.current = null;
        }
        if (persistReceivedText) {
            for (const streamMessage of streamMessagesRef.current.values()) {
                callbacksRef.current.onMessageDrain(streamMessage.sessionId, streamMessage.messageId, streamMessage.receivedText);
            }
        }
        streamMessagesRef.current.clear();
        lastRenderTimestampRef.current = null;
        taskCompletionPendingRef.current = false;
        setDisplayedTextByMessageId({});
    }, []);

    useEffect(() => () => {
        if (animationFrameIdentifierRef.current !== null) {
            cancelAnimationFrame(animationFrameIdentifierRef.current);
        }
        streamMessagesRef.current.clear();
        taskCompletionPendingRef.current = false;
    }, []);

    return { displayedTextByMessageId, appendTextDelta, completeTextMessage, resetTextStream };
}

/**
 * 合并单帧内的流式文本变化，减少 React 状态更新次数。
 */
function applyDisplayedTextChanges(previousDisplayedText: Record<string, string>, changes: Map<string, string | null>) {
    const nextDisplayedText = { ...previousDisplayedText };
    for (const [messageId, text] of changes) {
        if (text === null) {
            delete nextDisplayedText[messageId];
        } else {
            nextDisplayedText[messageId] = text;
        }
    }
    return nextDisplayedText;
}

/**
 * 按完整 Unicode 字符计算下一帧文本结束位置，避免临时截断表情符号。
 */
function findNextTextEnd(text: string, startIndex: number, characterCount: number) {
    let currentIndex = startIndex;
    let consumedCharacterCount = 0;
    while (currentIndex < text.length && consumedCharacterCount < characterCount) {
        const codePoint = text.codePointAt(currentIndex);
        currentIndex += codePoint !== undefined && codePoint > 0xffff ? 2 : 1;
        consumedCharacterCount += 1;
    }
    return currentIndex;
}

/**
 * 查找两个文本的共同前缀长度，避免完成事件替换文本时直接跳到全文。
 */
function findCommonPrefixLength(firstText: string, secondText: string) {
    let firstIndex = 0;
    let secondIndex = 0;
    while (firstIndex < firstText.length && secondIndex < secondText.length) {
        const firstCodePoint = firstText.codePointAt(firstIndex);
        const secondCodePoint = secondText.codePointAt(secondIndex);
        if (firstCodePoint !== secondCodePoint) break;
        firstIndex += firstCodePoint !== undefined && firstCodePoint > 0xffff ? 2 : 1;
        secondIndex += secondCodePoint !== undefined && secondCodePoint > 0xffff ? 2 : 1;
    }
    return firstIndex;
}
