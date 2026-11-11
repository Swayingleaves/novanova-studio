package com.novanovastudio.service;

import com.alibaba.fastjson2.JSON;
import com.novanovastudio.agent.workflow.VideoWorkflowRegistry;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.common.SystemMessage;
import com.novanovastudio.dto.SkillDtos;
import com.novanovastudio.entity.SkillRecords;
import com.novanovastudio.repository.SkillRepository;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.storage.MediaAccessService;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.Set;
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
    /** 市场分类。 */
    private static final Set<String> CATEGORIES = Set.of(
            SkillRecords.CATEGORY_IMAGE, SkillRecords.CATEGORY_VIDEO, SkillRecords.CATEGORY_ECOMMERCE,
            SkillRecords.CATEGORY_PORTRAIT, SkillRecords.CATEGORY_VIRAL);
    /** 我的技能列表范围。 */
    private static final Set<String> MINE_TABS = Set.of("created", "favorite");

    /** 技能仓储。 */
    private final SkillRepository repository;
    /** 视频工作流注册表。 */
    private final VideoWorkflowRegistry videoWorkflowRegistry;
    /** 私有存储桶读地址签发。 */
    private final MediaAccessService mediaAccessService;
    /** 当前登录用户。 */
    private final CurrentUserProvider currentUserProvider;

    /**
     * 查询创作页可选技能。
     *
     * @param targetType 适用生成类型
     * @return 用户侧技能列表
     */
    public Mono<SkillDtos.SkillOptionListResponse> listUserSkills(String targetType) {
        String type = normalizeTargetType(targetType);
        return currentUserProvider.optionalCurrentUser()
                .map(user -> user.id())
                .flatMap(userId -> loadComposerSkills(type, userId))
                .switchIfEmpty(Mono.defer(() -> loadComposerSkills(type, null)));
    }

    /**
     * 查询管理端技能列表。
     *
     * @param request 管理端查询请求
     * @return 管理端技能列表
     */
    public Mono<SkillDtos.SkillListResponse> listAdminSkills(SkillDtos.SkillListRequest request) {
        SkillDtos.SkillListRequest normalized = normalizeListRequest(request);
        return Mono.zip(repository.listSkills(normalized, false).concatMap(this::toItem).collectList(), repository.countSkills(normalized, false))
                .map(tuple -> new SkillDtos.SkillListResponse(tuple.getT1(), tuple.getT2()));
    }

    /**
     * 查询技能市场。
     *
     * @param category 市场分类
     * @param keyword 关键词
     * @param page 页码
     * @param pageSize 每页数量
     * @return 市场列表
     */
    public Mono<SkillDtos.SkillMarketListResponse> listMarketSkills(String category, String keyword, int page, int pageSize) {
        String normalizedCategory = normalizeOptionalCategory(category);
        String normalizedKeyword = normalizeKeyword(keyword);
        int normalizedPage = Math.max(1, page);
        int normalizedPageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, pageSize));
        int offset = (normalizedPage - 1) * normalizedPageSize;
        return currentUserProvider.currentUserId().flatMap(userId -> Mono.zip(
                repository.listMarketSkills(userId, normalizedCategory, normalizedKeyword, normalizedPageSize, offset).concatMap(this::toCard).collectList(),
                repository.countMarketSkills(normalizedCategory, normalizedKeyword))
                .map(tuple -> new SkillDtos.SkillMarketListResponse(tuple.getT1(), tuple.getT2())));
    }

    /**
     * 查询技能详情。未发布技能只有作者可以查看。
     *
     * @param id 技能ID
     * @return 技能详情
     */
    public Mono<SkillDtos.SkillDetail> getSkillDetail(Long id) {
        if (id == null || id <= 0) {
            return Mono.error(invalid(SystemMessage.of("business.invalidSkillID")));
        }
        return currentUserProvider.currentUserId().flatMap(userId -> repository.findVisibleById(id, userId)
                .filter(skill -> canView(skill, userId))
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, SystemMessage.of("business.skillNotFound"))))
                .flatMap(skill -> {
                    Mono<List<SkillDtos.SkillMarketCard>> related = StringUtils.hasText(skill.getCategory())
                            ? repository.listRelatedSkills(userId, skill.getCategory(), skill.getId()).concatMap(this::toCard).collectList()
                            : Mono.just(List.of());
                    return Mono.zip(toCard(skill), related)
                            .map(tuple -> toDetail(skill, userId, tuple.getT1(), tuple.getT2()));
                }));
    }

    /**
     * 查询我创建或收藏的技能。
     *
     * @param tab created 或 favorite
     * @param keyword 关键词
     * @param page 页码
     * @param pageSize 每页数量
     * @return 我的技能列表
     */
    public Mono<SkillDtos.SkillMineListResponse> listMySkills(String tab, String keyword, int page, int pageSize) {
        String normalizedTab = tab == null ? "" : tab.trim().toLowerCase(Locale.ROOT);
        if (!MINE_TABS.contains(normalizedTab)) {
            return Mono.error(invalid(SystemMessage.of("business.invalidSkillList")));
        }
        String normalizedKeyword = normalizeKeyword(keyword);
        int normalizedPage = Math.max(1, page);
        int normalizedPageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, pageSize));
        int offset = (normalizedPage - 1) * normalizedPageSize;
        return currentUserProvider.currentUserId().flatMap(userId -> {
            Mono<List<SkillDtos.SkillMineCard>> skills = ("favorite".equals(normalizedTab)
                    ? repository.listFavoriteSkills(userId, normalizedKeyword, normalizedPageSize, offset)
                    : repository.listOwnedSkills(userId, normalizedKeyword, normalizedPageSize, offset))
                    .concatMap(record -> toMineCard(record, userId))
                    .collectList();
            Mono<Long> total = "favorite".equals(normalizedTab)
                    ? repository.countFavoriteSkills(userId, normalizedKeyword)
                    : repository.countOwnedSkills(userId, normalizedKeyword);
            return Mono.zip(skills, total).map(tuple -> new SkillDtos.SkillMineListResponse(tuple.getT1(), tuple.getT2()));
        });
    }

    /**
     * 按ID加载当前用户可用的启用技能，供主Agent编排器注入流程提示词。
     *
     * @param id 技能ID
     * @param userId 当前用户ID
     * @return 技能记录
     */
    public Mono<SkillRecords.SkillRecord> findUsableSkill(Long id, Long userId) {
        if (id == null || id <= 0) {
            return Mono.error(invalid(SystemMessage.of("business.invalidSkillID")));
        }
        return repository.findEnabledById(id)
                .filter(skill -> canUse(skill, userId))
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, SystemMessage.of("business.skillNotFoundOrDisabled"))));
    }

    /**
     * 创建官方技能。
     *
     * @param request 创建请求
     * @return 操作完成信号
     */
    public Mono<Void> createSkill(SkillDtos.CreateSkillRequest request) {
        SkillRecords.SkillRecord record = buildRecord(
                request.name(), request.description(), request.targetType(), request.systemPrompt(), request.aspectRatio(), request.coverUrl(), request.status(), request.sortOrder());
        applyMarketFields(record, request.category(), request.subtitle(), request.audience(), request.usageSteps(), false);
        record.setOwnerUserId(null);
        record.setReviewStatus(SkillRecords.REVIEW_PUBLISHED);
        record.setRejectReason("");
        record.setWorkflowId(normalizeWorkflowId(request.workflowId()));
        return ensureUniqueWorkflowId(record.getWorkflowId(), null)
                .then(repository.createSkill(record))
                .doOnSuccess(id -> log.info("创建技能成功: id={}, type={}", id, record.getTargetType()))
                .then();
    }

    /**
     * 更新技能。管理员修改不改变作者和审核状态。
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
        applyMarketFields(record, request.category(), request.subtitle(), request.audience(), request.usageSteps(), false);
        record.setId(request.id());
        record.setWorkflowId(normalizeWorkflowId(request.workflowId()));
        return ensureUniqueWorkflowId(record.getWorkflowId(), request.id())
                .then(repository.updateSkill(record))
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

    /**
     * 用户创建技能，默认仅自己可见。
     *
     * @param request 创建请求
     * @return 操作完成信号
     */
    public Mono<Void> createUserSkill(SkillDtos.SaveUserSkillRequest request) {
        return currentUserProvider.currentUserId().flatMap(userId -> {
            SkillRecords.SkillRecord record = buildUserRecord(request);
            record.setOwnerUserId(userId);
            record.setStatus(SkillRecords.STATUS_ENABLED);
            record.setSortOrder(DEFAULT_SORT_ORDER);
            record.setReviewStatus(SkillRecords.REVIEW_PRIVATE);
            record.setRejectReason("");
            record.setWorkflowId(normalizeWorkflowId(request.workflowId()));
            return ensureUniqueWorkflowId(record.getWorkflowId(), null)
                    .then(repository.createSkill(record))
                    .doOnSuccess(id -> log.info("用户创建技能成功: id={}, userId={}", id, userId))
                    .then();
        });
    }

    /**
     * 用户更新自己的技能。已发布技能只保存待审核更新，线上版本继续可用。
     *
     * @param request 更新请求
     * @return 操作完成信号
     */
    public Mono<Void> updateUserSkill(SkillDtos.SaveUserSkillRequest request) {
        if (request.id() == null || request.id() <= 0) {
            return Mono.error(invalid(SystemMessage.of("business.skillIDIsRequired")));
        }
        return currentUserProvider.currentUserId().flatMap(userId -> repository.findVisibleById(request.id(), userId)
                .filter(skill -> userId.equals(skill.getOwnerUserId()))
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, SystemMessage.of("business.skillNotOwned"))))
                .flatMap(existing -> {
                    SkillRecords.SkillRecord record = buildUserRecord(request);
                    record.setId(existing.getId());
                    record.setWorkflowId(normalizeWorkflowId(request.workflowId()));
                    return ensureUniqueWorkflowId(record.getWorkflowId(), existing.getId()).then(Mono.defer(() -> {
                        if (SkillRecords.REVIEW_PUBLISHED.equals(existing.getReviewStatus())) {
                            return repository.savePendingRevision(existing.getId(), userId, JSON.toJSONString(toStoredRevision(record)))
                                    .flatMap(rows -> rows > 0 ? Mono.<Void>empty() : Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, SystemMessage.of("business.skillNotOwned"))))
                                    .doOnSuccess(ignored -> log.info("已发布技能提交更新审核: id={}, userId={}", request.id(), userId));
                        }
                        record.setReviewStatus(existing.getReviewStatus());
                        record.setRejectReason(existing.getRejectReason());
                        return repository.updateOwnedSkill(record, userId)
                                .flatMap(rows -> rows > 0 ? Mono.<Void>empty() : Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, SystemMessage.of("business.skillNotOwned"))))
                                .doOnSuccess(ignored -> log.info("用户更新技能成功: id={}, userId={}, reviewStatus={}", request.id(), userId, record.getReviewStatus()));
                    }));
                }));
    }

    /**
     * 用户删除自己的技能。
     *
     * @param id 技能ID
     * @return 操作完成信号
     */
    public Mono<Void> deleteUserSkill(Long id) {
        if (id == null || id <= 0) {
            return Mono.error(invalid(SystemMessage.of("business.skillIDIsRequired")));
        }
        return currentUserProvider.currentUserId().flatMap(userId -> repository.deleteOwnedSkill(id, userId)
                .flatMap(rows -> rows > 0 ? Mono.<Void>empty() : Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, SystemMessage.of("business.skillNotOwned"))))
                .doOnSuccess(ignored -> log.info("用户删除技能成功: id={}, userId={}", id, userId)));
    }

    /**
     * 提交技能审核。
     *
     * @param id 技能ID
     * @return 操作完成信号
     */
    public Mono<Void> submitSkillReview(Long id) {
        if (id == null || id <= 0) {
            return Mono.error(invalid(SystemMessage.of("business.skillIDIsRequired")));
        }
        return currentUserProvider.currentUserId().flatMap(userId -> repository.submitReview(id, userId)
                .flatMap(rows -> rows > 0 ? Mono.<Void>empty() : Mono.error(invalid(SystemMessage.of("business.skillCannotBeSubmitted"))))
                .doOnSuccess(ignored -> log.info("提交技能审核: id={}, userId={}", id, userId)));
    }

    /**
     * 撤回技能，退出市场。
     *
     * @param id 技能ID
     * @return 操作完成信号
     */
    public Mono<Void> withdrawSkill(Long id) {
        if (id == null || id <= 0) {
            return Mono.error(invalid(SystemMessage.of("business.skillIDIsRequired")));
        }
        return currentUserProvider.currentUserId().flatMap(userId -> repository.withdrawSkill(id, userId)
                .flatMap(rows -> rows > 0 ? Mono.<Void>empty() : Mono.error(invalid(SystemMessage.of("business.skillCannotBeWithdrawn"))))
                .doOnSuccess(ignored -> log.info("撤回技能: id={}, userId={}", id, userId)));
    }

    /**
     * 审核用户提交的技能。
     *
     * @param request 审核请求
     * @return 操作完成信号
     */
    public Mono<Void> reviewSkill(SkillDtos.ReviewSkillRequest request) {
        if (request.id() == null || request.id() <= 0) {
            return Mono.error(invalid(SystemMessage.of("business.skillIDIsRequired")));
        }
        if (request.approved() == null) {
            return Mono.error(invalid(SystemMessage.of("business.skillIsNotPendingReview")));
        }
        String reason = request.reason() == null ? "" : request.reason().trim();
        if (reason.length() > 500) {
            return Mono.error(invalid(SystemMessage.of("business.skillRejectReasonIsTooLong")));
        }
        boolean approved = Boolean.TRUE.equals(request.approved());
        String storedReason = approved ? "" : reason;
        return repository.findAnyById(request.id()).switchIfEmpty(Mono.error(invalid(SystemMessage.of("business.skillIsNotPendingReview"))))
                .flatMap(existing -> {
                    if (SkillRecords.REVIEW_PUBLISHED.equals(existing.getReviewStatus())
                            && SkillRecords.REVISION_PENDING.equals(existing.getRevisionStatus())) {
                        if (!approved) {
                            return repository.rejectPendingRevision(existing.getId(), storedReason)
                                    .flatMap(rows -> rows > 0 ? Mono.<Void>empty() : Mono.error(invalid(SystemMessage.of("business.skillIsNotPendingReview"))));
                        }
                        SkillRecords.SkillRecord revision = fromStoredRevision(existing.getPendingRevision());
                        return ensureUniqueWorkflowId(revision.getWorkflowId(), existing.getId())
                                .then(repository.applyPendingRevision(existing.getId(), revision))
                                .flatMap(rows -> rows > 0 ? Mono.<Void>empty() : Mono.error(invalid(SystemMessage.of("business.skillIsNotPendingReview"))));
                    }
                    if (!SkillRecords.REVIEW_PENDING.equals(existing.getReviewStatus())) {
                        return Mono.error(invalid(SystemMessage.of("business.skillIsNotPendingReview")));
                    }
                    String reviewStatus = approved ? SkillRecords.REVIEW_PUBLISHED : SkillRecords.REVIEW_REJECTED;
                    return repository.reviewSkill(existing.getId(), reviewStatus, storedReason)
                            .flatMap(rows -> rows > 0 ? Mono.<Void>empty() : Mono.error(invalid(SystemMessage.of("business.skillIsNotPendingReview"))));
                })
                .doOnSuccess(ignored -> log.info("审核技能: id={}, approved={}", request.id(), approved));
    }

    /**
     * 收藏已发布技能。
     *
     * @param id 技能ID
     * @return 操作完成信号
     */
    public Mono<Void> favoriteSkill(Long id) {
        if (id == null || id <= 0) {
            return Mono.error(invalid(SystemMessage.of("business.skillIDIsRequired")));
        }
        return currentUserProvider.currentUserId().flatMap(userId -> repository.isFavoritable(id)
                .flatMap(favoritable -> Boolean.TRUE.equals(favoritable)
                        ? repository.favoriteSkill(userId, id)
                        : Mono.error(invalid(SystemMessage.of("business.onlyPublishedSkillsCanBeFavorited"))))
                .doOnSuccess(ignored -> log.info("收藏技能: id={}, userId={}", id, userId)));
    }

    /**
     * 取消收藏。
     *
     * @param id 技能ID
     * @return 操作完成信号
     */
    public Mono<Void> unfavoriteSkill(Long id) {
        if (id == null || id <= 0) {
            return Mono.error(invalid(SystemMessage.of("business.skillIDIsRequired")));
        }
        return currentUserProvider.currentUserId().flatMap(userId -> repository.unfavoriteSkill(userId, id)
                .doOnSuccess(ignored -> log.info("取消收藏技能: id={}, userId={}", id, userId)));
    }

    /** 加载创作页技能。 */
    private Mono<SkillDtos.SkillOptionListResponse> loadComposerSkills(String targetType, Long userId) {
        return repository.listComposerSkills(targetType, userId)
                .concatMap(this::toOption)
                .collectList()
                .map(SkillDtos.SkillOptionListResponse::new);
    }

    /** 官方技能、已发布技能，或当前用户自己的技能可以使用。 */
    private boolean canUse(SkillRecords.SkillRecord skill, Long userId) {
        if (skill.getOwnerUserId() == null || SkillRecords.REVIEW_PUBLISHED.equals(skill.getReviewStatus())) {
            return true;
        }
        return userId != null && userId.equals(skill.getOwnerUserId());
    }

    /** 已发布市场技能任何人可见，其余只有作者可见。 */
    private boolean canView(SkillRecords.SkillRecord skill, Long userId) {
        if (userId != null && userId.equals(skill.getOwnerUserId())) {
            return true;
        }
        return SkillRecords.REVIEW_PUBLISHED.equals(skill.getReviewStatus())
                && Objects.equals(skill.getStatus(), SkillRecords.STATUS_ENABLED)
                && StringUtils.hasText(skill.getCategory());
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

    /** 用户技能只允许图片或视频。 */
    private String normalizeUserTargetType(String targetType) {
        String type = normalizeTargetType(targetType);
        if (SkillRecords.TYPE_CANVAS_SETTING_GRAPH.equals(type)) {
            throw invalid(SystemMessage.of("business.skillCategoryDoesNotMatchTarget"));
        }
        return type;
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
        record.setName(limit(required(name, SystemMessage.of("business.skillNameIsRequired")), 100, SystemMessage.of("business.skillNameIsRequired")));
        record.setDescription(limit(description == null ? "" : description.trim(), 4000, SystemMessage.of("business.skillDescriptionIsTooLong")));
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

    /** 构建用户技能内容。 */
    private SkillRecords.SkillRecord buildUserRecord(SkillDtos.SaveUserSkillRequest request) {
        SkillRecords.SkillRecord record = new SkillRecords.SkillRecord();
        record.setName(limit(required(request.name(), SystemMessage.of("business.skillNameIsRequired")), 100, SystemMessage.of("business.skillNameIsRequired")));
        record.setDescription(limit(request.description() == null ? "" : request.description().trim(), 4000, SystemMessage.of("business.skillDescriptionIsTooLong")));
        record.setTargetType(normalizeUserTargetType(request.targetType()));
        record.setSystemPrompt(required(request.systemPrompt(), SystemMessage.of("business.skillSystemPromptIsRequired")));
        record.setAspectRatio(normalizeAspectRatio(request.aspectRatio()));
        record.setCoverUrl(request.coverUrl() == null ? "" : request.coverUrl().trim());
        applyMarketFields(record, request.category(), request.subtitle(), request.audience(), request.usageSteps(), true);
        return record;
    }

    /** 写入市场展示字段。 */
    private void applyMarketFields(SkillRecords.SkillRecord record, String category, String subtitle, String audience,
                                   List<SkillDtos.SkillUsageStep> usageSteps, boolean categoryRequired) {
        record.setCategory(normalizeCategory(category, record.getTargetType(), categoryRequired));
        record.setSubtitle(limit(subtitle == null ? "" : subtitle.trim(), 200, SystemMessage.of("business.skillSubtitleIsTooLong")));
        record.setAudience(limit(audience == null ? "" : audience.trim(), 1000, SystemMessage.of("business.skillAudienceIsTooLong")));
        record.setUsageSteps(normalizeUsageSteps(usageSteps));
    }

    /** 规范化市场分类。图片和视频分类锁定创作去向，画布技能不能进入市场。 */
    private String normalizeCategory(String category, String targetType, boolean required) {
        String value = category == null ? "" : category.trim();
        if (SkillRecords.TYPE_CANVAS_SETTING_GRAPH.equals(targetType)) {
            if (StringUtils.hasText(value)) {
                throw invalid(SystemMessage.of("business.skillCategoryDoesNotMatchTarget"));
            }
            return null;
        }
        if (!StringUtils.hasText(value)) {
            if (required) {
                throw invalid(SystemMessage.of("business.skillCategoryIsRequired"));
            }
            return null;
        }
        if (!CATEGORIES.contains(value)) {
            throw invalid(SystemMessage.of("business.invalidSkillCategory"));
        }
        if (SkillRecords.CATEGORY_IMAGE.equals(value) && !SkillRecords.TYPE_IMAGE.equals(targetType)) {
            throw invalid(SystemMessage.of("business.skillCategoryDoesNotMatchTarget"));
        }
        if (SkillRecords.CATEGORY_VIDEO.equals(value) && !SkillRecords.TYPE_VIDEO.equals(targetType)) {
            throw invalid(SystemMessage.of("business.skillCategoryDoesNotMatchTarget"));
        }
        return value;
    }

    /** 空分类表示全部。 */
    private String normalizeOptionalCategory(String category) {
        if (!StringUtils.hasText(category) || "all".equalsIgnoreCase(category.trim())) {
            return "";
        }
        String value = category.trim();
        if (!CATEGORIES.contains(value)) {
            throw invalid(SystemMessage.of("business.invalidSkillCategory"));
        }
        return value;
    }

    /** 规范化搜索词。 */
    private String normalizeKeyword(String keyword) {
        String value = keyword == null ? "" : keyword.trim();
        return value.length() > 100 ? value.substring(0, 100) : value;
    }

    /** 规范化使用步骤。 */
    private String normalizeUsageSteps(List<SkillDtos.SkillUsageStep> steps) {
        List<SkillDtos.SkillUsageStep> normalized = new ArrayList<>();
        for (SkillDtos.SkillUsageStep step : steps == null ? List.<SkillDtos.SkillUsageStep>of() : steps) {
            if (step == null) {
                continue;
            }
            String title = step.title() == null ? "" : step.title().trim();
            String detail = step.detail() == null ? "" : step.detail().trim();
            if (title.isEmpty() && detail.isEmpty()) {
                continue;
            }
            if (title.length() > 40 || detail.length() > 300) {
                throw invalid(SystemMessage.of("business.skillUsageStepIsTooLong"));
            }
            normalized.add(new SkillDtos.SkillUsageStep(title, detail));
        }
        if (normalized.size() > 3) {
            throw invalid(SystemMessage.of("business.tooManySkillUsageSteps"));
        }
        return JSON.toJSONString(normalized);
    }

    /** 读取使用步骤。 */
    private List<SkillDtos.SkillUsageStep> parseUsageSteps(String json) {
        if (!StringUtils.hasText(json)) {
            return List.of();
        }
        try {
            List<SkillDtos.SkillUsageStep> steps = JSON.parseArray(json, SkillDtos.SkillUsageStep.class);
            return steps == null ? List.of() : steps;
        } catch (RuntimeException exception) {
            return List.of();
        }
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
                ? new SkillDtos.SkillListRequest("", "all", null, 1, 20, "all") : request;
        String type = source.targetType() == null || source.targetType().isBlank()
                || "all".equalsIgnoreCase(source.targetType()) ? "all" : normalizeTargetType(source.targetType());
        Integer status = source.status();
        if (status != null && status != 0 && status != 1) {
            throw invalid(SystemMessage.of("business.skillStatusMustBeEnabledOrDisabled"));
        }
        String reviewStatus = source.reviewStatus() == null || source.reviewStatus().isBlank()
                || "all".equalsIgnoreCase(source.reviewStatus()) ? "all" : source.reviewStatus().trim();
        if (!"all".equals(reviewStatus) && !Set.of(SkillRecords.REVIEW_PRIVATE, SkillRecords.REVIEW_PENDING, SkillRecords.REVIEW_PUBLISHED, SkillRecords.REVIEW_REJECTED).contains(reviewStatus)) {
            throw invalid(SystemMessage.of("business.invalidSkillList"));
        }
        return new SkillDtos.SkillListRequest(source.keyword() == null ? "" : source.keyword().trim(), type,
                status, Math.max(1, source.page()), Math.min(MAX_PAGE_SIZE, Math.max(1, source.pageSize())), reviewStatus);
    }

    /** 技能记录转用户选项，封面按预览用途现签。 */
    private Mono<SkillDtos.SkillOption> toOption(SkillRecords.SkillRecord record) {
        String workflowType = workflowType(record);
        String systemPrompt = SkillRecords.TYPE_CANVAS_SETTING_GRAPH.equals(record.getTargetType()) ? record.getSystemPrompt() : null;
        return mediaAccessService.signUrl(record.getCoverUrl() == null ? "" : record.getCoverUrl(), MediaAccessService.Purpose.PREVIEW)
                .map(url -> new SkillDtos.SkillOption(record.getId(), record.getName(), record.getDescription(), record.getTargetType(),
                        url, workflowType, systemPrompt, record.getAspectRatio()));
    }

    /** 技能记录转管理端条目。有待审核更新时展示待更新内容，线上版本仍由市场接口返回。 */
    private Mono<SkillDtos.SkillItem> toItem(SkillRecords.SkillRecord record) {
        SkillRecords.SkillRecord pending = SkillRecords.REVISION_PENDING.equals(record.getRevisionStatus()) ? pendingRevision(record) : null;
        SkillRecords.SkillRecord shown = pending == null ? record : pending;
        return mediaAccessService.signUrl(shown.getCoverUrl() == null ? "" : shown.getCoverUrl(), MediaAccessService.Purpose.PREVIEW)
                .map(url -> new SkillDtos.SkillItem(record.getId(), shown.getName(), shown.getDescription(), shown.getTargetType(), shown.getSystemPrompt(), url,
                        shown.getAspectRatio(), record.getStatus(), record.getSortOrder(), formatTime(record.getCreatedAt()), formatTime(record.getUpdatedAt()),
                        shown.getCategory(), shown.getSubtitle(), shown.getAudience(), parseUsageSteps(shown.getUsageSteps()),
                        record.getOwnerUserId(), record.getReviewStatus(), record.getRejectReason(), record.getAuthorName(), shown.getWorkflowId(),
                        record.getRevisionStatus()));
    }

    /** 技能记录转市场卡片。 */
    private Mono<SkillDtos.SkillMarketCard> toCard(SkillRecords.SkillRecord record) {
        return mediaAccessService.signUrl(record.getCoverUrl() == null ? "" : record.getCoverUrl(), MediaAccessService.Purpose.PREVIEW)
                .map(url -> new SkillDtos.SkillMarketCard(record.getId(), record.getName(), record.getSubtitle(), record.getDescription(),
                        record.getCategory(), record.getTargetType(), url, record.getAspectRatio(), workflowType(record),
                        record.getAuthorName(), record.getOwnerUserId() == null, Boolean.TRUE.equals(record.getFavorited())));
    }

    /** 技能记录转我的技能卡片。 */
    private Mono<SkillDtos.SkillMineCard> toMineCard(SkillRecords.SkillRecord record, Long userId) {
        return toCard(record).map(card -> new SkillDtos.SkillMineCard(card.id(), card.name(), card.subtitle(), card.description(), card.category(),
                card.targetType(), card.coverUrl(), card.aspectRatio(), card.workflowType(), card.authorName(), card.official(), card.favorited(),
                record.getStatus(), record.getReviewStatus(), record.getRejectReason(), userId.equals(record.getOwnerUserId()),
                record.getRevisionStatus()));
    }

    /** 组装详情。系统提示词和驳回原因只返回给作者。 */
    private SkillDtos.SkillDetail toDetail(SkillRecords.SkillRecord record, Long userId, SkillDtos.SkillMarketCard card, List<SkillDtos.SkillMarketCard> related) {
        boolean owned = userId.equals(record.getOwnerUserId());
        SkillRecords.SkillRecord pending = owned ? pendingRevision(record) : null;
        SkillDtos.SkillPendingRevision pendingView = pending == null ? null : new SkillDtos.SkillPendingRevision(
                pending.getName(), pending.getSubtitle(), pending.getDescription(), pending.getCategory(), pending.getTargetType(),
                pending.getCoverUrl(), pending.getAspectRatio(), pending.getAudience(), parseUsageSteps(pending.getUsageSteps()),
                pending.getSystemPrompt(), pending.getWorkflowId());
        return new SkillDtos.SkillDetail(card.id(), card.name(), card.subtitle(), card.description(), card.category(), card.targetType(),
                card.coverUrl(), card.aspectRatio(), card.workflowType(), record.getAudience(), parseUsageSteps(record.getUsageSteps()),
                card.authorName(), card.official(), card.favorited(), record.getStatus(), record.getReviewStatus(),
                owned ? record.getRejectReason() : "", owned ? record.getSystemPrompt() : null, owned, related, record.getWorkflowId(),
                owned ? record.getRevisionStatus() : "", owned ? record.getRevisionRejectReason() : "", pendingView);
    }

    /** 读取待审核更新。没有或内容损坏时返回空，避免影响线上技能。 */
    private SkillRecords.SkillRecord pendingRevision(SkillRecords.SkillRecord record) {
        boolean reviewable = SkillRecords.REVISION_PENDING.equals(record.getRevisionStatus())
                || SkillRecords.REVISION_REJECTED.equals(record.getRevisionStatus());
        if (!reviewable || !StringUtils.hasText(record.getPendingRevision())) {
            return null;
        }
        try {
            return fromStoredRevision(record.getPendingRevision());
        } catch (RuntimeException exception) {
            log.warn("技能待审核更新无法读取: id={}", record.getId());
            return null;
        }
    }

    /** 把用户提交的内容收成待审核快照。 */
    private StoredSkillRevision toStoredRevision(SkillRecords.SkillRecord record) {
        return new StoredSkillRevision(record.getName(), record.getSubtitle(), record.getDescription(), record.getCategory(),
                record.getTargetType(), record.getSystemPrompt(), record.getAspectRatio(), record.getCoverUrl(),
                record.getAudience(), record.getUsageSteps(), record.getWorkflowId());
    }

    /** 把待审核快照还原成可写回技能表的记录。 */
    private SkillRecords.SkillRecord fromStoredRevision(String json) {
        StoredSkillRevision stored = JSON.parseObject(json, StoredSkillRevision.class);
        if (stored == null || !StringUtils.hasText(stored.systemPrompt()) || !StringUtils.hasText(stored.workflowId())) {
            throw invalid(SystemMessage.of("business.skillIsNotPendingReview"));
        }
        SkillRecords.SkillRecord record = new SkillRecords.SkillRecord();
        record.setName(stored.name());
        record.setSubtitle(stored.subtitle());
        record.setDescription(stored.description());
        record.setCategory(stored.category());
        record.setTargetType(stored.targetType());
        record.setSystemPrompt(stored.systemPrompt());
        record.setAspectRatio(stored.aspectRatio());
        record.setCoverUrl(stored.coverUrl());
        record.setAudience(stored.audience());
        record.setUsageSteps(stored.usageSteps());
        record.setWorkflowId(stored.workflowId());
        return record;
    }

    /** 已发布技能的待审核内容。 */
    private record StoredSkillRevision(String name, String subtitle, String description, String category, String targetType,
                                       String systemPrompt, String aspectRatio, String coverUrl, String audience,
                                       String usageSteps, String workflowId) {
    }

    /** 视频技能只有在 workflowId 对应已注册工作流时才进入服务端工作流。 */
    private String workflowType(SkillRecords.SkillRecord record) {
        if (!SkillRecords.TYPE_VIDEO.equals(record.getTargetType()) || !StringUtils.hasText(record.getWorkflowId())) {
            return null;
        }
        String workflowId = record.getWorkflowId().trim().toLowerCase(Locale.ROOT);
        return videoWorkflowRegistry.isRegistered(workflowId) ? workflowId : null;
    }

    /** 规范化工作流标识。创建和更新都必须填写，且只能使用小写字母、数字、下划线和连字符。 */
    private String normalizeWorkflowId(String workflowId) {
        String value = workflowId == null ? "" : workflowId.trim().toLowerCase(Locale.ROOT);
        if (!StringUtils.hasText(value)) {
            throw invalid(SystemMessage.of("business.skillWorkflowIdIsRequired"));
        }
        if (!value.matches("[a-z0-9][a-z0-9_-]{0,63}")) {
            throw invalid(SystemMessage.of("business.skillWorkflowIdIsInvalid"));
        }
        return value;
    }

    /** 未删除技能的工作流标识必须唯一。 */
    private Mono<Void> ensureUniqueWorkflowId(String workflowId, Long excludeId) {
        return repository.workflowIdExists(workflowId, excludeId)
                .flatMap(exists -> Boolean.TRUE.equals(exists)
                        ? Mono.error(invalid(SystemMessage.of("business.skillWorkflowIdAlreadyExists")))
                        : Mono.empty());
    }

    /** 必填文本。 */
    private String required(String value, SystemMessage message) {
        if (!StringUtils.hasText(value)) {
            throw invalid(message);
        }
        return value.trim();
    }

    /** 限制文本长度。 */
    private String limit(String value, int max, SystemMessage message) {
        if (value != null && value.length() > max) {
            throw invalid(message);
        }
        return value == null ? "" : value;
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
