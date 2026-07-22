package com.novanovastudio.service;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.NotificationDtos;
import com.novanovastudio.entity.NotificationRecords;
import com.novanovastudio.repository.NotificationRepository;
import com.novanovastudio.security.CurrentUserProvider;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;

/**
 * @title        NotificationService.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  系统公告服务
 * @createTime   2026-06-26 10:00:00
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class NotificationService {

    private final NotificationRepository repository;
    private final CurrentUserProvider currentUserProvider;

    /**
     * 查询所有公告（管理员用）
     *
     * @return Mono<List<NotificationItem>> 公告列表
     */
    public Mono<List<NotificationDtos.NotificationItem>> listAllNotifications() {
        return repository.listAllNotifications().collectList().map(records ->
                records.stream().map(this::toItem).collect(Collectors.toList()));
    }

    /**
     * 查询用户公告（仅已发布，附带已读状态）
     *
     * @return Mono<List<NotificationItem>> 公告列表
     */
    public Mono<List<NotificationDtos.NotificationItem>> listUserNotifications() {
        return currentUserProvider.currentUserId().flatMap(userId ->
                Mono.zip(
                        repository.listPublishedNotifications(userId).collectList(),
                        repository.listReadNotificationIds(userId).collectList()
                ).map(tuple -> {
                    Set<Long> readIds = tuple.getT2().stream().collect(Collectors.toSet());
                    return tuple.getT1().stream().map(record -> {
                        NotificationDtos.NotificationItem item = toItem(record);
                        return new NotificationDtos.NotificationItem(
                                item.id(), item.title(), item.content(), item.priority(),
                                item.status(), item.publishedAt(), readIds.contains(record.getId()),
                                item.createdAt()
                        );
                    }).collect(Collectors.toList());
                })
        );
    }

    /**
     * 创建公告
     *
     * @param request CreateNotificationRequest 创建请求
     * @return Mono<Void>
     */
    public Mono<Void> createNotification(NotificationDtos.CreateNotificationRequest request) {
        return currentUserProvider.currentUserId().flatMap(userId -> {
            NotificationRecords.SystemNotificationRecord record = new NotificationRecords.SystemNotificationRecord();
            record.setTitle(request.title());
            record.setContent(request.content() == null ? "" : request.content());
            record.setPriority(request.priority() == null ? "normal" : request.priority());
            record.setCreatedBy(userId);
            return repository.createNotification(record).then();
        }).doOnSuccess(ignored -> log.info("创建公告成功"));
    }

    /**
     * 更新公告
     *
     * @param id Long 公告ID
     * @param title String 标题
     * @param content String 内容
     * @return Mono<Void>
     */
    public Mono<Void> updateNotification(Long id, String title, String content) {
        return repository.updateNotification(id, title, content == null ? "" : content)
                .doOnSuccess(ignored -> log.info("更新公告成功: id={}", id));
    }

    /**
     * 发布公告
     *
     * @param id Long 公告ID
     * @return Mono<Void>
     */
    public Mono<Void> publishNotification(Long id) {
        return repository.publishNotification(id)
                .doOnSuccess(ignored -> log.info("发布公告成功: id={}", id));
    }

    /**
     * 标记公告为已读
     *
     * @param request ReadNotificationRequest 请求
     * @return Mono<Void>
     */
    public Mono<Void> markAsRead(NotificationDtos.ReadNotificationRequest request) {
        return currentUserProvider.currentUserId().flatMap(userId ->
                repository.markAsRead(userId, request.notificationId())
        ).doOnSuccess(ignored -> log.info("标记公告已读: id={}", request.notificationId()));
    }

    /**
     * 标记当前用户的全部已发布公告为已读。
     *
     * @return Mono<Void> 操作完成信号
     */
    public Mono<Void> markAllAsRead() {
        return currentUserProvider.currentUserId()
                .flatMap(repository::markAllAsRead)
                .doOnSuccess(ignored -> log.info("标记全部公告已读"));
    }

    /**
     * 转换记录为DTO
     */
    private NotificationDtos.NotificationItem toItem(NotificationRecords.SystemNotificationRecord record) {
        return new NotificationDtos.NotificationItem(
                record.getId(),
                record.getTitle(),
                record.getContent(),
                record.getPriority(),
                record.getStatus(),
                record.getPublishedAt() == null ? null : record.getPublishedAt().toString(),
                false,
                record.getCreatedAt() == null ? null : record.getCreatedAt().toString()
        );
    }
}
