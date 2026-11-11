package com.novanovastudio.repository;

import com.novanovastudio.dto.SkillDtos;
import com.novanovastudio.entity.SkillRecords;
import io.r2dbc.spi.Row;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import lombok.RequiredArgsConstructor;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 图片和视频生成技能数据库访问。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-08-27 00:00
 */
@Repository
@RequiredArgsConstructor
public class SkillRepository {

    /** 技能列。 */
    private static final String SKILL_COLUMNS = """
            id, name, description, target_type, system_prompt, workflow_id, aspect_ratio, cover_url, status, sort_order,
            created_at, updated_at, deleted_at, category, subtitle, audience, usage_steps, owner_user_id,
            review_status, reject_reason, pending_revision, revision_status, revision_reject_reason
            """;
    /** 带表别名的技能列。 */
    private static final String SKILL_COLUMNS_ALIASED = """
            s.id, s.name, s.description, s.target_type, s.system_prompt, s.workflow_id, s.aspect_ratio, s.cover_url, s.status, s.sort_order,
            s.created_at, s.updated_at, s.deleted_at, s.category, s.subtitle, s.audience, s.usage_steps, s.owner_user_id,
            s.review_status, s.reject_reason, s.pending_revision, s.revision_status, s.revision_reject_reason
            """;
    /** 作者展示名。官方技能留空，由接口返回官方标记。 */
    private static final String AUTHOR_NAME = """
            CASE WHEN s.owner_user_id IS NULL THEN ''
                 ELSE COALESCE(NULLIF(TRIM(u.nickname), ''), NULLIF(TRIM(u.username), ''), '') END
            """;

    /** 响应式数据库客户端。 */
    private final DatabaseClient databaseClient;

