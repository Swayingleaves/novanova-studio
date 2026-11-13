package com.novanovastudio.repository;

import com.novanovastudio.entity.PlatformStandardOAuthProviderRecords;
import java.time.OffsetDateTime;
import lombok.RequiredArgsConstructor;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 平台标准 OAuth2 登录渠道配置数据库访问层。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-09 14:30
 */
@Repository
@RequiredArgsConstructor
public class StandardOAuthProviderRepository {

    /** 数据库客户端 */
    private final DatabaseClient databaseClient;

    /** 配置列清单 */
    private static final String COLUMNS = """
            provider, display_name, enabled, client_id, client_secret_encrypted, redirect_uri,
            authorization_uri, token_uri, user_info_uri, scopes, client_authentication_method,
            user_name_attribute, email_attribute, nickname_attribute, avatar_attribute,
            created_at, updated_at
            """;

    /**
     * 读取全部标准 OAuth2 渠道配置。
     *
     * @return Flux<StandardOAuthProviderRecord> 渠道配置
     */
    public Flux<PlatformStandardOAuthProviderRecords.StandardOAuthProviderRecord> findAll() {
        return databaseClient.sql("SELECT " + COLUMNS + " FROM platform_standard_oauth_providers ORDER BY created_at ASC, provider ASC")
                .map((row, metadata) -> mapRecord(row))
                .all();
    }

    /**
     * 按渠道标识读取配置。
     *
     * @param provider String 渠道标识
     * @return Mono<StandardOAuthProviderRecord> 渠道配置，不存在时为空
     */
    public Mono<PlatformStandardOAuthProviderRecords.StandardOAuthProviderRecord> findByProvider(String provider) {
        return databaseClient.sql("SELECT " + COLUMNS + " FROM platform_standard_oauth_providers WHERE provider = :provider")
                .bind("provider", provider)
                .map((row, metadata) -> mapRecord(row))
                .one();
    }

    /**
     * 新增渠道配置。
     *
     * @param record StandardOAuthProviderRecord 渠道配置
     * @return Mono<Long> 受影响行数
     */
    public Mono<Long> insert(PlatformStandardOAuthProviderRecords.StandardOAuthProviderRecord record) {
        return databaseClient.sql("""
                INSERT INTO platform_standard_oauth_providers(
                    provider, display_name, enabled, client_id, client_secret_encrypted, redirect_uri,
                    authorization_uri, token_uri, user_info_uri, scopes, client_authentication_method,
                    user_name_attribute, email_attribute, nickname_attribute, avatar_attribute
                ) VALUES (
                    :provider, :displayName, :enabled, :clientId, :clientSecretEncrypted, :redirectUri,
                    :authorizationUri, :tokenUri, :userInfoUri, :scopes, :clientAuthenticationMethod,
                    :userNameAttribute, :emailAttribute, :nicknameAttribute, :avatarAttribute
                )
                """)
                .bind("provider", record.getProvider())
                .bind("displayName", record.getDisplayName())
                .bind("enabled", record.getEnabled())
                .bind("clientId", record.getClientId())
                .bind("clientSecretEncrypted", record.getClientSecretEncrypted())
                .bind("redirectUri", record.getRedirectUri())
                .bind("authorizationUri", record.getAuthorizationUri())
                .bind("tokenUri", record.getTokenUri())
                .bind("userInfoUri", record.getUserInfoUri())
                .bind("scopes", record.getScopes())
                .bind("clientAuthenticationMethod", record.getClientAuthenticationMethod())
                .bind("userNameAttribute", record.getUserNameAttribute())
                .bind("emailAttribute", record.getEmailAttribute())
                .bind("nicknameAttribute", record.getNicknameAttribute())
                .bind("avatarAttribute", record.getAvatarAttribute())
                .fetch()
                .rowsUpdated();
    }

