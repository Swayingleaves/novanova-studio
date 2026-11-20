package com.novanovastudio.repository;

import com.novanovastudio.entity.PlatformVideoExportSettingsRecords;
import java.time.OffsetDateTime;
import lombok.RequiredArgsConstructor;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Mono;

/**
 * 平台漫剧视觉分镜板导出视频开关配置数据访问层。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-19 21:55:00
 */
@Repository
@RequiredArgsConstructor
public class VideoExportSettingsRepository {

    /** 数据库客户端。 */
    private final DatabaseClient databaseClient;

    /**
     * 读取唯一的导出视频开关配置记录。
     *
     * @return Mono<VideoExportSettingsRecord> 导出视频开关配置记录
     */
    public Mono<PlatformVideoExportSettingsRecords.VideoExportSettingsRecord> findSingleton() {
        return databaseClient.sql("""
                        SELECT enabled, created_at, updated_at
                        FROM platform_video_export_settings
                        WHERE id = 1
                        """)
                .map((row, metadata) -> mapRecord(row))
                .one();
    }

    /**
     * 保存导出视频开关配置并返回最新落库记录。
     *
     * @param enabled boolean 是否开启导出视频功能
     * @return Mono<VideoExportSettingsRecord> 更新后的配置记录
     */
    public Mono<PlatformVideoExportSettingsRecords.VideoExportSettingsRecord> upsert(boolean enabled) {
        return databaseClient.sql("""
                        INSERT INTO platform_video_export_settings(id, enabled)
                        VALUES (1, :enabled)
                        ON CONFLICT (id) DO UPDATE SET
                            enabled = EXCLUDED.enabled,
                            updated_at = CURRENT_TIMESTAMP
                        RETURNING enabled, created_at, updated_at
                        """)
                .bind("enabled", enabled)
                .map((row, metadata) -> mapRecord(row))
                .one();
    }

    /**
     * 将数据库行映射为导出视频开关配置实体。
     *
     * @param row io.r2dbc.spi.Row 数据库行
     * @return VideoExportSettingsRecord 配置实体记录
     */
    private PlatformVideoExportSettingsRecords.VideoExportSettingsRecord mapRecord(io.r2dbc.spi.Row row) {
        PlatformVideoExportSettingsRecords.VideoExportSettingsRecord record =
                new PlatformVideoExportSettingsRecords.VideoExportSettingsRecord();
        record.setEnabled(row.get("enabled", Boolean.class));
        record.setCreatedAt(row.get("created_at", OffsetDateTime.class));
        record.setUpdatedAt(row.get("updated_at", OffsetDateTime.class));
        return record;
    }
}
