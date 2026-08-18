package com.novanovastudio.repository;

import com.novanovastudio.entity.AiGenerationTask;
import com.novanovastudio.entity.EmailVerificationCode;
import com.novanovastudio.entity.PersistenceRecords;
import com.novanovastudio.entity.User;
import com.novanovastudio.entity.UserIdentityBinding;
import com.novanovastudio.entity.VideoCompositionTask;
import io.r2dbc.postgresql.codec.Json;
import io.r2dbc.spi.Row;
import java.time.OffsetDateTime;

/**
 * @title        RowMappers.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  响应式数据库行映射工具
 * @createTime   2026-06-24 18:25:00
 */
public final class RowMappers {

    /**
     * 禁止实例化
     */
    private RowMappers() {
    }

    /**
     * 映射用户行
     *
     * @param row Row 数据库行
     * @return User 用户实体
     */
    public static User user(Row row) {
        // 将users表字段转换为用户实体。
        User user = new User();
        user.setId(row.get("id", Long.class));
        user.setUsername(row.get("username", String.class));
        user.setPassword(row.get("password", String.class));
        user.setEmail(row.get("email", String.class));
        user.setNickname(row.get("nickname", String.class));
        user.setAvatar(row.get("avatar", String.class));
        user.setRole(row.get("role", String.class));
        user.setStatus(row.get("status", Integer.class));
        user.setCreditBalance(row.get("credit_balance", Integer.class));
        user.setLastLoginAt(row.get("last_login_at", OffsetDateTime.class));
        user.setWelcomeReadAt(row.get("welcome_read_at", OffsetDateTime.class));
        user.setRegisteredAt(row.get("registered_at", OffsetDateTime.class));
        user.setCreatedAt(row.get("created_at", OffsetDateTime.class));
        user.setUpdatedAt(row.get("updated_at", OffsetDateTime.class));
        return user;
    }

    /**
     * 映射第三方用户身份绑定行。
     *
     * @param row Row 数据库行
     * @return UserIdentityBinding 第三方用户身份绑定实体
     */
    public static UserIdentityBinding userIdentityBinding(Row row) {
        UserIdentityBinding binding = new UserIdentityBinding();
        binding.setId(row.get("id", Long.class));
        binding.setUserId(row.get("user_id", Long.class));
        binding.setProvider(row.get("provider", String.class));
        binding.setProviderUserId(row.get("provider_user_id", String.class));
        binding.setProviderEmail(row.get("provider_email", String.class));
        binding.setProviderNickname(row.get("provider_nickname", String.class));
        binding.setProviderAvatar(row.get("provider_avatar", String.class));
        binding.setCreatedAt(row.get("created_at", OffsetDateTime.class));
        binding.setUpdatedAt(row.get("updated_at", OffsetDateTime.class));
        return binding;
    }

    /**
     * 映射邮箱验证码行
     *
     * @param row Row 数据库行
     * @return EmailVerificationCode 邮箱验证码实体
     */
    public static EmailVerificationCode emailCode(Row row) {
        // 将email_verification_codes表字段转换为邮箱验证码实体。
        EmailVerificationCode record = new EmailVerificationCode();
        record.setId(row.get("id", Long.class));
        record.setEmail(row.get("email", String.class));
        record.setCodeHash(row.get("code_hash", String.class));
        record.setPurpose(row.get("purpose", String.class));
        record.setSendCount(row.get("send_count", Integer.class));
        record.setStatus(row.get("status", Integer.class));
        record.setExpiresAt(row.get("expires_at", OffsetDateTime.class));
        record.setUsedAt(row.get("used_at", OffsetDateTime.class));
        record.setCreatedAt(row.get("created_at", OffsetDateTime.class));
        record.setUpdatedAt(row.get("updated_at", OffsetDateTime.class));
        return record;
    }

    /**
     * 映射用户AI渠道行
     *
     * @param row Row 数据库行
     * @return UserAiChannelRecord 用户AI渠道记录
     */
    public static PersistenceRecords.UserAiChannelRecord userAiChannel(Row row) {
        // 将user_ai_channels表字段转换为用户AI渠道记录。
        PersistenceRecords.UserAiChannelRecord record = new PersistenceRecords.UserAiChannelRecord();
        record.setId(row.get("id", Long.class));
        record.setUserId(row.get("user_id", Long.class));
        record.setChannelId(row.get("channel_id", String.class));
        record.setName(row.get("name", String.class));
        record.setBaseUrl(row.get("base_url", String.class));
        record.setApiKeyEncrypted(row.get("api_key_encrypted", String.class));
        record.setApiFormat(row.get("api_format", String.class));
        record.setModels(jsonText(row, "models"));
        record.setSortOrder(row.get("sort_order", Integer.class));
        record.setStatus(row.get("status", Integer.class));
        record.setCreatedAt(row.get("created_at", OffsetDateTime.class));
        record.setUpdatedAt(row.get("updated_at", OffsetDateTime.class));
        return record;
    }

