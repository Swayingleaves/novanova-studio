import { translateMessage } from "@/features/locale/translate";
import type { StoryboardFontFamily } from "../types";

/** 文字轨道可选字体，英文字体在缺字时使用 Noto Sans SC 补字。 */
export const getStoryboardFonts = (translate = translateMessage): Record<StoryboardFontFamily, { label: string; cssFamily: string }> => ({
    notoSansSc: { label: translate("comicDrama.chineseNotoSansSc"), cssFamily: '"Storyboard Noto Sans SC"' },
    notoSerifSc: { label: translate("comicDrama.chineseNotoSerifSc"), cssFamily: '"Storyboard Noto Serif SC"' },
    lxgwWenKai: { label: translate("comicDrama.chineseLxgwWenkai"), cssFamily: '"Storyboard LXGW WenKai"' },
    inter: { label: translate("comicDrama.englishInter"), cssFamily: '"Storyboard Inter", "Storyboard Noto Sans SC"' },
    montserrat: { label: translate("comicDrama.englishMontserrat"), cssFamily: '"Storyboard Montserrat", "Storyboard Noto Sans SC"' },
    lora: { label: translate("comicDrama.englishLora"), cssFamily: '"Storyboard Lora", "Storyboard Noto Sans SC"' },
    caveat: { label: translate("comicDrama.englishCaveat"), cssFamily: '"Storyboard Caveat", "Storyboard Noto Sans SC"' },
});

/** 字体选项在读取时生成，切换语言不改变字体标识和实际字体资源。 */
export const getStoryboardFontOptions = (translate = translateMessage) => Object.entries(getStoryboardFonts(translate))
    .map(([value, font]) => ({ value: value as StoryboardFontFamily, label: font.label }));
