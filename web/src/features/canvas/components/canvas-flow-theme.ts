import type { CSSProperties } from "react";

import type { CanvasTheme } from "@/shared/lib/canvas-theme";

type CanvasControlStyleVars = CSSProperties & {
    "--xy-controls-box-shadow": string;
    "--xy-controls-button-background-color": string;
    "--xy-controls-button-background-color-hover-props": string;
    "--xy-controls-button-border-color-props": string;
    "--xy-controls-button-color-props": string;
    "--xy-controls-button-color-hover-props": string;
};

/**
 * 生成画布控制区样式变量。
 *
 * @param theme CanvasTheme 当前画布主题
 * @return CanvasControlStyleVars 控制区及按钮主题变量
 */
export function getCanvasControlStyleVars(theme: CanvasTheme): CanvasControlStyleVars {
    return {
        background: theme.toolbar.panel,
        borderColor: theme.toolbar.border,
        color: theme.node.text,
        "--xy-controls-box-shadow": "var(--studio-shadow)",
        "--xy-controls-button-background-color": theme.toolbar.panel,
        "--xy-controls-button-background-color-hover-props": theme.toolbar.itemHover,
        "--xy-controls-button-border-color-props": theme.toolbar.border,
        "--xy-controls-button-color-props": theme.toolbar.item,
        "--xy-controls-button-color-hover-props": theme.node.text,
    };
}