    /**
     * 映射用户AI模型配置记录。
     *
     * @param row Row 数据库行
     * @return UserAiModelConfigRecord 用户AI模型配置记录
     */
    public static PersistenceRecords.UserAiModelConfigRecord userAiModelConfig(Row row) {
        PersistenceRecords.UserAiModelConfigRecord record = new PersistenceRecords.UserAiModelConfigRecord();
        record.setId(row.get("id", Long.class));
        record.setUserId(row.get("user_id", Long.class));
        record.setModelConfigId(row.get("model_config_id", String.class));
        record.setChannelId(row.get("channel_id", String.class));
        record.setModelName(row.get("model_name", String.class));
        record.setModelType(row.get("model_type", String.class));
        record.setCapabilities(row.get("capabilities", String.class));
        record.setDefaultModel(row.get("is_default", Boolean.class));
        record.setSortOrder(row.get("sort_order", Integer.class));
        record.setCreditCost(row.get("credit_cost", Integer.class));
        record.setCreditUnit(row.get("credit_unit", String.class));
        record.setThinkingEnabled(row.get("thinking_enabled", Boolean.class));
        record.setReasoningEffort(row.get("reasoning_effort", String.class));
        record.setRequestConcurrency(row.get("request_concurrency", Integer.class));
        record.setCustomBodyParameters(row.get("custom_body_parameters", String.class));
        record.setVideoBillingConfiguration(row.get("video_billing_configuration", String.class));
        record.setCreatedAt(row.get("created_at", OffsetDateTime.class));
        record.setUpdatedAt(row.get("updated_at", OffsetDateTime.class));
        return record;
    }

    /**
     * 映射用户对象存储行
     *
     * @param row Row 数据库行
     * @return UserObjectStorageRecord 用户对象存储记录
     */
    public static PersistenceRecords.UserObjectStorageRecord userObjectStorage(Row row) {
        // 将user_object_storage_configs表字段转换为对象存储记录。
        PersistenceRecords.UserObjectStorageRecord record = new PersistenceRecords.UserObjectStorageRecord();
        record.setId(row.get("id", Long.class));
        record.setUserId(row.get("user_id", Long.class));
        record.setStorageId(row.get("storage_id", String.class));
        record.setName(row.get("name", String.class));
        record.setProvider(row.get("provider", String.class));
        record.setAccessKeyEncrypted(row.get("access_key_encrypted", String.class));
        record.setSecretKeyEncrypted(row.get("secret_key_encrypted", String.class));
        record.setBucket(row.get("bucket", String.class));
        record.setRegion(row.get("region", String.class));
        record.setEndpoint(row.get("endpoint", String.class));
        record.setDirectory(row.get("directory", String.class));
        record.setPublicBaseUrl(row.get("public_base_url", String.class));
        record.setDefaultStorage(row.get("is_default", Boolean.class));
        record.setLastTestedAt(row.get("last_tested_at", String.class));
        record.setStatus(row.get("status", Integer.class));
        record.setCreatedAt(row.get("created_at", OffsetDateTime.class));
        record.setUpdatedAt(row.get("updated_at", OffsetDateTime.class));
        return record;
    }

    /**
     * 映射JSON快照行
     *
     * @param row Row 数据库行
     * @return SnapshotRecord JSON快照实体
     */
    public static PersistenceRecords.SnapshotRecord snapshot(Row row) {
        // 将画布、素材和生成记录的统一查询字段转换为快照实体。
        PersistenceRecords.SnapshotRecord record = new PersistenceRecords.SnapshotRecord();
        record.setId(row.get("id", String.class));
        record.setUserId(row.get("user_id", Long.class));
        record.setType(row.get("record_type", String.class));
        record.setTitle(row.get("title", String.class));
        record.setData(jsonText(row, "record_data"));
        record.setStatus(row.get("status", Integer.class));
        record.setCreatedAt(row.get("created_at", OffsetDateTime.class));
        record.setUpdatedAt(row.get("updated_at", OffsetDateTime.class));
        return record;
    }

    /**
     * 映射生成记录行。
     *
     * @param row Row 数据库行
     * @return GenerationLogRecord 生成记录实体
     */
    public static PersistenceRecords.GenerationLogRecord generationLog(Row row) {
        // 生成记录除JSON快照外，还携带任务状态和未读判断所需时间。
        PersistenceRecords.GenerationLogRecord record = new PersistenceRecords.GenerationLogRecord();
        record.setId(row.get("id", String.class));
        record.setUserId(row.get("user_id", Long.class));
        record.setType(row.get("record_type", String.class));
        record.setTitle(row.get("title", String.class));
        record.setData(jsonText(row, "record_data"));
        record.setStatus(row.get("status", Integer.class));
        record.setGenerationStatus(row.get("generation_status", String.class));
        record.setGenerationCompletedAt(row.get("generation_completed_at", OffsetDateTime.class));
        record.setGenerationViewedAt(row.get("generation_viewed_at", OffsetDateTime.class));
        record.setCreatedAt(row.get("created_at", OffsetDateTime.class));
        record.setUpdatedAt(row.get("updated_at", OffsetDateTime.class));
        return record;
    }

