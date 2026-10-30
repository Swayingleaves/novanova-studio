"use client";

import { useQuery } from "@tanstack/react-query";
import { useTeamStore } from "@/features/team/stores/use-team-store";
import { getComicDramaFinalPromptUnitPrice } from "@/services/api/comic-drama";

/** 单镜头和批量生成共用的价格查询及启动条件。 */
export function useFinalPromptPricing(model: string, enabled: boolean) {
    const teamId = useTeamStore((state) => state.team?.id ?? 0);
    const query = useQuery({
        queryKey: ["comicDrama", "finalPromptUnitPrice", teamId, model],
        queryFn: () => getComicDramaFinalPromptUnitPrice(model),
        enabled: Boolean(model && enabled),
        retry: false,
    });
    const ready = Boolean(model && !query.isFetching && !query.isError
        && query.data?.unitPrice != null && query.data.revision > 0);
    const reason = !model ? "请选择提示词模型"
        : query.isFetching ? "正在加载最终提示词价格"
        : query.isError ? `价格加载失败：${query.error.message}`
        : query.data?.unitPrice == null ? "该模型尚未定价，请联系管理员在「创作定价 · 漫剧创作-生成最终提示词定价」配置"
        : "";
    return { ...query, ready, reason };
}
