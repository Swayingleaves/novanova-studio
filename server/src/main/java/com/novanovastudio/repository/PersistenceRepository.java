package com.novanovastudio.repository;

import com.novanovastudio.entity.PersistenceRecords;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * @title        PersistenceRepository.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  响应式业务持久化仓储
 * @createTime   2026-06-24 18:25:00
 */
@Repository
@RequiredArgsConstructor
public class PersistenceRepository {

    /** 数据库客户端 */
    private final DatabaseClient databaseClient;

    /**
     * 查询用户AI渠道
     *
     * @param userId Long 用户ID
     * @return Flux<UserAiChannelRecord> 渠道列表
     */
    public Flux<PersistenceRecords.UserAiChannelRecord> listUserAiChannels(Long userId) {
        // 渠道按用户和排序值读取，只返回正常状态记录。
        return databaseClient.sql("""
                SELECT id, user_id, channel_id, name, base_url, api_key_encrypted, api_format, models::text AS models, sort_order, status, created_at, updated_at
                FROM user_ai_channels
                WHERE user_id = :userId AND status = 1
                ORDER BY sort_order ASC, id ASC
                """).bind("userId", userId).map((row, metadata) -> RowMappers.userAiChannel(row)).all();
    }

    /**
     * 替换保存用户AI渠道
     *
     * @param userId Long 用户ID
     * @param records List<UserAiChannelRecord> 渠道列表
     * @return Mono<Void> 操作结果
     */
    public Mono<Void> replaceUserAiChannels(Long userId, List<PersistenceRecords.UserAiChannelRecord> records) {
        // 按当前请求快照覆盖渠道，避免旧密钥被隐式保留。
        return databaseClient.sql("DELETE FROM user_ai_channels WHERE user_id = :userId")
                .bind("userId", userId)
                .fetch()
                .rowsUpdated()
                .thenMany(Flux.fromIterable(records == null ? List.of() : records))
                .concatMap(this::insertUserAiChannel)
                .then();
    }

    /**
     * 新增用户AI渠道
     *
     * @param record UserAiChannelRecord 渠道记录
     * @return Mono<Void> 操作结果
     */
    private Mono<Void> insertUserAiChannel(PersistenceRecords.UserAiChannelRecord record) {
        // 渠道模型以JSONB保存，API Key只保存加密结果。
        return databaseClient.sql("""
                INSERT INTO user_ai_channels(user_id, channel_id, name, base_url, api_key_encrypted, api_format, models, sort_order, status)
                VALUES (:userId, :channelId, :name, :baseUrl, :apiKeyEncrypted, :apiFormat, CAST(:models AS jsonb), :sortOrder, 1)
                """)
                .bind("userId", record.getUserId())
                .bind("channelId", record.getChannelId())
                .bind("name", record.getName())
                .bind("baseUrl", record.getBaseUrl())
                .bind("apiKeyEncrypted", record.getApiKeyEncrypted())
                .bind("apiFormat", record.getApiFormat())
                .bind("models", record.getModels())
                .bind("sortOrder", record.getSortOrder())
                .fetch()
                .rowsUpdated()
                .then();
    }

    /** 查询单个用户渠道。 */
    public Mono<PersistenceRecords.UserAiChannelRecord> getUserAiChannel(Long userId, String channelId) {
        return databaseClient.sql("""
                SELECT id, user_id, channel_id, name, base_url, api_key_encrypted, api_format, models::text AS models, sort_order, status, created_at, updated_at
                FROM user_ai_channels WHERE user_id = :userId AND channel_id = :channelId AND status = 1
                """).bind("userId", userId).bind("channelId", channelId)
                .map((row, metadata) -> RowMappers.userAiChannel(row)).one();
    }

    /** 新增用户渠道。 */
    public Mono<Void> createUserAiChannel(PersistenceRecords.UserAiChannelRecord record) {
        return insertUserAiChannel(record);
    }

    /** 修改用户渠道。 */
    public Mono<Long> updateUserAiChannel(PersistenceRecords.UserAiChannelRecord record) {
        return databaseClient.sql("""
                UPDATE user_ai_channels SET name=:name, base_url=:baseUrl, api_key_encrypted=:apiKeyEncrypted,
                api_format=:apiFormat, models=CAST(:models AS jsonb), sort_order=:sortOrder, updated_at=CURRENT_TIMESTAMP
                WHERE user_id=:userId AND channel_id=:channelId AND status=1
                """).bind("name", record.getName()).bind("baseUrl", record.getBaseUrl())
                .bind("apiKeyEncrypted", record.getApiKeyEncrypted()).bind("apiFormat", record.getApiFormat())
                .bind("models", record.getModels()).bind("sortOrder", record.getSortOrder())
                .bind("userId", record.getUserId()).bind("channelId", record.getChannelId()).fetch().rowsUpdated();
    }

    /** 删除用户渠道。 */
    public Mono<Long> deleteUserAiChannel(Long userId, String channelId) {
        return databaseClient.sql("DELETE FROM user_ai_channels WHERE user_id=:userId AND channel_id=:channelId")
                .bind("userId", userId).bind("channelId", channelId).fetch().rowsUpdated();
    }

    /** 查询渠道是否仍被模型配置引用。 */
    public Mono<Boolean> existsModelConfigByChannel(Long userId, String channelId) {
        return databaseClient.sql("SELECT EXISTS(SELECT 1 FROM user_ai_model_configs WHERE user_id=:userId AND channel_id=:channelId) AS exists_value")
                .bind("userId", userId).bind("channelId", channelId)
                .map((row, metadata) -> Boolean.TRUE.equals(row.get("exists_value", Boolean.class))).one();
    }

    /** 查询用户模型配置。 */
    public Flux<PersistenceRecords.UserAiModelConfigRecord> listUserAiModelConfigs(Long userId) {
        return databaseClient.sql("""
                SELECT id, user_id, model_config_id, channel_id, model_name, model_type,
                       capabilities::text AS capabilities, is_default, sort_order, 0 AS credit_cost, 'generation' AS credit_unit,
                       thinking_enabled, reasoning_effort, 1 AS request_concurrency, '{}'::jsonb AS custom_body_parameters,
                       NULL::text AS video_billing_configuration, created_at, updated_at
                FROM user_ai_model_configs WHERE user_id=:userId ORDER BY model_type, sort_order, id
                """).bind("userId", userId).map((row, metadata) -> RowMappers.userAiModelConfig(row)).all();
    }

