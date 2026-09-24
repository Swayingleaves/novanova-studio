import type { StoryboardFontFamily } from "../types";

/** 文字轨道可选字体，英文字体在缺字时使用 Noto Sans SC 补字。 */
export const STORYBOARD_FONTS: Record<StoryboardFontFamily, { label: string; cssFamily: string }> = {
    notoSansSc: { label: "中文 · Noto Sans SC 黑体", cssFamily: '"Storyboard Noto Sans SC"' },
    notoSerifSc: { label: "中文 · Noto Serif SC 宋体", cssFamily: '"Storyboard Noto Serif SC"' },
    lxgwWenKai: { label: "中文 · 霞鹜文楷", cssFamily: '"Storyboard LXGW WenKai"' },
    inter: { label: "英文 · Inter", cssFamily: '"Storyboard Inter", "Storyboard Noto Sans SC"' },
    montserrat: { label: "英文 · Montserrat", cssFamily: '"Storyboard Montserrat", "Storyboard Noto Sans SC"' },
    lora: { label: "英文 · Lora", cssFamily: '"Storyboard Lora", "Storyboard Noto Sans SC"' },
    caveat: { label: "英文 · Caveat", cssFamily: '"Storyboard Caveat", "Storyboard Noto Sans SC"' },
};

export const STORYBOARD_FONT_OPTIONS = (Object.keys(STORYBOARD_FONTS) as StoryboardFontFamily[])
    .map((value) => ({ value, label: STORYBOARD_FONTS[value].label }));
