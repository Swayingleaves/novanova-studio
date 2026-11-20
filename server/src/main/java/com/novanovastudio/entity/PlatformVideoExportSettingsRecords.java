package com.novanovastudio.entity;

import java.time.OffsetDateTime;
import lombok.Data;

/**
 * 平台漫剧视觉分镜板导出视频开关配置持久化记录。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-19 21:55:00
 */
public final class PlatformVideoExportSettingsRecords {

    private PlatformVideoExportSettingsRecords() {
    }

    /** 导出视频开关配置实体记录 */
    @Data
    public static class VideoExportSettingsRecord {

        /** 是否开启漫剧创作视觉分镜板导出视频功能 */
        private Boolean enabled;

        /** 创建时间 */
        private OffsetDateTime createdAt;

        /** 更新时间 */
        private OffsetDateTime updatedAt;
    }
}
