package com.novanovastudio.entity;

import java.time.OffsetDateTime;
import lombok.Data;

/**
 * 平台客户端下载链接配置实体集合。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-22 14:35:00
 */
public final class PlatformClientDownloadSettingsRecords {

    private PlatformClientDownloadSettingsRecords() {
    }

    /**
     * 平台客户端下载链接配置记录。
     */
    @Data
    public static class ClientDownloadSettingsRecord {

        /** Mac 英特尔芯片客户端下载链接 */
        private String macIntelUrl;

        /** Mac M 系列芯片客户端下载链接 */
        private String macAppleSiliconUrl;

        /** Windows 客户端下载链接 */
        private String windowsUrl;

        /** 创建时间 */
        private OffsetDateTime createdAt;

        /** 更新时间 */
        private OffsetDateTime updatedAt;
    }
}
