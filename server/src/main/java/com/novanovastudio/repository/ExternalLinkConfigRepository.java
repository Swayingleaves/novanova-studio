package com.novanovastudio.repository;

import com.novanovastudio.entity.PlatformExternalLinkConfigRecords;
import lombok.RequiredArgsConstructor;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Mono;

/**
 * 平台全局展示外链配置数据库访问层。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-13 14:20
 */
@Repository
@RequiredArgsConstructor
public class ExternalLinkConfigRepository {

    private final DatabaseClient databaseClient;

    /**
     * 读取唯一的展示外链配置。
     *
     * @return 配置记录，未配置时为空
     */
    public Mono<PlatformExternalLinkConfigRecords.ExternalLinkConfigRecord> findSingleton() {
        return databaseClient.sql("""
                SELECT title, url, description, cover_url, created_at, updated_at
                FROM platform_external_link_config
                WHERE id = 1
                """).map((row, metadata) -> mapRecord(row)).one();
    }

    /**
     * 写入唯一的展示外链配置，已存在时覆盖。
     *
     * @param record 配置记录
     * @return 写入完成信号
     */
    public Mono<Void> upsert(PlatformExternalLinkConfigRecords.ExternalLinkConfigRecord record) {
        return databaseClient.sql("""
                INSERT INTO platform_external_link_config(id, title, url, description, cover_url)
                VALUES (1, :title, :url, :description, :coverUrl)
                ON CONFLICT (id) DO UPDATE SET
                    title = EXCLUDED.title,
                    url = EXCLUDED.url,
                    description = EXCLUDED.description,
                    cover_url = EXCLUDED.cover_url,
                    updated_at = CURRENT_TIMESTAMP
                """)
                .bind("title", record.getTitle())
                .bind("url", record.getUrl())
                .bind("description", record.getDescription())
                .bind("coverUrl", record.getCoverUrl())
                .fetch()
                .rowsUpdated()
                .then();
    }

    /**
     * 删除展示外链配置，右上角不再展示入口。
     *
     * @return 删除完成信号
     */
    public Mono<Void> deleteSingleton() {
        return databaseClient.sql("DELETE FROM platform_external_link_config WHERE id = 1")
                .fetch()
                .rowsUpdated()
                .then();
    }

    private PlatformExternalLinkConfigRecords.ExternalLinkConfigRecord mapRecord(io.r2dbc.spi.Row row) {
        PlatformExternalLinkConfigRecords.ExternalLinkConfigRecord record = new PlatformExternalLinkConfigRecords.ExternalLinkConfigRecord();
        record.setTitle(row.get("title", String.class));
        record.setUrl(row.get("url", String.class));
        record.setDescription(row.get("description", String.class));
        record.setCoverUrl(row.get("cover_url", String.class));
        record.setCreatedAt(row.get("created_at", java.time.OffsetDateTime.class));
        record.setUpdatedAt(row.get("updated_at", java.time.OffsetDateTime.class));
        return record;
    }
}
