"use client";

import { create } from "zustand";

import { listCommunityConfigs, type CommunityConfig } from "@/services/api/community";

type CommunityStore = {
    configs: CommunityConfig[];
    loaded: boolean;
    /** 重新读取平台社群配置，失败时保留上一次结果。 */
    refresh: () => Promise<void>;
};

/** 社群配置由平台统一维护，读取失败时保持隐藏入口而不是打断页面。 */
export const useCommunityStore = create<CommunityStore>()((set) => ({
    configs: [],
    loaded: false,
    refresh: async () => {
        try {
            const configs = await listCommunityConfigs();
            set({ configs: [...(configs || [])].sort((first, second) => first.sortOrder - second.sortOrder), loaded: true });
        } catch {
            set({ loaded: true });
        }
    },
}));
