/**
 * PWA 主题色（用于 viewport 的 meta theme-color）。
 *
 * 值必须与 globals.css 中 `--studio-bg` 设计 token 保持一致：
 * generate-pwa.mjs 在构建期校验两处一致，漂移时构建报错。
 * manifest 的 background_color / theme_color 由构建脚本直接从 globals.css 读取。
 */
export const PWA_THEME_COLORS = {
    light: "#f4f5f2",
    dark: "#050606",
} as const;
