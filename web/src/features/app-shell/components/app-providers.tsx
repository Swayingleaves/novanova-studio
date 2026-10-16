"use client";

import type { ReactNode } from "react";
import { useEffect, useLayoutEffect } from "react";
import { usePathname } from "next/navigation";
import { ProConfigProvider, enUSIntl, zhCNIntl } from "@ant-design/pro-components";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import enUS from "antd/locale/en_US";
import { NextIntlClientProvider } from "next-intl";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import "dayjs/locale/en";
import { websiteMessages } from "@/features/locale/messages";
import { useLanguageStore } from "@/features/locale/language-store";
import { isWebsiteLocale, languageTag, type WebsiteLocale } from "@/features/locale/locale";

import { ClientRootInit } from "@/features/app-shell/components/client-root-init";
import { getAntThemeConfig } from "@/shared/lib/app-theme";
import { useThemeStore } from "@/features/theme/stores/use-theme-store";
import { isDarkResolvedTheme, type ResolvedTheme, type ThemePreference } from "@/shared/lib/theme-preference";

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
    initialLocale,
    initialThemePreference,
    initialResolvedTheme,
}: {
    children: ReactNode;
    initialLocale: WebsiteLocale;
    initialThemePreference: ThemePreference;
    initialResolvedTheme: ResolvedTheme;
}) {
    const selectedLocale = useLanguageStore((state) => state.locale);
    const pathname = usePathname();
    const documentLocale = pathname.match(/^\/docs\/(zh-cn|en)(?:\/|$)/)?.[1];
    const locale = isWebsiteLocale(documentLocale) ? documentLocale : selectedLocale ?? initialLocale;
    useLayoutEffect(() => {
        document.documentElement.lang = languageTag(locale);
        document.documentElement.dataset.language = locale;
        dayjs.locale(locale);
        const description = document.querySelector('meta[name="description"]');
        if (!pathname.startsWith("/docs")) {
            description?.setAttribute("content", pathname === "/editions"
                ? websiteMessages[locale].editions.compareEnterpriseFeaturesAcrossNovanovaStudioEditions
                : websiteMessages[locale].website.description);
            document.title = pathname === "/editions" ? websiteMessages[locale].editions.compareEditionsNovanovaStudio : "Novanova Studio";
        }
    }, [locale, pathname]);

    useEffect(() => {
        // 根布局会被客户端导航复用，显式文档路径始终同步到当前浏览器偏好。
        if (isWebsiteLocale(documentLocale)) useLanguageStore.getState().setLocale(documentLocale);
    }, [documentLocale]);
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
        <NextIntlClientProvider locale={locale} messages={websiteMessages[locale]}>
            <ConfigProvider locale={locale === "en" ? enUS : zhCN} theme={getAntThemeConfig(effectiveResolvedTheme)}>
                <ProConfigProvider intl={locale === "en" ? enUSIntl : zhCNIntl} dark={isDarkResolvedTheme(effectiveResolvedTheme)}>
                    <App>
                        <QueryClientProvider client={queryClient}>
                            <ClientRootInit>{children}</ClientRootInit>
                        </QueryClientProvider>
                    </App>
                </ProConfigProvider>
            </ConfigProvider>
        </NextIntlClientProvider>
    );
}
