import type { NavigationMenuConfig, NavigationMenuConfigInput } from "@/services/api/navigation-menu";
import { navigationTools, type NavigationTool } from "@/shared/constants/navigation-tools";
import { resolveNavigationMenuIcon } from "./navigation-menu-icons";

/** 可由后台配置显示与顺序的普通菜单项清单（保持默认顺序）。 */
export const configurableNavigationTools: readonly NavigationTool[] = navigationTools.filter((tool) => !tool.adminOnly);

/** 仅管理员可见且固定展示在底部的系统管理菜单项。 */
export const adminOnlyNavigationTools: readonly NavigationTool[] = navigationTools.filter((tool) => Boolean(tool.adminOnly));

const configurableToolMap = new Map<string, NavigationTool>(
    configurableNavigationTools.map((tool) => [tool.slug, tool]),
);

/** 已合并后台外观定制配置的可渲染导航菜单项。 */
export type ResolvedNavigationTool = NavigationTool & {
    /** 自定义显示名称，为空时由视图层回退 translate(labelKey)。 */
    displayName?: string | null;
    /** 自定义图标标识。 */
    iconKey?: string | null;
    /** 右上角角标文案，为空时不展示。 */
    badgeText?: string | null;
    /** 右上角角标颜色（十六进制），为空时沿用系统默认角标色。 */
    badgeColor?: string | null;
};

function normalizeOptionalText(value: string | null | undefined): string | null {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
}

/** 生成默认全部开启且按内置顺序排列的菜单草稿（保留内置默认 NEW 角标）。 */
export function defaultNavigationMenuDrafts(): NavigationMenuConfigInput[] {
    return configurableNavigationTools.map((tool) => ({
        menuKey: tool.slug,
        enabled: true,
        displayName: null,
        iconKey: null,
        badgeText: tool.isNew ? "NEW" : null,
        badgeColor: null,
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
        const tool = configurableToolMap.get(item.menuKey)!;
        // 兼容未返回 badgeText 字段的历史配置：仅在字段显式缺省（undefined）时沿用内置 isNew，传 null/空串表示关闭角标。
        const badgeText = item.badgeText === undefined ? (tool.isNew ? "NEW" : null) : normalizeOptionalText(item.badgeText);
        merged.push({
            menuKey: item.menuKey,
            enabled: Boolean(item.enabled),
            displayName: normalizeOptionalText(item.displayName),
            iconKey: normalizeOptionalText(item.iconKey),
            badgeText,
            badgeColor: normalizeOptionalText(item.badgeColor),
        });
    }

    for (const tool of configurableNavigationTools) {
        if (seenKeys.has(tool.slug)) continue;
        seenKeys.add(tool.slug);
        merged.push({
            menuKey: tool.slug,
            enabled: true,
            displayName: null,
            iconKey: null,
            badgeText: tool.isNew ? "NEW" : null,
            badgeColor: null,
        });
    }

    return merged;
}

/** 计算配置草稿签名，用于比较顺序、开关状态或外观自定义是否发生变化。 */
export function navigationMenuDraftSignature(items: readonly NavigationMenuConfigInput[]): string {
    return JSON.stringify(
        items.map((item) => [
            item.menuKey,
            Boolean(item.enabled),
            normalizeOptionalText(item.displayName),
            normalizeOptionalText(item.iconKey),
            normalizeOptionalText(item.badgeText),
            normalizeOptionalText(item.badgeColor)?.toLowerCase() ?? null,
        ]),
    );
}

/** 根据服务端配置与管理员身份解析最终可见的左侧菜单列表，系统管理项始终固定在管理员视图末尾。 */
export function resolveVisibleNavigationTools(
    configs: readonly NavigationMenuConfig[],
    includeAdmin: boolean,
): ResolvedNavigationTool[] {
    const resolved: ResolvedNavigationTool[] = [];
    for (const item of mergeNavigationMenuConfigs(configs)) {
        if (!item.enabled) continue;
        const tool = configurableToolMap.get(item.menuKey);
        if (!tool) continue;
        resolved.push({
            ...tool,
            icon: resolveNavigationMenuIcon(item.iconKey, tool.icon),
            displayName: normalizeOptionalText(item.displayName),
            iconKey: normalizeOptionalText(item.iconKey),
            badgeText: normalizeOptionalText(item.badgeText),
            badgeColor: normalizeOptionalText(item.badgeColor),
        });
    }

    if (!includeAdmin) return resolved;
    return [
        ...resolved,
        ...adminOnlyNavigationTools.map((tool) => ({
            ...tool,
            displayName: null,
            iconKey: null,
            badgeText: tool.isNew ? "NEW" : null,
            badgeColor: null,
        })),
    ];
}
