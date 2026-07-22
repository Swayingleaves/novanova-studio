/** 画布主题色板明暗标识。 */
export type CanvasColorTheme = "light" | "dark";

/** 画布背景渲染模式。 */
export type CanvasBackgroundMode = "dots" | "blank";

/** 画布背景相关色值。 */
interface CanvasBgColors {
    background: string;
    /** 画布主背景，与工作台页面背景保持一致。 */
    backgroundGradient: string;
    dot: string;
    selectionStroke: string;
    selectionFill: string;
}

/** 画布节点相关色值。 */
interface CanvasNodeColors {
    label: string;
    fill: string;
    panel: string;
    stroke: string;
    activeStroke: string;
    placeholder: string;
    text: string;
    muted: string;
    faint: string;
}

/** 画布工具栏相关色值。 */
interface CanvasToolbarColors {
    panel: string;
    border: string;
    item: string;
    itemHover: string;
    activeBg: string;
    activeText: string;
    activeGradient: string;
    activeGradientText: string;
}

/** 单个主题色板。 */
interface CanvasColorPalette {
    canvas: CanvasBgColors;
    node: CanvasNodeColors;
    toolbar: CanvasToolbarColors;
}

/**
 * 画布主题色板表。
 * <p>
 * 画布主题色板与工作台深浅主题保持相同的页面背景和操作色。
 * 色值为字符串字面量并 `as const`，便于类型推导。
 */
export const canvasThemes = {
    light: {
        canvas: {
            background: "#f4f5f2",
            backgroundGradient: "#f4f5f2",
            dot: "rgba(82,111,30,.38)",
            selectionStroke: "#526f1e",
            selectionFill: "rgba(82,111,30,.10)",
        },
        node: {
            label: "#596157",
            fill: "#ffffff",
            panel: "#ffffff",
            stroke: "#c7cec4",
            activeStroke: "#526f1e",
            placeholder: "#687066",
            text: "#171a17",
            muted: "#596157",
            faint: "#687066",
        },
        toolbar: {
            panel: "rgba(255,255,255,.94)",
            border: "#dce1da",
            item: "#596157",
            itemHover: "#e5e9e2",
            activeBg: "rgba(82,111,30,.12)",
            activeText: "#405718",
            activeGradient: "#526f1e",
            activeGradientText: "#ffffff",
        },
    },
    dark: {
        canvas: {
            background: "#050606",
            backgroundGradient: "#050606",
            dot: "rgba(199,243,107,.26)",
            selectionStroke: "#c7f36b",
            selectionFill: "rgba(199,243,107,.12)",
        },
        node: {
            label: "#c2c9c0",
            fill: "#0c0e0d",
            panel: "#0c0e0d",
            stroke: "#363c36",
            activeStroke: "#c7f36b",
            placeholder: "#858d84",
            text: "#f3f6f0",
            muted: "#c2c9c0",
            faint: "#727a71",
        },
        toolbar: {
            panel: "rgba(12,14,13,.94)",
            border: "#242824",
            item: "#c2c9c0",
            itemHover: "#181c18",
            activeBg: "rgba(199,243,107,.16)",
            activeText: "#f3f6f0",
            activeGradient: "#c7f36b",
            activeGradientText: "#11170a",
        },
    },
} as const satisfies Record<CanvasColorTheme, CanvasColorPalette>;

/** 单个主题色板类型。 */
export type CanvasTheme = (typeof canvasThemes)[CanvasColorTheme];
