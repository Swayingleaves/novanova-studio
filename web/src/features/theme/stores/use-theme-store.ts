"use client";

import { create } from "zustand";

import { applyResolvedThemeToDocument, persistThemePreference, readStoredThemePreference, readSystemResolvedTheme, resolveThemePreference, type ResolvedTheme, type ThemePreference } from "@/shared/lib/theme-preference";

type ThemeStore = {
    hydrated: boolean;
    preference: ThemePreference;
    resolvedTheme: ResolvedTheme;
    hydrateTheme: (initialPreference: ThemePreference) => void;
    setThemePreference: (preference: ThemePreference) => void;
    syncSystemTheme: (systemPrefersDark?: boolean) => void;
};

/** 默认主题偏好。 */
const DEFAULT_THEME_PREFERENCE: ThemePreference = "dark";

/** 默认生效主题。 */
const DEFAULT_RESOLVED_THEME: ResolvedTheme = "dark";

/**
 * 全局主题状态。
 * <p>
 * 单一主题源负责偏好持久化、系统主题同步与根节点主题属性写入。
 */
export const useThemeStore = create<ThemeStore>()((set, get) => ({
    hydrated: false,
    preference: DEFAULT_THEME_PREFERENCE,
    resolvedTheme: DEFAULT_RESOLVED_THEME,
    hydrateTheme: (initialPreference) => {
        const preference = readStoredThemePreference() ?? initialPreference;
        const resolvedTheme = resolveThemePreference(preference, readSystemResolvedTheme() === "dark");

        persistThemePreference(preference);
        applyResolvedThemeToDocument(resolvedTheme, preference);
        set({
            hydrated: true,
            preference,
            resolvedTheme,
        });
    },
    setThemePreference: (preference) => {
        const resolvedTheme = resolveThemePreference(preference, readSystemResolvedTheme() === "dark");
        persistThemePreference(preference);
        applyResolvedThemeToDocument(resolvedTheme, preference);
        set({ preference, resolvedTheme, hydrated: true });
    },
    syncSystemTheme: (systemPrefersDark) => {
        const { preference, hydrated } = get();
        if (!hydrated || preference !== "system") return;

        const resolvedTheme = resolveThemePreference("system", systemPrefersDark ?? readSystemResolvedTheme() === "dark");
        applyResolvedThemeToDocument(resolvedTheme, preference);
        set({ resolvedTheme });
    },
}));
