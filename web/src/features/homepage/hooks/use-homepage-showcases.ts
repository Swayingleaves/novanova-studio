"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchHomepageShowcases, homepageFallbackShowcases } from "../api/homepage-showcases";
import type { HomepageShowcase } from "@/services/api/server";

export function useHomepageShowcases() {
    const [items, setItems] = useState<HomepageShowcase[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const reload = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const remoteItems = await fetchHomepageShowcases();
            setItems(remoteItems.length ? remoteItems : homepageFallbackShowcases);
        } catch (requestError) {
            setItems([]);
            setError(requestError instanceof Error ? requestError.message : "读取首页精选内容失败");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void reload();
    }, [reload]);

    return { items, loading, error, reload };
}
