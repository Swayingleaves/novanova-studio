package com.novanovastudio.repository;

import java.time.OffsetDateTime;
import lombok.RequiredArgsConstructor;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Mono;

/**
 * 平台模型调用成功率统计配置数据访问层。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-24 09:25:00
 */
@Repository
@RequiredArgsConstructor
public class ModelStatsSettingsRepository {

    /** 数据库客户端。 */
    private final DatabaseClient databaseClient;

    /**
     * 读取唯一的模型成功率统计配置记录。
     *
     * @return Mono<ModelStatsSettingsRow> 统计天数与更新时间
     */
    public Mono<ModelStatsSettingsRow> findSingleton() {
        return databaseClient.sql("""
                        SELECT success_rate_window_days, updated_at
                        FROM platform_model_stats_settings
                        WHERE id = 1
                        """)
                .map((row, metadata) -> mapRow(row))
                .one();
    }

    /**
     * 保存模型成功率统计天数并返回落库记录。
     *
     * @param successRateWindowDays int 统计天数窗口
     * @return Mono<ModelStatsSettingsRow> 更新后的配置记录
     */
    public Mono<ModelStatsSettingsRow> upsert(int successRateWindowDays) {
        return databaseClient.sql("""
                        INSERT INTO platform_model_stats_settings(id, success_rate_window_days)
                        VALUES (1, :successRateWindowDays)
                        ON CONFLICT (id) DO UPDATE SET
                            success_rate_window_days = EXCLUDED.success_rate_window_days,
                            updated_at = CURRENT_TIMESTAMP
                        RETURNING success_rate_window_days, updated_at
                        """)
                .bind("successRateWindowDays", successRateWindowDays)
                .map((row, metadata) -> mapRow(row))
                .one();
    }

    /**
     * 将数据库行映射为配置记录。
     *
     * @param row io.r2dbc.spi.Row 数据库行
     * @return ModelStatsSettingsRow 配置记录
     */
    private ModelStatsSettingsRow mapRow(io.r2dbc.spi.Row row) {
        Integer days = row.get("success_rate_window_days", Integer.class);
        return new ModelStatsSettingsRow(days == null ? 3 : days, row.get("updated_at", OffsetDateTime.class));
    }

    /**
     * 统计配置查询行。
     *
     * @param successRateWindowDays 统计天数
     * @param updatedAt 更新时间
     */
    public record ModelStatsSettingsRow(int successRateWindowDays, OffsetDateTime updatedAt) {
    }
}
