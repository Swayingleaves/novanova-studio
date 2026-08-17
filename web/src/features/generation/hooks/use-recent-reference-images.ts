"use client";

import { useCallback, useEffect, useState } from "react";

import { loadRecentReferenceImageUrls, normalizeRecentReferenceImageUrls, prependRecentReferenceImageUrl, saveRecentReferenceImageUrls } from "@/features/generation/lib/recent-reference-images";

export function useRecentReferenceImages(userId?: string) {
    const [recentReferenceImageUrls, setRecentReferenceImageUrls] = useState<string[]>([]);

    useEffect(() => {
        let cancelled = false;
        setRecentReferenceImageUrls([]);
        void loadRecentReferenceImageUrls(userId)
            .then((urls) => {
                if (!cancelled) {
                    setRecentReferenceImageUrls((current) => {
                        const next = normalizeRecentReferenceImageUrls([...current, ...urls]);
                        if (current.length) void saveRecentReferenceImageUrls(userId, next).catch((error) => console.error("保存最近参考图失败", error));
                        return next;
                    });
                }
            })
            .catch((error) => console.error("读取最近参考图失败", error));
        return () => {
            cancelled = true;
        };
    }, [userId]);

    const recordRecentReferenceImage = useCallback(
        (url?: string) => {
            if (!userId || !url) return;
            setRecentReferenceImageUrls((current) => {
                const next = prependRecentReferenceImageUrl(current, url);
                void saveRecentReferenceImageUrls(userId, next).catch((error) => console.error("保存最近参考图失败", error));
                return next;
            });
        },
        [userId],
    );

    return { recentReferenceImageUrls, recordRecentReferenceImage };
}
