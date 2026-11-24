package com.novanovastudio.service;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.NotificationDtos;
import com.novanovastudio.entity.NotificationRecords;
import com.novanovastudio.repository.NotificationRepository;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.storage.MediaAccessService;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Flux;
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

    /** 公告标题最大长度。 */
    private static final int MAX_TITLE_LENGTH = 200;

    /** 公告图片地址最大长度。 */
    private static final int MAX_IMAGE_URL_LENGTH = 2048;

    /** 引导按钮文案最大长度。 */
    private static final int MAX_ACTION_LABEL_LENGTH = 32;

    /** 跳转路径与预选模型标识最大长度。 */
    private static final int MAX_TARGET_FIELD_LENGTH = 255;

    private final NotificationRepository repository;
    private final CurrentUserProvider currentUserProvider;

    /** 私有存储桶读地址签发。 */
    @Autowired(required = false)
    private MediaAccessService mediaAccessService;

    /**
     * 查询所有公告（管理员用）
     *
     * @return Mono<List<NotificationItem>> 公告列表
     */
    public Mono<List<NotificationDtos.NotificationItem>> listAllNotifications() {
        return repository.listAllNotifications()
                .concatMap(record -> toSignedItem(record, false))
                .collectList();
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
                ).flatMap(tuple -> {
                    Set<Long> readIds = tuple.getT2().stream().collect(Collectors.toSet());
                    return Flux.fromIterable(tuple.getT1())
                            .concatMap(record -> toSignedItem(record, readIds.contains(record.getId())))
                            .collectList();
                })
        );
    }

    /**
     * 创建公告（标题、内容、图片三者至少填写一项）。
     *
     * @param request CreateNotificationRequest 创建请求
     * @return Mono<Void>
     */
    public Mono<Void> createNotification(NotificationDtos.CreateNotificationRequest request) {
        String title = normalizeText(request == null ? null : request.title());
        String content = normalizeText(request == null ? null : request.content());
        String imageUrl = normalizeOptionalUrl(request == null ? null : request.imageUrl());
        String actionLabel = normalizeOptionalUrl(request == null ? null : request.actionLabel());
        String targetPath = normalizeOptionalUrl(request == null ? null : request.targetPath());
        String targetModel = normalizeOptionalUrl(request == null ? null : request.targetModel());
        validateAnnouncementFields(title, content, imageUrl, actionLabel, targetPath, targetModel);
        return currentUserProvider.currentUserId().flatMap(userId -> {
            NotificationRecords.SystemNotificationRecord record = new NotificationRecords.SystemNotificationRecord();
            record.setTitle(title);
            record.setContent(content);
            record.setImageUrl(imageUrl);
            record.setActionLabel(targetPath == null ? null : actionLabel);
            record.setTargetPath(targetPath);
            record.setTargetModel(targetPath == null ? null : targetModel);
            record.setPriority(request == null || !StringUtils.hasText(request.priority()) ? "normal" : request.priority().trim());
            record.setCreatedBy(userId);
            return repository.createNotification(record).then();
        }).doOnSuccess(ignored -> log.info("创建公告成功"));
    }

    /**
     * 更新公告（标题、内容、图片三者至少填写一项）。
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
        if (id == null || id <= 0) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "公告标识无效"));
        }
        String normalizedTitle = normalizeText(title);
        String normalizedContent = normalizeText(content);
        String normalizedImageUrl = normalizeOptionalUrl(imageUrl);
        String normalizedActionLabel = normalizeOptionalUrl(actionLabel);
        String normalizedTargetPath = normalizeOptionalUrl(targetPath);
        String normalizedTargetModel = normalizeOptionalUrl(targetModel);
        validateAnnouncementFields(normalizedTitle, normalizedContent, normalizedImageUrl,
                normalizedActionLabel, normalizedTargetPath, normalizedTargetModel);
        return repository.updateNotification(
                        id,
                        normalizedTitle,
                        normalizedContent,
                        normalizedImageUrl,
                        normalizedTargetPath == null ? null : normalizedActionLabel,
                        normalizedTargetPath,
                        normalizedTargetPath == null ? null : normalizedTargetModel)
                .doOnSuccess(ignored -> log.info("更新公告成功: id={}", id));
    }

    /**
     * 兼容旧更新公告方法签名（不携带引导跳转参数）。
     *
     * @param id Long 公告ID
     * @param title String 标题
     * @param content String 内容
     * @param imageUrl String 图片地址，可为null
     * @return Mono<Void>
     */
    public Mono<Void> updateNotification(Long id, String title, String content, String imageUrl) {
        return updateNotification(id, title, content, imageUrl, null, null, null);
    }

    /**
     * 兼容旧更新公告方法签名（不携带图片地址）。
     *
     * @param id Long 公告ID
     * @param title String 标题
     * @param content String 内容
     * @return Mono<Void>
     */
    public Mono<Void> updateNotification(Long id, String title, String content) {
        return updateNotification(id, title, content, null);
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
     * 校验公告内容组合规则：标题、正文、图片三者至少填写一项，并检查长度上限。
     *
     * @param title String 规范化后的标题
     * @param content String 规范化后的正文
     * @param imageUrl String 规范化后的图片地址
     */
    private void validateAnnouncementFields(
            String title, String content, String imageUrl,
            String actionLabel, String targetPath, String targetModel) {
        if (!StringUtils.hasText(title) && !StringUtils.hasText(content) && !StringUtils.hasText(imageUrl)) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "公告标题、文字内容和图片至少填写一项");
        }
        if (title.length() > MAX_TITLE_LENGTH) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "公告标题不能超过 " + MAX_TITLE_LENGTH + " 个字符");
        }
        if (imageUrl != null && imageUrl.length() > MAX_IMAGE_URL_LENGTH) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "公告图片地址过长");
        }
        if (actionLabel != null && actionLabel.length() > MAX_ACTION_LABEL_LENGTH) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "引导按钮文案不能超过 " + MAX_ACTION_LABEL_LENGTH + " 个字符");
        }
        if (targetPath != null) {
            if (targetPath.length() > MAX_TARGET_FIELD_LENGTH || !targetPath.startsWith("/") || targetPath.startsWith("//")) {
                throw new BusinessException(ErrorCode.PARAM_INVALID, "跳转路径必须为站内相对路径");
            }
        }
        if (targetModel != null && targetModel.length() > MAX_TARGET_FIELD_LENGTH) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "预选模型标识过长");
        }
    }

    /**
     * 将公告记录转换为 DTO，并对私有存储桶图片地址按需签发读地址。
     *
     * @param record SystemNotificationRecord 公告持久化记录
     * @param read boolean 当前用户是否已读
     * @return Mono<NotificationItem> 公告展示 DTO
     */
    private Mono<NotificationDtos.NotificationItem> toSignedItem(
            NotificationRecords.SystemNotificationRecord record, boolean read) {
        String rawImageUrl = normalizeOptionalUrl(record.getImageUrl());
        Mono<String> signedUrlMono = (rawImageUrl == null || mediaAccessService == null)
                ? Mono.justOrEmpty(rawImageUrl).defaultIfEmpty("")
                : mediaAccessService.signUrl(rawImageUrl, MediaAccessService.Purpose.PREVIEW)
                        .onErrorReturn(rawImageUrl);
        return signedUrlMono.map(signedUrl -> new NotificationDtos.NotificationItem(
                record.getId(),
                record.getTitle() == null ? "" : record.getTitle(),
                record.getContent() == null ? "" : record.getContent(),
                record.getPriority(),
                record.getStatus(),
                record.getPublishedAt() == null ? null : record.getPublishedAt().toString(),
                read,
                record.getCreatedAt() == null ? null : record.getCreatedAt().toString(),
                StringUtils.hasText(signedUrl) ? signedUrl : null,
                normalizeOptionalUrl(record.getActionLabel()),
                normalizeOptionalUrl(record.getTargetPath()),
                normalizeOptionalUrl(record.getTargetModel())
        ));
    }

    private String normalizeText(String value) {
        return value == null ? "" : value.trim();
    }

    private String normalizeOptionalUrl(String value) {
        if (!StringUtils.hasText(value)) {
            return null;
        }
        return value.trim();
    }
}
