package com.novanovastudio.dto;

import java.util.List;

/**
 * 平台全局左侧导航菜单配置数据传输对象。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-18 10:55:00
 */
public final class NavigationMenuDtos {

    private NavigationMenuDtos() {
    }

    /**
     * 公开导航菜单条目。
     *
     * @param menuKey 导航菜单唯一标识
     * @param enabled 是否显示
     * @param sortOrder 展示排序值
     * @param displayName 自定义显示名称，为空时使用默认名称
     * @param iconKey 自定义图标标识，为空时使用默认图标
     * @param badgeText 右上角角标文案，为空时不展示角标
     * @param badgeColor 右上角角标颜色，为空时使用系统默认角标色
     */
    public record NavigationMenuConfig(
            String menuKey,
            boolean enabled,
            int sortOrder,
            String displayName,
            String iconKey,
            String badgeText,
            String badgeColor) {

        /** 保持旧调用方仅返回开关与排序字段。 */
        public NavigationMenuConfig(String menuKey, boolean enabled, int sortOrder) {
            this(menuKey, enabled, sortOrder, null, null, null, null);
        }
    }

    /**
     * 保存请求中的单个导航菜单配置。
     *
     * @param menuKey 导航菜单唯一标识
     * @param enabled 是否显示
     * @param displayName 自定义显示名称
     * @param iconKey 自定义图标标识
     * @param badgeText 右上角角标文案
     * @param badgeColor 右上角角标颜色
     */
    public record NavigationMenuConfigInput(
            String menuKey,
            Boolean enabled,
            String displayName,
            String iconKey,
            String badgeText,
            String badgeColor) {

        /** 保持旧调用方仅提交开关状态。 */
        public NavigationMenuConfigInput(String menuKey, Boolean enabled) {
            this(menuKey, enabled, null, null, null, null);
        }
    }

    /**
     * 整份导航菜单配置保存请求，提交顺序决定展示顺序。
     *
     * @param configs 全量可配置菜单项列表
     */
    public record SaveNavigationMenuConfigsRequest(List<NavigationMenuConfigInput> configs) {
    }
}
