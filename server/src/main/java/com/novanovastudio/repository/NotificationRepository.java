package com.novanovastudio.repository;

import com.novanovastudio.entity.NotificationRecords;
import lombok.RequiredArgsConstructor;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * @title        NotificationRepository.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  系统公告持久化仓储
 * @createTime   2026-06-26 10:00:00
 */
@Repository
@RequiredArgsConstructor
public class NotificationRepository {

    private final DatabaseClient databaseClient;

    /**
     * 查询所有公告（管理员用）
     *
     * @return Flux<SystemNotificationRecord> 公告列表
     */
    public Flux<NotificationRecords.SystemNotificationRecord> listAllNotifications() {
        return databaseClient.sql("""
                SELECT id, title, content, priority, status, published_at, created_by, created_at, updated_at
                FROM system_notifications
                ORDER BY created_at DESC
                """).map((row, metadata) -> {
                    NotificationRecords.SystemNotificationRecord record = new NotificationRecords.SystemNotificationRecord();
                    record.setId(row.get("id", Long.class));
                    record.setTitle(row.get("title", String.class));
                    record.setContent(row.get("content", String.class));
                    record.setPriority(row.get("priority", String.class));
                    record.setStatus(row.get("status", Integer.class));
                    record.setPublishedAt(row.get("published_at", java.time.OffsetDateTime.class));
                    record.setCreatedBy(row.get("created_by", Long.class));
                    record.setCreatedAt(row.get("created_at", java.time.OffsetDateTime.class));
                    record.setUpdatedAt(row.get("updated_at", java.time.OffsetDateTime.class));
                    return record;
                }).all();
    }

    /**
     * 查询已发布的公告（带用户的已读状态）
     *
     * @param userId Long 用户ID
     * @return Flux<SystemNotificationRecord> 公告列表
     */
    public Flux<NotificationRecords.SystemNotificationRecord> listPublishedNotifications(Long userId) {
        return databaseClient.sql("""
                SELECT n.id, n.title, n.content, n.priority, n.status, n.published_at, n.created_by, n.created_at, n.updated_at
                FROM system_notifications n
                WHERE n.status = 1
                ORDER BY n.published_at DESC
                """).map((row, metadata) -> {
                    NotificationRecords.SystemNotificationRecord record = new NotificationRecords.SystemNotificationRecord();
                    record.setId(row.get("id", Long.class));
                    record.setTitle(row.get("title", String.class));
                    record.setContent(row.get("content", String.class));
                    record.setPriority(row.get("priority", String.class));
                    record.setStatus(row.get("status", Integer.class));
                    record.setPublishedAt(row.get("published_at", java.time.OffsetDateTime.class));
                    record.setCreatedBy(row.get("created_by", Long.class));
                    record.setCreatedAt(row.get("created_at", java.time.OffsetDateTime.class));
                    record.setUpdatedAt(row.get("updated_at", java.time.OffsetDateTime.class));
                    return record;
                }).all();
    }

    /**
     * 查询用户已读的公告ID列表
     *
     * @param userId Long 用户ID
     * @return Flux<Long> 已读公告ID列表
     */
    public Flux<Long> listReadNotificationIds(Long userId) {
        return databaseClient.sql("""
                SELECT notification_id FROM user_notification_reads WHERE user_id = :userId
                """).bind("userId", userId).map((row, metadata) -> row.get("notification_id", Long.class)).all();
    }

    /**
     * 创建公告
     *
     * @param record SystemNotificationRecord 公告记录
     * @return Mono<Long> 公告ID
     */
    public Mono<Long> createNotification(NotificationRecords.SystemNotificationRecord record) {
        return databaseClient.sql("""
                INSERT INTO system_notifications(title, content, priority, status, created_by)
                VALUES (:title, :content, :priority, 0, :createdBy)
                """)
                .bind("title", record.getTitle())
                .bind("content", record.getContent() == null ? "" : record.getContent())
                .bind("priority", record.getPriority() == null ? "normal" : record.getPriority())
                .bind("createdBy", record.getCreatedBy())
                .fetch()
                .rowsUpdated()
                .then(databaseClient.sql("SELECT LASTVAL()").map((row, metadata) -> row.get(0, Long.class)).one());
    }

    /**
     * 更新公告（已发布和草稿均可编辑）
     *
     * @param id Long 公告ID
     * @param title String 标题
     * @param content String 内容
     * @return Mono<Void>
     */
    public Mono<Void> updateNotification(Long id, String title, String content) {
        return databaseClient.sql("""
                UPDATE system_notifications SET title = :title, content = :content, updated_at = CURRENT_TIMESTAMP
                WHERE id = :id
                """).bind("id", id).bind("title", title).bind("content", content).fetch().rowsUpdated().then();
    }

    /**
     * 发布公告
     *
     * @param id Long 公告ID
     * @return Mono<Void>
     */
    public Mono<Void> publishNotification(Long id) {
        return databaseClient.sql("""
                UPDATE system_notifications SET status = 1, published_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                WHERE id = :id AND status = 0
                """).bind("id", id).fetch().rowsUpdated().then();
    }

    /**
     * 标记公告为已读
     *
     * @param userId Long 用户ID
     * @param notificationId Long 公告ID
     * @return Mono<Void>
     */
    public Mono<Void> markAsRead(Long userId, Long notificationId) {
        return databaseClient.sql("""
                INSERT INTO user_notification_reads(user_id, notification_id)
                VALUES (:userId, :notificationId)
                ON CONFLICT (user_id, notification_id) DO NOTHING
                """).bind("userId", userId).bind("notificationId", notificationId).fetch().rowsUpdated().then();
    }

    /**
     * 标记用户的所有已发布公告为已读。
     *
     * @param userId Long 用户ID
     * @return Mono<Void> 操作完成信号
     */
    public Mono<Void> markAllAsRead(Long userId) {
        return databaseClient.sql("""
                INSERT INTO user_notification_reads(user_id, notification_id)
                SELECT :userId, notifications.id
                FROM system_notifications notifications
                WHERE notifications.status = 1
                ON CONFLICT (user_id, notification_id) DO NOTHING
                """).bind("userId", userId).fetch().rowsUpdated().then();
    }
}
