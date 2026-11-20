import type { NavigationMenuConfig, NavigationMenuConfigInput } from "@/services/api/navigation-menu";
import { navigationTools, type NavigationTool } from "@/shared/constants/navigation-tools";

/** 可由后台配置显示与顺序的普通菜单项清单（保持默认顺序）。 */
export const configurableNavigationTools: readonly NavigationTool[] = navigationTools.filter((tool) => !tool.adminOnly);

/** 仅管理员可见且固定展示在底部的系统管理菜单项。 */
export const adminOnlyNavigationTools: readonly NavigationTool[] = navigationTools.filter((tool) => Boolean(tool.adminOnly));

const configurableToolMap = new Map<string, NavigationTool>(
    configurableNavigationTools.map((tool) => [tool.slug, tool]),
);

/** 生成默认全部开启且按内置顺序排列的菜单草稿。 */
export function defaultNavigationMenuDrafts(): NavigationMenuConfigInput[] {
    return configurableNavigationTools.map((tool) => ({
        menuKey: tool.slug,
        enabled: true,
    }));
}

/** 将服务端配置按 sortOrder 合并默认菜单清单，缺失的内置菜单按默认顺序以开启状态追加在末尾。 */
export function mergeNavigationMenuConfigs(configs: readonly NavigationMenuConfig[]): NavigationMenuConfigInput[] {
    const ordered = [...configs].sort((first, second) => first.sortOrder - second.sortOrder);
    const merged: NavigationMenuConfigInput[] = [];
    const seenKeys = new Set<string>();

    for (const item of ordered) {
        if (!configurableToolMap.has(item.menuKey) || seenKeys.has(item.menuKey)) continue;
        seenKeys.add(item.menuKey);
        merged.push({
            menuKey: item.menuKey,
            enabled: Boolean(item.enabled),
        });
    }

    for (const tool of configurableNavigationTools) {
        if (seenKeys.has(tool.slug)) continue;
        seenKeys.add(tool.slug);
        merged.push({
            menuKey: tool.slug,
            enabled: true,
        });
    }

    return merged;
}

/** 计算配置草稿签名，用于比较顺序或开关状态是否发生变化。 */
export function navigationMenuDraftSignature(items: readonly NavigationMenuConfigInput[]): string {
    return JSON.stringify(items.map((item) => [item.menuKey, Boolean(item.enabled)]));
}

/** 根据服务端配置与管理员身份解析最终可见的左侧菜单列表，系统管理项始终固定在管理员视图末尾。 */
export function resolveVisibleNavigationTools(
    configs: readonly NavigationMenuConfig[],
    includeAdmin: boolean,
): NavigationTool[] {
    const resolved = mergeNavigationMenuConfigs(configs)
        .filter((item) => item.enabled)
        .map((item) => configurableToolMap.get(item.menuKey))
        .filter((tool): tool is NavigationTool => Boolean(tool));

    return includeAdmin ? [...resolved, ...adminOnlyNavigationTools] : resolved;
}