    /**
     * 查询技能列表。
     *
     * @param request 技能列表请求
     * @param userOnly 是否只返回已启用且已发布的技能
     * @return 技能记录流
     */
    public Flux<SkillRecords.SkillRecord> listSkills(SkillDtos.SkillListRequest request, boolean userOnly) {
        QueryParts parts = buildWhere(request, userOnly);
        int pageSize = Math.max(1, request.pageSize());
        int offset = (Math.max(1, request.page()) - 1) * pageSize;
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                SELECT %s, %s AS author_name, FALSE AS favorited
                FROM skills s
                LEFT JOIN users u ON u.id = s.owner_user_id
                %s
                ORDER BY s.sort_order ASC, s.id ASC
                LIMIT :limit OFFSET :offset
                """.formatted(SKILL_COLUMNS_ALIASED, AUTHOR_NAME, parts.where()))
                .bind("limit", pageSize)
                .bind("offset", offset);
        return bind(spec, parts.binds()).map((row, metadata) -> map(row)).all();
    }

    /**
     * 统计技能数量。
     *
     * @param request 技能列表请求
     * @param userOnly 是否只统计已启用且已发布的技能
     * @return 技能总数
     */
    public Mono<Long> countSkills(SkillDtos.SkillListRequest request, boolean userOnly) {
        QueryParts parts = buildWhere(request, userOnly);
        return bind(databaseClient.sql("SELECT COUNT(1) AS total FROM skills s " + parts.where()), parts.binds())
                .map((row, metadata) -> Objects.requireNonNull(row.get("total", Long.class)))
                .one();
    }

    /**
     * 查询创作页可选技能：已发布技能，以及当前用户自己启用的技能。
     *
     * @param targetType 适用生成类型
     * @param userId 当前用户ID，未登录时为空
     * @return 技能记录流
     */
    public Flux<SkillRecords.SkillRecord> listComposerSkills(String targetType, Long userId) {
        String ownerClause = userId == null ? "FALSE" : "s.owner_user_id = :userId";
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                SELECT %s, '' AS author_name, FALSE AS favorited
                FROM skills s
                WHERE s.deleted_at IS NULL AND s.status = 1 AND s.target_type = :targetType
                  AND (s.review_status = 'published' OR %s)
                ORDER BY s.sort_order ASC, s.id ASC
                LIMIT 100
                """.formatted(SKILL_COLUMNS_ALIASED, ownerClause))
                .bind("targetType", targetType);
        if (userId != null) {
            spec = spec.bind("userId", userId);
        }
        return spec.map((row, metadata) -> map(row)).all();
    }

    /**
     * 查询市场技能。
     *
     * @param userId 当前用户ID
     * @param category 市场分类，空表示全部
     * @param keyword 关键词
     * @param limit 每页数量
     * @param offset 偏移
     * @return 技能记录流
     */
    public Flux<SkillRecords.SkillRecord> listMarketSkills(Long userId, String category, String keyword, int limit, int offset) {
        QueryParts parts = marketWhere(category, keyword);
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                SELECT %s, %s AS author_name,
                       EXISTS (SELECT 1 FROM skill_favorites fav WHERE fav.skill_id = s.id AND fav.user_id = :userId) AS favorited
                FROM skills s
                LEFT JOIN users u ON u.id = s.owner_user_id
                WHERE %s
                ORDER BY s.sort_order ASC, s.id DESC
                LIMIT :limit OFFSET :offset
                """.formatted(SKILL_COLUMNS_ALIASED, AUTHOR_NAME, parts.where()))
                .bind("userId", userId)
                .bind("limit", limit)
                .bind("offset", offset);
        return bind(spec, parts.binds()).map((row, metadata) -> map(row)).all();
    }

    /**
     * 统计市场技能数量。
     *
     * @param category 市场分类
     * @param keyword 关键词
     * @return 总数
     */
    public Mono<Long> countMarketSkills(String category, String keyword) {
        QueryParts parts = marketWhere(category, keyword);
        return bind(databaseClient.sql("SELECT COUNT(1) AS total FROM skills s WHERE " + parts.where()), parts.binds())
                .map((row, metadata) -> Objects.requireNonNull(row.get("total", Long.class)))
                .one();
    }

    /**
     * 查询我创建的技能。
     *
     * @param userId 当前用户ID
     * @param keyword 关键词
     * @param limit 每页数量
     * @param offset 偏移
     * @return 技能记录流
     */
    public Flux<SkillRecords.SkillRecord> listOwnedSkills(Long userId, String keyword, int limit, int offset) {
        QueryParts parts = ownedWhere(keyword);
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                SELECT %s, %s AS author_name,
                       EXISTS (SELECT 1 FROM skill_favorites fav WHERE fav.skill_id = s.id AND fav.user_id = :userId) AS favorited
                FROM skills s
                LEFT JOIN users u ON u.id = s.owner_user_id
                WHERE %s
                ORDER BY s.updated_at DESC, s.id DESC
                LIMIT :limit OFFSET :offset
                """.formatted(SKILL_COLUMNS_ALIASED, AUTHOR_NAME, parts.where()))
                .bind("userId", userId)
                .bind("limit", limit)
                .bind("offset", offset);
        return bind(spec, parts.binds()).map((row, metadata) -> map(row)).all();
    }

    /**
     * 统计我创建的技能。
     *
     * @param userId 当前用户ID
     * @param keyword 关键词
     * @return 总数
     */
    public Mono<Long> countOwnedSkills(Long userId, String keyword) {
        QueryParts parts = ownedWhere(keyword);
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("SELECT COUNT(1) AS total FROM skills s WHERE " + parts.where())
                .bind("userId", userId);
        return bind(spec, parts.binds()).map((row, metadata) -> Objects.requireNonNull(row.get("total", Long.class))).one();
    }

    /**
     * 查询我收藏且仍已发布的技能。
     *
     * @param userId 当前用户ID
     * @param keyword 关键词
     * @param limit 每页数量
     * @param offset 偏移
     * @return 技能记录流
     */
    public Flux<SkillRecords.SkillRecord> listFavoriteSkills(Long userId, String keyword, int limit, int offset) {
        QueryParts parts = favoriteWhere(keyword);
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                SELECT %s, %s AS author_name, TRUE AS favorited
                FROM skills s
                JOIN skill_favorites fav ON fav.skill_id = s.id AND fav.user_id = :userId
                LEFT JOIN users u ON u.id = s.owner_user_id
                WHERE %s
                ORDER BY fav.created_at DESC, s.id DESC
                LIMIT :limit OFFSET :offset
                """.formatted(SKILL_COLUMNS_ALIASED, AUTHOR_NAME, parts.where()))
                .bind("userId", userId)
                .bind("limit", limit)
                .bind("offset", offset);
        return bind(spec, parts.binds()).map((row, metadata) -> map(row)).all();
    }

    /**
     * 统计我收藏的技能。
     *
     * @param userId 当前用户ID
     * @param keyword 关键词
     * @return 总数
     */
    public Mono<Long> countFavoriteSkills(Long userId, String keyword) {
        QueryParts parts = favoriteWhere(keyword);
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                SELECT COUNT(1) AS total
                FROM skills s
                JOIN skill_favorites fav ON fav.skill_id = s.id AND fav.user_id = :userId
                WHERE %s
                """.formatted(parts.where())).bind("userId", userId);
        return bind(spec, parts.binds()).map((row, metadata) -> Objects.requireNonNull(row.get("total", Long.class))).one();
    }

    /**
     * 查询同分类的相关技能。
     *
     * @param userId 当前用户ID
     * @param category 市场分类
     * @param excludeId 排除的技能ID
     * @return 技能记录流
     */
    public Flux<SkillRecords.SkillRecord> listRelatedSkills(Long userId, String category, Long excludeId) {
        return databaseClient.sql("""
                SELECT %s, %s AS author_name,
                       EXISTS (SELECT 1 FROM skill_favorites fav WHERE fav.skill_id = s.id AND fav.user_id = :userId) AS favorited
                FROM skills s
                LEFT JOIN users u ON u.id = s.owner_user_id
                WHERE s.deleted_at IS NULL AND s.status = 1 AND s.review_status = 'published'
                  AND s.category = :category AND s.id <> :excludeId
                ORDER BY s.sort_order ASC, s.id DESC
                LIMIT 4
                """.formatted(SKILL_COLUMNS_ALIASED, AUTHOR_NAME))
                .bind("userId", userId)
                .bind("category", category)
                .bind("excludeId", excludeId)
                .map((row, metadata) -> map(row))
                .all();
    }

    /**
     * 按ID查询启用技能。
     *
     * @param id 技能ID
     * @return 技能记录
     */
    public Mono<SkillRecords.SkillRecord> findEnabledById(Long id) {
        return databaseClient.sql("""
                SELECT %s, '' AS author_name, FALSE AS favorited
                FROM skills
                WHERE id = :id AND deleted_at IS NULL AND status = 1
                """.formatted(SKILL_COLUMNS))
                .bind("id", id)
                .map((row, metadata) -> map(row))
                .one();
    }

    /**
     * 按ID查询未删除技能，并带上当前用户的收藏状态。
     *
     * @param id 技能ID
     * @param userId 当前用户ID
     * @return 技能记录
     */
    public Mono<SkillRecords.SkillRecord> findVisibleById(Long id, Long userId) {
        return databaseClient.sql("""
                SELECT %s, %s AS author_name,
                       EXISTS (SELECT 1 FROM skill_favorites fav WHERE fav.skill_id = s.id AND fav.user_id = :userId) AS favorited
                FROM skills s
                LEFT JOIN users u ON u.id = s.owner_user_id
                WHERE s.id = :id AND s.deleted_at IS NULL
                """.formatted(SKILL_COLUMNS_ALIASED, AUTHOR_NAME))
                .bind("id", id)
                .bind("userId", userId)
                .map((row, metadata) -> map(row))
                .one();
    }

    /**
     * 创建技能。
     *
     * @param record 技能记录
     * @return 新技能ID
     */
    public Mono<Long> createSkill(SkillRecords.SkillRecord record) {
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                INSERT INTO skills(name, description, target_type, system_prompt, workflow_id, aspect_ratio, cover_url, status, sort_order,
                    category, subtitle, audience, usage_steps, owner_user_id, review_status, reject_reason)
                VALUES (:name, :description, :targetType, :systemPrompt, :workflowId, :aspectRatio, :coverUrl, :status, :sortOrder,
                    :category, :subtitle, :audience, :usageSteps, :ownerUserId, :reviewStatus, :rejectReason)
                RETURNING id
                """)
                .bind("name", record.getName())
                .bind("description", record.getDescription())
                .bind("targetType", record.getTargetType())
                .bind("systemPrompt", record.getSystemPrompt())
                .bind("workflowId", record.getWorkflowId())
                .bind("aspectRatio", record.getAspectRatio())
                .bind("coverUrl", record.getCoverUrl())
                .bind("status", record.getStatus())
                .bind("sortOrder", record.getSortOrder())
                .bind("subtitle", empty(record.getSubtitle()))
                .bind("audience", empty(record.getAudience()))
                .bind("usageSteps", empty(record.getUsageSteps()).isBlank() ? "[]" : record.getUsageSteps())
                .bind("reviewStatus", empty(record.getReviewStatus()).isBlank() ? SkillRecords.REVIEW_PUBLISHED : record.getReviewStatus())
                .bind("rejectReason", empty(record.getRejectReason()));
        spec = R2dbcBindings.bindNullable(spec, "category", record.getCategory(), String.class);
        spec = R2dbcBindings.bindNullable(spec, "ownerUserId", record.getOwnerUserId(), Long.class);
        return spec.map((row, metadata) -> row.get("id", Long.class)).one();
    }

    /**
     * 更新技能内容。不改作者和审核状态。
     *
     * @param record 技能记录
     * @return 更新行数
     */
    public Mono<Long> updateSkill(SkillRecords.SkillRecord record) {
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                UPDATE skills
                SET name = :name,
                    description = :description,
                    target_type = :targetType,
                    system_prompt = :systemPrompt,
                    workflow_id = :workflowId,
                    aspect_ratio = :aspectRatio,
                    cover_url = :coverUrl,
                    status = :status,
                    sort_order = :sortOrder,
                    category = :category,
                    subtitle = :subtitle,
                    audience = :audience,
                    usage_steps = :usageSteps,
                    pending_revision = NULL,
                    revision_status = '',
                    revision_reject_reason = '',
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = :id AND deleted_at IS NULL
                """)
                .bind("id", record.getId())
                .bind("name", record.getName())
                .bind("description", record.getDescription())
                .bind("targetType", record.getTargetType())
                .bind("systemPrompt", record.getSystemPrompt())
                .bind("workflowId", record.getWorkflowId())
                .bind("aspectRatio", record.getAspectRatio())
                .bind("coverUrl", record.getCoverUrl())
                .bind("status", record.getStatus())
                .bind("sortOrder", record.getSortOrder())
                .bind("subtitle", empty(record.getSubtitle()))
                .bind("audience", empty(record.getAudience()))
                .bind("usageSteps", empty(record.getUsageSteps()).isBlank() ? "[]" : record.getUsageSteps());
        spec = R2dbcBindings.bindNullable(spec, "category", record.getCategory(), String.class);
        return spec.fetch().rowsUpdated();
    }

    /**
     * 更新作者自己的技能。已发布技能由调用方改回审核中。
     *
     * @param record 技能记录
     * @param userId 作者用户ID
     * @return 更新行数
     */
    public Mono<Long> updateOwnedSkill(SkillRecords.SkillRecord record, Long userId) {
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                UPDATE skills
                SET name = :name,
                    description = :description,
                    target_type = :targetType,
                    system_prompt = :systemPrompt,
                    workflow_id = :workflowId,
                    aspect_ratio = :aspectRatio,
                    cover_url = :coverUrl,
                    category = :category,
                    subtitle = :subtitle,
                    audience = :audience,
                    usage_steps = :usageSteps,
                    review_status = :reviewStatus,
                    reject_reason = :rejectReason,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = :id AND owner_user_id = :userId AND deleted_at IS NULL
                """)
                .bind("id", record.getId())
                .bind("userId", userId)
                .bind("name", record.getName())
                .bind("description", record.getDescription())
                .bind("targetType", record.getTargetType())
                .bind("systemPrompt", record.getSystemPrompt())
                .bind("workflowId", record.getWorkflowId())
                .bind("aspectRatio", record.getAspectRatio())
                .bind("coverUrl", record.getCoverUrl())
                .bind("subtitle", empty(record.getSubtitle()))
                .bind("audience", empty(record.getAudience()))
                .bind("usageSteps", empty(record.getUsageSteps()).isBlank() ? "[]" : record.getUsageSteps())
                .bind("reviewStatus", record.getReviewStatus())
                .bind("rejectReason", empty(record.getRejectReason()));
        spec = R2dbcBindings.bindNullable(spec, "category", record.getCategory(), String.class);
        return spec.fetch().rowsUpdated();
    }

    /**
     * 更新技能状态。
     *
     * @param id 技能ID
     * @param status 状态
     * @return 更新行数
     */
    public Mono<Long> updateSkillStatus(Long id, Integer status) {
        return databaseClient.sql("""
                UPDATE skills
                SET status = :status, updated_at = CURRENT_TIMESTAMP
                WHERE id = :id AND deleted_at IS NULL
                """)
                .bind("id", id)
                .bind("status", status)
                .fetch()
                .rowsUpdated();
    }

    /**
     * 提交审核。
     *
     * @param id 技能ID
     * @param userId 作者用户ID
     * @return 更新行数
     */
    public Mono<Long> submitReview(Long id, Long userId) {
        return databaseClient.sql("""
                UPDATE skills
                SET review_status = 'pending', reject_reason = '', updated_at = CURRENT_TIMESTAMP
                WHERE id = :id AND owner_user_id = :userId AND deleted_at IS NULL
                  AND review_status IN ('private', 'rejected')
                """)
                .bind("id", id)
                .bind("userId", userId)
                .fetch()
                .rowsUpdated();
    }

    /**
     * 撤回为未发布。
     *
     * @param id 技能ID
     * @param userId 作者用户ID
     * @return 更新行数
     */
    public Mono<Long> withdrawSkill(Long id, Long userId) {
        return databaseClient.sql("""
                UPDATE skills
                SET review_status = 'private', reject_reason = '',
                    pending_revision = NULL, revision_status = '', revision_reject_reason = '',
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = :id AND owner_user_id = :userId AND deleted_at IS NULL
                  AND review_status IN ('pending', 'published', 'rejected')
                """)
                .bind("id", id)
                .bind("userId", userId)
                .fetch()
                .rowsUpdated();
    }

    /**
     * 按ID查询未删除技能，供审核读取待更新内容。
     *
     * @param id 技能ID
     * @return 技能记录
     */
    public Mono<SkillRecords.SkillRecord> findAnyById(Long id) {
        return databaseClient.sql("""
                SELECT %s, '' AS author_name, FALSE AS favorited
                FROM skills
                WHERE id = :id AND deleted_at IS NULL
                """.formatted(SKILL_COLUMNS))
                .bind("id", id)
                .map((row, metadata) -> map(row))
                .one();
    }

    /**
     * 保存已发布技能的待审核更新，不改线上字段。
     *
     * @param id 技能ID
     * @param userId 作者用户ID
     * @param pendingRevision 待审核内容 JSON
     * @return 更新行数
     */
    public Mono<Long> savePendingRevision(Long id, Long userId, String pendingRevision) {
        return databaseClient.sql("""
                UPDATE skills
                SET pending_revision = :pendingRevision,
                    revision_status = 'pending',
                    revision_reject_reason = '',
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = :id AND owner_user_id = :userId AND deleted_at IS NULL
                  AND review_status = 'published'
                """)
                .bind("id", id)
                .bind("userId", userId)
                .bind("pendingRevision", pendingRevision)
                .fetch()
                .rowsUpdated();
    }

    /**
     * 审核通过后，用待更新内容替换线上技能。
     *
     * @param id 技能ID
     * @param revision 待更新内容
     * @return 更新行数
     */
    public Mono<Long> applyPendingRevision(Long id, SkillRecords.SkillRecord revision) {
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                UPDATE skills
                SET name = :name,
                    description = :description,
                    target_type = :targetType,
                    system_prompt = :systemPrompt,
                    workflow_id = :workflowId,
                    aspect_ratio = :aspectRatio,
                    cover_url = :coverUrl,
                    category = :category,
                    subtitle = :subtitle,
                    audience = :audience,
                    usage_steps = :usageSteps,
                    pending_revision = NULL,
                    revision_status = '',
                    revision_reject_reason = '',
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = :id AND deleted_at IS NULL AND review_status = 'published' AND revision_status = 'pending'
                """)
                .bind("id", id)
                .bind("name", revision.getName())
                .bind("description", revision.getDescription())
                .bind("targetType", revision.getTargetType())
                .bind("systemPrompt", revision.getSystemPrompt())
                .bind("workflowId", revision.getWorkflowId())
                .bind("aspectRatio", revision.getAspectRatio())
                .bind("coverUrl", revision.getCoverUrl())
                .bind("subtitle", empty(revision.getSubtitle()))
                .bind("audience", empty(revision.getAudience()))
                .bind("usageSteps", empty(revision.getUsageSteps()).isBlank() ? "[]" : revision.getUsageSteps());
        spec = R2dbcBindings.bindNullable(spec, "category", revision.getCategory(), String.class);
        return spec.fetch().rowsUpdated();
    }

    /**
     * 驳回已发布技能的更新，线上内容保持不变。
     *
     * @param id 技能ID
     * @param reason 驳回原因
     * @return 更新行数
     */
    public Mono<Long> rejectPendingRevision(Long id, String reason) {
        return databaseClient.sql("""
                UPDATE skills
                SET revision_status = 'rejected',
                    revision_reject_reason = :reason,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = :id AND deleted_at IS NULL AND review_status = 'published' AND revision_status = 'pending'
                """)
                .bind("id", id)
                .bind("reason", reason == null ? "" : reason)
                .fetch()
                .rowsUpdated();
    }

    /**
     * 审核用户技能。
     *
     * @param id 技能ID
     * @param reviewStatus 审核结果
     * @param reason 驳回原因
     * @return 更新行数
     */
    public Mono<Long> reviewSkill(Long id, String reviewStatus, String reason) {
        return databaseClient.sql("""
                UPDATE skills
                SET review_status = :reviewStatus, reject_reason = :reason, updated_at = CURRENT_TIMESTAMP
                WHERE id = :id AND deleted_at IS NULL AND review_status = 'pending' AND owner_user_id IS NOT NULL
                """)
                .bind("id", id)
                .bind("reviewStatus", reviewStatus)
                .bind("reason", reason == null ? "" : reason)
                .fetch()
                .rowsUpdated();
    }

    /**
     * 软删除作者自己的技能。
     *
     * @param id 技能ID
     * @param userId 作者用户ID
     * @return 更新行数
     */
    public Mono<Long> deleteOwnedSkill(Long id, Long userId) {
        return databaseClient.sql("""
                UPDATE skills
                SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                WHERE id = :id AND owner_user_id = :userId AND deleted_at IS NULL
                """)
                .bind("id", id)
                .bind("userId", userId)
                .fetch()
                .rowsUpdated()
                .flatMap(rows -> rows > 0 ? deleteFavorites(List.of(id)).thenReturn(rows) : Mono.just(rows));
    }

    /**
     * 批量软删除技能。
     *
     * @param ids 技能ID列表
     * @return 操作完成信号
     */
    public Mono<Void> deleteSkills(List<Long> ids) {
        if (ids == null || ids.isEmpty()) {
            return Mono.empty();
        }
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                UPDATE skills
                SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                WHERE deleted_at IS NULL AND id IN (%s)
                """.formatted(R2dbcBindings.namedPlaceholders("id", ids.size())));
        return R2dbcBindings.bindList(spec, "id", ids).fetch().rowsUpdated()
                .then(deleteFavorites(ids));
    }

    /**
     * 收藏已发布技能。
     *
     * @param userId 用户ID
     * @param skillId 技能ID
     * @return 操作完成信号
     */
    public Mono<Void> favoriteSkill(Long userId, Long skillId) {
        return databaseClient.sql("""
                INSERT INTO skill_favorites(user_id, skill_id)
                SELECT :userId, s.id
                FROM skills s
                WHERE s.id = :skillId AND s.deleted_at IS NULL AND s.status = 1
                  AND s.review_status = 'published' AND s.category IS NOT NULL
                ON CONFLICT (user_id, skill_id) DO NOTHING
                """)
                .bind("userId", userId)
                .bind("skillId", skillId)
                .fetch()
                .rowsUpdated()
                .then();
    }

    /**
     * 取消收藏。
     *
     * @param userId 用户ID
     * @param skillId 技能ID
     * @return 操作完成信号
     */
    public Mono<Void> unfavoriteSkill(Long userId, Long skillId) {
        return databaseClient.sql("""
                DELETE FROM skill_favorites
                WHERE user_id = :userId AND skill_id = :skillId
                """)
                .bind("userId", userId)
                .bind("skillId", skillId)
                .fetch()
                .rowsUpdated()
                .then();
    }

    /**
     * 判断技能当前是否可收藏。
     *
     * @param skillId 技能ID
     * @return 是否可收藏
     */
    public Mono<Boolean> isFavoritable(Long skillId) {
        return databaseClient.sql("""
                SELECT COUNT(1) AS total
                FROM skills
                WHERE id = :id AND deleted_at IS NULL AND status = 1
                  AND review_status = 'published' AND category IS NOT NULL
                """)
                .bind("id", skillId)
                .map((row, metadata) -> Objects.requireNonNull(row.get("total", Long.class)) > 0)
                .one();
    }

    /** 删除技能收藏。 */
    private Mono<Void> deleteFavorites(List<Long> ids) {
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                DELETE FROM skill_favorites
                WHERE skill_id IN (%s)
                """.formatted(R2dbcBindings.namedPlaceholders("id", ids.size())));
        return R2dbcBindings.bindList(spec, "id", ids).fetch().rowsUpdated().then();
    }

    /** 构建管理端查询条件。 */
    private QueryParts buildWhere(SkillDtos.SkillListRequest request, boolean userOnly) {
        List<String> conditions = new ArrayList<>();
        List<BindValue> binds = new ArrayList<>();
        conditions.add("s.deleted_at IS NULL");
        if (userOnly) {
            conditions.add("s.status = 1");
            conditions.add("s.review_status = 'published'");
        } else if (request.status() != null) {
            conditions.add("s.status = :status");
            binds.add(new BindValue("status", request.status()));
        }
        if (request.targetType() != null && !request.targetType().isBlank()
                && !"all".equalsIgnoreCase(request.targetType())) {
            conditions.add("s.target_type = :targetType");
            binds.add(new BindValue("targetType", request.targetType()));
        }
        if ("pending".equals(request.reviewStatus())) {
            conditions.add("(s.review_status = 'pending' OR s.revision_status = 'pending')");
        } else if (request.reviewStatus() != null && !request.reviewStatus().isBlank()
                && !"all".equalsIgnoreCase(request.reviewStatus())) {
            conditions.add("s.review_status = :reviewStatus");
            binds.add(new BindValue("reviewStatus", request.reviewStatus()));
        }
        addKeyword(conditions, binds, request.keyword(), "s.name", "s.subtitle", "s.description", "s.audience");
        return new QueryParts("WHERE " + String.join(" AND ", conditions), binds);
    }

    /** 市场查询条件。 */
    private QueryParts marketWhere(String category, String keyword) {
        List<String> conditions = new ArrayList<>();
        List<BindValue> binds = new ArrayList<>();
        conditions.add("s.deleted_at IS NULL");
        conditions.add("s.status = 1");
        conditions.add("s.review_status = 'published'");
        conditions.add("s.category IS NOT NULL");
        if (category != null && !category.isBlank() && !"all".equalsIgnoreCase(category)) {
            conditions.add("s.category = :category");
            binds.add(new BindValue("category", category));
        }
        addKeyword(conditions, binds, keyword, "s.name", "s.subtitle", "s.description", "s.audience", "s.usage_steps");
        return new QueryParts(String.join(" AND ", conditions), binds);
    }

    /** 我创建的技能查询条件。 */
    private QueryParts ownedWhere(String keyword) {
        List<String> conditions = new ArrayList<>();
        List<BindValue> binds = new ArrayList<>();
        conditions.add("s.deleted_at IS NULL");
        conditions.add("s.owner_user_id = :userId");
        addKeyword(conditions, binds, keyword, "s.name", "s.subtitle", "s.description", "s.audience", "s.usage_steps");
        return new QueryParts(String.join(" AND ", conditions), binds);
    }

    /** 我收藏的技能查询条件。 */
    private QueryParts favoriteWhere(String keyword) {
        List<String> conditions = new ArrayList<>();
        List<BindValue> binds = new ArrayList<>();
        conditions.add("s.deleted_at IS NULL");
        conditions.add("s.status = 1");
        conditions.add("s.review_status = 'published'");
        conditions.add("s.category IS NOT NULL");
        addKeyword(conditions, binds, keyword, "s.name", "s.subtitle", "s.description", "s.audience", "s.usage_steps");
        return new QueryParts(String.join(" AND ", conditions), binds);
    }

    /** 追加公开内容关键词条件。 */
    private void addKeyword(List<String> conditions, List<BindValue> binds, String keyword, String... columns) {
        String value = keyword == null ? "" : keyword.trim().toLowerCase(Locale.ROOT);
        if (value.isBlank()) {
            return;
        }
        List<String> likes = new ArrayList<>();
        for (String column : columns) {
            likes.add("LOWER(" + column + ") LIKE :keyword");
        }
        conditions.add("(" + String.join(" OR ", likes) + ")");
        binds.add(new BindValue("keyword", "%" + value + "%"));
    }

    /** 绑定动态查询参数。 */
    private DatabaseClient.GenericExecuteSpec bind(DatabaseClient.GenericExecuteSpec spec, List<BindValue> binds) {
        DatabaseClient.GenericExecuteSpec result = spec;
        for (BindValue bind : binds) {
            result = result.bind(bind.name(), bind.value());
        }
        return result;
    }

    /**
     * 判断未删除技能中是否已有相同工作流标识。
     *
     * @param workflowId 规范化后的工作流标识
     * @param excludeId 更新时排除的技能ID，创建时为空
     * @return 是否已存在
     */
    public Mono<Boolean> workflowIdExists(String workflowId, Long excludeId) {
        String sql = """
                SELECT COUNT(1) AS total
                FROM skills
                WHERE deleted_at IS NULL AND lower(workflow_id) = :workflowId
                """ + (excludeId == null ? "" : " AND id <> :excludeId");
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql(sql).bind("workflowId", workflowId);
        if (excludeId != null) {
            spec = spec.bind("excludeId", excludeId);
        }
        return spec.map((row, metadata) -> row.get("total", Long.class)).one()
                .map(total -> total != null && total > 0);
    }

    /** 映射数据库行。 */
    private SkillRecords.SkillRecord map(Row row) {
        SkillRecords.SkillRecord record = new SkillRecords.SkillRecord();
        record.setId(row.get("id", Long.class));
        record.setName(row.get("name", String.class));
        record.setDescription(empty(row.get("description", String.class)));
        record.setTargetType(row.get("target_type", String.class));
        record.setSystemPrompt(row.get("system_prompt", String.class));
        record.setWorkflowId(empty(row.get("workflow_id", String.class)));
        record.setAspectRatio(row.get("aspect_ratio", String.class));
        record.setCoverUrl(empty(row.get("cover_url", String.class)));
        record.setStatus(row.get("status", Integer.class));
        record.setSortOrder(row.get("sort_order", Integer.class));
        record.setCreatedAt(row.get("created_at", OffsetDateTime.class));
        record.setUpdatedAt(row.get("updated_at", OffsetDateTime.class));
        record.setDeletedAt(row.get("deleted_at", OffsetDateTime.class));
        record.setCategory(row.get("category", String.class));
        record.setSubtitle(empty(row.get("subtitle", String.class)));
        record.setAudience(empty(row.get("audience", String.class)));
        record.setUsageSteps(empty(row.get("usage_steps", String.class)));
        record.setOwnerUserId(row.get("owner_user_id", Long.class));
        record.setReviewStatus(row.get("review_status", String.class));
        record.setRejectReason(empty(row.get("reject_reason", String.class)));
        record.setPendingRevision(row.get("pending_revision", String.class));
        record.setRevisionStatus(empty(row.get("revision_status", String.class)));
        record.setRevisionRejectReason(empty(row.get("revision_reject_reason", String.class)));
        record.setAuthorName(empty(row.get("author_name", String.class)));
        record.setFavorited(readFlag(row.get("favorited")));
        return record;
    }

    /** 读取布尔标记。 */
    private boolean readFlag(Object value) {
        if (value instanceof Boolean flag) {
            return flag;
        }
        if (value instanceof Number number) {
            return number.intValue() != 0;
        }
        return false;
    }

    /** 空字符串。 */
    private String empty(String value) {
        return value == null ? "" : value;
    }

    /** 动态查询绑定值。 */
    private record BindValue(String name, Object value) {
    }

    /** 动态查询片段。 */
    private record QueryParts(String where, List<BindValue> binds) {
    }
}
