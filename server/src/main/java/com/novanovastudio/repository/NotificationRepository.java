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
                SELECT id, title, content, image_url, action_label, target_path, target_model, priority, status, published_at, created_by, created_at, updated_at
                FROM system_notifications
                ORDER BY created_at DESC
                """).map((row, metadata) -> mapNotificationRow(row)).all();
    }

    /**
     * 查询已发布的公告（带用户的已读状态）
     *
     * @param userId Long 用户ID
     * @return Flux<SystemNotificationRecord> 公告列表
     */
    public Flux<NotificationRecords.SystemNotificationRecord> listPublishedNotifications(Long userId) {
        return databaseClient.sql("""
                SELECT n.id, n.title, n.content, n.image_url, n.action_label, n.target_path, n.target_model, n.priority, n.status, n.published_at, n.created_by, n.created_at, n.updated_at
                FROM system_notifications n
                WHERE n.status = 1
                ORDER BY n.published_at DESC
                """).map((row, metadata) -> mapNotificationRow(row)).all();
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
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                INSERT INTO system_notifications(title, content, image_url, action_label, target_path, target_model, priority, status, created_by)
                VALUES (:title, :content, :imageUrl, :actionLabel, :targetPath, :targetModel, :priority, 0, :createdBy)
                """)
                .bind("title", record.getTitle() == null ? "" : record.getTitle())
                .bind("content", record.getContent() == null ? "" : record.getContent())
                .bind("priority", record.getPriority() == null ? "normal" : record.getPriority())
                .bind("createdBy", record.getCreatedBy());
        spec = bindNullableString(spec, "imageUrl", record.getImageUrl());
        spec = bindNullableString(spec, "actionLabel", record.getActionLabel());
        spec = bindNullableString(spec, "targetPath", record.getTargetPath());
        spec = bindNullableString(spec, "targetModel", record.getTargetModel());
        return spec.fetch()
                .rowsUpdated()
                .then(databaseClient.sql("SELECT LASTVAL()").map((row, metadata) -> row.get(0, Long.class)).one());
    }

    /**
     * 更新公告（已发布和草稿均可编辑）
     *
     * @param id Long 公告ID
     * @param title String 标题
     * @param content String 内容
     * @param imageUrl String 图片地址，可为null
     * @param actionLabel String 引导按钮文案，可为null
     * @param targetPath String 站内跳转路径，可为null
     * @param targetModel String 预选模型标识，可为null
     * @return Mono<Void>
     */
    public Mono<Void> updateNotification(
            Long id, String title, String content, String imageUrl,
            String actionLabel, String targetPath, String targetModel) {
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                UPDATE system_notifications
                SET title = :title,
                    content = :content,
                    image_url = :imageUrl,
                    action_label = :actionLabel,
                    target_path = :targetPath,
                    target_model = :targetModel,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = :id
                """)
                .bind("id", id)
                .bind("title", title == null ? "" : title)
                .bind("content", content == null ? "" : content);
        spec = bindNullableString(spec, "imageUrl", imageUrl);
        spec = bindNullableString(spec, "actionLabel", actionLabel);
        spec = bindNullableString(spec, "targetPath", targetPath);
        spec = bindNullableString(spec, "targetModel", targetModel);
        return spec.fetch().rowsUpdated().then();
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
                ON CONFLICT (team_id, user_id, notification_id) DO NOTHING
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
                ON CONFLICT (team_id, user_id, notification_id) DO NOTHING
                """).bind("userId", userId).fetch().rowsUpdated().then();
    }

    private DatabaseClient.GenericExecuteSpec bindNullableString(
            DatabaseClient.GenericExecuteSpec spec, String name, String value) {
        return value == null ? spec.bindNull(name, String.class) : spec.bind(name, value);
    }

    /**
     * 将数据库行映射为公告持久化记录。
     *
     * @param row io.r2dbc.spi.Row 数据库行
     * @return SystemNotificationRecord 公告记录
     */
    private NotificationRecords.SystemNotificationRecord mapNotificationRow(io.r2dbc.spi.Row row) {
        NotificationRecords.SystemNotificationRecord record = new NotificationRecords.SystemNotificationRecord();
        record.setId(row.get("id", Long.class));
        record.setTitle(row.get("title", String.class));
        record.setContent(row.get("content", String.class));
        record.setImageUrl(row.get("image_url", String.class));
        record.setActionLabel(row.get("action_label", String.class));
        record.setTargetPath(row.get("target_path", String.class));
        record.setTargetModel(row.get("target_model", String.class));
        record.setPriority(row.get("priority", String.class));
        record.setStatus(row.get("status", Integer.class));
        record.setPublishedAt(row.get("published_at", java.time.OffsetDateTime.class));
        record.setCreatedBy(row.get("created_by", Long.class));
        record.setCreatedAt(row.get("created_at", java.time.OffsetDateTime.class));
        record.setUpdatedAt(row.get("updated_at", java.time.OffsetDateTime.class));
        return record;
    }
}
