package com.novanovastudio.repository;

import com.novanovastudio.entity.PlatformClientDownloadSettingsRecords;
import java.time.OffsetDateTime;
import lombok.RequiredArgsConstructor;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Mono;

/**
 * 平台客户端下载链接配置数据访问层。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-22 14:35:00
 */
@Repository
@RequiredArgsConstructor
public class ClientDownloadSettingsRepository {

    /** 数据库客户端。 */
    private final DatabaseClient databaseClient;

    /**
     * 读取唯一的客户端下载链接配置记录。
     *
     * @return Mono<ClientDownloadSettingsRecord> 配置记录
     */
    public Mono<PlatformClientDownloadSettingsRecords.ClientDownloadSettingsRecord> findSingleton() {
        return databaseClient.sql("""
                        SELECT mac_intel_url, mac_apple_silicon_url, windows_url, created_at, updated_at
                        FROM platform_client_download_settings
                        WHERE id = 1
                        """)
                .map((row, metadata) -> mapRecord(row))
                .one();
    }

    /**
     * 保存客户端下载链接配置并返回最新落库记录。
     *
     * @param macIntelUrl String Mac 英特尔芯片下载链接
     * @param macAppleSiliconUrl String Mac M 系列芯片下载链接
     * @param windowsUrl String Windows 下载链接
     * @return Mono<ClientDownloadSettingsRecord> 更新后的配置记录
     */
    public Mono<PlatformClientDownloadSettingsRecords.ClientDownloadSettingsRecord> upsert(
            String macIntelUrl, String macAppleSiliconUrl, String windowsUrl) {
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                        INSERT INTO platform_client_download_settings(id, mac_intel_url, mac_apple_silicon_url, windows_url)
                        VALUES (1, :macIntelUrl, :macAppleSiliconUrl, :windowsUrl)
                        ON CONFLICT (id) DO UPDATE SET
                            mac_intel_url = EXCLUDED.mac_intel_url,
                            mac_apple_silicon_url = EXCLUDED.mac_apple_silicon_url,
                            windows_url = EXCLUDED.windows_url,
                            updated_at = CURRENT_TIMESTAMP
                        RETURNING mac_intel_url, mac_apple_silicon_url, windows_url, created_at, updated_at
                        """);
        spec = R2dbcBindings.bindNullable(spec, "macIntelUrl", macIntelUrl, String.class);
        spec = R2dbcBindings.bindNullable(spec, "macAppleSiliconUrl", macAppleSiliconUrl, String.class);
        spec = R2dbcBindings.bindNullable(spec, "windowsUrl", windowsUrl, String.class);
        return spec.map((row, metadata) -> mapRecord(row)).one();
    }

    /**
     * 将数据库行映射为客户端下载链接配置实体。
     *
     * @param row io.r2dbc.spi.Row 数据库行
     * @return ClientDownloadSettingsRecord 配置实体记录
     */
    private PlatformClientDownloadSettingsRecords.ClientDownloadSettingsRecord mapRecord(io.r2dbc.spi.Row row) {
        PlatformClientDownloadSettingsRecords.ClientDownloadSettingsRecord record =
                new PlatformClientDownloadSettingsRecords.ClientDownloadSettingsRecord();
        record.setMacIntelUrl(row.get("mac_intel_url", String.class));
        record.setMacAppleSiliconUrl(row.get("mac_apple_silicon_url", String.class));
        record.setWindowsUrl(row.get("windows_url", String.class));
        record.setCreatedAt(row.get("created_at", OffsetDateTime.class));
        record.setUpdatedAt(row.get("updated_at", OffsetDateTime.class));
        return record;
    }
}
