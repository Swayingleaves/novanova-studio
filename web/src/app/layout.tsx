import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import { AppProviders } from "@/features/app-shell/components/app-providers";
import { ThemeScript } from "@/features/theme/components/theme-script";
import { getInitialResolvedTheme, isDarkResolvedTheme, readThemePreferenceFromCookieStore } from "@/shared/lib/theme-preference";
import "antd/dist/reset.css";
import "./globals.css";
import React from "react";
import { getWebsiteLocale } from "@/features/locale/server";
import { languageTag } from "@/features/locale/locale";
import { websiteMessages } from "@/features/locale/messages";

export async function generateMetadata(): Promise<Metadata> {
    const locale = await getWebsiteLocale();
    const editionsPage = (await headers()).get("x-novanova-pathname") === "/editions";
    return {
        title: editionsPage ? websiteMessages[locale].editions.compareEditionsNovanovaStudio : "Novanova Studio",
        description: editionsPage ? websiteMessages[locale].editions.compareEnterpriseFeaturesAcrossNovanovaStudioEditions : websiteMessages[locale].website.description,
        icons: {
            icon: "/novanovastudio.png",
            shortcut: "/novanovastudio.png",
            apple: "/novanovastudio.png",
        },
    };
}

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
