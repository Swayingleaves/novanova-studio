package com.novanovastudio.entity;

import java.time.OffsetDateTime;
import lombok.Data;

/**
 * @title        NotificationRecords.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  系统公告持久化记录实体
 * @createTime   2026-06-26 10:00:00
 */
public final class NotificationRecords {

    private NotificationRecords() {
    }

    /** 公告状态：草稿 */
    public static final int STATUS_DRAFT = 0;

    /** 公告状态：已发布 */
    public static final int STATUS_PUBLISHED = 1;

    /** 公告优先级：普通 */
    public static final String PRIORITY_NORMAL = "normal";

    /** 公告优先级：高 */
    public static final String PRIORITY_HIGH = "high";

    /**
     * 系统公告记录
     */
    @Data
    public static class SystemNotificationRecord {

        /** 主键ID */
        private Long id;

        /** 公告标题 */
        private String title;

        /** 公告内容 */
        private String content;

        /** 优先级：normal/high */
        private String priority;

        /** 状态：0草稿，1已发布 */
        private Integer status;

        /** 发布时间 */
        private OffsetDateTime publishedAt;

        /** 创建人用户ID */
        private Long createdBy;

        /** 创建时间 */
        private OffsetDateTime createdAt;

        /** 更新时间 */
        private OffsetDateTime updatedAt;
    }

    /**
     * 用户公告已读记录
     */
    @Data
    public static class UserNotificationReadRecord {

        /** 主键ID */
        private Long id;

        /** 用户ID */
        private Long userId;

        /** 公告ID */
        private Long notificationId;

        /** 阅读时间 */
        private OffsetDateTime readAt;
    }
}
