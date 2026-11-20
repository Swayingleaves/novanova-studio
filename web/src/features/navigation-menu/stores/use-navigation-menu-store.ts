"use client";

import { create } from "zustand";

import {
    listNavigationMenuConfigs,
    type NavigationMenuConfig,
    type NavigationMenuConfigInput,
} from "@/services/api/navigation-menu";

type NavigationMenuStore = {
    configs: NavigationMenuConfig[];
    loaded: boolean;
    /** 重新读取平台导航菜单配置，失败时保留上一次结果并标记已加载避免导航长期空白。 */
    refresh: () => Promise<void>;
    /** 后台保存成功后立即更新本地缓存，使左侧导航同步生效。 */
    setConfigsFromInputs: (inputs: readonly NavigationMenuConfigInput[]) => void;
};

/** 平台左侧导航菜单配置状态，读取失败时自动回退为全部默认显示。 */
export const useNavigationMenuStore = create<NavigationMenuStore>()((set) => ({
    configs: [],
    loaded: false,
    refresh: async () => {
        try {
            const configs = await listNavigationMenuConfigs();
            set({
                configs: [...(configs || [])].sort((first, second) => first.sortOrder - second.sortOrder),
                loaded: true,
            });
        } catch {
            set({ loaded: true });
        }
    },
    setConfigsFromInputs: (inputs) => {
        set({
            configs: inputs.map((item, index) => ({
                menuKey: item.menuKey,
                enabled: Boolean(item.enabled),
                sortOrder: index,
            })),
            loaded: true,
        });
    },
}));