    /**
     * 映射媒体文件行
     *
     * @param row Row 数据库行
     * @return MediaFileRecord 媒体文件实体
     */
    public static PersistenceRecords.MediaFileRecord media(Row row) {
        // 将media_files表字段转换为媒体文件实体。
        PersistenceRecords.MediaFileRecord record = new PersistenceRecords.MediaFileRecord();
        record.setStorageKey(row.get("storage_key", String.class));
        record.setUserId(row.get("user_id", Long.class));
        record.setKind(row.get("kind", String.class));
        record.setSourceUrl(row.get("source_url", String.class));
        record.setObjectStorageProvider(row.get("object_storage_provider", String.class));
        record.setObjectStorageUrl(row.get("object_storage_url", String.class));
        record.setObjectStorageKey(row.get("object_storage_key", String.class));
        record.setBucket(row.get("bucket", String.class));
        record.setRegion(row.get("region", String.class));
        record.setMimeType(row.get("mime_type", String.class));
        record.setBytes(row.get("bytes", Long.class));
        record.setWidth(row.get("width", Integer.class));
        record.setHeight(row.get("height", Integer.class));
        record.setDurationMs(row.get("duration_ms", Integer.class));
        record.setMetadata(jsonText(row, "metadata"));
        record.setStatus(row.get("status", Integer.class));
        record.setCreatedAt(row.get("created_at", OffsetDateTime.class));
        record.setUpdatedAt(row.get("updated_at", OffsetDateTime.class));
        return record;
    }

    /**
     * 映射AI任务行
     *
     * @param row Row 数据库行
     * @return AiGenerationTask AI任务实体
     */
    public static AiGenerationTask aiTask(Row row) {
        // 将ai_generation_tasks表字段转换为AI生成任务实体。
        AiGenerationTask task = new AiGenerationTask();
        task.setId(row.get("id", String.class));
        task.setUserId(row.get("user_id", Long.class));
        task.setTaskType(row.get("task_type", String.class));
        task.setModel(row.get("model", String.class));
        task.setProvider(row.get("provider", String.class));
        task.setModelConfigId(row.get("model_config_id", String.class));
        task.setStatus(row.get("status", String.class));
        task.setProgress(row.get("progress", Integer.class));
        task.setRequestData(jsonText(row, "request_data"));
        task.setResultData(jsonText(row, "result_data"));
        task.setErrorMessage(row.get("error_message", String.class));
        task.setStartedAt(row.get("started_at", OffsetDateTime.class));
        task.setCompletedAt(row.get("completed_at", OffsetDateTime.class));
        task.setCreatedAt(row.get("created_at", OffsetDateTime.class));
        task.setUpdatedAt(row.get("updated_at", OffsetDateTime.class));
        return task;
    }

    /**
     * 映射视频合成任务行。
     *
     * @param row Row 数据库行
     * @return VideoCompositionTask 视频合成任务实体
     */
    public static VideoCompositionTask videoCompositionTask(Row row) {
        // 将video_composition_tasks表字段转换为视频合成任务实体。
        VideoCompositionTask task = new VideoCompositionTask();
        task.setId(row.get("id", String.class));
        task.setUserId(row.get("user_id", Long.class));
        task.setStatus(row.get("status", String.class));
        task.setProgress(row.get("progress", Integer.class));
        task.setSourceStorageKeys(jsonText(row, "source_storage_keys"));
        task.setResultData(jsonText(row, "result_data"));
        task.setErrorMessage(row.get("error_message", String.class));
        task.setStartedAt(row.get("started_at", OffsetDateTime.class));
        task.setCompletedAt(row.get("completed_at", OffsetDateTime.class));
        task.setCreatedAt(row.get("created_at", OffsetDateTime.class));
        task.setUpdatedAt(row.get("updated_at", OffsetDateTime.class));
        return task;
    }

    /**
     * 读取JSON文本
     *
     * @param row Row 数据库行
     * @param column String 字段名
     * @return String JSON文本
     */
    private static String jsonText(Row row, String column) {
        // R2DBC PostgreSQL的jsonb可能返回Json对象，也可能在显式::text时返回字符串。
        Object value = row.get(column);
        if (value == null) {
            return null;
        }
        if (value instanceof Json json) {
            return json.asString();
        }
        return value.toString();
    }
}
