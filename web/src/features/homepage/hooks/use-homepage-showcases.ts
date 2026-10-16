"use client";
import { translateMessage as translate } from "@/features/locale/translate";
import { useTranslation } from "@/features/locale/use-translation";


import { useCallback, useEffect, useState } from "react";
import { fetchHomepageShowcases, homepageFallbackShowcases } from "../api/homepage-showcases";
import type { HomepageShowcase } from "@/services/api/server";

export function useHomepageShowcases() {
    const translate = useTranslation();
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
            setError(requestError instanceof Error ? requestError.message : translate("homepage.failedToLoadHomepageShowcases"));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void reload();
    }, [reload]);

    return { items, loading, error, reload };
}