    /** 查询单个用户模型配置。 */
    public Mono<PersistenceRecords.UserAiModelConfigRecord> getUserAiModelConfig(Long userId, String modelConfigId) {
        return databaseClient.sql("""
                SELECT id, user_id, model_config_id, channel_id, model_name, model_type,
                       capabilities::text AS capabilities, is_default, sort_order, 0 AS credit_cost, 'generation' AS credit_unit,
                       thinking_enabled, reasoning_effort, 1 AS request_concurrency, '{}'::jsonb AS custom_body_parameters,
                       NULL::text AS video_billing_configuration, created_at, updated_at
                FROM user_ai_model_configs WHERE user_id=:userId AND model_config_id=:modelConfigId
                """).bind("userId", userId).bind("modelConfigId", modelConfigId)
                .map((row, metadata) -> RowMappers.userAiModelConfig(row)).one();
    }

    /** 新增用户模型配置。 */
    public Mono<Void> createUserAiModelConfig(PersistenceRecords.UserAiModelConfigRecord record) {
        return databaseClient.sql("""
                INSERT INTO user_ai_model_configs(user_id, model_config_id, channel_id, model_name, model_type, capabilities, is_default, sort_order,
                                                  thinking_enabled, reasoning_effort)
                VALUES (:userId,:modelConfigId,:channelId,:modelName,:modelType,CAST(:capabilities AS jsonb),:isDefault,:sortOrder,
                        :thinkingEnabled,:reasoningEffort)
                """).bind("userId", record.getUserId()).bind("modelConfigId", record.getModelConfigId())
                .bind("channelId", record.getChannelId()).bind("modelName", record.getModelName())
                .bind("modelType", record.getModelType()).bind("capabilities", record.getCapabilities())
                .bind("isDefault", Boolean.TRUE.equals(record.getDefaultModel())).bind("sortOrder", record.getSortOrder())
                .bind("thinkingEnabled", record.getThinkingEnabled() == null || Boolean.TRUE.equals(record.getThinkingEnabled()))
                .bind("reasoningEffort", record.getReasoningEffort() == null ? "high" : record.getReasoningEffort())
                .fetch().rowsUpdated().then();
    }

    /** 修改用户模型配置。 */
    public Mono<Long> updateUserAiModelConfig(PersistenceRecords.UserAiModelConfigRecord record) {
        return databaseClient.sql("""
                UPDATE user_ai_model_configs SET model_type=:modelType, capabilities=CAST(:capabilities AS jsonb),
                sort_order=:sortOrder, thinking_enabled=:thinkingEnabled, reasoning_effort=:reasoningEffort, updated_at=CURRENT_TIMESTAMP
                WHERE user_id=:userId AND model_config_id=:modelConfigId
                """).bind("modelType", record.getModelType()).bind("capabilities", record.getCapabilities())
                .bind("sortOrder", record.getSortOrder()).bind("thinkingEnabled", record.getThinkingEnabled() == null || Boolean.TRUE.equals(record.getThinkingEnabled()))
                .bind("reasoningEffort", record.getReasoningEffort() == null ? "high" : record.getReasoningEffort()).bind("userId", record.getUserId())
                .bind("modelConfigId", record.getModelConfigId()).fetch().rowsUpdated();
    }

    /** 删除用户模型配置。 */
    public Mono<Long> deleteUserAiModelConfig(Long userId, String modelConfigId) {
        return databaseClient.sql("DELETE FROM user_ai_model_configs WHERE user_id=:userId AND model_config_id=:modelConfigId")
                .bind("userId", userId).bind("modelConfigId", modelConfigId).fetch().rowsUpdated();
    }

    /** 设置类型默认模型。 */
    public Mono<Void> setDefaultUserAiModel(Long userId, String modelType, String modelConfigId) {
        return databaseClient.sql("UPDATE user_ai_model_configs SET is_default=FALSE, updated_at=CURRENT_TIMESTAMP WHERE user_id=:userId AND model_type=:modelType")
                .bind("userId", userId).bind("modelType", modelType).fetch().rowsUpdated()
                .then(databaseClient.sql("UPDATE user_ai_model_configs SET is_default=TRUE, updated_at=CURRENT_TIMESTAMP WHERE user_id=:userId AND model_config_id=:modelConfigId AND model_type=:modelType")
                        .bind("userId", userId).bind("modelConfigId", modelConfigId).bind("modelType", modelType).fetch().rowsUpdated().then());
    }

    /**
     * 查询用户对象存储配置
     *
     * @param userId Long 用户ID
     * @return Flux<UserObjectStorageRecord> 对象存储列表
     */
    public Flux<PersistenceRecords.UserObjectStorageRecord> listUserObjectStorages(Long userId) {
        // 对象存储按默认项优先、更新时间倒序读取。
        return databaseClient.sql("""
                SELECT id, user_id, storage_id, name, provider, access_key_encrypted, secret_key_encrypted, bucket, region, endpoint, directory, public_base_url, is_default, last_tested_at, status, created_at, updated_at
                FROM user_object_storage_configs
                WHERE user_id = :userId AND status = 1
                ORDER BY is_default DESC, updated_at DESC, id ASC
                """).bind("userId", userId).map((row, metadata) -> RowMappers.userObjectStorage(row)).all();
    }

    /**
     * 查询默认对象存储配置
     *
     * @param userId Long 用户ID
     * @return Mono<UserObjectStorageRecord> 默认对象存储
     */
    public Mono<PersistenceRecords.UserObjectStorageRecord> getDefaultUserObjectStorage(Long userId) {
        // 上传链路只读取默认对象存储配置。
        return databaseClient.sql("""
                SELECT id, user_id, storage_id, name, provider, access_key_encrypted, secret_key_encrypted, bucket, region, endpoint, directory, public_base_url, is_default, last_tested_at, status, created_at, updated_at
                FROM user_object_storage_configs
                WHERE user_id = :userId AND status = 1 AND is_default = TRUE
                ORDER BY updated_at DESC
                LIMIT 1
                """).bind("userId", userId).map((row, metadata) -> RowMappers.userObjectStorage(row)).one();
    }

    /**
     * 替换保存用户对象存储配置
     *
     * @param userId Long 用户ID
     * @param records List<UserObjectStorageRecord> 对象存储列表
     * @return Mono<Void> 操作结果
     */
    public Mono<Void> replaceUserObjectStorages(Long userId, List<PersistenceRecords.UserObjectStorageRecord> records) {
        // 按当前请求快照覆盖对象存储配置，避免旧密钥被隐式保留。
        return databaseClient.sql("DELETE FROM user_object_storage_configs WHERE user_id = :userId")
                .bind("userId", userId)
                .fetch()
                .rowsUpdated()
                .thenMany(Flux.fromIterable(records == null ? List.of() : records))
                .concatMap(this::insertUserObjectStorage)
                .then();
    }

