"use client";

import { create } from "zustand";

import {
    listNavigationMenuConfigs,
    type NavigationMenuConfig,
    type NavigationMenuConfigInput,
} from "@/services/api/navigation-menu";

const NAVIGATION_MENU_CACHE_KEY = "novanova:navigation-menu-configs";
const MAX_REFRESH_RETRY_ATTEMPTS = 5;
const REFRESH_RETRY_DELAY_MS = 1500;

let refreshRetryAttempts = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

/** 归一化并按 sortOrder 排序菜单配置。 */
function normalizeConfigs(configs: readonly NavigationMenuConfig[] | null | undefined): NavigationMenuConfig[] {
    return [...(configs || [])]
        .filter((item) => item && typeof item.menuKey === "string")
        .map((item, index) => ({
            menuKey: item.menuKey,
            enabled: Boolean(item.enabled),
            sortOrder: typeof item.sortOrder === "number" ? item.sortOrder : index,
            displayName: item.displayName ?? null,
            iconKey: item.iconKey ?? null,
            badgeText: item.badgeText === undefined ? undefined : item.badgeText,
            badgeColor: item.badgeColor ?? null,
        }))
        .sort((first, second) => first.sortOrder - second.sortOrder);
}

/** 读取上次成功拉取的极简菜单配置快照，避免发版重启瞬间回退为全部默认显示。 */
function readCachedConfigs(): NavigationMenuConfig[] {
    if (typeof window === "undefined") return [];
    try {
        const raw = window.localStorage.getItem(NAVIGATION_MENU_CACHE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? normalizeConfigs(parsed as NavigationMenuConfig[]) : [];
    } catch {
        return [];
    }
}

/** 持久化最新菜单配置快照（仅包含几条菜单键与布尔开关）。 */
function writeCachedConfigs(configs: readonly NavigationMenuConfig[]): void {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(NAVIGATION_MENU_CACHE_KEY, JSON.stringify(configs));
    } catch {
        // 隐私模式或存储受限时忽略缓存写入
    }
}

function clearScheduledRetry(): void {
    if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
    }
}

type NavigationMenuStore = {
    configs: NavigationMenuConfig[];
    loaded: boolean;
    /** 重新读取平台导航菜单配置；服务重启等瞬时失败时优先使用上次缓存并自动重试。 */
    refresh: () => Promise<void>;
    /** 后台保存成功后立即更新本地缓存，使左侧导航同步生效。 */
    setConfigsFromInputs: (inputs: readonly NavigationMenuConfigInput[]) => void;
};

/** 平台左侧导航菜单配置状态。 */
export const useNavigationMenuStore = create<NavigationMenuStore>()((set, get) => ({
    configs: [],
    loaded: false,
    refresh: async () => {
        clearScheduledRetry();
        try {
            const configs = normalizeConfigs(await listNavigationMenuConfigs());
            refreshRetryAttempts = 0;
            writeCachedConfigs(configs);
            set({ configs, loaded: true });
        } catch {
            // 优先使用已有内存配置或上次持久化的菜单快照，防止已隐藏的菜单在更新刷新瞬间重新冒出。
            const current = get().configs;
            const fallback = current.length ? current : readCachedConfigs();
            if (fallback.length) {
                set({ configs: fallback, loaded: true });
            }
            if (refreshRetryAttempts < MAX_REFRESH_RETRY_ATTEMPTS) {
                refreshRetryAttempts += 1;
                retryTimer = setTimeout(() => {
                    retryTimer = null;
                    void get().refresh();
                }, REFRESH_RETRY_DELAY_MS);
                return;
            }
            refreshRetryAttempts = 0;
            set({ loaded: true });
        }
    },
    setConfigsFromInputs: (inputs) => {
        clearScheduledRetry();
        refreshRetryAttempts = 0;
        const nextConfigs = inputs.map((item, index) => ({
            menuKey: item.menuKey,
            enabled: Boolean(item.enabled),
            sortOrder: index,
            displayName: item.displayName ?? null,
            iconKey: item.iconKey ?? null,
            badgeText: item.badgeText ?? null,
            badgeColor: item.badgeColor ?? null,
        }));
        writeCachedConfigs(nextConfigs);
        set({ configs: nextConfigs, loaded: true });
    },
}));
