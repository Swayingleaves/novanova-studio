package com.novanovastudio.repository;

import com.alibaba.fastjson2.JSON;
import com.novanovastudio.dto.PromptLibraryDtos;
import com.novanovastudio.entity.PromptLibraryRecords;
import io.r2dbc.spi.Row;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import lombok.RequiredArgsConstructor;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * @title        PromptLibraryRepository.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  提示词库持久化仓储
 * @createTime   2026-06-29 22:15:00
 */
@Repository
@RequiredArgsConstructor
public class PromptLibraryRepository {

    /** 数据库客户端 */
    private final DatabaseClient databaseClient;

    /**
     * 查询提示词列表。
     *
     * @param request PromptListRequest 查询请求
     * @return Flux<PromptRecord> 提示词记录流
     */
    public Flux<PromptLibraryRecords.PromptRecord> listPrompts(PromptLibraryDtos.PromptListRequest request) {
        QueryParts parts = buildWhere(request);
        int limit = Math.max(1, request.pageSize());
        int offset = (Math.max(1, request.page()) - 1) * limit;
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                SELECT id, title, prompt_content, cover_url, preview_content, category, tags_data::text AS tags_data,
                       source_url, status, sort_order, created_by, created_at, updated_at, deleted_at
                FROM prompt_library
                %s
                ORDER BY sort_order ASC, updated_at DESC, id DESC
                LIMIT :limit OFFSET :offset
                """.formatted(parts.where()))
                .bind("limit", limit)
                .bind("offset", offset);
        spec = bindQuery(spec, parts);
        return spec.map((row, metadata) -> mapPrompt(row)).all();
    }

    /**
     * 统计提示词数量。
     *
     * @param request PromptListRequest 查询请求
     * @return Mono<Long> 总数
     */
    public Mono<Long> countPrompts(PromptLibraryDtos.PromptListRequest request) {
        QueryParts parts = buildWhere(request);
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("SELECT COUNT(1) AS total FROM prompt_library " + parts.where());
        spec = bindQuery(spec, parts);
        return spec.map((row, metadata) -> Objects.requireNonNull(row.get("total", Long.class))).one();
    }

    /**
     * 查询分类选项。
     *
     * @param userOnly boolean 是否只查询用户可见数据
     * @return Flux<String> 分类列表
     */
    public Flux<String> listCategories(boolean userOnly) {
        String statusWhere = userOnly ? "AND status = 1" : "";
        return databaseClient.sql("""
                SELECT DISTINCT category
                FROM prompt_library
                WHERE deleted_at IS NULL %s
                ORDER BY category ASC
                """.formatted(statusWhere))
                .map((row, metadata) -> row.get("category", String.class))
                .all();
    }

    /**
     * 查询标签选项。
     *
     * @param userOnly boolean 是否只查询用户可见数据
     * @return Flux<String> 标签列表
     */
    public Flux<String> listTags(boolean userOnly) {
        String statusWhere = userOnly ? "AND status = 1" : "";
        return databaseClient.sql("""
                SELECT DISTINCT jsonb_array_elements_text(tags_data) AS tag
                FROM prompt_library
                WHERE deleted_at IS NULL %s
                ORDER BY tag ASC
                """.formatted(statusWhere))
                .map((row, metadata) -> row.get("tag", String.class))
                .all();
    }

    /**
     * 创建提示词。
     *
     * @param record PromptRecord 提示词记录
     * @return Mono<Long> 新增提示词ID
     */
    public Mono<Long> createPrompt(PromptLibraryRecords.PromptRecord record) {
        return databaseClient.sql("""
                INSERT INTO prompt_library(title, prompt_content, cover_url, preview_content, category, tags_data, source_url, status, sort_order, created_by)
                VALUES (:title, :promptContent, :coverUrl, :previewContent, :category, CAST(:tagsData AS jsonb), :sourceUrl, :status, :sortOrder, :createdBy)
                RETURNING id
                """)
                .bind("title", record.getTitle())
                .bind("promptContent", record.getPromptContent())
                .bind("coverUrl", record.getCoverUrl())
                .bind("previewContent", record.getPreviewContent())
                .bind("category", record.getCategory())
                .bind("tagsData", JSON.toJSONString(record.getTags()))
                .bind("sourceUrl", record.getSourceUrl())
                .bind("status", record.getStatus())
                .bind("sortOrder", record.getSortOrder())
                .bind("createdBy", record.getCreatedBy())
                .map((row, metadata) -> row.get("id", Long.class))
                .one();
    }

    /**
     * 更新提示词。
     *
     * @param record PromptRecord 提示词记录
     * @return Mono<Void> 更新结果
     */
    public Mono<Void> updatePrompt(PromptLibraryRecords.PromptRecord record) {
        return databaseClient.sql("""
                UPDATE prompt_library
                SET title = :title,
                    prompt_content = :promptContent,
                    cover_url = :coverUrl,
                    preview_content = :previewContent,
                    category = :category,
                    tags_data = CAST(:tagsData AS jsonb),
                    source_url = :sourceUrl,
                    status = :status,
                    sort_order = :sortOrder,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = :id AND deleted_at IS NULL
                """)
                .bind("id", record.getId())
                .bind("title", record.getTitle())
                .bind("promptContent", record.getPromptContent())
                .bind("coverUrl", record.getCoverUrl())
                .bind("previewContent", record.getPreviewContent())
                .bind("category", record.getCategory())
                .bind("tagsData", JSON.toJSONString(record.getTags()))
                .bind("sourceUrl", record.getSourceUrl())
                .bind("status", record.getStatus())
                .bind("sortOrder", record.getSortOrder())
                .fetch()
                .rowsUpdated()
                .then();
    }

    /**
     * 更新提示词状态。
     *
     * @param id Long 提示词ID
     * @param status Integer 状态
     * @return Mono<Void> 更新结果
     */
    public Mono<Void> updatePromptStatus(Long id, Integer status) {
        return databaseClient.sql("""
                UPDATE prompt_library
                SET status = :status, updated_at = CURRENT_TIMESTAMP
                WHERE id = :id AND deleted_at IS NULL
                """)
                .bind("id", id)
                .bind("status", status)
                .fetch()
                .rowsUpdated()
                .then();
    }

    /**
     * 软删除提示词。
     *
     * @param ids List<Long> 提示词ID列表
     * @return Mono<Void> 删除结果
     */
    public Mono<Void> deletePrompts(List<Long> ids) {
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                UPDATE prompt_library
                SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                WHERE deleted_at IS NULL AND id IN (%s)
                """.formatted(R2dbcBindings.namedPlaceholders("id", ids.size())));
        spec = R2dbcBindings.bindList(spec, "id", ids);
        return spec.fetch().rowsUpdated().then();
    }

    /**
     * 构建查询条件。
     *
     * @param request PromptListRequest 查询请求
     * @return QueryParts 查询片段
     */
    private QueryParts buildWhere(PromptLibraryDtos.PromptListRequest request) {
        List<String> conditions = new ArrayList<>();
        conditions.add("deleted_at IS NULL");
        List<BindValue> binds = new ArrayList<>();
        if (request.status() != null) {
            conditions.add("status = :status");
            binds.add(new BindValue("status", request.status()));
        }
        String category = request.category() == null ? "" : request.category().trim();
        if (!category.isBlank() && !"全部".equals(category) && !"all".equalsIgnoreCase(category)) {
            conditions.add("category = :category");
            binds.add(new BindValue("category", category));
        }
        String keyword = request.keyword() == null ? "" : request.keyword().trim().toLowerCase();
        if (!keyword.isBlank()) {
            conditions.add("(LOWER(title) LIKE :keyword OR LOWER(prompt_content) LIKE :keyword OR LOWER(category) LIKE :keyword)");
            binds.add(new BindValue("keyword", "%" + keyword + "%"));
        }
        List<String> tags = request.tags() == null ? List.of() : request.tags().stream().filter(tag -> tag != null && !tag.isBlank()).map(String::trim).toList();
        for (int index = 0; index < tags.size(); index++) {
            String key = "tag" + index;
            conditions.add("jsonb_exists(tags_data, :" + key + ")");
            binds.add(new BindValue(key, tags.get(index)));
        }
        return new QueryParts("WHERE " + String.join(" AND ", conditions), binds);
    }

    /**
     * 绑定查询参数。
     *
     * @param spec GenericExecuteSpec SQL执行器
     * @param parts QueryParts 查询片段
     * @return GenericExecuteSpec 绑定后的SQL执行器
     */
    private DatabaseClient.GenericExecuteSpec bindQuery(DatabaseClient.GenericExecuteSpec spec, QueryParts parts) {
        DatabaseClient.GenericExecuteSpec bound = spec;
        for (BindValue bind : parts.binds()) {
            bound = bound.bind(bind.name(), bind.value());
        }
        return bound;
    }

    /**
     * 映射提示词记录。
     *
     * @param row Row 数据库行
     * @return PromptRecord 提示词记录
     */
    private PromptLibraryRecords.PromptRecord mapPrompt(Row row) {
        PromptLibraryRecords.PromptRecord record = new PromptLibraryRecords.PromptRecord();
        record.setId(row.get("id", Long.class));
        record.setTitle(row.get("title", String.class));
        record.setPromptContent(row.get("prompt_content", String.class));
        record.setCoverUrl(row.get("cover_url", String.class));
        record.setPreviewContent(row.get("preview_content", String.class));
        record.setCategory(row.get("category", String.class));
        record.setTags(parseTags(row.get("tags_data", String.class)));
        record.setSourceUrl(row.get("source_url", String.class));
        record.setStatus(row.get("status", Integer.class));
        record.setSortOrder(row.get("sort_order", Integer.class));
        record.setCreatedBy(row.get("created_by", Long.class));
        record.setCreatedAt(row.get("created_at", OffsetDateTime.class));
        record.setUpdatedAt(row.get("updated_at", OffsetDateTime.class));
        record.setDeletedAt(row.get("deleted_at", OffsetDateTime.class));
        return record;
    }

    /**
     * 解析标签JSON。
     *
     * @param tagsData String 标签JSON
     * @return List<String> 标签列表
     */
    private List<String> parseTags(String tagsData) {
        if (tagsData == null || tagsData.isBlank()) return List.of();
        return JSON.parseArray(tagsData, String.class);
    }

    /**
     * SQL绑定值。
     *
     * @param name String 参数名称
     * @param value Object 参数值
     */
    private record BindValue(String name, Object value) {
    }

    /**
     * SQL查询片段。
     *
     * @param where String WHERE片段
     * @param binds List<BindValue> 绑定值列表
     */
    private record QueryParts(String where, List<BindValue> binds) {
    }
}
