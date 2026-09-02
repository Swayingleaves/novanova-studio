package com.novanovastudio.repository;

import com.novanovastudio.dto.SkillDtos;
import com.novanovastudio.entity.SkillRecords;
import io.r2dbc.spi.Row;
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

    /** 响应式数据库客户端。 */
    private final DatabaseClient databaseClient;

    /**
     * 查询技能列表。
     *
     * @param request 技能列表请求
     * @param userOnly 是否只返回启用技能
     * @return 技能记录流
     */
    public Flux<SkillRecords.SkillRecord> listSkills(SkillDtos.SkillListRequest request, boolean userOnly) {
        QueryParts parts = buildWhere(request, userOnly);
        int pageSize = Math.max(1, request.pageSize());
        int offset = (Math.max(1, request.page()) - 1) * pageSize;
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                SELECT id, name, description, target_type, system_prompt, aspect_ratio, cover_url, status, sort_order, created_at, updated_at, deleted_at
                FROM skills
                %s
                ORDER BY sort_order ASC, id ASC
                LIMIT :limit OFFSET :offset
                """.formatted(parts.where()))
                .bind("limit", pageSize)
                .bind("offset", offset);
        return bind(spec, parts.binds()).map((row, metadata) -> map(row)).all();
    }

    /**
     * 统计技能数量。
     *
     * @param request 技能列表请求
     * @param userOnly 是否只统计启用技能
     * @return 技能总数
     */
    public Mono<Long> countSkills(SkillDtos.SkillListRequest request, boolean userOnly) {
        QueryParts parts = buildWhere(request, userOnly);
        return bind(databaseClient.sql("SELECT COUNT(1) AS total FROM skills " + parts.where()), parts.binds())
                .map((row, metadata) -> Objects.requireNonNull(row.get("total", Long.class)))
                .one();
    }

    /**
     * 按ID查询启用技能。
     *
     * @param id 技能ID
     * @return 技能记录
     */
    public Mono<SkillRecords.SkillRecord> findEnabledById(Long id) {
        return databaseClient.sql("""
                SELECT id, name, description, target_type, system_prompt, aspect_ratio, cover_url, status, sort_order, created_at, updated_at, deleted_at
                FROM skills
                WHERE id = :id AND deleted_at IS NULL AND status = 1
                """)
                .bind("id", id)
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
        return databaseClient.sql("""
                INSERT INTO skills(name, description, target_type, system_prompt, aspect_ratio, cover_url, status, sort_order)
                VALUES (:name, :description, :targetType, :systemPrompt, :aspectRatio, :coverUrl, :status, :sortOrder)
                RETURNING id
                """)
                .bind("name", record.getName())
                .bind("description", record.getDescription())
                .bind("targetType", record.getTargetType())
                .bind("systemPrompt", record.getSystemPrompt())
                .bind("aspectRatio", record.getAspectRatio())
                .bind("coverUrl", record.getCoverUrl())
                .bind("status", record.getStatus())
                .bind("sortOrder", record.getSortOrder())
                .map((row, metadata) -> row.get("id", Long.class))
                .one();
    }

    /**
     * 更新技能。
     *
     * @param record 技能记录
     * @return 更新行数
     */
    public Mono<Long> updateSkill(SkillRecords.SkillRecord record) {
        return databaseClient.sql("""
                UPDATE skills
                SET name = :name,
                    description = :description,
                    target_type = :targetType,
                    system_prompt = :systemPrompt,
                    aspect_ratio = :aspectRatio,
                    cover_url = :coverUrl,
                    status = :status,
                    sort_order = :sortOrder,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = :id AND deleted_at IS NULL
                """)
                .bind("id", record.getId())
                .bind("name", record.getName())
                .bind("description", record.getDescription())
                .bind("targetType", record.getTargetType())
                .bind("systemPrompt", record.getSystemPrompt())
                .bind("aspectRatio", record.getAspectRatio())
                .bind("coverUrl", record.getCoverUrl())
                .bind("status", record.getStatus())
                .bind("sortOrder", record.getSortOrder())
                .fetch()
                .rowsUpdated();
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
        return R2dbcBindings.bindList(spec, "id", ids).fetch().rowsUpdated().then();
    }

    /**
     * 构建查询条件。
     *
     * @param request 技能列表请求
     * @param userOnly 是否只查询启用记录
     * @return 查询片段
     */
    private QueryParts buildWhere(SkillDtos.SkillListRequest request, boolean userOnly) {
        List<String> conditions = new ArrayList<>();
        List<BindValue> binds = new ArrayList<>();
        conditions.add("deleted_at IS NULL");
        if (userOnly) {
            conditions.add("status = 1");
        } else if (request.status() != null) {
            conditions.add("status = :status");
            binds.add(new BindValue("status", request.status()));
        }
        if (request.targetType() != null && !request.targetType().isBlank()
                && !"all".equalsIgnoreCase(request.targetType())) {
            conditions.add("target_type = :targetType");
            binds.add(new BindValue("targetType", request.targetType()));
        }
        String keyword = request.keyword() == null ? "" : request.keyword().trim().toLowerCase(Locale.ROOT);
        if (!keyword.isBlank()) {
            conditions.add("(LOWER(name) LIKE :keyword OR LOWER(description) LIKE :keyword)");
            binds.add(new BindValue("keyword", "%" + keyword + "%"));
        }
        return new QueryParts("WHERE " + String.join(" AND ", conditions), binds);
    }

    /**
     * 绑定动态查询参数。
     *
     * @param spec SQL执行规格
     * @param binds 查询参数
     * @return 已绑定SQL执行规格
     */
    private DatabaseClient.GenericExecuteSpec bind(DatabaseClient.GenericExecuteSpec spec, List<BindValue> binds) {
        DatabaseClient.GenericExecuteSpec result = spec;
        for (BindValue bind : binds) {
            result = result.bind(bind.name(), bind.value());
        }
        return result;
    }

    /**
     * 映射数据库行。
     *
     * @param row 数据库行
     * @return 技能记录
     */
    private SkillRecords.SkillRecord map(Row row) {
        SkillRecords.SkillRecord record = new SkillRecords.SkillRecord();
        record.setId(row.get("id", Long.class));
        record.setName(row.get("name", String.class));
        record.setDescription(row.get("description", String.class));
        record.setTargetType(row.get("target_type", String.class));
        record.setSystemPrompt(row.get("system_prompt", String.class));
        record.setAspectRatio(row.get("aspect_ratio", String.class));
        record.setCoverUrl(row.get("cover_url", String.class));
        record.setStatus(row.get("status", Integer.class));
        record.setSortOrder(row.get("sort_order", Integer.class));
        record.setCreatedAt(row.get("created_at", java.time.OffsetDateTime.class));
        record.setUpdatedAt(row.get("updated_at", java.time.OffsetDateTime.class));
        record.setDeletedAt(row.get("deleted_at", java.time.OffsetDateTime.class));
        return record;
    }

    /** 动态查询绑定值。 */
    private record BindValue(String name, Object value) {
    }

    /** 动态查询片段。 */
    private record QueryParts(String where, List<BindValue> binds) {
    }
}
