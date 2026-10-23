import { infiniteQueryOptions } from "@tanstack/react-query";

import type { ServerGenerationLogPage } from "@/services/api/server";

/** 两个创作页面共用页码规则，刷新时顺序重读已加载的页面。 */
export function generationLogQueryOptions<Conversation>(
    logType: "image" | "video",
    userId: string | undefined,
    readPage: (page: number) => Promise<ServerGenerationLogPage<Conversation>>,
) {
    return infiniteQueryOptions({
        queryKey: ["generationConversations", userId, logType],
        queryFn: ({ pageParam }) => readPage(pageParam),
        initialPageParam: 1,
        getNextPageParam: (lastPage, _pages, lastPageParam) => lastPage.hasMore ? lastPageParam + 1 : undefined,
        enabled: false,
        retry: false,
        gcTime: 0,
    });
}

/** 按服务端顺序合并分页，去除新增任务导致页边界移动时的重复记录。 */
export function mergeGenerationLogPages<Conversation extends { id: string }>(pages: ServerGenerationLogPage<Conversation>[]): Conversation[] {
    const seen = new Set<string>();
    return pages.flatMap((page) => page.logs).filter((conversation) => {
        if (seen.has(conversation.id)) return false;
        seen.add(conversation.id);
        return true;
    });
}
