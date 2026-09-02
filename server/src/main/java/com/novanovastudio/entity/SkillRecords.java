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
    }
}
