"use client";

import { useEffect, useRef, useState } from "react";

import { applyHomepageCreationSettings, peekHomepageCreationHandoff, type HomepageCreationDraft, type HomepageCreationTarget } from "@/features/homepage/lib/homepage-creation-handoff";
import { useConfigStore } from "@/features/settings/stores/use-config-store";

/** 配置恢复完成后再读取首页草稿，避免随后的配置水合把草稿里的模型盖掉。 */
export function useHomepageCreationDraft(target: HomepageCreationTarget) {
    const configHydrated = useConfigStore((state) => state.hydrated);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const [draft, setDraft] = useState<HomepageCreationDraft | null>(null);
    const appliedRef = useRef(false);

    useEffect(() => {
        if (!configHydrated || appliedRef.current) return;
        appliedRef.current = true;
        const next = peekHomepageCreationHandoff(target);
        if (!next) return;
        applyHomepageCreationSettings(next, updateConfig);
        setDraft(next);
    }, [configHydrated, target, updateConfig]);

    return draft;
}
