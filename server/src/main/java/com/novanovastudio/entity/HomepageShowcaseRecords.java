package com.novanovastudio.entity;

import java.time.OffsetDateTime;
import lombok.Data;

/**
 * 首页精选展示内容持久化记录。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-07-18 12:00:00
 */
public final class HomepageShowcaseRecords {

    /** 停用状态 */
    public static final int STATUS_DISABLED = 0;

    /** 启用状态 */
    public static final int STATUS_ENABLED = 1;

    private HomepageShowcaseRecords() {
    }

    /** 首页精选内容记录 */
    @Data
    public static class ShowcaseRecord {
        /** 内容ID */
        private Long id;
        /** 展示标题 */
        private String title;
        /** 展示描述 */
        private String description;
        /** 作品分类 */
        private String category;
        /** 创作者名称 */
        private String creatorName;
        /** 媒体类型 */
        private String mediaType;
        /** 媒体地址 */
        private String mediaUrl;
        /** 缩略图地址 */
        private String thumbnailUrl;
        /** 目标类型 */
        private String targetType;
        /** 目标路径 */
        private String targetPath;
        /** 关联提示词 */
        private String promptContent;
        /** 排序值 */
        private Integer sortOrder;
        /** 启用状态 */
        private Integer status;
        /** 创建人 */
        private Long createdBy;
        /** 创建时间 */
        private OffsetDateTime createdAt;
        /** 更新时间 */
        private OffsetDateTime updatedAt;
        /** 软删除时间 */
        private OffsetDateTime deletedAt;
    }
}