    /**
     * 新增用户对象存储配置
     *
     * @param record UserObjectStorageRecord 对象存储记录
     * @return Mono<Void> 操作结果
     */
    private Mono<Void> insertUserObjectStorage(PersistenceRecords.UserObjectStorageRecord record) {
        // 对象存储密钥只保存加密结果。
        return databaseClient.sql("""
                INSERT INTO user_object_storage_configs(user_id, storage_id, name, provider, access_key_encrypted, secret_key_encrypted, bucket, region, endpoint, directory, public_base_url, is_default, last_tested_at, status)
                VALUES (:userId, :storageId, :name, :provider, :accessKeyEncrypted, :secretKeyEncrypted, :bucket, :region, :endpoint, :directory, :publicBaseUrl, :isDefault, :lastTestedAt, 1)
                """)
                .bind("userId", record.getUserId())
                .bind("storageId", record.getStorageId())
                .bind("name", record.getName())
                .bind("provider", record.getProvider())
                .bind("accessKeyEncrypted", record.getAccessKeyEncrypted())
                .bind("secretKeyEncrypted", record.getSecretKeyEncrypted())
                .bind("bucket", record.getBucket())
                .bind("region", record.getRegion())
                .bind("endpoint", record.getEndpoint())
                .bind("directory", record.getDirectory())
                .bind("publicBaseUrl", record.getPublicBaseUrl())
                .bind("isDefault", Boolean.TRUE.equals(record.getDefaultStorage()))
                .bind("lastTestedAt", record.getLastTestedAt())
                .fetch()
                .rowsUpdated()
                .then();
    }

    /** 查询单个用户对象存储。 */
    public Mono<PersistenceRecords.UserObjectStorageRecord> getUserObjectStorage(Long userId, String storageId) {
        return databaseClient.sql("""
                SELECT id, user_id, storage_id, name, provider, access_key_encrypted, secret_key_encrypted, bucket, region,
                       endpoint, directory, public_base_url, is_default, last_tested_at, status, created_at, updated_at
                FROM user_object_storage_configs WHERE user_id=:userId AND storage_id=:storageId AND status=1
                """).bind("userId", userId).bind("storageId", storageId)
                .map((row, metadata) -> RowMappers.userObjectStorage(row)).one();
    }

    /** 新增用户对象存储。 */
    public Mono<Void> createUserObjectStorage(PersistenceRecords.UserObjectStorageRecord record) {
        return insertUserObjectStorage(record);
    }

    /** 修改用户对象存储。 */
    public Mono<Long> updateUserObjectStorage(PersistenceRecords.UserObjectStorageRecord record) {
        return databaseClient.sql("""
                UPDATE user_object_storage_configs SET name=:name, provider=:provider, access_key_encrypted=:accessKeyEncrypted,
                secret_key_encrypted=:secretKeyEncrypted, bucket=:bucket, region=:region, endpoint=:endpoint, directory=:directory,
                public_base_url=:publicBaseUrl, last_tested_at=:lastTestedAt, updated_at=CURRENT_TIMESTAMP
                WHERE user_id=:userId AND storage_id=:storageId AND status=1
                """).bind("name", record.getName()).bind("provider", record.getProvider())
                .bind("accessKeyEncrypted", record.getAccessKeyEncrypted()).bind("secretKeyEncrypted", record.getSecretKeyEncrypted())
                .bind("bucket", record.getBucket()).bind("region", record.getRegion()).bind("endpoint", record.getEndpoint()).bind("directory", record.getDirectory())
                .bind("publicBaseUrl", record.getPublicBaseUrl()).bind("lastTestedAt", record.getLastTestedAt())
                .bind("userId", record.getUserId()).bind("storageId", record.getStorageId()).fetch().rowsUpdated();
    }

    /** 删除用户对象存储。 */
    public Mono<Long> deleteUserObjectStorage(Long userId, String storageId) {
        return databaseClient.sql("DELETE FROM user_object_storage_configs WHERE user_id=:userId AND storage_id=:storageId")
                .bind("userId", userId).bind("storageId", storageId).fetch().rowsUpdated();
    }

    /** 设置默认对象存储。 */
    public Mono<Void> setDefaultUserObjectStorage(Long userId, String storageId) {
        return databaseClient.sql("UPDATE user_object_storage_configs SET is_default=FALSE, updated_at=CURRENT_TIMESTAMP WHERE user_id=:userId AND status=1")
                .bind("userId", userId).fetch().rowsUpdated()
                .then(databaseClient.sql("UPDATE user_object_storage_configs SET is_default=TRUE, updated_at=CURRENT_TIMESTAMP WHERE user_id=:userId AND storage_id=:storageId AND status=1")
                        .bind("userId", userId).bind("storageId", storageId).fetch().rowsUpdated().then());
    }

    /**
     * 查询全站AI渠道。
     *
     * @return Flux<UserAiChannelRecord> 全站AI渠道记录流
     */
    public Flux<PersistenceRecords.UserAiChannelRecord> listPlatformAiChannels() {
        return databaseClient.sql("""
                SELECT id, NULL::BIGINT AS user_id, channel_id, name, base_url, api_key_encrypted, api_format,
                       models::text AS models, sort_order, status, created_at, updated_at
                FROM platform_ai_channels
                WHERE status = 1
                ORDER BY created_at DESC, id DESC
                """).map((row, metadata) -> RowMappers.userAiChannel(row)).all();
    }

    /**
     * 查询单个全站AI渠道。
     *
     * @param channelId String 渠道业务ID
     * @return Mono<UserAiChannelRecord> 全站AI渠道记录
     */
    public Mono<PersistenceRecords.UserAiChannelRecord> getPlatformAiChannel(String channelId) {
        return databaseClient.sql("""
                SELECT id, NULL::BIGINT AS user_id, channel_id, name, base_url, api_key_encrypted, api_format,
                       models::text AS models, sort_order, status, created_at, updated_at
                FROM platform_ai_channels
                WHERE channel_id = :channelId AND status = 1
                """).bind("channelId", channelId).map((row, metadata) -> RowMappers.userAiChannel(row)).one();
    }

    /**
     * 创建全站AI渠道。
     *
     * @param record UserAiChannelRecord 全站AI渠道记录
     * @return Mono<Void> 创建结果
     */
    public Mono<Void> createPlatformAiChannel(PersistenceRecords.UserAiChannelRecord record) {
        return databaseClient.sql("""
                INSERT INTO platform_ai_channels(channel_id, name, base_url, api_key_encrypted, api_format, models, sort_order, status)
                VALUES (:channelId, :name, :baseUrl, :apiKeyEncrypted, :apiFormat, CAST(:models AS jsonb), :sortOrder, 1)
                """).bind("channelId", record.getChannelId()).bind("name", record.getName())
                .bind("baseUrl", record.getBaseUrl()).bind("apiKeyEncrypted", record.getApiKeyEncrypted())
                .bind("apiFormat", record.getApiFormat()).bind("models", record.getModels())
                .bind("sortOrder", record.getSortOrder()).fetch().rowsUpdated().then();
    }