    /**
     * 更新渠道配置。
     *
     * @param record StandardOAuthProviderRecord 渠道配置
     * @return Mono<Long> 受影响行数
     */
    public Mono<Long> update(PlatformStandardOAuthProviderRecords.StandardOAuthProviderRecord record) {
        return databaseClient.sql("""
                UPDATE platform_standard_oauth_providers
                SET display_name = :displayName,
                    enabled = :enabled,
                    client_id = :clientId,
                    client_secret_encrypted = :clientSecretEncrypted,
                    redirect_uri = :redirectUri,
                    authorization_uri = :authorizationUri,
                    token_uri = :tokenUri,
                    user_info_uri = :userInfoUri,
                    scopes = :scopes,
                    client_authentication_method = :clientAuthenticationMethod,
                    user_name_attribute = :userNameAttribute,
                    email_attribute = :emailAttribute,
                    nickname_attribute = :nicknameAttribute,
                    avatar_attribute = :avatarAttribute,
                    updated_at = CURRENT_TIMESTAMP
                WHERE provider = :provider
                """)
                .bind("provider", record.getProvider())
                .bind("displayName", record.getDisplayName())
                .bind("enabled", record.getEnabled())
                .bind("clientId", record.getClientId())
                .bind("clientSecretEncrypted", record.getClientSecretEncrypted())
                .bind("redirectUri", record.getRedirectUri())
                .bind("authorizationUri", record.getAuthorizationUri())
                .bind("tokenUri", record.getTokenUri())
                .bind("userInfoUri", record.getUserInfoUri())
                .bind("scopes", record.getScopes())
                .bind("clientAuthenticationMethod", record.getClientAuthenticationMethod())
                .bind("userNameAttribute", record.getUserNameAttribute())
                .bind("emailAttribute", record.getEmailAttribute())
                .bind("nicknameAttribute", record.getNicknameAttribute())
                .bind("avatarAttribute", record.getAvatarAttribute())
                .fetch()
                .rowsUpdated();
    }

    /**
     * 删除渠道配置。
     *
     * @param provider String 渠道标识
     * @return Mono<Long> 受影响行数
     */
    public Mono<Long> delete(String provider) {
        return databaseClient.sql("DELETE FROM platform_standard_oauth_providers WHERE provider = :provider")
                .bind("provider", provider)
                .fetch()
                .rowsUpdated();
    }

    /**
     * 统计渠道已绑定的用户数量。
     *
     * @param provider String 渠道标识
     * @return Mono<Long> 绑定数量
     */
    public Mono<Long> countBindings(String provider) {
        return databaseClient.sql("SELECT COUNT(*) AS binding_count FROM user_identity_bindings WHERE provider = :provider")
                .bind("provider", provider)
                .map((row, metadata) -> row.get("binding_count", Long.class))
                .one();
    }

    /**
     * 把数据库行转换为配置记录。
     *
     * @param row 数据库行
     * @return StandardOAuthProviderRecord 配置记录
     */
    private PlatformStandardOAuthProviderRecords.StandardOAuthProviderRecord mapRecord(io.r2dbc.spi.Row row) {
        PlatformStandardOAuthProviderRecords.StandardOAuthProviderRecord record = new PlatformStandardOAuthProviderRecords.StandardOAuthProviderRecord();
        record.setProvider(row.get("provider", String.class));
        record.setDisplayName(row.get("display_name", String.class));
        record.setEnabled(Boolean.TRUE.equals(row.get("enabled", Boolean.class)));
        record.setClientId(row.get("client_id", String.class));
        record.setClientSecretEncrypted(row.get("client_secret_encrypted", String.class));
        record.setRedirectUri(row.get("redirect_uri", String.class));
        record.setAuthorizationUri(row.get("authorization_uri", String.class));
        record.setTokenUri(row.get("token_uri", String.class));
        record.setUserInfoUri(row.get("user_info_uri", String.class));
        record.setScopes(row.get("scopes", String.class));
        record.setClientAuthenticationMethod(row.get("client_authentication_method", String.class));
        record.setUserNameAttribute(row.get("user_name_attribute", String.class));
        record.setEmailAttribute(row.get("email_attribute", String.class));
        record.setNicknameAttribute(row.get("nickname_attribute", String.class));
        record.setAvatarAttribute(row.get("avatar_attribute", String.class));
        record.setCreatedAt(row.get("created_at", OffsetDateTime.class));
        record.setUpdatedAt(row.get("updated_at", OffsetDateTime.class));
        return record;
    }
}
