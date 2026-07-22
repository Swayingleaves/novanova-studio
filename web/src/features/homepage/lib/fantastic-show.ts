import type { HomepageShowcase } from "@/services/api/server";

export const FANTASTIC_SHOW_CATEGORIES = ["全部", "视觉海报", "概念短片", "商业广告", "游戏美术", "时尚影像", "产品视觉", "生活方式"] as const;

export type FantasticShowCategory = (typeof FANTASTIC_SHOW_CATEGORIES)[number];

/**
 * 返回首页顶部精选之外的精彩创作内容。
 *
 * @param items HomepageShowcase[] 已排序的首页展示内容
 * @return HomepageShowcase[] 用于精彩创作网格的内容
 */
export function getFantasticShowcases(items: HomepageShowcase[]) {
    return items.slice(3);
}

/**
 * 按分类与关键词筛选精彩创作内容。
 *
 * @param items HomepageShowcase[] 可筛选的作品列表
 * @param category FantasticShowCategory 当前分类
 * @param keyword string 用户输入的关键词
 * @return HomepageShowcase[] 符合筛选条件的作品列表
 */
export function filterFantasticShowcases(items: HomepageShowcase[], category: FantasticShowCategory, keyword: string) {
    const normalizedKeyword = keyword.trim().toLocaleLowerCase();
    return items.filter((item) => {
        if (category !== "全部" && item.category !== category) return false;
        if (!normalizedKeyword) return true;
        return [item.title, item.description, item.category, item.creatorName].some((value) => value.toLocaleLowerCase().includes(normalizedKeyword));
    });
}

/**
 * 生成创作者名称的简洁首字母标识。
 *
 * @param creatorName string 创作者名称
 * @return string 用于头像显示的首字母或首个字符
 */
export function creatorMonogram(creatorName: string) {
    const trimmedName = creatorName.trim();
    if (!trimmedName) return "N";
    const words = trimmedName.split(/\s+/).filter(Boolean);
    if (words.length > 1)
        return words
            .slice(0, 2)
            .map((word) => word[0])
            .join("")
            .toUpperCase();
    return Array.from(trimmedName).slice(0, 2).join("").toUpperCase();
}
