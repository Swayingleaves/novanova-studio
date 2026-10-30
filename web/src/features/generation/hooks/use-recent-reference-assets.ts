"use client";

import { useCallback, useEffect, useState } from "react";

import { loadRecentReferenceAssets, normalizeRecentReferenceAssets, prependRecentReferenceAsset, saveRecentReferenceAssets, type RecentReferenceAsset, type RecentReferenceAssetInput } from "@/features/generation/lib/recent-reference-assets";

export function useRecentReferenceAssets(userId?: string) {
    const [recentReferenceAssets, setRecentReferenceAssets] = useState<RecentReferenceAsset[]>([]);

    useEffect(() => {
        let cancelled = false;
        setRecentReferenceAssets([]);
        void loadRecentReferenceAssets(userId)
            .then((assets) => {
                if (!cancelled) {
                    setRecentReferenceAssets((current) => {
                        const next = normalizeRecentReferenceAssets([...current, ...assets]);
                        if (current.length) void saveRecentReferenceAssets(userId, next).catch((error) => console.error("保存最近上传素材失败", error));
                        return next;
                    });
                }
            })
            .catch((error) => console.error("读取最近上传素材失败", error));
        return () => {
            cancelled = true;
        };
    }, [userId]);

    const recordRecentReferenceAsset = useCallback(
        (asset: RecentReferenceAssetInput) => {
            if (!userId || !asset.url) return;
            setRecentReferenceAssets((current) => {
                const next = prependRecentReferenceAsset(current, asset);
                void saveRecentReferenceAssets(userId, next).catch((error) => console.error("保存最近上传素材失败", error));
                return next;
            });
        },
        [userId],
    );

    return { recentReferenceAssets, recordRecentReferenceAsset };
}
