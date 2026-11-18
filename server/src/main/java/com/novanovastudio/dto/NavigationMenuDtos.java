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
     */
    public record NavigationMenuConfig(String menuKey, boolean enabled, int sortOrder) {
    }

    /**
     * 保存请求中的单个导航菜单配置。
     *
     * @param menuKey 导航菜单唯一标识
     * @param enabled 是否显示
     */
    public record NavigationMenuConfigInput(String menuKey, Boolean enabled) {
    }

    /**
     * 整份导航菜单配置保存请求，提交顺序决定展示顺序。
     *
     * @param configs 全量可配置菜单项列表
     */
    public record SaveNavigationMenuConfigsRequest(List<NavigationMenuConfigInput> configs) {
    }
}
