package com.novanovastudio.repository;

import com.novanovastudio.entity.PlatformCommunityConfigRecords;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 平台全局社群配置数据库访问层。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-29 15:30
 */
@Repository
@RequiredArgsConstructor
public class CommunityConfigRepository {

    /** 整份配置替换使用的咨询锁键，避免并发保存互相穿插 */
    private static final String REPLACE_LOCK_KEY = "platform-community-configs";

    private final DatabaseClient databaseClient;

    /**
     * 按排序值读取全部社群配置。
     *
     * @return 已排序的社群配置
     */
    public Flux<PlatformCommunityConfigRecords.CommunityConfigRecord> listOrdered() {
        return databaseClient.sql("""
                SELECT id, name, image_url, sort_order, created_at, updated_at
                FROM platform_community_configs
                ORDER BY sort_order ASC, id ASC
                """).map((row, metadata) -> mapRecord(row)).all();
    }

    /**
     * 在事务内获取整份配置的咨询锁。
     *
     * @return 加锁完成信号
     */
    public Mono<Void> lockForReplace() {
        return databaseClient.sql("SELECT pg_advisory_xact_lock(hashtext(:lockKey))")
                .bind("lockKey", REPLACE_LOCK_KEY)
                .fetch()
                .all()
                .then();
    }

    /**
     * 重建整份社群配置，调用方必须保证处于同一事务内。
     *
     * @param records 按展示顺序排列的配置
     * @return 写入完成信号
     */
    public Mono<Void> replaceAll(List<PlatformCommunityConfigRecords.CommunityConfigRecord> records) {
        return databaseClient.sql("DELETE FROM platform_community_configs")
                .fetch()
                .rowsUpdated()
                .thenMany(Flux.fromIterable(records).concatMap(this::insert))
                .then();
    }

    private Mono<Void> insert(PlatformCommunityConfigRecords.CommunityConfigRecord record) {
        return databaseClient.sql("""
                INSERT INTO platform_community_configs(name, image_url, sort_order)
                VALUES (:name, :imageUrl, :sortOrder)
                """)
                .bind("name", record.getName())
                .bind("imageUrl", record.getImageUrl())
                .bind("sortOrder", record.getSortOrder())
                .fetch()
                .rowsUpdated()
                .then();
    }

    private PlatformCommunityConfigRecords.CommunityConfigRecord mapRecord(io.r2dbc.spi.Row row) {
        PlatformCommunityConfigRecords.CommunityConfigRecord record = new PlatformCommunityConfigRecords.CommunityConfigRecord();
        record.setId(row.get("id", Long.class));
        record.setName(row.get("name", String.class));
        record.setImageUrl(row.get("image_url", String.class));
        record.setSortOrder(row.get("sort_order", Integer.class));
        record.setCreatedAt(row.get("created_at", java.time.OffsetDateTime.class));
        record.setUpdatedAt(row.get("updated_at", java.time.OffsetDateTime.class));
        return record;
    }
}
