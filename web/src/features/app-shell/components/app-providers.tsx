"use client";

import type { ReactNode } from "react";
import { useEffect, useLayoutEffect } from "react";
import { ProConfigProvider } from "@ant-design/pro-components";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";

import { ClientRootInit } from "@/features/app-shell/components/client-root-init";
import { getAntThemeConfig } from "@/shared/lib/app-theme";
import { useThemeStore } from "@/features/theme/stores/use-theme-store";
import type { ResolvedTheme, ThemePreference } from "@/shared/lib/theme-preference";

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 30_000,
            retry: false,
            refetchOnWindowFocus: false,
        },
    },
});

export function AppProviders({
    children,
    initialThemePreference,
    initialResolvedTheme,
}: {
    children: ReactNode;
    initialThemePreference: ThemePreference;
    initialResolvedTheme: ResolvedTheme;
}) {
    const hydrated = useThemeStore((state) => state.hydrated);
    const preference = useThemeStore((state) => state.preference);
    const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
    const hydrateTheme = useThemeStore((state) => state.hydrateTheme);
    const syncSystemTheme = useThemeStore((state) => state.syncSystemTheme);
    const effectiveResolvedTheme = hydrated ? resolvedTheme : initialResolvedTheme;

    useLayoutEffect(() => {
        hydrateTheme(initialThemePreference);
    }, [hydrateTheme, initialThemePreference]);

    useEffect(() => {
        if (typeof window.matchMedia !== "function") return;

        const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
        const handleChange = (event: MediaQueryListEvent) => {
            syncSystemTheme(event.matches);
        };

        syncSystemTheme(mediaQuery.matches);
        mediaQuery.addEventListener("change", handleChange);
        return () => {
            mediaQuery.removeEventListener("change", handleChange);
        };
    }, [preference, syncSystemTheme]);

    return (
        <ConfigProvider locale={zhCN} theme={getAntThemeConfig(effectiveResolvedTheme)}>
            <ProConfigProvider dark={effectiveResolvedTheme === "dark"}>
                <App>
                    <QueryClientProvider client={queryClient}>
                        <ClientRootInit>{children}</ClientRootInit>
                    </QueryClientProvider>
                </App>
            </ProConfigProvider>
        </ConfigProvider>
    );
}
