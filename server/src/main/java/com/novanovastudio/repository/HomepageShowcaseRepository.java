package com.novanovastudio.repository;

import com.novanovastudio.entity.HomepageShowcaseRecords;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.r2dbc.core.RowsFetchSpec;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 首页精选内容数据库访问层。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-07-18 12:00:00
 */
@Repository
@RequiredArgsConstructor
public class HomepageShowcaseRepository {

    private final DatabaseClient databaseClient;

    /** 查询公开启用内容。 */
    public Flux<HomepageShowcaseRecords.ShowcaseRecord> listPublic(int limit) {
        return query("WHERE deleted_at IS NULL AND status = 1", limit, 0);
    }

    /** 查询管理端全部未删除内容。 */
    public Flux<HomepageShowcaseRecords.ShowcaseRecord> listAdmin() {
        return databaseClient.sql("""
                SELECT id, title, description, category, creator_name, media_type, media_url, thumbnail_url, target_type, target_path,
                       prompt_content, sort_order, status, created_by, created_at, updated_at, deleted_at
                FROM homepage_showcases
                WHERE deleted_at IS NULL
                ORDER BY sort_order ASC, updated_at DESC, id DESC
                """).map((row, metadata) -> mapRecord(row)).all();
    }

    /** 创建首页精选内容。 */
    public Mono<Long> create(HomepageShowcaseRecords.ShowcaseRecord record) {
        return databaseClient.sql("""
                INSERT INTO homepage_showcases(title, description, category, creator_name, media_type, media_url, thumbnail_url,
                    target_type, target_path, prompt_content, sort_order, status, created_by)
                VALUES (:title, :description, :category, :creatorName, :mediaType, :mediaUrl, :thumbnailUrl,
                    :targetType, :targetPath, :promptContent, :sortOrder, :status, :createdBy)
                RETURNING id
                """)
                .bind("title", record.getTitle())
                .bind("description", record.getDescription())
                .bind("category", record.getCategory())
                .bind("creatorName", record.getCreatorName())
                .bind("mediaType", record.getMediaType())
                .bind("mediaUrl", record.getMediaUrl())
                .bind("thumbnailUrl", record.getThumbnailUrl())
                .bind("targetType", record.getTargetType())
                .bind("targetPath", record.getTargetPath())
                .bind("promptContent", record.getPromptContent())
                .bind("sortOrder", record.getSortOrder())
                .bind("status", record.getStatus())
                .bind("createdBy", record.getCreatedBy())
                .map((row, metadata) -> row.get("id", Long.class))
                .one();
    }

    /** 更新首页精选内容。 */
    public Mono<Void> update(HomepageShowcaseRecords.ShowcaseRecord record) {
        return databaseClient.sql("""
                UPDATE homepage_showcases
                SET title = :title, description = :description, category = :category, creator_name = :creatorName, media_type = :mediaType,
                    media_url = :mediaUrl, thumbnail_url = :thumbnailUrl, target_type = :targetType,
                    target_path = :targetPath, prompt_content = :promptContent, sort_order = :sortOrder,
                    status = :status, updated_at = CURRENT_TIMESTAMP
                WHERE id = :id AND deleted_at IS NULL
                """)
                .bind("id", record.getId())
                .bind("title", record.getTitle())
                .bind("description", record.getDescription())
                .bind("category", record.getCategory())
                .bind("creatorName", record.getCreatorName())
                .bind("mediaType", record.getMediaType())
                .bind("mediaUrl", record.getMediaUrl())
                .bind("thumbnailUrl", record.getThumbnailUrl())
                .bind("targetType", record.getTargetType())
                .bind("targetPath", record.getTargetPath())
                .bind("promptContent", record.getPromptContent())
                .bind("sortOrder", record.getSortOrder())
                .bind("status", record.getStatus())
                .fetch().rowsUpdated().then();
    }

    /** 更新状态。 */
    public Mono<Void> updateStatus(Long id, Integer status) {
        return databaseClient.sql("""
                UPDATE homepage_showcases SET status = :status, updated_at = CURRENT_TIMESTAMP
                WHERE id = :id AND deleted_at IS NULL
                """).bind("id", id).bind("status", status).fetch().rowsUpdated().then();
    }

    /** 批量软删除。 */
    public Mono<Void> delete(List<Long> ids) {
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                UPDATE homepage_showcases SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                WHERE deleted_at IS NULL AND id IN (%s)
                """.formatted(R2dbcBindings.namedPlaceholders("id", ids.size())));
        return R2dbcBindings.bindList(spec, "id", ids).fetch().rowsUpdated().then();
    }

    private Flux<HomepageShowcaseRecords.ShowcaseRecord> query(String where, int limit, int offset) {
        RowsFetchSpec<HomepageShowcaseRecords.ShowcaseRecord> query = databaseClient.sql("""
                SELECT id, title, description, category, creator_name, media_type, media_url, thumbnail_url, target_type, target_path,
                       prompt_content, sort_order, status, created_by, created_at, updated_at, deleted_at
                FROM homepage_showcases %s
                ORDER BY sort_order ASC, updated_at DESC, id DESC LIMIT :limit OFFSET :offset
                """.formatted(where)).bind("limit", limit).bind("offset", offset).map((row, metadata) -> mapRecord(row));
        return query.all();
    }

    private HomepageShowcaseRecords.ShowcaseRecord mapRecord(io.r2dbc.spi.Row row) {
        HomepageShowcaseRecords.ShowcaseRecord record = new HomepageShowcaseRecords.ShowcaseRecord();
        record.setId(row.get("id", Long.class));
        record.setTitle(row.get("title", String.class));
        record.setDescription(row.get("description", String.class));
        record.setCategory(row.get("category", String.class));
        record.setCreatorName(row.get("creator_name", String.class));
        record.setMediaType(row.get("media_type", String.class));
        record.setMediaUrl(row.get("media_url", String.class));
        record.setThumbnailUrl(row.get("thumbnail_url", String.class));
        record.setTargetType(row.get("target_type", String.class));
        record.setTargetPath(row.get("target_path", String.class));
        record.setPromptContent(row.get("prompt_content", String.class));
        record.setSortOrder(row.get("sort_order", Integer.class));
        record.setStatus(row.get("status", Integer.class));
        record.setCreatedBy(row.get("created_by", Long.class));
        record.setCreatedAt(row.get("created_at", java.time.OffsetDateTime.class));
        record.setUpdatedAt(row.get("updated_at", java.time.OffsetDateTime.class));
        record.setDeletedAt(row.get("deleted_at", java.time.OffsetDateTime.class));
        return record;
    }
}
