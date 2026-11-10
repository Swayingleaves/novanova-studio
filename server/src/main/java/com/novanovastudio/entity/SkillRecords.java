package com.novanovastudio.entity;

import java.time.OffsetDateTime;
import lombok.Data;

/**
 * 图片和视频生成技能持久化记录。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-08-27 00:00
 */
public final class SkillRecords {

    /** 图片生成类型。 */
    public static final String TYPE_IMAGE = "image";
    /** 视频生成类型。 */
    public static final String TYPE_VIDEO = "video";
    /** 画布设定图技能类型。 */
    public static final String TYPE_CANVAS_SETTING_GRAPH = "canvasSettingGraph";
    /** 停用状态。 */
    public static final int STATUS_DISABLED = 0;
    /** 启用状态。 */
    public static final int STATUS_ENABLED = 1;
    /** 市场分类：图片。 */
    public static final String CATEGORY_IMAGE = "image";
    /** 市场分类：视频。 */
    public static final String CATEGORY_VIDEO = "video";
    /** 市场分类：电商。 */
    public static final String CATEGORY_ECOMMERCE = "ecommerce";
    /** 市场分类：人像。 */
    public static final String CATEGORY_PORTRAIT = "portrait";
    /** 市场分类：爆款复刻。 */
    public static final String CATEGORY_VIRAL = "viralReplica";
    /** 审核状态：未发布。 */
    public static final String REVIEW_PRIVATE = "private";
    /** 审核状态：审核中。 */
    public static final String REVIEW_PENDING = "pending";
    /** 审核状态：已发布。 */
    public static final String REVIEW_PUBLISHED = "published";
    /** 审核状态：已驳回。 */
    public static final String REVIEW_REJECTED = "rejected";

    private SkillRecords() {
    }

    /**
     * 技能记录。
     */
    @Data
    public static class SkillRecord {

        /** 技能ID。 */
        private Long id;
        /** 技能名称。 */
        private String name;
        /** 技能简介，展示在用户侧选择面板。 */
        private String description;
        /** 适用生成类型：image图片，video视频，canvasSettingGraph画布设定图。 */
        private String targetType;
        /** 技能流程系统提示词，驱动主Agent引导式多轮对话。 */
        private String systemPrompt;
        /** 默认生成比例，例如16:9、9:16。 */
        private String aspectRatio;
        /** 技能封面地址。 */
        private String coverUrl;
        /** 启用状态。 */
        private Integer status;
        /** 排序值。 */
        private Integer sortOrder;
        /** 创建时间。 */
        private OffsetDateTime createdAt;
        /** 更新时间。 */
        private OffsetDateTime updatedAt;
        /** 软删除时间。 */
        private OffsetDateTime deletedAt;
        /** 市场分类，画布设定图为空。 */
        private String category;
        /** 一句话介绍。 */
        private String subtitle;
        /** 适合人群。 */
        private String audience;
        /** 使用步骤 JSON。 */
        private String usageSteps;
        /** 作者用户ID，空表示官方技能。 */
        private Long ownerUserId;
        /** 审核状态。 */
        private String reviewStatus;
        /** 驳回原因。 */
        private String rejectReason;
        /** 作者展示名，联表查询时填充。 */
        private String authorName;
        /** 当前用户是否已收藏，联表查询时填充。 */
        private Boolean favorited;
    }
}