    /**
     * 更新全站AI渠道。
     *
     * @param record UserAiChannelRecord 全站AI渠道记录
     * @return Mono<Long> 更新行数
     */
    public Mono<Long> updatePlatformAiChannel(PersistenceRecords.UserAiChannelRecord record) {
        return databaseClient.sql("""
                UPDATE platform_ai_channels
                SET name = :name, base_url = :baseUrl, api_key_encrypted = :apiKeyEncrypted, api_format = :apiFormat,
                    models = CAST(:models AS jsonb), sort_order = :sortOrder, updated_at = CURRENT_TIMESTAMP
                WHERE channel_id = :channelId AND status = 1
                """).bind("name", record.getName()).bind("baseUrl", record.getBaseUrl())
                .bind("apiKeyEncrypted", record.getApiKeyEncrypted()).bind("apiFormat", record.getApiFormat())
                .bind("models", record.getModels()).bind("sortOrder", record.getSortOrder())
                .bind("channelId", record.getChannelId()).fetch().rowsUpdated();
    }

    /**
     * 删除全站AI渠道。
     *
     * @param channelId String 渠道业务ID
     * @return Mono<Long> 删除行数
     */
    public Mono<Long> deletePlatformAiChannel(String channelId) {
        return databaseClient.sql("DELETE FROM platform_ai_channels WHERE channel_id = :channelId")
                .bind("channelId", channelId).fetch().rowsUpdated();
    }

    /**
     * 判断全站模型配置是否引用渠道。
     *
     * @param channelId String 渠道业务ID
     * @return Mono<Boolean> 是否存在引用
     */
    public Mono<Boolean> existsPlatformModelConfigByChannel(String channelId) {
        return databaseClient.sql("SELECT EXISTS(SELECT 1 FROM platform_ai_model_configs WHERE channel_id = :channelId) AS exists_value")
                .bind("channelId", channelId).map((row, metadata) -> Boolean.TRUE.equals(row.get("exists_value", Boolean.class))).one();
    }

    /**
     * 查询全站模型配置。
     *
     * @return Flux<UserAiModelConfigRecord> 全站模型配置记录流
     */
    public Flux<PersistenceRecords.UserAiModelConfigRecord> listPlatformAiModelConfigs() {
        return databaseClient.sql("""
                SELECT id, NULL::BIGINT AS user_id, model_config_id, channel_id, model_name, model_type,
                       capabilities::text AS capabilities, is_default, sort_order, credit_cost, credit_unit,
                       thinking_enabled, reasoning_effort, request_concurrency, custom_body_parameters::text AS custom_body_parameters,
                       video_billing_configuration::text AS video_billing_configuration, display_name, model_icon,
                       is_custom_model, custom_model_config::text AS custom_model_config, created_at, updated_at
                FROM platform_ai_model_configs
                ORDER BY created_at DESC, id DESC
                """).map((row, metadata) -> RowMappers.userAiModelConfig(row)).all();
    }

    /**
     * 查询单个全站模型配置。
     *
     * @param modelConfigId String 模型配置业务ID
     * @return Mono<UserAiModelConfigRecord> 全站模型配置记录
     */
    public Mono<PersistenceRecords.UserAiModelConfigRecord> getPlatformAiModelConfig(String modelConfigId) {
        return databaseClient.sql("""
                SELECT id, NULL::BIGINT AS user_id, model_config_id, channel_id, model_name, model_type,
                       capabilities::text AS capabilities, is_default, sort_order, credit_cost, credit_unit,
                       thinking_enabled, reasoning_effort, request_concurrency, custom_body_parameters::text AS custom_body_parameters,
                       video_billing_configuration::text AS video_billing_configuration, display_name, model_icon,
                       is_custom_model, custom_model_config::text AS custom_model_config, created_at, updated_at
                FROM platform_ai_model_configs
                WHERE model_config_id = :modelConfigId
                """).bind("modelConfigId", modelConfigId).map((row, metadata) -> RowMappers.userAiModelConfig(row)).one();
    }

    /**
     * 查询全站模型同时并发数。
     *
     * @param modelConfigId String 模型配置业务ID
     * @return Mono<Integer> 模型同时并发数
     */
    public Mono<Integer> getPlatformModelRequestConcurrency(String modelConfigId) {
        return databaseClient.sql("SELECT request_concurrency FROM platform_ai_model_configs WHERE model_config_id = :modelConfigId")
                .bind("modelConfigId", modelConfigId)
                .map((row, metadata) -> row.get("request_concurrency", Integer.class))
                .one();
    }

