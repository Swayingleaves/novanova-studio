package com.novanovastudio.service;

import com.novanovastudio.common.SystemMessage;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.HomepageShowcaseDtos;
import com.novanovastudio.entity.HomepageShowcaseRecords;
import com.novanovastudio.repository.HomepageShowcaseRepository;
import com.novanovastudio.security.CurrentUserProvider;
import java.net.URI;
import java.util.Map;
import java.util.List;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;

/**
 * 首页精选内容业务服务。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-07-18 12:00:00
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class HomepageShowcaseService {

    private static final int DEFAULT_SORT_ORDER = 1000;
    private static final int MAX_PUBLIC_LIMIT = 24;
    private static final int MAX_TITLE_LENGTH = 200;
    private static final int MAX_CATEGORY_LENGTH = 50;
    private static final int MAX_CREATOR_NAME_LENGTH = 100;
    private static final List<String> MEDIA_TYPES = List.of("image", "video");
    private static final List<String> TARGET_TYPES = List.of("image", "video", "canvas", "asset");
    private static final Map<String, String> TARGET_PATHS = Map.of(
            "image", "/image",
            "video", "/video",
            "canvas", "/canvas",
            "asset", "/assets");

    private final HomepageShowcaseRepository repository;
    private final CurrentUserProvider currentUserProvider;

    /** 查询首页公开精选内容。 */
    public Mono<HomepageShowcaseDtos.ShowcaseListResponse> listPublic(Integer limit) {
        int normalizedLimit = Math.max(1, Math.min(MAX_PUBLIC_LIMIT, limit == null ? 12 : limit));
        return repository.listPublic(normalizedLimit).map(this::toItem).collectList()
                .map(items -> new HomepageShowcaseDtos.ShowcaseListResponse(items, items.size()));
    }

    /** 查询管理端精选内容。 */
    public Mono<HomepageShowcaseDtos.ShowcaseListResponse> listAdmin() {
        return repository.listAdmin().map(this::toItem).collectList()
                .map(items -> new HomepageShowcaseDtos.ShowcaseListResponse(items, items.size()));
    }

    /** 创建精选内容。 */
    public Mono<Void> create(HomepageShowcaseDtos.CreateShowcaseRequest request) {
        HomepageShowcaseRecords.ShowcaseRecord record = buildRecord(null, request.title(), request.description(), request.category(), request.creatorName(), request.mediaType(), request.mediaUrl(), request.thumbnailUrl(), request.targetType(), request.targetPath(), request.promptContent(), request.sortOrder(), request.status());
        return currentUserProvider.currentUserId().flatMap(userId -> {
            record.setCreatedBy(userId);
            return repository.create(record);
        }).doOnSuccess(id -> log.info("创建首页精选内容成功: id={}", id)).then();
    }

    /** 更新精选内容。 */
    public Mono<Void> update(HomepageShowcaseDtos.UpdateShowcaseRequest request) {
        if (request.id() == null || request.id() <= 0) return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.showcaseIDIsRequired")));
        HomepageShowcaseRecords.ShowcaseRecord record = buildRecord(request.id(), request.title(), request.description(), request.category(), request.creatorName(), request.mediaType(), request.mediaUrl(), request.thumbnailUrl(), request.targetType(), request.targetPath(), request.promptContent(), request.sortOrder(), request.status());
        return repository.update(record).doOnSuccess(ignored -> log.info("更新首页精选内容成功: id={}", request.id()));
    }

    /** 更新精选内容状态。 */
    public Mono<Void> updateStatus(HomepageShowcaseDtos.UpdateShowcaseStatusRequest request) {
        if (request.id() == null || request.id() <= 0) return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.showcaseIDIsRequired")));
        return repository.updateStatus(request.id(), normalizeStatus(request.status()));
    }

    /** 删除精选内容。 */
    public Mono<Void> delete(HomepageShowcaseDtos.DeleteShowcasesRequest request) {
        List<Long> ids = request.ids() == null ? List.of() : request.ids().stream().filter(id -> id != null && id > 0).distinct().toList();
        if (ids.isEmpty()) return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.selectShowcasesToDelete")));
        return repository.delete(ids).doOnSuccess(ignored -> log.info("删除首页精选内容成功: ids={}", ids));
    }

    private HomepageShowcaseRecords.ShowcaseRecord buildRecord(Long id, String title, String description, String category, String creatorName, String mediaType, String mediaUrl, String thumbnailUrl, String targetType, String targetPath, String promptContent, Integer sortOrder, Integer status) {
        String normalizedTitle = required(title, SystemMessage.of("business.titleIsRequired"));
        if (normalizedTitle.length() > MAX_TITLE_LENGTH) throw new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.titleMustNotExceed200Characters"));
        String normalizedCategory = required(category, SystemMessage.of("business.categoryIsRequired"));
        if (normalizedCategory.length() > MAX_CATEGORY_LENGTH) throw new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.categoryMustNotExceed50Characters"));
        String normalizedCreatorName = required(creatorName, SystemMessage.of("business.creatorIsRequired"));
        if (normalizedCreatorName.length() > MAX_CREATOR_NAME_LENGTH) throw new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.creatorNameMustNotExceed100Characters"));
        String normalizedMediaType = normalizeEnum(mediaType, MEDIA_TYPES, SystemMessage.of("business.invalidMediaType"));
        String normalizedTargetType = normalizeEnum(targetType, TARGET_TYPES, SystemMessage.of("business.invalidTargetType"));
        validateUrl(mediaUrl, SystemMessage.of("business.mediaURLIsRequiredAndMustBeValid"));
        if (!normalizeText(thumbnailUrl).isBlank()) validateUrl(thumbnailUrl, SystemMessage.of("business.invalidThumbnailURL"));
        String normalizedTargetPath = normalizeText(targetPath);
        if (normalizedTargetPath.isBlank()) normalizedTargetPath = TARGET_PATHS.get(normalizedTargetType);
        if (!normalizedTargetPath.startsWith("/") || normalizedTargetPath.startsWith("//")) throw new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.targetMustBeAnInternalPath"));
        HomepageShowcaseRecords.ShowcaseRecord record = new HomepageShowcaseRecords.ShowcaseRecord();
        record.setId(id);
        record.setTitle(normalizedTitle);
        record.setDescription(normalizeText(description));
        record.setCategory(normalizedCategory);
        record.setCreatorName(normalizedCreatorName);
        record.setMediaType(normalizedMediaType);
        record.setMediaUrl(mediaUrl.trim());
        record.setThumbnailUrl(normalizeText(thumbnailUrl));
        record.setTargetType(normalizedTargetType);
        record.setTargetPath(normalizedTargetPath);
        record.setPromptContent(normalizeText(promptContent));
        record.setSortOrder(sortOrder == null ? DEFAULT_SORT_ORDER : Math.max(0, sortOrder));
        record.setStatus(normalizeStatus(status));
        return record;
    }

    private void validateUrl(String value, SystemMessage message) {
        String normalized = normalizeText(value);
        if (normalized.isBlank()) throw new BusinessException(ErrorCode.PARAM_INVALID, message);
        if (normalized.startsWith("/") && !normalized.startsWith("//")) return;
        try {
            URI uri = URI.create(normalized);
            if (!("http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme()))) throw new IllegalArgumentException();
        } catch (IllegalArgumentException exception) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, message);
        }
    }

    private String normalizeEnum(String value, List<String> allowed, SystemMessage message) {
        String normalized = normalizeText(value).toLowerCase();
        if (!allowed.contains(normalized)) throw new BusinessException(ErrorCode.PARAM_INVALID, message);
        return normalized;
    }

    private Integer normalizeStatus(Integer status) {
        if (status == null) return HomepageShowcaseRecords.STATUS_ENABLED;
        if (status == 0 || status == 1) return status;
        throw new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.invalidStatus"));
    }

    private String required(String value, SystemMessage message) {
        String normalized = normalizeText(value);
        if (normalized.isBlank()) throw new BusinessException(ErrorCode.PARAM_INVALID, message);
        return normalized;
    }

    private String normalizeText(String value) {
        return value == null ? "" : value.trim();
    }

    private HomepageShowcaseDtos.ShowcaseItem toItem(HomepageShowcaseRecords.ShowcaseRecord record) {
        return new HomepageShowcaseDtos.ShowcaseItem(record.getId(), record.getTitle(), record.getDescription(), record.getCategory(), record.getCreatorName(), record.getMediaType(), record.getMediaUrl(), record.getThumbnailUrl(), record.getTargetType(), record.getTargetPath(), record.getPromptContent(), record.getSortOrder(), record.getStatus(), record.getCreatedAt() == null ? null : record.getCreatedAt().toString(), record.getUpdatedAt() == null ? null : record.getUpdatedAt().toString());
    }
}
