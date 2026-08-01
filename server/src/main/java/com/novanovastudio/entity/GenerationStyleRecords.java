package com.novanovastudio.entity;

import java.time.OffsetDateTime;
import lombok.Data;

/**
 * 图片和视频生成风格持久化记录。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-31 00:00
 */
public final class GenerationStyleRecords {

    /** 图片生成类型。 */
    public static final String TYPE_IMAGE = "image";
    /** 视频生成类型。 */
    public static final String TYPE_VIDEO = "video";
    /** 停用状态。 */
    public static final int STATUS_DISABLED = 0;
    /** 启用状态。 */
    public static final int STATUS_ENABLED = 1;

    private GenerationStyleRecords() {
    }

    /**
     * 风格记录。
     */
    @Data
    public static class StyleRecord {

        /** 风格ID。 */
        private Long id;
        /** 生成类型。 */
        private String generationType;
        /** 风格名称。 */
        private String name;
        /** 风格提示词。 */
        private String stylePrompt;
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
