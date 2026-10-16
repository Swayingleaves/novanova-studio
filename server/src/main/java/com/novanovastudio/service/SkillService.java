package com.novanovastudio.service;

import com.novanovastudio.common.SystemMessage;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.SkillDtos;
import com.novanovastudio.entity.SkillRecords;
import com.novanovastudio.agent.workflow.VideoWorkflowRegistry;
import com.novanovastudio.repository.SkillRepository;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Mono;

/**
 * 图片和视频生成技能业务服务。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-08-27 00:00
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class SkillService {

    /** 默认排序值。 */
    private static final int DEFAULT_SORT_ORDER = 1000;
    /** 最大分页数量。 */
    private static final int MAX_PAGE_SIZE = 100;

    /** 技能仓储。 */
    private final SkillRepository repository;
    /** 视频工作流注册表。 */
    private final VideoWorkflowRegistry videoWorkflowRegistry;

    /**
     * 查询用户侧启用技能。
     *
     * @param targetType 适用生成类型
     * @return 用户侧技能列表
     */
    public Mono<SkillDtos.SkillOptionListResponse> listUserSkills(String targetType) {
        String type = normalizeTargetType(targetType);
        SkillDtos.SkillListRequest request = new SkillDtos.SkillListRequest("", type, null, 1, MAX_PAGE_SIZE);
        return repository.listSkills(request, true)
                .map(this::toOption)
                .collectList()
                .map(SkillDtos.SkillOptionListResponse::new);
    }

    /**
     * 查询管理端技能列表。
     *
     * @param request 管理端查询请求
     * @return 管理端技能列表
     */
    public Mono<SkillDtos.SkillListResponse> listAdminSkills(SkillDtos.SkillListRequest request) {
        SkillDtos.SkillListRequest normalized = normalizeListRequest(request);
        return Mono.zip(repository.listSkills(normalized, false).map(this::toItem).collectList(), repository.countSkills(normalized, false))
                .map(tuple -> new SkillDtos.SkillListResponse(tuple.getT1(), tuple.getT2()));
    }

    /**
     * 按ID加载启用技能，供主Agent编排器注入流程提示词。
     *
     * @param id 技能ID
     * @return 技能记录
     */
    public Mono<SkillRecords.SkillRecord> findEnabledSkill(Long id) {
        if (id == null || id <= 0) {
            return Mono.error(invalid(SystemMessage.of("business.invalidSkillID")));
        }
        return repository.findEnabledById(id)
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, SystemMessage.of("business.skillNotFoundOrDisabled"))));
    }

    /**
     * 创建技能。
     *
     * @param request 创建请求
     * @return 操作完成信号
     */
    public Mono<Void> createSkill(SkillDtos.CreateSkillRequest request) {
        SkillRecords.SkillRecord record = buildRecord(
                request.name(), request.description(), request.targetType(), request.systemPrompt(), request.aspectRatio(), request.coverUrl(), request.status(), request.sortOrder());
        return repository.createSkill(record)
                .doOnSuccess(id -> log.info("创建技能成功: id={}, type={}", id, record.getTargetType()))
                .then();
    }

    /**
     * 更新技能。
     *
     * @param request 更新请求
     * @return 操作完成信号
     */
    public Mono<Void> updateSkill(SkillDtos.UpdateSkillRequest request) {
        if (request.id() == null || request.id() <= 0) {
            return Mono.error(invalid(SystemMessage.of("business.skillIDIsRequired")));
        }
        SkillRecords.SkillRecord record = buildRecord(
                request.name(), request.description(), request.targetType(), request.systemPrompt(), request.aspectRatio(), request.coverUrl(), request.status(), request.sortOrder());
        record.setId(request.id());
        return repository.updateSkill(record)
                .flatMap(rows -> rows > 0 ? Mono.<Void>empty() : Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, SystemMessage.of("business.skillNotFound"))))
                .doOnSuccess(ignored -> log.info("更新技能成功: id={}", request.id()));
    }

    /**
     * 更新技能状态。
     *
     * @param request 状态请求
     * @return 操作完成信号
     */
    public Mono<Void> updateSkillStatus(SkillDtos.UpdateSkillStatusRequest request) {
        if (request.id() == null || request.id() <= 0) {
            return Mono.error(invalid(SystemMessage.of("business.skillIDIsRequired")));
        }
        int status = normalizeStatus(request.status());
        return repository.updateSkillStatus(request.id(), status)
                .flatMap(rows -> rows > 0 ? Mono.<Void>empty() : Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, SystemMessage.of("business.skillNotFound"))))
                .doOnSuccess(ignored -> log.info("更新技能状态成功: id={}, status={}", request.id(), status));
    }

    /**
     * 批量软删除技能。
     *
     * @param request 删除请求
     * @return 操作完成信号
     */
    public Mono<Void> deleteSkills(SkillDtos.DeleteSkillsRequest request) {
        List<Long> ids = request.ids() == null ? List.of() : request.ids().stream()
                .filter(Objects::nonNull)
                .filter(id -> id > 0)
                .distinct()
                .toList();
        if (ids.isEmpty()) {
            return Mono.error(invalid(SystemMessage.of("business.selectSkillsToDelete")));
        }
        return repository.deleteSkills(ids).doOnSuccess(ignored -> log.info("删除技能成功: ids={}", ids));
    }

    /** 规范化适用类型。 */
    private String normalizeTargetType(String targetType) {
        String type = targetType == null ? "" : targetType.trim().toLowerCase(Locale.ROOT);
        return switch (type) {
            case "image" -> SkillRecords.TYPE_IMAGE;
            case "video" -> SkillRecords.TYPE_VIDEO;
            case "canvassettinggraph" -> SkillRecords.TYPE_CANVAS_SETTING_GRAPH;
            default -> throw invalid(SystemMessage.of("business.skillTypeMustBeImageVideoOrCanvasSettingGraph"));
        };
    }

    /** 规范化状态。 */
    private int normalizeStatus(Integer status) {
        int value = status == null ? SkillRecords.STATUS_ENABLED : status;
        if (value != SkillRecords.STATUS_ENABLED && value != SkillRecords.STATUS_DISABLED) {
            throw invalid(SystemMessage.of("business.skillStatusMustBeEnabledOrDisabled"));
        }
        return value;
    }

    /** 构建技能记录。 */
    private SkillRecords.SkillRecord buildRecord(String name, String description, String targetType, String systemPrompt,
                                                  String aspectRatio, String coverUrl, Integer status, Integer sortOrder) {
        SkillRecords.SkillRecord record = new SkillRecords.SkillRecord();
        record.setName(required(name, SystemMessage.of("business.skillNameIsRequired")));
        record.setDescription(description == null ? "" : description.trim());
        record.setTargetType(normalizeTargetType(targetType));
        record.setSystemPrompt(required(systemPrompt, SystemMessage.of("business.skillSystemPromptIsRequired")));
        record.setAspectRatio(normalizeAspectRatio(aspectRatio));
        record.setCoverUrl(coverUrl == null ? "" : coverUrl.trim());
        record.setStatus(normalizeStatus(status));
        if (sortOrder != null && sortOrder < 0) {
            throw invalid(SystemMessage.of("business.skillSortOrderMustNotBeNegative"));
        }
        record.setSortOrder(sortOrder == null ? DEFAULT_SORT_ORDER : sortOrder);
        return record;
    }

    /** 规范化默认生成比例。 */
    private String normalizeAspectRatio(String aspectRatio) {
        String value = StringUtils.hasText(aspectRatio) ? aspectRatio.trim() : "16:9";
        if (!value.matches("\\d+(?::\\d+)?")) {
            throw invalid(SystemMessage.of("business.invalidDefaultAspectRatioEG169"));
        }
        String[] parts = value.split(":");
        try {
            if (parts.length != 2 || Integer.parseInt(parts[0]) <= 0 || Integer.parseInt(parts[1]) <= 0) {
                throw invalid(SystemMessage.of("business.defaultAspectRatioMustHavePositiveDimensionsEG16"));
            }
        } catch (NumberFormatException exception) {
            throw invalid(SystemMessage.of("business.defaultAspectRatioMustHavePositiveDimensionsEG16"));
        }
        return value;
    }

    /** 规范化列表请求。 */
    private SkillDtos.SkillListRequest normalizeListRequest(SkillDtos.SkillListRequest request) {
        SkillDtos.SkillListRequest source = request == null
                ? new SkillDtos.SkillListRequest("", "all", null, 1, 20) : request;
        String type = source.targetType() == null || source.targetType().isBlank()
                || "all".equalsIgnoreCase(source.targetType()) ? "all" : normalizeTargetType(source.targetType());
        Integer status = source.status();
        if (status != null && status != 0 && status != 1) {
            throw invalid(SystemMessage.of("business.skillStatusMustBeEnabledOrDisabled"));
        }
        return new SkillDtos.SkillListRequest(source.keyword() == null ? "" : source.keyword().trim(), type,
                status, Math.max(1, source.page()), Math.min(MAX_PAGE_SIZE, Math.max(1, source.pageSize())));
    }

    /** 技能记录转用户选项。 */
    private SkillDtos.SkillOption toOption(SkillRecords.SkillRecord record) {
        String workflowType = "video".equals(record.getTargetType())
                ? videoWorkflowRegistry.resolveWorkflowType(record.getSystemPrompt()).orElse(null) : null;
        String systemPrompt = SkillRecords.TYPE_CANVAS_SETTING_GRAPH.equals(record.getTargetType()) ? record.getSystemPrompt() : null;
        return new SkillDtos.SkillOption(record.getId(), record.getName(), record.getDescription(), record.getTargetType(),
                record.getCoverUrl(), workflowType, systemPrompt, record.getAspectRatio());
    }

    /** 技能记录转管理端条目。 */
    private SkillDtos.SkillItem toItem(SkillRecords.SkillRecord record) {
        return new SkillDtos.SkillItem(record.getId(), record.getName(), record.getDescription(), record.getTargetType(), record.getSystemPrompt(), record.getCoverUrl(),
                record.getAspectRatio(), record.getStatus(), record.getSortOrder(), formatTime(record.getCreatedAt()), formatTime(record.getUpdatedAt()));
    }

    /** 必填文本。 */
    private String required(String value, SystemMessage message) {
        if (!StringUtils.hasText(value)) {
            throw invalid(message);
        }
        return value.trim();
    }

    /** 格式化时间。 */
    private String formatTime(java.time.OffsetDateTime value) {
        return value == null ? null : value.toString();
    }

    /** 构建参数异常。 */
    private BusinessException invalid(SystemMessage message) {
        return new BusinessException(ErrorCode.PARAM_INVALID, message);
    }
}
