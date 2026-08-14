import type { GenerationStyleOption } from "@/services/api/server";

/** 当前生成请求最多选择的风格数量。 */
export const MAX_GENERATION_STYLE_SELECTION_COUNT = 1;

/** 当前生成请求超过风格选择上限时的统一提示。 */
export const GENERATION_STYLE_SELECTION_LIMIT_MESSAGE = `最多选择${MAX_GENERATION_STYLE_SELECTION_COUNT}个风格`;

/** 风格库中的全部分类标识。 */
export const ALL_GENERATION_STYLE_CATEGORY = "__all__";

/** 统一风格库筛选所需的最小字段。 */
export type GenerationStyleLibraryItem = Pick<GenerationStyleOption, "id" | "name" | "generationType" | "coverUrl" | "category">;

/** 从已排序且具备封面的风格中提取非空分类，并保持首次出现顺序。 */
export function collectGenerationStyleCategories(styles: GenerationStyleLibraryItem[]) {
    const categories = new Map<string, string>();
    styles.forEach((style) => {
        if (!style.coverUrl?.trim()) return;
        const category = style.category?.trim() || "";
        const categoryKey = category.toLocaleLowerCase();
        if (category && !categories.has(categoryKey)) categories.set(categoryKey, category);
    });
    return [...categories.values()];
}

/** 按关键词和分类筛选风格；没有封面的旧记录仅显示在全部分类。 */
export function filterGenerationStyles(styles: GenerationStyleLibraryItem[], query = "", category = ALL_GENERATION_STYLE_CATEGORY) {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const normalizedCategory = category.toLocaleLowerCase();
    return styles.filter((style) => {
        const styleCategory = style.category?.trim() || "";
        const matchesCategory = category === ALL_GENERATION_STYLE_CATEGORY || styleCategory.toLocaleLowerCase() === normalizedCategory;
        if (!matchesCategory) return false;
        if (category !== ALL_GENERATION_STYLE_CATEGORY && !style.coverUrl?.trim()) return false;
        if (!normalizedQuery) return true;
        return style.name.toLocaleLowerCase().includes(normalizedQuery) || styleCategory.toLocaleLowerCase().includes(normalizedQuery);
    });
}

/** 判断风格是否使用统一中性默认封面。 */
export function usesGenerationStyleDefaultCover(style: Pick<GenerationStyleLibraryItem, "coverUrl">) {
    return !style.coverUrl?.trim();
}

/** 判断风格是否已被当前生成请求选择。 */
export function isGenerationStyleSelected(styleId: number, selectedStyles: Array<Pick<GenerationStyleLibraryItem, "id">>) {
    return selectedStyles.some((style) => style.id === styleId);
}

/** 返回键盘高亮项，列表为空时返回undefined。 */
export function generationStyleAt(styles: GenerationStyleLibraryItem[], index: number) {
    return styles[Math.max(0, Math.min(index, styles.length - 1))];
}
