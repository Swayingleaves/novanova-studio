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
        /** 创建时间 */
        private OffsetDateTime createdAt;
        /** 更新时间 */
        private OffsetDateTime updatedAt;
    }
}
