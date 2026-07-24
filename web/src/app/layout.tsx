import type { Metadata } from "next";
import Script from "next/script";
import { cookies } from "next/headers";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import { AppProviders } from "@/features/app-shell/components/app-providers";
import { buildThemeBootstrapScript, getInitialResolvedTheme, readThemePreferenceFromCookieStore } from "@/shared/lib/theme-preference";
import "antd/dist/reset.css";
import "./globals.css";
import React from "react";

export const metadata: Metadata = {
    title: "Novanova Studio",
    description: "Novanova Studio 是面向 AI 视觉创作的一站式工作台，集图片生成、视频创作、智能 Agent、无限画布与资产管理于一体，帮助创作者高效完成从灵感构思到作品交付。",
    icons: {
        icon: "/novanovastudio.png",
        shortcut: "/novanovastudio.png",
        apple: "/novanovastudio.png",
    },
};

export default async function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    const cookieStore = await cookies();
    const initialThemePreference = readThemePreferenceFromCookieStore(cookieStore) ?? "dark";
    const initialResolvedTheme = getInitialResolvedTheme(initialThemePreference);

    return (
        <html lang="zh-CN" suppressHydrationWarning className="font-sans" data-theme={initialResolvedTheme} data-theme-preference={initialThemePreference} style={{ colorScheme: initialResolvedTheme }}>
            <body
                className="bg-background text-foreground antialiased"
                style={{
                    fontFamily: '"SF Pro Display","SF Pro Text","PingFang SC","Microsoft YaHei","Helvetica Neue",sans-serif',
                }}
            >
                <Script id="theme-script" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: buildThemeBootstrapScript(initialThemePreference) }} />
                <AntdRegistry>
                    <AppProviders initialThemePreference={initialThemePreference} initialResolvedTheme={initialResolvedTheme}>
                        {children}
                    </AppProviders>
                </AntdRegistry>
            </body>
        </html>
    );
}
