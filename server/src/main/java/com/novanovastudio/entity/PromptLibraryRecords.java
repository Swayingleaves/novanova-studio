package com.novanovastudio.entity;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import lombok.Data;

/**
 * @title        PromptLibraryRecords.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  提示词库持久化记录实体
 * @createTime   2026-06-29 22:05:00
 */
public final class PromptLibraryRecords {

    /** 提示词状态：停用 */
    public static final int STATUS_DISABLED = 0;

    /** 提示词状态：启用 */
    public static final int STATUS_ENABLED = 1;

    private PromptLibraryRecords() {
    }

    /**
     * 提示词记录
     */
    @Data
    public static class PromptRecord {

        /** 提示词ID */
        private Long id;

        /** 提示词标题 */
        private String title;

        /** 提示词正文 */
        private String promptContent;

        /** 封面图片URL */
        private String coverUrl;

        /** 详情预览内容 */
        private String previewContent;

        /** 提示词分类 */
        private String category;

        /** 提示词标签列表 */
        private List<String> tags = new ArrayList<>();

        /** 来源地址 */
        private String sourceUrl;

        /** 状态：1启用，0停用 */
        private Integer status;

        /** 排序值，越小越靠前 */
        private Integer sortOrder;

        /** 创建人用户ID */
        private Long createdBy;

        /** 创建时间 */
        private OffsetDateTime createdAt;

        /** 更新时间 */
        private OffsetDateTime updatedAt;

        /** 软删除时间 */
        private OffsetDateTime deletedAt;
    }
}
