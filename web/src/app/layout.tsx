import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import { AppProviders } from "@/features/app-shell/components/app-providers";
import { PWA_BASE_PATH } from "@/features/pwa/pwa-constants";
import { PWA_THEME_COLORS } from "@/features/pwa/pwa-theme-colors";
import { ThemeScript } from "@/features/theme/components/theme-script";
import { getInitialResolvedTheme, isDarkResolvedTheme, readThemePreferenceFromCookieStore } from "@/shared/lib/theme-preference";
import "antd/dist/reset.css";
import "./globals.css";
import React from "react";
import { getWebsiteLocale } from "@/features/locale/server";
import { languageTag } from "@/features/locale/locale";
import { websiteMessages } from "@/features/locale/messages";
import { resolveSpaceBrand } from "@/features/team/space-brand";

export async function generateMetadata(): Promise<Metadata> {
    const locale = await getWebsiteLocale();
    const platformBrand = resolveSpaceBrand(null);
    const editionsPage = (await headers()).get("x-novanova-pathname") === "/editions";
    return {
        title: editionsPage ? websiteMessages[locale].editions.compareEditionsNovanovaStudio : platformBrand.name,
        description: editionsPage ? websiteMessages[locale].editions.compareEnterpriseFeaturesAcrossNovanovaStudioEditions : websiteMessages[locale].website.description,
        // PWA：仅生产构建注入 manifest（产物由 pnpm build 末尾的 generate-pwa.mjs 生成）
        ...(process.env.NODE_ENV === "production" ? { manifest: `${PWA_BASE_PATH}manifest.webmanifest` } : {}),
        applicationName: platformBrand.name,
        icons: {
            icon: platformBrand.iconUrl,
            shortcut: platformBrand.iconUrl,
            apple: platformBrand.iconUrl,
        },
    };
}

/** PWA meta theme-color（与 globals.css 的 --studio-bg 一致，generate-pwa.mjs 构建期校验） */
export const viewport: Viewport = {
    themeColor: [
        { media: "(prefers-color-scheme: light)", color: PWA_THEME_COLORS.light },
        { media: "(prefers-color-scheme: dark)", color: PWA_THEME_COLORS.dark },
    ],
};

export default async function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    const cookieStore = await cookies();
    const initialLocale = await getWebsiteLocale();
    const initialThemePreference = readThemePreferenceFromCookieStore(cookieStore) ?? "dark";
    const initialResolvedTheme = getInitialResolvedTheme(initialThemePreference);

    return (
        <html lang={languageTag(initialLocale)} data-language={initialLocale} suppressHydrationWarning className="font-sans" data-theme={initialResolvedTheme} data-theme-preference={initialThemePreference} style={{ colorScheme: isDarkResolvedTheme(initialResolvedTheme) ? "dark" : "light" }}>
            <body
                className="bg-background text-foreground antialiased"
                style={{
                    fontFamily: '"SF Pro Display","SF Pro Text","PingFang SC","Microsoft YaHei","Helvetica Neue",sans-serif',
                }}
            >
                <ThemeScript preference={initialThemePreference} />
                <AntdRegistry>
                    <AppProviders initialLocale={initialLocale} initialThemePreference={initialThemePreference} initialResolvedTheme={initialResolvedTheme}>
                        {children}
                    </AppProviders>
                </AntdRegistry>
            </body>
        </html>
    );
}
