import type { ThemeConfig } from "antd";
import { theme as antdTheme } from "antd";

import type { ResolvedTheme } from "@/shared/lib/theme-preference";

const CSS_VAR_KEY_LIGHT = "novanova-studio-light";
const CSS_VAR_KEY_DARK = "novanova-studio-dark";

/** Logo 品牌色 */
const BRAND = {
    light: { primary: "#526f1e", hover: "#648625", active: "#405718", foreground: "#ffffff", soft: "rgba(82,111,30,0.10)", border: "rgba(82,111,30,0.22)" },
    dark: { primary: "#c7f36b", hover: "#d6ff82", active: "#afda54", foreground: "#11170a", soft: "rgba(199,243,107,0.14)", border: "rgba(199,243,107,0.28)" },
};

interface Palette {
    bg: string;
    bgElevated: string;
    border: string;
    borderLight: string;
    text: string;
    textSecondary: string;
    textMuted: string;
    fill: string;
    fillSecondary: string;
    tableSelected: string;
    tableSelectedHover: string;
    tagDefaultBg: string;
    tagDefaultBorder: string;
    tagDefaultText: string;
}

const lightPalette: Palette = {
    bg: "rgba(255,255,255,0.86)",
    bgElevated: "#ffffff",
    border: "#c7cec4",
    borderLight: "#dce1da",
    text: "#171a17",
    textSecondary: "#394037",
    textMuted: "#596157",
    fill: "rgba(82,111,30,0.08)",
    fillSecondary: "#ecefe9",
    tableSelected: "rgba(82,111,30,0.10)",
    tableSelectedHover: "rgba(82,111,30,0.16)",
    tagDefaultBg: "#f4f5f2",
    tagDefaultBorder: "#dce1da",
    tagDefaultText: "#394037",
};

const darkPalette: Palette = {
    bg: "#0c0e0d",
    bgElevated: "#121512",
    border: "#363c36",
    borderLight: "#242824",
    text: "#f3f6f0",
    textSecondary: "#c2c9c0",
    textMuted: "#858d84",
    fill: "rgba(199,243,107,0.14)",
    fillSecondary: "#121512",
    tableSelected: "rgba(199,243,107,0.14)",
    tableSelectedHover: "rgba(199,243,107,0.20)",
    tagDefaultBg: "#121512",
    tagDefaultBorder: "#363c36",
    tagDefaultText: "#c2c9c0",
};

/**
 * 生成 Ant Design 主题配置。
 *
 * @param resolvedTheme ResolvedTheme 当前生效主题
 * @return antd ThemeConfig
 */
export function getAntThemeConfig(resolvedTheme: ResolvedTheme): ThemeConfig {
    const isDark = resolvedTheme === "dark";
    const p = isDark ? darkPalette : lightPalette;
    const brand = isDark ? BRAND.dark : BRAND.light;
    const modalBackground = isDark ? "#0c0e0d" : "#ffffff";

    return {
        algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        cssVar: { key: isDark ? CSS_VAR_KEY_DARK : CSS_VAR_KEY_LIGHT },
        token: {
            colorPrimary: brand.primary,
            colorInfo: isDark ? "#75b7f5" : "#28679b",
            colorSuccess: isDark ? "#5ed69b" : "#1f7a4d",
            colorWarning: isDark ? "#f3c969" : "#8a5c00",
            colorError: isDark ? "#ff7c7c" : "#b42318",
            colorLink: brand.primary,
            colorLinkHover: brand.hover,
            colorLinkActive: brand.active,
            colorTextLightSolid: "#ffffff",
            colorBgLayout: isDark ? "#050606" : "#f4f5f2",
            colorBgContainer: p.bg,
            colorBgElevated: p.bgElevated,
            colorBorder: p.border,
            colorBorderSecondary: p.borderLight,
            colorText: p.text,
            colorTextSecondary: p.textSecondary,
            colorTextTertiary: p.textMuted,
            colorFillQuaternary: p.fill,
            colorFillTertiary: p.fillSecondary,
            colorSplit: p.borderLight,
            borderRadius: 8,
            boxShadow: isDark ? "0 16px 36px rgba(2,6,23,0.36)" : "0 8px 24px rgba(30,41,59,0.06)",
        },
        components: {
            Button: {
                primaryShadow: "none",
                primaryColor: brand.foreground,
                defaultBg: p.bg,
                defaultBorderColor: p.border,
                defaultColor: p.textSecondary,
                defaultHoverBg: isDark ? "rgba(17,24,39,0.96)" : "rgba(255,255,255,0.92)",
                defaultHoverColor: p.text,
                defaultHoverBorderColor: brand.border,
                borderRadius: 8,
                controlHeight: 34,
            },
            Input: {
                activeBorderColor: brand.primary,
                activeShadow: `0 0 0 2px ${brand.soft}`,
                hoverBorderColor: p.border,
                borderRadius: 8,
                colorBgContainer: p.bg,
            },
            Modal: {
                contentBg: modalBackground,
                headerBg: modalBackground,
                footerBg: modalBackground,
                borderRadiusLG: 12,
            },
            Table: {
                rowSelectedBg: p.tableSelected,
                rowSelectedHoverBg: p.tableSelectedHover,
                headerBg: p.fillSecondary,
                headerColor: p.textMuted,
                borderColor: p.borderLight,
            },
            Tag: {
                defaultBg: p.tagDefaultBg,
                defaultColor: p.tagDefaultText,
            },
            Select: {
                optionActiveBg: p.fillSecondary,
                optionSelectedBg: brand.soft,
                optionSelectedColor: brand.primary,
            },
            Menu: {
                itemActiveBg: brand.soft,
                itemHoverBg: p.fill,
                itemSelectedBg: brand.soft,
                itemSelectedColor: p.text,
                darkItemBg: p.bg,
                darkItemHoverBg: brand.soft,
                darkItemSelectedBg: brand.soft,
                darkItemSelectedColor: p.text,
            },
        },
    };
}
