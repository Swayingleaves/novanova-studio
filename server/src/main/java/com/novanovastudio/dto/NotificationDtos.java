package com.novanovastudio.dto;

import jakarta.validation.constraints.NotBlank;
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
     * 创建公告请求
     *
     * @param title String 公告标题
     * @param content String 公告内容
     * @param priority String 优先级
     */
    public record CreateNotificationRequest(@NotBlank(message = "公告标题不能为空") @Size(max = 200, message = "公告标题不能超过200字") String title,
                                            String content,
                                            String priority) {
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
     */
    public record NotificationItem(Long id,
                                   String title,
                                   String content,
                                   String priority,
                                   Integer status,
                                   String publishedAt,
                                   Boolean read,
                                   String createdAt) {
    }

    /**
     * 标记已读请求
     *
     * @param notificationId Long 公告ID
     */
    public record ReadNotificationRequest(Long notificationId) {
    }

    /**
     * 更新公告请求
     *
     * @param id Long 公告ID
     * @param title String 标题
     * @param content String 内容
     */
    public record UpdateNotificationRequest(Long id, String title, String content) {
    }
}
