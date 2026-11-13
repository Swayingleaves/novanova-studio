package com.novanovastudio.repository;

import com.novanovastudio.entity.PlatformOAuthProviderRecords;
import lombok.RequiredArgsConstructor;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 平台 OAuth2 第三方登录渠道配置数据库访问层。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-09 12:00
 */
@Repository
@RequiredArgsConstructor
public class OAuthProviderConfigRepository {

    /** 数据库客户端 */
    private final DatabaseClient databaseClient;

    /**
     * 读取全部登录渠道配置。
     *
     * @return Flux<OAuthProviderRecord> 登录渠道配置
     */
    public Flux<PlatformOAuthProviderRecords.OAuthProviderRecord> findAll() {
        return databaseClient.sql("""
                SELECT provider, enabled, client_id, client_secret_encrypted, redirect_uri, updated_at
                FROM platform_oauth_providers
                """).map((row, metadata) -> mapRecord(row)).all();
    }

    /**
     * 按渠道标识读取配置。
     *
     * @param provider String 渠道标识
     * @return Mono<OAuthProviderRecord> 登录渠道配置，不存在时为空
     */
    public Mono<PlatformOAuthProviderRecords.OAuthProviderRecord> findByProvider(String provider) {
        return databaseClient.sql("""
                SELECT provider, enabled, client_id, client_secret_encrypted, redirect_uri, updated_at
                FROM platform_oauth_providers
                WHERE provider = :provider
                """)
                .bind("provider", provider)
                .map((row, metadata) -> mapRecord(row))
                .one();
    }

    /**
     * 更新指定渠道的配置。
     *
     * @param record OAuthProviderRecord 渠道配置
     * @return Mono<Long> 受影响行数
     */
    public Mono<Long> update(PlatformOAuthProviderRecords.OAuthProviderRecord record) {
        return databaseClient.sql("""
                UPDATE platform_oauth_providers
                SET enabled = :enabled,
                    client_id = :clientId,
                    client_secret_encrypted = :clientSecretEncrypted,
                    redirect_uri = :redirectUri,
                    updated_at = CURRENT_TIMESTAMP
                WHERE provider = :provider
                """)
                .bind("provider", record.getProvider())
                .bind("enabled", record.getEnabled())
                .bind("clientId", record.getClientId())
                .bind("clientSecretEncrypted", record.getClientSecretEncrypted())
                .bind("redirectUri", record.getRedirectUri())
                .fetch()
                .rowsUpdated();
    }

    /**
     * 把数据库行转换为配置记录。
     *
     * @param row 数据库行
     * @return OAuthProviderRecord 配置记录
     */
    private PlatformOAuthProviderRecords.OAuthProviderRecord mapRecord(io.r2dbc.spi.Row row) {
        PlatformOAuthProviderRecords.OAuthProviderRecord record = new PlatformOAuthProviderRecords.OAuthProviderRecord();
        record.setProvider(row.get("provider", String.class));
        record.setEnabled(Boolean.TRUE.equals(row.get("enabled", Boolean.class)));
        record.setClientId(row.get("client_id", String.class));
        record.setClientSecretEncrypted(row.get("client_secret_encrypted", String.class));
        record.setRedirectUri(row.get("redirect_uri", String.class));
        record.setUpdatedAt(row.get("updated_at", java.time.OffsetDateTime.class));
        return record;
    }
}
