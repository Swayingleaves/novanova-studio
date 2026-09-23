"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useComicDramaStore } from "../stores/use-comic-drama-store";
import type { ComicDramaMediaResult } from "../types";

/** 存在进行中任务时的自动同步间隔。 */
const AUTO_REFRESH_INTERVAL_MS = 5000;

/** 媒体任务是否还在排队或生成中。 */
function isRunningMedia(media: ComicDramaMediaResult): boolean {
    return media.status === "queued" || media.status === "processing";
}

/**
 * 只要有媒体任务在排队或生成中就按固定间隔自动同步状态，全部结束后自动停止。
 * 手动与自动共用同一个飞行中保护，避免请求叠加；自动轮询失败保持静默。
 *
 * @param media 当前项目的媒体记录
 * @returns autoRefreshing 是否处于自动刷新；runningCount 进行中数量；lastSyncedAt 上次成功同步时间；syncNow 立即同步一次（失败会抛错）
 */
export function useMediaAutoRefresh(media: ComicDramaMediaResult[]) {
    const syncMedia = useComicDramaStore((state) => state.syncMedia);
    const [lastSyncedAt, setLastSyncedAt] = useState<string>("");
    const syncingRef = useRef(false);

    const runningCount = media.filter(isRunningMedia).length;
    const autoRefreshing = runningCount > 0;

    // 单次状态同步，带飞行中保护
    const syncNow = useCallback(async () => {
        if (syncingRef.current) return;
        syncingRef.current = true;
        try {
            await syncMedia();
            setLastSyncedAt(new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
        } finally {
            syncingRef.current = false;
        }
    }, [syncMedia]);

    // 依赖布尔值而非计数，计数变化不会重启定时器
    useEffect(() => {
        if (!autoRefreshing) return;
        void syncNow().catch(() => undefined);
        const timer = window.setInterval(() => {
            void syncNow().catch(() => undefined);
        }, AUTO_REFRESH_INTERVAL_MS);
        return () => window.clearInterval(timer);
    }, [autoRefreshing, syncNow]);

    return { autoRefreshing, runningCount, lastSyncedAt, syncNow };
}
