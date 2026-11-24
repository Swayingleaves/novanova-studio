package com.novanovastudio.entity;

import java.time.OffsetDateTime;
import lombok.Data;

/**
 * 平台全局左侧导航菜单配置持久化记录。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-18 10:55:00
 */
public final class PlatformNavigationMenuConfigRecords {

    private PlatformNavigationMenuConfigRecords() {
    }

    /** 导航菜单配置记录 */
    @Data
    public static class NavigationMenuConfigRecord {
        /** 导航菜单唯一标识 */
        private String menuKey;
        /** 是否启用展示 */
        private Boolean enabled;
        /** 展示排序值 */
        private Integer sortOrder;
        /** 自定义菜单显示名称，为空时沿用默认名称 */
        private String displayName;
        /** 自定义菜单图标标识，为空时沿用默认图标 */
        private String iconKey;
        /** 右上角角标文案，为空时不显示角标 */
        private String badgeText;
        /** 右上角角标文字颜色，为空时沿用系统默认角标色 */
        private String badgeColor;
        /** 创建时间 */
        private OffsetDateTime createdAt;
        /** 更新时间 */
        private OffsetDateTime updatedAt;
    }
}
