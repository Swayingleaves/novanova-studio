"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { CanvasTheme } from "@/shared/lib/canvas-theme";

const CanvasThemeContext = createContext<CanvasTheme | null>(null);

/**
 * 画布主题上下文提供者。
 *
 * @param props ReactNode 与当前画布主题
 * @return JSX.Element
 */
export function CanvasThemeProvider({ children, theme }: { children: ReactNode; theme: CanvasTheme }) {
    return <CanvasThemeContext.Provider value={theme}>{children}</CanvasThemeContext.Provider>;
}

/**
 * 读取当前画布主题。
 *
 * @return CanvasTheme 当前画布主题
 */
export function useCanvasTheme(): CanvasTheme {
    const theme = useContext(CanvasThemeContext);
    if (!theme) {
        throw new Error("画布主题上下文缺失，请确认组件已包裹在 CanvasThemeProvider 中。");
    }
    return theme;
}
