package com.novanovastudio.dto;

import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * @title        NotificationDtos.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  系统公告数据传输对象
 * @createTime   2026-06-26 10:00:00
 */
public final class NotificationDtos {

    private NotificationDtos() {
    }

    /**
     * 创建公告请求（标题、内容、图片三者至少填写一项）。
     *
     * @param title String 公告标题（可选，最多 200 字符）
     * @param content String 公告内容（可选）
     * @param priority String 优先级
     * @param imageUrl String 公告图片地址（可选）
     * @param actionLabel String 引导按钮文案（可选，最多 32 字符）
     * @param targetPath String 站内跳转路径（可选，以 / 开头）
     * @param targetModel String 预选模型标识（可选，channelId::modelName）
     */
    public record CreateNotificationRequest(
            @Size(max = 200, message = "business.announcementTitleMustNotExceed200Characters") String title,
            String content,
            String priority,
            String imageUrl,
            @Size(max = 32, message = "引导按钮文案不能超过32个字符") String actionLabel,
            @Size(max = 255, message = "跳转路径不能超过255个字符") String targetPath,
            @Size(max = 255, message = "预选模型标识不能超过255个字符") String targetModel) {

        /** 保持旧调用方不传跳转引导参数。 */
        public CreateNotificationRequest(String title, String content, String priority, String imageUrl) {
            this(title, content, priority, imageUrl, null, null, null);
        }

        /** 保持旧调用方不传图片地址。 */
        public CreateNotificationRequest(String title, String content, String priority) {
            this(title, content, priority, null, null, null, null);
        }
    }

    /**
     * 公告列表响应
     *
     * @param notifications List<NotificationItem> 公告列表
     */
    public record NotificationListResponse(List<NotificationItem> notifications) {
    }

    /**
     * 公告条目
     *
     * @param id Long 公告ID
     * @param title String 标题
     * @param content String 内容
     * @param priority String 优先级
     * @param status Integer 状态
     * @param publishedAt String 发布时间
     * @param read Boolean 是否已读
     * @param createdAt String 创建时间
     * @param imageUrl String 公告图片地址，为空时无图片
     * @param actionLabel String 引导按钮文案
     * @param targetPath String 站内跳转路径
     * @param targetModel String 预选模型标识
     */
    public record NotificationItem(Long id,
                                   String title,
                                   String content,
                                   String priority,
                                   Integer status,
                                   String publishedAt,
                                   Boolean read,
                                   String createdAt,
                                   String imageUrl,
                                   String actionLabel,
                                   String targetPath,
                                   String targetModel) {

        /** 保持旧调用方不返回引导跳转字段。 */
        public NotificationItem(Long id, String title, String content, String priority,
                                Integer status, String publishedAt, Boolean read, String createdAt, String imageUrl) {
            this(id, title, content, priority, status, publishedAt, read, createdAt, imageUrl, null, null, null);
        }

        /** 保持旧调用方不返回图片地址。 */
        public NotificationItem(Long id, String title, String content, String priority,
                                Integer status, String publishedAt, Boolean read, String createdAt) {
            this(id, title, content, priority, status, publishedAt, read, createdAt, null, null, null, null);
        }
    }

    /**
     * 标记已读请求
     *
     * @param notificationId Long 公告ID
     */
    public record ReadNotificationRequest(Long notificationId) {
    }

    /**
     * 更新公告请求（标题、内容、图片三者至少填写一项）。
     *
     * @param id Long 公告ID
     * @param title String 标题
     * @param content String 内容
     * @param imageUrl String 图片地址
     * @param actionLabel String 引导按钮文案
     * @param targetPath String 站内跳转路径
     * @param targetModel String 预选模型标识
     */
    public record UpdateNotificationRequest(
            Long id,
            @Size(max = 200, message = "business.announcementTitleMustNotExceed200Characters") String title,
            String content,
            String imageUrl,
            @Size(max = 32, message = "引导按钮文案不能超过32个字符") String actionLabel,
            @Size(max = 255, message = "跳转路径不能超过255个字符") String targetPath,
            @Size(max = 255, message = "预选模型标识不能超过255个字符") String targetModel) {

        /** 保持旧调用方不传跳转引导参数。 */
        public UpdateNotificationRequest(Long id, String title, String content, String imageUrl) {
            this(id, title, content, imageUrl, null, null, null);
        }

        /** 保持旧调用方不传图片地址。 */
        public UpdateNotificationRequest(Long id, String title, String content) {
            this(id, title, content, null, null, null, null);
        }
    }
}
