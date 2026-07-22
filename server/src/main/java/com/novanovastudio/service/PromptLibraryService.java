package com.novanovastudio.service;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.PromptLibraryDtos;
import com.novanovastudio.entity.PromptLibraryRecords;
import com.novanovastudio.repository.PromptLibraryRepository;
import com.novanovastudio.security.CurrentUserProvider;
import java.util.List;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;

/**
 * @title        PromptLibraryService.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  提示词库服务
 * @createTime   2026-06-29 22:25:00
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class PromptLibraryService {

    /** 默认排序值 */
    private static final int DEFAULT_SORT_ORDER = 1000;

    /** 最大分页数量 */
    private static final int MAX_PAGE_SIZE = 100;

    /** 提示词库仓储 */
    private final PromptLibraryRepository repository;

    /** 当前用户提供器 */
    private final CurrentUserProvider currentUserProvider;

    /**
     * 查询用户侧提示词列表。
     *
     * @param request PromptListRequest 查询请求
     * @return Mono<PromptListResponse> 提示词列表响应
     */
    public Mono<PromptLibraryDtos.PromptListResponse> listUserPrompts(PromptLibraryDtos.PromptListRequest request) {
        PromptLibraryDtos.PromptListRequest normalized = normalizeListRequest(request, PromptLibraryRecords.STATUS_ENABLED);
        return listPrompts(normalized, true);
    }

    /**
     * 查询管理端提示词列表。
     *
     * @param request PromptListRequest 查询请求
     * @return Mono<PromptListResponse> 提示词列表响应
     */
    public Mono<PromptLibraryDtos.PromptListResponse> listAdminPrompts(PromptLibraryDtos.PromptListRequest request) {
        PromptLibraryDtos.PromptListRequest normalized = normalizeListRequest(request, request.status());
        return listPrompts(normalized, false);
    }

    /**
     * 创建提示词。
     *
     * @param request CreatePromptRequest 创建请求
     * @return Mono<Void> 创建结果
     */
    public Mono<Void> createPrompt(PromptLibraryDtos.CreatePromptRequest request) {
        PromptLibraryRecords.PromptRecord record = buildRecord(request.title(), request.prompt(), request.category(), request.tags(), request.coverUrl(), request.preview(), request.sourceUrl(), request.status(), request.sortOrder());
        return currentUserProvider.currentUserId()
                .flatMap(userId -> {
                    record.setCreatedBy(userId);
                    return repository.createPrompt(record);
                })
                .doOnSuccess(id -> log.info("创建提示词成功: id={}, title={}", id, record.getTitle()))
                .then();
    }

    /**
     * 更新提示词。
     *
     * @param request UpdatePromptRequest 更新请求
     * @return Mono<Void> 更新结果
     */
    public Mono<Void> updatePrompt(PromptLibraryDtos.UpdatePromptRequest request) {
        if (request.id() == null) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "提示词ID不能为空"));
        }
        PromptLibraryRecords.PromptRecord record = buildRecord(request.title(), request.prompt(), request.category(), request.tags(), request.coverUrl(), request.preview(), request.sourceUrl(), request.status(), request.sortOrder());
        record.setId(request.id());
        return repository.updatePrompt(record)
                .doOnSuccess(ignored -> log.info("更新提示词成功: id={}", request.id()));
    }

    /**
     * 更新提示词状态。
     *
     * @param request UpdatePromptStatusRequest 状态请求
     * @return Mono<Void> 更新结果
     */
    public Mono<Void> updatePromptStatus(PromptLibraryDtos.UpdatePromptStatusRequest request) {
        if (request.id() == null) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "提示词ID不能为空"));
        }
        Integer status = normalizeStatus(request.status());
        return repository.updatePromptStatus(request.id(), status)
                .doOnSuccess(ignored -> log.info("更新提示词状态成功: id={}, status={}", request.id(), status));
    }

    /**
     * 删除提示词。
     *
     * @param request DeletePromptsRequest 删除请求
     * @return Mono<Void> 删除结果
     */
    public Mono<Void> deletePrompts(PromptLibraryDtos.DeletePromptsRequest request) {
        List<Long> ids = request.ids() == null ? List.of() : request.ids().stream().filter(id -> id != null && id > 0).distinct().toList();
        if (ids.isEmpty()) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "请选择要删除的提示词"));
        }
        return repository.deletePrompts(ids)
                .doOnSuccess(ignored -> log.info("删除提示词成功: ids={}", ids));
    }

    /**
     * 查询提示词列表。
     *
     * @param request PromptListRequest 查询请求
     * @param userOnly boolean 是否用户侧查询
     * @return Mono<PromptListResponse> 提示词列表响应
     */
    private Mono<PromptLibraryDtos.PromptListResponse> listPrompts(PromptLibraryDtos.PromptListRequest request, boolean userOnly) {
        return Mono.zip(
                repository.listPrompts(request).map(this::toItem).collectList(),
                repository.countPrompts(request),
                repository.listTags(userOnly).collectList(),
                repository.listCategories(userOnly).collectList()
        ).map(tuple -> new PromptLibraryDtos.PromptListResponse(tuple.getT1(), tuple.getT3(), tuple.getT4(), tuple.getT2()));
    }

    /**
     * 构建提示词记录。
     *
     * @param title String 标题
     * @param prompt String 提示词正文
     * @param category String 分类
     * @param tags List<String> 标签列表
     * @param coverUrl String 封面URL
     * @param preview String 预览内容
     * @param sourceUrl String 来源地址
     * @param status Integer 状态
     * @param sortOrder Integer 排序值
     * @return PromptRecord 提示词记录
     */
    private PromptLibraryRecords.PromptRecord buildRecord(String title, String prompt, String category, List<String> tags, String coverUrl, String preview, String sourceUrl, Integer status, Integer sortOrder) {
        String normalizedTitle = required(title, "标题不能为空");
        String normalizedPrompt = required(prompt, "提示词内容不能为空");
        String normalizedCategory = required(category, "分类不能为空");
        PromptLibraryRecords.PromptRecord record = new PromptLibraryRecords.PromptRecord();
        record.setTitle(normalizedTitle);
        record.setPromptContent(normalizedPrompt);
        record.setCategory(normalizedCategory);
        record.setTags(normalizeTags(tags));
        record.setCoverUrl(normalizeText(coverUrl));
        record.setPreviewContent(normalizeText(preview));
        record.setSourceUrl(normalizeText(sourceUrl));
        record.setStatus(normalizeStatus(status));
        record.setSortOrder(sortOrder == null ? DEFAULT_SORT_ORDER : sortOrder);
        return record;
    }

    /**
     * 规范列表请求。
     *
     * @param request PromptListRequest 原始请求
     * @param status Integer 状态
     * @return PromptListRequest 规范后的请求
     */
    private PromptLibraryDtos.PromptListRequest normalizeListRequest(PromptLibraryDtos.PromptListRequest request, Integer status) {
        int page = Math.max(1, request.page());
        int pageSize = Math.max(1, Math.min(MAX_PAGE_SIZE, request.pageSize()));
        Integer normalizedStatus = status == null ? null : normalizeStatus(status);
        return new PromptLibraryDtos.PromptListRequest(normalizeText(request.keyword()), normalizeTags(request.tags()), normalizeText(request.category()), normalizedStatus, page, pageSize);
    }

    /**
     * 规范状态。
     *
     * @param status Integer 状态
     * @return Integer 规范后的状态
     */
    private Integer normalizeStatus(Integer status) {
        if (status == null) return PromptLibraryRecords.STATUS_ENABLED;
        if (status.equals(PromptLibraryRecords.STATUS_ENABLED) || status.equals(PromptLibraryRecords.STATUS_DISABLED)) return status;
        throw new BusinessException(ErrorCode.PARAM_INVALID, "提示词状态不正确");
    }

    /**
     * 规范标签。
     *
     * @param tags List<String> 标签列表
     * @return List<String> 规范后的标签列表
     */
    private List<String> normalizeTags(List<String> tags) {
        if (tags == null) return List.of();
        return tags.stream().filter(tag -> tag != null && !tag.isBlank()).map(String::trim).distinct().toList();
    }

    /**
     * 校验必填文本。
     *
     * @param value String 文本值
     * @param message String 错误消息
     * @return String 规范后的文本
     */
    private String required(String value, String message) {
        String normalized = normalizeText(value);
        if (normalized.isBlank()) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, message);
        }
        return normalized;
    }

    /**
     * 规范文本。
     *
     * @param value String 文本值
     * @return String 规范后的文本
     */
    private String normalizeText(String value) {
        return value == null ? "" : value.trim();
    }

    /**
     * 转换提示词记录为响应条目。
     *
     * @param record PromptRecord 提示词记录
     * @return PromptItem 响应条目
     */
    private PromptLibraryDtos.PromptItem toItem(PromptLibraryRecords.PromptRecord record) {
        return new PromptLibraryDtos.PromptItem(
                record.getId(),
                record.getTitle(),
                record.getCoverUrl(),
                record.getPromptContent(),
                record.getTags(),
                record.getCategory(),
                record.getSourceUrl(),
                record.getPreviewContent(),
                record.getStatus(),
                record.getSortOrder(),
                record.getCreatedAt() == null ? null : record.getCreatedAt().toString(),
                record.getUpdatedAt() == null ? null : record.getUpdatedAt().toString()
        );
    }
}
