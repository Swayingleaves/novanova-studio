package com.novanovastudio.entity;

import java.time.OffsetDateTime;
import lombok.Data;

/**
 * 平台全局社群配置持久化记录。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-29 15:30
 */
public final class PlatformCommunityConfigRecords {

    private PlatformCommunityConfigRecords() {
    }

    /** 社群配置记录 */
    @Data
    public static class CommunityConfigRecord {
        /** 配置主键 */
        private Long id;
        /** 社群名称 */
        private String name;
        /** 二维码图片地址 */
        private String imageUrl;
        /** 展示排序值 */
        private Integer sortOrder;
        /** 创建时间 */
        private OffsetDateTime createdAt;
        /** 更新时间 */
        private OffsetDateTime updatedAt;
    }
}