    /**
     * 创建全站模型配置。
     *
     * @param record UserAiModelConfigRecord 全站模型配置记录
     * @return Mono<Void> 创建结果
     */
    public Mono<Void> createPlatformAiModelConfig(PersistenceRecords.UserAiModelConfigRecord record) {
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                INSERT INTO platform_ai_model_configs(model_config_id, channel_id, model_name, model_type, capabilities, is_default, sort_order,
                                                      credit_cost, credit_unit, thinking_enabled, reasoning_effort, request_concurrency, custom_body_parameters,
                                                      video_billing_configuration, display_name, model_icon, is_custom_model, custom_model_config)
                VALUES (:modelConfigId, :channelId, :modelName, :modelType, CAST(:capabilities AS jsonb), :isDefault, :sortOrder,
                        :creditCost, :creditUnit, :thinkingEnabled, :reasoningEffort, :requestConcurrency, CAST(:customBodyParameters AS jsonb),
                        CAST(:videoBillingConfiguration AS jsonb), :displayName, :modelIcon, :isCustomModel, CAST(:customModelConfig AS jsonb))
                """).bind("modelConfigId", record.getModelConfigId()).bind("channelId", record.getChannelId())
                .bind("modelName", record.getModelName()).bind("modelType", record.getModelType())
                .bind("capabilities", record.getCapabilities()).bind("isDefault", Boolean.TRUE.equals(record.getDefaultModel()))
                .bind("sortOrder", record.getSortOrder()).bind("creditCost", record.getCreditCost()).bind("creditUnit", record.getCreditUnit())
                .bind("thinkingEnabled", record.getThinkingEnabled() == null || Boolean.TRUE.equals(record.getThinkingEnabled()))
                .bind("reasoningEffort", record.getReasoningEffort() == null ? "high" : record.getReasoningEffort())
                .bind("requestConcurrency", record.getRequestConcurrency() == null ? 1 : record.getRequestConcurrency())
                .bind("customBodyParameters", record.getCustomBodyParameters() == null ? "{}" : record.getCustomBodyParameters())
                .bind("videoBillingConfiguration", record.getVideoBillingConfiguration() == null ? "null" : record.getVideoBillingConfiguration())
                .bind("isCustomModel", Boolean.TRUE.equals(record.getIsCustomModel()))
                .bind("customModelConfig", record.getCustomModelConfig() == null ? "null" : record.getCustomModelConfig());
        spec = R2dbcBindings.bindNullable(spec, "displayName", record.getDisplayName(), String.class);
        spec = R2dbcBindings.bindNullable(spec, "modelIcon", record.getModelIcon(), String.class);
        return spec.fetch()
                .rowsUpdated()
                .then();
    }

    /**
     * 更新全站模型配置。
     *
     * @param record UserAiModelConfigRecord 全站模型配置记录
     * @return Mono<Long> 更新行数
     */
    public Mono<Long> updatePlatformAiModelConfig(PersistenceRecords.UserAiModelConfigRecord record) {
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                UPDATE platform_ai_model_configs
                SET model_type = :modelType, capabilities = CAST(:capabilities AS jsonb), sort_order = :sortOrder, credit_cost = :creditCost,
                    credit_unit = :creditUnit, request_concurrency = :requestConcurrency, custom_body_parameters = CAST(:customBodyParameters AS jsonb),
                    video_billing_configuration = CAST(:videoBillingConfiguration AS jsonb), display_name = :displayName, model_icon = :modelIcon,
                    thinking_enabled = :thinkingEnabled, reasoning_effort = :reasoningEffort,
                    is_custom_model = :isCustomModel, custom_model_config = CAST(:customModelConfig AS jsonb),
                    updated_at = CURRENT_TIMESTAMP
                WHERE model_config_id = :modelConfigId
                """).bind("modelType", record.getModelType()).bind("capabilities", record.getCapabilities())
                .bind("sortOrder", record.getSortOrder()).bind("creditCost", record.getCreditCost()).bind("creditUnit", record.getCreditUnit())
                .bind("requestConcurrency", record.getRequestConcurrency() == null ? 1 : record.getRequestConcurrency())
                .bind("customBodyParameters", record.getCustomBodyParameters() == null ? "{}" : record.getCustomBodyParameters())
                .bind("videoBillingConfiguration", record.getVideoBillingConfiguration() == null ? "null" : record.getVideoBillingConfiguration())
                .bind("thinkingEnabled", record.getThinkingEnabled() == null || Boolean.TRUE.equals(record.getThinkingEnabled()))
                .bind("reasoningEffort", record.getReasoningEffort() == null ? "high" : record.getReasoningEffort())
                .bind("isCustomModel", Boolean.TRUE.equals(record.getIsCustomModel()))
                .bind("customModelConfig", record.getCustomModelConfig() == null ? "null" : record.getCustomModelConfig())
                .bind("modelConfigId", record.getModelConfigId());
        spec = R2dbcBindings.bindNullable(spec, "displayName", record.getDisplayName(), String.class);
        spec = R2dbcBindings.bindNullable(spec, "modelIcon", record.getModelIcon(), String.class);
        return spec.fetch().rowsUpdated();
    }

    /**
     * 删除全站模型配置。
     *
     * @param modelConfigId String 模型配置业务ID
     * @return Mono<Long> 删除行数
     */
    public Mono<Long> deletePlatformAiModelConfig(String modelConfigId) {
        return databaseClient.sql("DELETE FROM platform_ai_model_configs WHERE model_config_id = :modelConfigId")
                .bind("modelConfigId", modelConfigId).fetch().rowsUpdated();
    }

    /**
     * 设置全站默认模型。
     *
     * @param modelType String 模型类型
     * @param modelConfigId String 模型配置业务ID
     * @return Mono<Void> 设置结果
     */
    public Mono<Void> setDefaultPlatformAiModel(String modelType, String modelConfigId) {
        return databaseClient.sql("UPDATE platform_ai_model_configs SET is_default = FALSE, updated_at = CURRENT_TIMESTAMP WHERE model_type = :modelType")
                .bind("modelType", modelType).fetch().rowsUpdated()
                .then(databaseClient.sql("UPDATE platform_ai_model_configs SET is_default = TRUE, updated_at = CURRENT_TIMESTAMP WHERE model_config_id = :modelConfigId AND model_type = :modelType")
                        .bind("modelConfigId", modelConfigId).bind("modelType", modelType).fetch().rowsUpdated().then());
    }

    /**
     * 查询全站对象存储配置。
     *
     * @return Flux<UserObjectStorageRecord> 全站对象存储记录流
     */
    public Flux<PersistenceRecords.UserObjectStorageRecord> listPlatformObjectStorages() {
        return databaseClient.sql("""
                SELECT id, NULL::BIGINT AS user_id, storage_id, name, provider, access_key_encrypted, secret_key_encrypted,
                       bucket, region, endpoint, directory, public_base_url, is_default, last_tested_at, status, created_at, updated_at
                FROM platform_object_storage_configs
                WHERE status = 1
                ORDER BY created_at DESC, id DESC
                """).map((row, metadata) -> RowMappers.userObjectStorage(row)).all();
    }

    /**
     * 查询全站默认对象存储。
     *
     * @return Mono<UserObjectStorageRecord> 全站默认对象存储记录
     */
    public Mono<PersistenceRecords.UserObjectStorageRecord> getDefaultPlatformObjectStorage() {
        return databaseClient.sql("""
                SELECT id, NULL::BIGINT AS user_id, storage_id, name, provider, access_key_encrypted, secret_key_encrypted,
                       bucket, region, endpoint, directory, public_base_url, is_default, last_tested_at, status, created_at, updated_at
                FROM platform_object_storage_configs
                WHERE status = 1 AND is_default = TRUE
                ORDER BY updated_at DESC
                LIMIT 1
                """).map((row, metadata) -> RowMappers.userObjectStorage(row)).one();
    }

    /**
     * 查询单个全站对象存储。
     *
     * @param storageId String 对象存储业务ID
     * @return Mono<UserObjectStorageRecord> 全站对象存储记录
     */
    public Mono<PersistenceRecords.UserObjectStorageRecord> getPlatformObjectStorage(String storageId) {
        return databaseClient.sql("""
                SELECT id, NULL::BIGINT AS user_id, storage_id, name, provider, access_key_encrypted, secret_key_encrypted,
                       bucket, region, endpoint, directory, public_base_url, is_default, last_tested_at, status, created_at, updated_at
                FROM platform_object_storage_configs
                WHERE storage_id = :storageId AND status = 1
                """).bind("storageId", storageId).map((row, metadata) -> RowMappers.userObjectStorage(row)).one();
    }

    /**
     * 创建全站对象存储。
     *
     * @param record UserObjectStorageRecord 全站对象存储记录
     * @return Mono<Void> 创建结果
     */
    public Mono<Void> createPlatformObjectStorage(PersistenceRecords.UserObjectStorageRecord record) {
        return databaseClient.sql("""
                INSERT INTO platform_object_storage_configs(storage_id, name, provider, access_key_encrypted, secret_key_encrypted,
                                                             bucket, region, endpoint, directory, public_base_url, is_default, last_tested_at, status)
                VALUES (:storageId, :name, :provider, :accessKeyEncrypted, :secretKeyEncrypted, :bucket, :region,
                        :endpoint, :directory, :publicBaseUrl, :isDefault, :lastTestedAt, 1)
                """).bind("storageId", record.getStorageId()).bind("name", record.getName()).bind("provider", record.getProvider())
                .bind("accessKeyEncrypted", record.getAccessKeyEncrypted()).bind("secretKeyEncrypted", record.getSecretKeyEncrypted())
                .bind("bucket", record.getBucket()).bind("region", record.getRegion()).bind("endpoint", record.getEndpoint()).bind("directory", record.getDirectory())
                .bind("publicBaseUrl", record.getPublicBaseUrl()).bind("isDefault", Boolean.TRUE.equals(record.getDefaultStorage()))
                .bind("lastTestedAt", record.getLastTestedAt()).fetch().rowsUpdated().then();
    }

    /**
     * 更新全站对象存储。
     *
     * @param record UserObjectStorageRecord 全站对象存储记录
     * @return Mono<Long> 更新行数
     */
    public Mono<Long> updatePlatformObjectStorage(PersistenceRecords.UserObjectStorageRecord record) {
        return databaseClient.sql("""
                UPDATE platform_object_storage_configs
                SET name = :name, provider = :provider, access_key_encrypted = :accessKeyEncrypted,
                    secret_key_encrypted = :secretKeyEncrypted, bucket = :bucket, region = :region, endpoint = :endpoint, directory = :directory,
                    public_base_url = :publicBaseUrl, last_tested_at = :lastTestedAt, updated_at = CURRENT_TIMESTAMP
                WHERE storage_id = :storageId AND status = 1
                """).bind("name", record.getName()).bind("provider", record.getProvider())
                .bind("accessKeyEncrypted", record.getAccessKeyEncrypted()).bind("secretKeyEncrypted", record.getSecretKeyEncrypted())
                .bind("bucket", record.getBucket()).bind("region", record.getRegion()).bind("endpoint", record.getEndpoint()).bind("directory", record.getDirectory())
                .bind("publicBaseUrl", record.getPublicBaseUrl()).bind("lastTestedAt", record.getLastTestedAt())
                .bind("storageId", record.getStorageId()).fetch().rowsUpdated();
    }

    /**
     * 删除全站对象存储。
     *
     * @param storageId String 对象存储业务ID
     * @return Mono<Long> 删除行数
     */
    public Mono<Long> deletePlatformObjectStorage(String storageId) {
        return databaseClient.sql("DELETE FROM platform_object_storage_configs WHERE storage_id = :storageId")
                .bind("storageId", storageId).fetch().rowsUpdated();
    }

    /**
     * 设置全站默认对象存储。
     *
     * @param storageId String 对象存储业务ID
     * @return Mono<Void> 设置结果
     */
    public Mono<Void> setDefaultPlatformObjectStorage(String storageId) {
        return databaseClient.sql("UPDATE platform_object_storage_configs SET is_default = FALSE, updated_at = CURRENT_TIMESTAMP WHERE status = 1")
                .fetch().rowsUpdated()
                .then(databaseClient.sql("UPDATE platform_object_storage_configs SET is_default = TRUE, updated_at = CURRENT_TIMESTAMP WHERE storage_id = :storageId AND status = 1")
                        .bind("storageId", storageId).fetch().rowsUpdated().then());
    }

    /**
     * 查询画布项目列表
     *
     * @param userId Long 用户ID
     * @return Flux<SnapshotRecord> 画布项目列表
     */
    public Flux<PersistenceRecords.SnapshotRecord> listProjects(Long userId) {
        // 只返回未软删除的项目，并按更新时间倒序排列。
        return databaseClient.sql("""
                SELECT id, user_id, NULL AS record_type, title, project_data::text AS record_data, status, created_at, updated_at
                FROM canvas_projects
                WHERE user_id = :userId AND status = 1
                ORDER BY updated_at DESC
                """).bind("userId", userId).map((row, metadata) -> RowMappers.snapshot(row)).all();
    }

    /**
     * 查询画布项目
     *
     * @param userId Long 用户ID
     * @param id String 项目ID
     * @return Mono<SnapshotRecord> 画布项目
     */
    public Mono<PersistenceRecords.SnapshotRecord> getProject(Long userId, String id) {
        // 项目详情同时限定用户ID和项目ID。
        return databaseClient.sql("""
                SELECT id, user_id, NULL AS record_type, title, project_data::text AS record_data, status, created_at, updated_at
                FROM canvas_projects
                WHERE user_id = :userId AND id = :id AND status = 1
                """).bind("userId", userId).bind("id", id).map((row, metadata) -> RowMappers.snapshot(row)).one();
    }

    /**
     * 保存画布项目
     *
     * @param record SnapshotRecord 画布项目
     * @return Mono<Void> 操作结果
     */
    public Mono<Void> saveProject(PersistenceRecords.SnapshotRecord record) {
        // 项目保存使用UPSERT，并通过WHERE限制只更新同一用户的记录。
        return databaseClient.sql("""
                INSERT INTO canvas_projects(id, user_id, title, project_data, status)
                VALUES (:id, :userId, :title, CAST(:data AS jsonb), 1)
                ON CONFLICT (id) DO UPDATE
                SET title = EXCLUDED.title, project_data = EXCLUDED.project_data, status = 1, updated_at = CURRENT_TIMESTAMP
                WHERE canvas_projects.user_id = EXCLUDED.user_id
                """)
                .bind("id", record.getId())
                .bind("userId", record.getUserId())
                .bind("title", record.getTitle())
                .bind("data", record.getData())
                .fetch()
                .rowsUpdated()
                .then();
    }

    /**
     * 删除画布项目
     *
     * @param userId Long 用户ID
     * @param ids List<String> 项目ID列表
     * @return Mono<Void> 操作结果
     */
    public Mono<Void> deleteProjects(Long userId, List<String> ids) {
        if (ids == null || ids.isEmpty()) {
            return Mono.empty();
        }
        // 删除采用软删除，保留历史数据和审计时间。
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("UPDATE canvas_projects SET status = 0, updated_at = CURRENT_TIMESTAMP WHERE user_id = :userId AND id IN (" + R2dbcBindings.namedPlaceholders("id", ids.size()) + ")")
                .bind("userId", userId);
        spec = R2dbcBindings.bindList(spec, "id", ids);
        return spec.fetch().rowsUpdated().then();
    }

    /**
     * 查询素材列表
     *
     * @param userId Long 用户ID
     * @return Flux<SnapshotRecord> 素材列表
     */
    public Flux<PersistenceRecords.SnapshotRecord> listAssets(Long userId) {
        // 只返回当前用户未软删除素材。
        return databaseClient.sql("""
                SELECT id, user_id, kind AS record_type, title, asset_data::text AS record_data, status, created_at, updated_at
                FROM assets
                WHERE user_id = :userId AND status = 1
                ORDER BY updated_at DESC
                """).bind("userId", userId).map((row, metadata) -> RowMappers.snapshot(row)).all();
    }

    /**
     * 保存素材
     *
     * @param record SnapshotRecord 素材记录
     * @return Mono<Void> 操作结果
     */
    public Mono<Void> saveAsset(PersistenceRecords.SnapshotRecord record) {
        // 素材保存使用UPSERT，并限制只能覆盖同一用户的素材。
        return databaseClient.sql("""
                INSERT INTO assets(id, user_id, kind, title, asset_data, status)
                VALUES (:id, :userId, :kind, :title, CAST(:data AS jsonb), 1)
                ON CONFLICT (id) DO UPDATE
                SET kind = EXCLUDED.kind, title = EXCLUDED.title, asset_data = EXCLUDED.asset_data, status = 1, updated_at = CURRENT_TIMESTAMP
                WHERE assets.user_id = EXCLUDED.user_id
                """)
                .bind("id", record.getId())
                .bind("userId", record.getUserId())
                .bind("kind", record.getType())
                .bind("title", record.getTitle())
                .bind("data", record.getData())
                .fetch()
                .rowsUpdated()
                .then();
    }

    /**
     * 删除素材
     *
     * @param userId Long 用户ID
     * @param ids List<String> 素材ID列表
     * @return Mono<Void> 操作结果
     */
    public Mono<Void> deleteAssets(Long userId, List<String> ids) {
        if (ids == null || ids.isEmpty()) {
            return Mono.empty();
        }
        // 素材删除采用软删除。
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("UPDATE assets SET status = 0, updated_at = CURRENT_TIMESTAMP WHERE user_id = :userId AND id IN (" + R2dbcBindings.namedPlaceholders("id", ids.size()) + ")")
                .bind("userId", userId);
        spec = R2dbcBindings.bindList(spec, "id", ids);
        return spec.fetch().rowsUpdated().then();
    }

    /**
     * 查询生成记录列表
     *
     * @param userId Long 用户ID
     * @param logType String 记录类型
     * @return Flux<SnapshotRecord> 生成记录列表
     */
    public Flux<PersistenceRecords.GenerationLogRecord> listGenerationLogs(Long userId, String logType) {
        // 基础查询限定用户和未删除状态，可选类型筛选按参数决定。
        String sql = """
                SELECT id, user_id, log_type AS record_type, title, log_data::text AS record_data, status,
                       generation_status, generation_completed_at, generation_viewed_at, created_at, updated_at
                FROM generation_logs
                WHERE user_id = :userId AND status = 1
                """;
        if (logType != null && !logType.isBlank()) {
            sql += " AND log_type = :logType";
        }
        sql += " ORDER BY created_at DESC";
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql(sql).bind("userId", userId);
        if (logType != null && !logType.isBlank()) {
            spec = spec.bind("logType", logType);
        }
        return spec.map((row, metadata) -> RowMappers.generationLog(row)).all();
    }

    /**
     * 按 ID 查询单条生成记录
     *
     * @param userId Long 用户ID
     * @param id     String 记录ID
     * @return Mono<SnapshotRecord> 记录（不存在时 empty）
     */
    public Mono<PersistenceRecords.GenerationLogRecord> findGenerationLogById(Long userId, String id) {
        return databaseClient.sql("""
                SELECT id, user_id, log_type AS record_type, title, log_data::text AS record_data, status,
                       generation_status, generation_completed_at, generation_viewed_at, created_at, updated_at
                FROM generation_logs
                WHERE user_id = :userId AND id = :id AND status = 1
                """)
                .bind("userId", userId)
                .bind("id", id)
                .map((row, metadata) -> RowMappers.generationLog(row))
                .one();
    }

    /**
     * 保存生成记录
     *
     * @param record GenerationLogRecord 生成记录
     * @return Mono<Void> 操作结果
     */
    public Mono<Void> saveGenerationLog(PersistenceRecords.GenerationLogRecord record) {
        // 生成记录保存使用UPSERT，并限制只能覆盖同一用户的记录。
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                INSERT INTO generation_logs(id, user_id, log_type, title, log_data, status, generation_status, generation_completed_at)
                VALUES (:id, :userId, :logType, :title, CAST(:data AS jsonb), 1, :generationStatus, :generationCompletedAt)
                ON CONFLICT (id) DO UPDATE
                SET log_type = EXCLUDED.log_type, title = EXCLUDED.title, log_data = EXCLUDED.log_data, status = 1,
                    generation_status = EXCLUDED.generation_status,
                    generation_completed_at = EXCLUDED.generation_completed_at,
                    updated_at = CURRENT_TIMESTAMP
                WHERE generation_logs.user_id = EXCLUDED.user_id
                """)
                .bind("id", record.getId())
                .bind("userId", record.getUserId())
                .bind("logType", record.getType())
                .bind("title", record.getTitle())
                .bind("data", record.getData())
                .bind("generationStatus", record.getGenerationStatus());
        spec = R2dbcBindings.bindNullable(spec, "generationCompletedAt", record.getGenerationCompletedAt(), java.time.OffsetDateTime.class);
        return spec.fetch()
                .rowsUpdated()
                .then();
    }

    /**
     * 原子保存指定生成轮次的Agent执行活动。
     *
     * @param userId Long 当前用户ID
     * @param id String 生成记录ID
     * @param roundId String 生成轮次ID
     * @param activitiesJson String 执行活动JSON数组
     * @return Mono<Long> 更新行数
     */
    public Mono<Long> saveGenerationRoundActivities(Long userId, String id, String roundId, String activitiesJson) {
        return databaseClient.sql("""
                UPDATE generation_logs
                SET log_data = jsonb_set(
                        log_data,
                        '{rounds}',
                        (
                            SELECT jsonb_agg(
                                    CASE
                                        WHEN round_data ->> 'id' = :roundId
                                            THEN jsonb_set(round_data, '{activities}', CAST(:activities AS jsonb), true)
                                        ELSE round_data
                                    END
                                    ORDER BY item_index
                            )
                            FROM jsonb_array_elements(COALESCE(log_data -> 'rounds', '[]'::jsonb))
                                 WITH ORDINALITY AS round_item(round_data, item_index)
                        ),
                        false
                    ),
                    updated_at = CURRENT_TIMESTAMP
                WHERE user_id = :userId
                  AND id = :id
                  AND status = 1
                  AND EXISTS (
                      SELECT 1
                      FROM jsonb_array_elements(COALESCE(log_data -> 'rounds', '[]'::jsonb)) AS round_item(round_data)
                      WHERE round_data ->> 'id' = :roundId
                  )
                """)
                .bind("userId", userId)
                .bind("id", id)
                .bind("roundId", roundId)
                .bind("activities", activitiesJson)
                .fetch()
                .rowsUpdated();
    }

    /**
     * 标记生成记录已查看。
     *
     * @param userId Long 当前用户ID
     * @param id String 生成记录ID
     * @return Mono<Long> 更新行数
     */
    public Mono<Long> markGenerationLogViewed(Long userId, String id) {
        // 同时限定用户和正常状态，避免越权修改或恢复已删除记录。
        return databaseClient.sql("""
                UPDATE generation_logs
                SET generation_viewed_at = CURRENT_TIMESTAMP
                WHERE user_id = :userId AND id = :id AND status = 1
                """)
                .bind("userId", userId)
                .bind("id", id)
                .fetch()
                .rowsUpdated();
    }

    /**
     * 修改生成记录标题
     *
     * @param userId Long 用户ID
     * @param id String 记录ID
     * @param title String 新标题
     * @return Mono<Long> 更新行数
     */
    public Mono<Long> renameGenerationLogTitle(Long userId, String id, String title) {
        // 仅更新目标用户单条记录的标题与快照标题，避免覆盖其他快照内容。
        return databaseClient.sql("""
                UPDATE generation_logs
                SET title = :title,
                    log_data = jsonb_set(COALESCE(log_data, '{}'::jsonb), '{title}', to_jsonb(CAST(:title AS text)), true),
                    updated_at = CURRENT_TIMESTAMP
                WHERE user_id = :userId AND id = :id AND status = 1
                """)
                .bind("userId", userId)
                .bind("id", id)
                .bind("title", title)
                .fetch()
                .rowsUpdated();
    }

    /**
     * 删除生成记录
     *
     * @param userId Long 用户ID
     * @param ids List<String> 记录ID列表
     * @return Mono<Void> 操作结果
     */
    public Mono<Void> deleteGenerationLogs(Long userId, List<String> ids) {
        if (ids == null || ids.isEmpty()) {
            return Mono.empty();
        }
        // 生成记录删除采用软删除。
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("UPDATE generation_logs SET status = 0, updated_at = CURRENT_TIMESTAMP WHERE user_id = :userId AND id IN (" + R2dbcBindings.namedPlaceholders("id", ids.size()) + ")")
                .bind("userId", userId);
        spec = R2dbcBindings.bindList(spec, "id", ids);
        return spec.fetch().rowsUpdated().then();
    }

    /**
     * 保存媒体元数据
     *
     * @param record MediaFileRecord 媒体记录
     * @return Mono<Void> 操作结果
     */
    public Mono<Void> saveMedia(PersistenceRecords.MediaFileRecord record) {
        // 媒体元数据保存使用storage_key做冲突键，并限制只能覆盖同一用户记录。
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                INSERT INTO media_files(storage_key, user_id, kind, source_url, object_storage_provider, object_storage_url, object_storage_key, bucket, region, mime_type, bytes, width, height, duration_ms, metadata, status)
                VALUES (:storageKey, :userId, :kind, :sourceUrl, :objectStorageProvider, :objectStorageUrl, :objectStorageKey, :bucket, :region, :mimeType, :bytes, :width, :height, :durationMs, CAST(:metadata AS jsonb), 1)
                ON CONFLICT (storage_key) DO UPDATE
                SET kind = EXCLUDED.kind, source_url = EXCLUDED.source_url, object_storage_provider = EXCLUDED.object_storage_provider,
                    object_storage_url = EXCLUDED.object_storage_url, object_storage_key = EXCLUDED.object_storage_key,
                    bucket = EXCLUDED.bucket, region = EXCLUDED.region, mime_type = EXCLUDED.mime_type, bytes = EXCLUDED.bytes,
                    width = EXCLUDED.width, height = EXCLUDED.height, duration_ms = EXCLUDED.duration_ms, metadata = EXCLUDED.metadata,
                    status = 1, updated_at = CURRENT_TIMESTAMP
                WHERE media_files.user_id = EXCLUDED.user_id
                """)
                .bind("storageKey", record.getStorageKey())
                .bind("userId", record.getUserId())
                .bind("kind", record.getKind());
        spec = R2dbcBindings.bindNullable(spec, "sourceUrl", record.getSourceUrl(), String.class);
        spec = spec.bind("objectStorageProvider", record.getObjectStorageProvider() == null ? "" : record.getObjectStorageProvider());
        spec = R2dbcBindings.bindNullable(spec, "objectStorageUrl", record.getObjectStorageUrl(), String.class);
        spec = R2dbcBindings.bindNullable(spec, "objectStorageKey", record.getObjectStorageKey(), String.class);
        spec = R2dbcBindings.bindNullable(spec, "bucket", record.getBucket(), String.class);
        spec = R2dbcBindings.bindNullable(spec, "region", record.getRegion(), String.class);
        spec = spec.bind("mimeType", record.getMimeType()).bind("bytes", record.getBytes());
        spec = R2dbcBindings.bindNullable(spec, "width", record.getWidth(), Integer.class);
        spec = R2dbcBindings.bindNullable(spec, "height", record.getHeight(), Integer.class);
        spec = R2dbcBindings.bindNullable(spec, "durationMs", record.getDurationMs(), Integer.class);
        return spec.bind("metadata", record.getMetadata() == null || record.getMetadata().isBlank() ? "{}" : record.getMetadata())
                .fetch()
                .rowsUpdated()
                .then();
    }

    /**
     * 查询媒体元数据
     *
     * @param userId Long 用户ID
     * @param storageKey String 媒体存储键
     * @return Mono<MediaFileRecord> 媒体记录
     */
    public Mono<PersistenceRecords.MediaFileRecord> getMedia(Long userId, String storageKey) {
        // 媒体读取同时限定用户、存储键和未删除状态。
        return databaseClient.sql("SELECT storage_key, user_id, kind, source_url, object_storage_provider, object_storage_url, object_storage_key, bucket, region, mime_type, bytes, width, height, duration_ms, metadata::text AS metadata, status, created_at, updated_at FROM media_files WHERE user_id = :userId AND storage_key = :storageKey AND status = 1")
                .bind("userId", userId)
                .bind("storageKey", storageKey)
                .map((row, metadata) -> RowMappers.media(row))
                .one();
    }

    /**
     * 删除媒体元数据
     *
     * @param userId Long 用户ID
     * @param storageKeys List<String> 媒体存储键列表
     * @return Mono<Void> 操作结果
     */
    public Mono<Void> deleteMedia(Long userId, List<String> storageKeys) {
        if (storageKeys == null || storageKeys.isEmpty()) {
            return Mono.empty();
        }
        // 媒体删除采用软删除，真实对象存储文件暂不删除。
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("UPDATE media_files SET status = 0, updated_at = CURRENT_TIMESTAMP WHERE user_id = :userId AND storage_key IN (" + R2dbcBindings.namedPlaceholders("storageKey", storageKeys.size()) + ")")
                .bind("userId", userId);
        spec = R2dbcBindings.bindList(spec, "storageKey", storageKeys);
        return spec.fetch().rowsUpdated().then();
    }
}
