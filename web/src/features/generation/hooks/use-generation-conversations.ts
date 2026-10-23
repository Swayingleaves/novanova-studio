"use client";

import { useCallback, useMemo, useRef, type RefObject } from "react";
import { useInfiniteQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";

import { generationLogQueryOptions, mergeGenerationLogPages } from "@/features/generation/lib/generation-log-pagination";
import { getGenerationConversationStatus, type GenerationLogStatusFields } from "@/features/generation/lib/generation-log-status";
import { reconcileGenerationLogTasks } from "@/features/generation/lib/generation-log-task-reconciliation";
import { listGenerationLogs, markGenerationLogViewed, type ServerGenerationLogPage } from "@/services/api/server";

type GenerationConversation = GenerationLogStatusFields & { id: string; rounds: unknown };

/** 统一管理任务列表的分页、刷新、已读状态和局部更新。 */
export function useGenerationConversations<Conversation extends GenerationConversation>(
    logType: "image" | "video",
    userId: string | undefined,
    activeId: RefObject<string | null>,
    normalizeConversation: (raw: Partial<Conversation>) => Promise<Conversation>,
) {
    const queryClient = useQueryClient();
    const readPage = useCallback(async (page: number): Promise<ServerGenerationLogPage<Conversation>> => {
        const result = await listGenerationLogs<Conversation>(logType, page);
        const reconciled = await reconcileGenerationLogTasks(logType, result.logs);
        let logs: Conversation[] = await Promise.all(reconciled.map(normalizeConversation));
        const activeConversation = logs.find((conversation) => conversation.id === activeId.current);
        if (activeConversation && getGenerationConversationStatus(activeConversation) !== "none" && activeConversation.generationStatus !== "running") {
            try {
                await markGenerationLogViewed(activeConversation.id);
                logs = logs.map((conversation) => conversation.id === activeConversation.id
                    ? { ...conversation, generationViewedAt: conversation.generationCompletedAt } : conversation);
            } catch (error) {
                console.error("标记生成记录已读失败", error);
            }
        }
        return { ...result, logs };
    }, [activeId, logType, normalizeConversation]);
    const options = useMemo(() => generationLogQueryOptions(logType, userId, readPage), [logType, userId, readPage]);
    const query = useInfiniteQuery(options);
    const conversations = useMemo(() => mergeGenerationLogPages(query.data?.pages || []), [query.data]);
    const conversationsRef = useRef(conversations);
    conversationsRef.current = conversations;
    const requests = useMemo(() => ({
        refresh: null as Promise<Conversation[]> | null,
        more: null as Promise<unknown> | null,
        refreshAgain: false,
    }), [logType, userId]);
    const { refetch, fetchNextPage } = query;

    const refreshConversations = useCallback(() => {
        if (requests.refresh) {
            requests.refreshAgain = true;
            return requests.refresh;
        }
        const request = (async () => {
            // 等待翻页完成后再刷新，避免丢掉期间发生的新任务和删除事件。
            if (requests.more) await requests.more;
            let result;
            do {
                requests.refreshAgain = false;
                result = await refetch({ cancelRefetch: false });
            } while (requests.refreshAgain);
            return mergeGenerationLogPages(result.data?.pages || []);
        })();
        requests.refresh = request;
        void request.finally(() => { requests.refresh = null; });
        return request;
    }, [refetch, requests]);

    const loadMoreConversations = useCallback(() => {
        if (requests.refresh || requests.more || query.isFetching || !query.hasNextPage) return;
        const request = fetchNextPage({ cancelRefetch: false });
        requests.more = request;
        void request.finally(() => { requests.more = null; });
    }, [fetchNextPage, query.hasNextPage, query.isFetching, requests]);

    const setConversations = useCallback((update: (current: Conversation[]) => Conversation[]) => {
        queryClient.setQueryData<InfiniteData<ServerGenerationLogPage<Conversation>>>(options.queryKey, (current) => {
            if (!current) return current;
            const next = update(mergeGenerationLogPages(current.pages));
            conversationsRef.current = next;
            const updated = new Map(next.map((conversation) => [conversation.id, conversation]));
            return { ...current, pages: current.pages.map((page) => ({ ...page, logs: page.logs.flatMap((conversation) => {
                const value = updated.get(conversation.id);
                return value ? [value] : [];
            }) })) };
        });
    }, [options.queryKey, queryClient]);

    return {
        conversations,
        conversationsRef,
        setConversations,
        refreshConversations,
        loadMoreConversations,
        conversationsLoading: query.isFetching,
        hasMoreConversations: query.hasNextPage,
        conversationsError: query.error,
        retryConversations: query.isFetchNextPageError ? loadMoreConversations : refreshConversations,
    };
}
