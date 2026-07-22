"use client";

import { useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";

import { ALL_PROMPTS_OPTION, fetchPrompts } from "@/features/prompts/api/prompts";

export const PROMPT_PAGE_SIZE = 20;

export type UsePromptListParams = {
    keyword: string;
    tags: string[];
    category: string;
    enabled?: boolean;
};

export function usePromptList({ keyword, tags, category, enabled = true }: UsePromptListParams) {
    const normalizedKeyword = keyword.trim();
    const normalizedTags = useMemo(() => [...new Set(tags.filter((tag) => tag && tag !== ALL_PROMPTS_OPTION))].sort(), [tags]);
    const query = useInfiniteQuery({
        queryKey: ["prompts", normalizedKeyword, normalizedTags, category],
        queryFn: ({ pageParam }) => fetchPrompts({ keyword: normalizedKeyword, tag: normalizedTags, category, page: pageParam, pageSize: PROMPT_PAGE_SIZE }),
        initialPageParam: 1,
        getNextPageParam: (lastPage, pages) => (pages.reduce((total, page) => total + page.items.length, 0) < lastPage.total ? pages.length + 1 : undefined),
        enabled,
        staleTime: 5 * 60 * 1000,
    });
    const firstPage = query.data?.pages[0];
    const items = useMemo(() => query.data?.pages.flatMap((page) => page.items) || [], [query.data?.pages]);
    const promptTags = useMemo(() => [ALL_PROMPTS_OPTION, ...(firstPage?.tags || [])], [firstPage?.tags]);
    const promptCategories = useMemo(() => [ALL_PROMPTS_OPTION, ...(firstPage?.categories || [])], [firstPage?.categories]);

    return {
        query,
        items,
        tags: promptTags,
        categories: promptCategories,
        total: firstPage?.total || 0,
    };
}
