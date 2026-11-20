"use client";

import { create } from "zustand";

import { getVideoExportSettings } from "@/services/api/video-export-settings";

type VideoExportSettingsStore = {
    enabled: boolean;
    loaded: boolean;
    /** 重新读取平台导出视频开关配置，失败时保留上一次结果。 */
    refresh: () => Promise<boolean>;
    /** 后台保存成功后立即更新本地缓存。 */
    setEnabled: (enabled: boolean) => void;
};

/** 平台漫剧视觉分镜板导出视频开关状态，默认开启。 */
export const useVideoExportSettingsStore = create<VideoExportSettingsStore>()((set, get) => ({
    enabled: true,
    loaded: false,
    refresh: async () => {
        try {
            const settings = await getVideoExportSettings();
            const enabled = settings ? Boolean(settings.enabled) : true;
            set({ enabled, loaded: true });
            return enabled;
        } catch {
            set({ loaded: true });
            return get().enabled;
        }
    },
    setEnabled: (enabled) => {
        set({ enabled: Boolean(enabled), loaded: true });
    },
}));
