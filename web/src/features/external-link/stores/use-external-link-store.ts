"use client";

import { create } from "zustand";

import { getExternalLinkConfig, type ExternalLinkConfig } from "@/services/api/external-link";

type ExternalLinkStore = {
    config: ExternalLinkConfig | null;
    loaded: boolean;
    /** 重新读取展示外链配置，失败时保留上一次结果。 */
    refresh: () => Promise<void>;
};

/** 展示外链由平台统一维护，读取失败时保持隐藏入口而不是打断页面。 */
export const useExternalLinkStore = create<ExternalLinkStore>()((set) => ({
    config: null,
    loaded: false,
    refresh: async () => {
        try {
            const config = await getExternalLinkConfig();
            set({ config: config && config.title && config.url ? config : null, loaded: true });
        } catch {
            set({ loaded: true });
        }
    },
}));
