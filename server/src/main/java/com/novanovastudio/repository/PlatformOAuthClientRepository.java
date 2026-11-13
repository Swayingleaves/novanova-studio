package com.novanovastudio.repository;

import com.novanovastudio.entity.PlatformOAuthClientRecords;
import java.time.OffsetDateTime;
import lombok.RequiredArgsConstructor;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 对外 OAuth2 授权客户端数据库访问层。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-09 18:40
 */
@Repository
@RequiredArgsConstructor
public class PlatformOAuthClientRepository {

    /** 配置列清单 */
    private static final String COLUMNS = """
            client_id, display_name, enabled, client_secret_encrypted, redirect_uris,
            logo_storage_key, logo_storage_id, logo_object_key, logo_mime_type, display_content, created_at, updated_at
            """;

    /** 数据库客户端 */
    private final DatabaseClient databaseClient;

    /**
     * 读取全部授权客户端，按创建时间排列。
     *
     * @return Flux<OAuthClientRecord> 授权客户端
     */
    public Flux<PlatformOAuthClientRecords.OAuthClientRecord> findAll() {
        return databaseClient.sql("SELECT " + COLUMNS + " FROM platform_oauth_clients ORDER BY created_at ASC, client_id ASC")
                .map((row, metadata) -> mapRecord(row))
                .all();
    }

    /**
     * 按客户端标识读取配置。
     *
     * @param clientId String 客户端标识
     * @return Mono<OAuthClientRecord> 授权客户端，不存在时为空
     */
    public Mono<PlatformOAuthClientRecords.OAuthClientRecord> findByClientId(String clientId) {
        return databaseClient.sql("SELECT " + COLUMNS + " FROM platform_oauth_clients WHERE client_id = :clientId")
                .bind("clientId", clientId)
                .map((row, metadata) -> mapRecord(row))
                .one();
    }

    /**
     * 新增授权客户端。
     *
     * @param record OAuthClientRecord 授权客户端
     * @return Mono<Long> 受影响行数
     */
    public Mono<Long> insert(PlatformOAuthClientRecords.OAuthClientRecord record) {
        DatabaseClient.GenericExecuteSpec specification = databaseClient.sql("""
                INSERT INTO platform_oauth_clients(
                    client_id, display_name, enabled, client_secret_encrypted, redirect_uris,
                    logo_storage_key, logo_storage_id, logo_object_key, logo_mime_type, display_content
                ) VALUES (
                    :clientId, :displayName, :enabled, :clientSecretEncrypted, :redirectUris,
                    :logoStorageKey, :logoStorageId, :logoObjectKey, :logoMimeType, :displayContent
                )
                """)
                .bind("clientId", record.getClientId())
                .bind("displayName", record.getDisplayName())
                .bind("enabled", record.getEnabled())
                .bind("clientSecretEncrypted", record.getClientSecretEncrypted())
                .bind("redirectUris", record.getRedirectUris());
        return bindPresentation(specification, record)
                .fetch()
                .rowsUpdated();
    }

    /**
     * 更新名称、启用状态、回调地址和授权页展示，不改动密钥。
     *
     * @param record OAuthClientRecord 授权客户端
     * @return Mono<Long> 受影响行数
     */
    public Mono<Long> update(PlatformOAuthClientRecords.OAuthClientRecord record) {
        DatabaseClient.GenericExecuteSpec specification = databaseClient.sql("""
                UPDATE platform_oauth_clients
                SET display_name = :displayName,
                    enabled = :enabled,
                    redirect_uris = :redirectUris,
                    logo_storage_key = :logoStorageKey,
                    logo_storage_id = :logoStorageId,
                    logo_object_key = :logoObjectKey,
                    logo_mime_type = :logoMimeType,
                    display_content = :displayContent,
                    updated_at = CURRENT_TIMESTAMP
                WHERE client_id = :clientId
                """)
                .bind("clientId", record.getClientId())
                .bind("displayName", record.getDisplayName())
                .bind("enabled", record.getEnabled())
                .bind("redirectUris", record.getRedirectUris());
        return bindPresentation(specification, record)
                .fetch()
                .rowsUpdated();
    }

    /**
     * 绑定可为空的授权页展示字段。
     *
     * @param specification GenericExecuteSpec 已绑定基础字段的语句
     * @param record OAuthClientRecord 授权客户端
     * @return GenericExecuteSpec 可执行语句
     */
    private DatabaseClient.GenericExecuteSpec bindPresentation(DatabaseClient.GenericExecuteSpec specification,
                                                               PlatformOAuthClientRecords.OAuthClientRecord record) {
        specification = R2dbcBindings.bindNullable(specification, "logoStorageKey", record.getLogoStorageKey(), String.class);
        specification = R2dbcBindings.bindNullable(specification, "logoStorageId", record.getLogoStorageId(), String.class);
        specification = R2dbcBindings.bindNullable(specification, "logoObjectKey", record.getLogoObjectKey(), String.class);
        specification = R2dbcBindings.bindNullable(specification, "logoMimeType", record.getLogoMimeType(), String.class);
        return R2dbcBindings.bindNullable(specification, "displayContent", record.getDisplayContent(), String.class);
    }

    /**
     * 替换指定客户端的密钥。
     *
     * @param clientId String 客户端标识
     * @param clientSecretEncrypted String 加密后的新密钥
     * @return Mono<Long> 受影响行数
     */
    public Mono<Long> updateSecret(String clientId, String clientSecretEncrypted) {
        return databaseClient.sql("""
                UPDATE platform_oauth_clients
                SET client_secret_encrypted = :clientSecretEncrypted,
                    updated_at = CURRENT_TIMESTAMP
                WHERE client_id = :clientId
                """)
                .bind("clientId", clientId)
                .bind("clientSecretEncrypted", clientSecretEncrypted)
                .fetch()
                .rowsUpdated();
    }

    /**
     * 删除授权客户端。
     *
     * @param clientId String 客户端标识
     * @return Mono<Long> 受影响行数
     */
    public Mono<Long> delete(String clientId) {
        return databaseClient.sql("DELETE FROM platform_oauth_clients WHERE client_id = :clientId")
                .bind("clientId", clientId)
                .fetch()
                .rowsUpdated();
    }

    /**
     * 把数据库行转换为客户端记录。
     *
     * @param row 数据库行
     * @return OAuthClientRecord 客户端记录
     */
    private PlatformOAuthClientRecords.OAuthClientRecord mapRecord(io.r2dbc.spi.Row row) {
        PlatformOAuthClientRecords.OAuthClientRecord record = new PlatformOAuthClientRecords.OAuthClientRecord();
        record.setClientId(row.get("client_id", String.class));
        record.setDisplayName(row.get("display_name", String.class));
        record.setEnabled(Boolean.TRUE.equals(row.get("enabled", Boolean.class)));
        record.setClientSecretEncrypted(row.get("client_secret_encrypted", String.class));
        record.setRedirectUris(row.get("redirect_uris", String.class));
        record.setLogoStorageKey(row.get("logo_storage_key", String.class));
        record.setLogoStorageId(row.get("logo_storage_id", String.class));
        record.setLogoObjectKey(row.get("logo_object_key", String.class));
        record.setLogoMimeType(row.get("logo_mime_type", String.class));
        record.setDisplayContent(row.get("display_content", String.class));
        record.setCreatedAt(row.get("created_at", OffsetDateTime.class));
        record.setUpdatedAt(row.get("updated_at", OffsetDateTime.class));
        return record;
    }
}
