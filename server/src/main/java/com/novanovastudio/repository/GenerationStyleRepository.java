package com.novanovastudio.repository;

import com.novanovastudio.dto.GenerationStyleDtos;
import com.novanovastudio.entity.GenerationStyleRecords;
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
 * 图片和视频生成风格数据库访问。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-31 00:00
 */
@Repository
@RequiredArgsConstructor
public class GenerationStyleRepository {

    /** 响应式数据库客户端。 */
    private final DatabaseClient databaseClient;

    /**
     * 查询风格列表。
     *
     * @param request 风格列表请求
     * @param userOnly 是否只返回启用风格
     * @return 风格记录流
     */
    public Flux<GenerationStyleRecords.StyleRecord> listStyles(GenerationStyleDtos.StyleListRequest request, boolean userOnly) {
        QueryParts parts = buildWhere(request, userOnly);
        int pageSize = Math.max(1, request.pageSize());
        int offset = (Math.max(1, request.page()) - 1) * pageSize;
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                SELECT id, generation_type, name, style_prompt, cover_url, thumbnail_version, category, status, sort_order, created_at, updated_at, deleted_at
                FROM generation_styles
                %s
                ORDER BY sort_order ASC, id ASC
                LIMIT :limit OFFSET :offset
                """.formatted(parts.where()))
                .bind("limit", pageSize)
                .bind("offset", offset);
        return bind(spec, parts.binds()).map((row, metadata) -> map(row)).all();
    }

    /**
     * 统计风格数量。
     *
     * @param request 风格列表请求
     * @param userOnly 是否只统计启用风格
     * @return 风格总数
     */
    public Mono<Long> countStyles(GenerationStyleDtos.StyleListRequest request, boolean userOnly) {
        QueryParts parts = buildWhere(request, userOnly);
        return bind(databaseClient.sql("SELECT COUNT(1) AS total FROM generation_styles " + parts.where()), parts.binds())
                .map((row, metadata) -> Objects.requireNonNull(row.get("total", Long.class)))
                .one();
    }

    /**
     * 按启用状态和类型批量查询风格，结果顺序由调用方按ID顺序重建。
     *
     * @param generationType 生成类型
     * @param ids 风格ID
     * @return 风格记录流
     */
    public Flux<GenerationStyleRecords.StyleRecord> findEnabledByIds(String generationType, List<Long> ids) {
        if (ids == null || ids.isEmpty()) {
            return Flux.empty();
        }
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                SELECT id, generation_type, name, style_prompt, cover_url, thumbnail_version, category, status, sort_order, created_at, updated_at, deleted_at
                FROM generation_styles
                WHERE deleted_at IS NULL AND status = 1 AND generation_type = :generationType
                  AND id IN (%s)
                """.formatted(R2dbcBindings.namedPlaceholders("id", ids.size())))
                .bind("generationType", generationType);
        return R2dbcBindings.bindList(spec, "id", ids).map((row, metadata) -> map(row)).all();
    }

    /**
     * 创建风格。
     *
     * @param record 风格记录
     * @return 新风格ID
     */
    public Mono<Long> createStyle(GenerationStyleRecords.StyleRecord record) {
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                INSERT INTO generation_styles(generation_type, name, style_prompt, cover_url, cover_thumbnail, thumbnail_version, category, status, sort_order)
                VALUES (:generationType, :name, :stylePrompt, :coverUrl, :coverThumbnail, :thumbnailVersion, :category, :status, :sortOrder)
                RETURNING id
                """)
                .bind("generationType", record.getGenerationType())
                .bind("name", record.getName())
                .bind("stylePrompt", record.getStylePrompt())
                .bind("coverUrl", record.getCoverUrl())
                .bind("category", record.getCategory())
                .bind("status", record.getStatus())
                .bind("sortOrder", record.getSortOrder());
        return bindThumbnail(spec, record).map((row, metadata) -> row.get("id", Long.class))
                .one();
    }

    /**
     * 更新风格。
     *
     * @param record 风格记录
     * @return 更新行数
     */
    public Mono<Long> updateStyle(GenerationStyleRecords.StyleRecord record) {
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                UPDATE generation_styles
                SET generation_type = :generationType,
                    name = :name,
                    style_prompt = :stylePrompt,
                    cover_url = COALESCE(:coverUrl, cover_url),
                    cover_thumbnail = CASE WHEN :coverUrl IS NULL THEN cover_thumbnail ELSE :coverThumbnail END,
                    thumbnail_version = CASE WHEN :coverUrl IS NULL THEN thumbnail_version ELSE :thumbnailVersion END,
                    category = :category,
                    status = :status,
                    sort_order = :sortOrder,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = :id AND deleted_at IS NULL
                """)
                .bind("id", record.getId())
                .bind("generationType", record.getGenerationType())
                .bind("name", record.getName())
                .bind("stylePrompt", record.getStylePrompt())
                .bind("category", record.getCategory())
                .bind("status", record.getStatus())
                .bind("sortOrder", record.getSortOrder());
        spec = record.getCoverUrl() == null ? spec.bindNull("coverUrl", String.class) : spec.bind("coverUrl", record.getCoverUrl());
        return bindThumbnail(spec, record).fetch()
                .rowsUpdated();
    }

    /**
     * 读取当前作用域内的未删除风格封面地址。
     * @param id 风格标识
     * @param userOnly 是否只读已启用风格
     * @return 封面地址
     */
    public Mono<String> findCoverUrl(long id, boolean userOnly) {
        return databaseClient.sql("""
                SELECT cover_url FROM generation_styles
                WHERE id = :id AND deleted_at IS NULL AND (NOT :userOnly OR status = 1)
                """)
                .bind("id", id).bind("userOnly", userOnly)
                .map((row, metadata) -> row.get("cover_url", String.class)).one();
    }

    /**
     * 按风格主键和原封面地址更新图片，保留其他字段。
     * @param record 新封面和缩略图
     * @param previousCoverUrl 更新前的封面地址
     * @return 更新行数
     */
    public Mono<Long> replaceCover(GenerationStyleRecords.StyleRecord record, String previousCoverUrl) {
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                UPDATE generation_styles
                SET cover_url = :coverUrl, cover_thumbnail = :coverThumbnail, thumbnail_version = :thumbnailVersion,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = :id AND deleted_at IS NULL AND cover_url = :previousCoverUrl
                """)
                .bind("id", record.getId())
                .bind("coverUrl", record.getCoverUrl())
                .bind("previousCoverUrl", previousCoverUrl);
        return bindThumbnail(spec, record).fetch().rowsUpdated();
    }

    /**
     * 按版本加载缩略图。列表查询无需返回图片字节。
     * @param id 风格标识
     * @param version 缩略图版本
     * @param userOnly 是否仅允许读取启用风格
     * @return 缩略图字节
     */
    public Mono<byte[]> findThumbnail(long id, String version, boolean userOnly) {
        return databaseClient.sql("""
                SELECT cover_thumbnail FROM generation_styles
                WHERE id = :id AND deleted_at IS NULL AND thumbnail_version = :version
                  AND (NOT :userOnly OR status = 1)
                """)
                .bind("id", id).bind("version", version).bind("userOnly", userOnly)
                .map((row, metadata) -> row.get("cover_thumbnail", byte[].class)).one();
    }

    /**
     * 绑定可空的缩略图及其版本。
     * @param spec SQL执行规格
     * @param record 风格记录
     * @return 已绑定的执行规格
     */
    private DatabaseClient.GenericExecuteSpec bindThumbnail(DatabaseClient.GenericExecuteSpec spec, GenerationStyleRecords.StyleRecord record) {
        return record.getCoverThumbnail() == null
                ? spec.bindNull("coverThumbnail", byte[].class).bindNull("thumbnailVersion", String.class)
                : spec.bind("coverThumbnail", record.getCoverThumbnail()).bind("thumbnailVersion", record.getThumbnailVersion());
    }

    /**
     * 更新风格状态。
     *
     * @param id 风格ID
     * @param status 状态
     * @return 更新行数
     */
    public Mono<Long> updateStyleStatus(Long id, Integer status) {
        return databaseClient.sql("""
                UPDATE generation_styles
                SET status = :status, updated_at = CURRENT_TIMESTAMP
                WHERE id = :id AND deleted_at IS NULL
                """)
                .bind("id", id)
                .bind("status", status)
                .fetch()
                .rowsUpdated();
    }

    /**
     * 批量软删除风格。
     *
     * @param ids 风格ID列表
     * @return 操作完成信号
     */
    public Mono<Void> deleteStyles(List<Long> ids) {
        if (ids == null || ids.isEmpty()) {
            return Mono.empty();
        }
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                UPDATE generation_styles
                SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                WHERE deleted_at IS NULL AND id IN (%s)
                """.formatted(R2dbcBindings.namedPlaceholders("id", ids.size())));
        return R2dbcBindings.bindList(spec, "id", ids).fetch().rowsUpdated().then();
    }

    /**
     * 构建查询条件。
     *
     * @param request 风格列表请求
     * @param userOnly 是否只查询启用记录
     * @return 查询片段
     */
    private QueryParts buildWhere(GenerationStyleDtos.StyleListRequest request, boolean userOnly) {
        List<String> conditions = new ArrayList<>();
        List<BindValue> binds = new ArrayList<>();
        conditions.add("deleted_at IS NULL");
        if (userOnly) {
            conditions.add("status = 1");
        } else if (request.status() != null) {
            conditions.add("status = :status");
            binds.add(new BindValue("status", request.status()));
        }
        if (request.generationType() != null && !request.generationType().isBlank()
                && !"all".equalsIgnoreCase(request.generationType())) {
            conditions.add("generation_type = :generationType");
            binds.add(new BindValue("generationType", request.generationType()));
        }
        String keyword = request.keyword() == null ? "" : request.keyword().trim().toLowerCase(Locale.ROOT);
        if (!keyword.isBlank()) {
            conditions.add("(LOWER(name) LIKE :keyword OR LOWER(style_prompt) LIKE :keyword OR LOWER(category) LIKE :keyword)");
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
     * @return 风格记录
     */
    private GenerationStyleRecords.StyleRecord map(Row row) {
        GenerationStyleRecords.StyleRecord record = new GenerationStyleRecords.StyleRecord();
        record.setId(row.get("id", Long.class));
        record.setGenerationType(row.get("generation_type", String.class));
        record.setName(row.get("name", String.class));
        record.setStylePrompt(row.get("style_prompt", String.class));
        record.setCoverUrl(row.get("cover_url", String.class));
        record.setThumbnailVersion(row.get("thumbnail_version", String.class));
        record.setCategory(row.get("category", String.class));
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
