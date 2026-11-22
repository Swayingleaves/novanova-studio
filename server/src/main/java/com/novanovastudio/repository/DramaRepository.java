package com.novanovastudio.repository;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.security.TeamScope;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 智能短剧项目、阶段版本和稳定请求的数据库访问。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-14 00:40
 */
@Repository
@RequiredArgsConstructor
public class DramaRepository {

    /** 响应式数据库客户端。 */
    private final DatabaseClient databaseClient;

    /**
     * 短剧项目行。
     *
     * @param id 项目ID
     * @param teamId 团队空间
     * @param userId 用户ID
     * @param name 名称
     * @param ideaText 创意
     * @param storyText 正文
     * @param textModel 文本模型
     * @param sessionId 会话ID
     * @param currentStage 当前阶段
     * @param status 项目状态
     * @param revision 修订号
     * @param activeRequestId 活动请求
     * @param durationSeconds 目标时长
     * @param textCredits 已结算文本积分
     * @param createdAt 创建时间
     * @param updatedAt 更新时间
     */
    public record ProjectRow(String id, long teamId, long userId, String name, String ideaText, String storyText,
                             String textModel, String sessionId, String currentStage, String status, int revision,
                             String activeRequestId, int durationSeconds, String aspectRatio, BigDecimal textCredits,
                             OffsetDateTime createdAt, OffsetDateTime updatedAt) {
    }

    /**
     * 阶段版本行。
     *
     * @param id 版本ID
     * @param projectId 项目ID
     * @param stage 阶段
     * @param versionNumber 版本号
     * @param baselineJson 上游基线
     * @param contentJson 产物
     * @param confirmationStatus 确认状态
     * @param freshness 新鲜度
     * @param sourceRequestId 来源请求
     * @param confirmedAt 确认时间
     * @param createdAt 创建时间
     */
    public record VersionRow(String id, String projectId, String stage, int versionNumber, String baselineJson,
                             String contentJson, String confirmationStatus, String freshness, String sourceRequestId,
                             OffsetDateTime confirmedAt, OffsetDateTime createdAt) {
    }

    /**
     * 插入项目。
     *
     * @param row 项目
     * @return 是否写入新行
     */
    public Mono<Boolean> insertProject(ProjectRow row) {
        return databaseClient.sql("""
                INSERT INTO drama_project (
                    id, team_id, user_id, name, idea_text, story_text, text_model, session_id, current_stage, status,
                    revision, active_request_id, duration_seconds, aspect_ratio, text_credits, created_at, updated_at
                ) VALUES (
                    :id, :teamId, :userId, :name, :idea, :story, :model, :sessionId, :stage, :status,
                    :revision, :activeRequestId, :duration, :aspectRatio, :credits, :createdAt, :updatedAt
                ) ON CONFLICT (id) DO NOTHING
                """)
                .bind("id", row.id()).bind("teamId", row.teamId()).bind("userId", row.userId())
                .bind("name", row.name()).bind("idea", row.ideaText()).bind("story", row.storyText())
                .bind("model", row.textModel()).bind("sessionId", row.sessionId()).bind("stage", row.currentStage())
                .bind("status", row.status()).bind("revision", row.revision())
                .bind("activeRequestId", row.activeRequestId() == null ? "" : row.activeRequestId())
                .bind("duration", row.durationSeconds()).bind("aspectRatio", row.aspectRatio()).bind("credits", row.textCredits())
                .bind("createdAt", row.createdAt()).bind("updatedAt", row.updatedAt())
                .fetch().rowsUpdated().map(count -> count > 0);
    }

    /**
     * 按用户和空间读取项目。
     *
     * @param userId 用户ID
     * @param teamId 团队空间
     * @param projectId 项目ID
     * @return 项目
     */
    public Mono<ProjectRow> findProject(long userId, long teamId, String projectId) {
        return databaseClient.sql(projectSql() + " WHERE id = :id AND user_id = :userId AND team_id = :teamId")
                .bind("id", projectId).bind("userId", userId).bind("teamId", teamId)
                .map((row, metadata) -> mapProject(row)).one();
    }

    /**
     * 分页读取项目。
     *
     * @param userId 用户ID
     * @param teamId 团队空间
     * @param limit 数量
     * @param offset 偏移
     * @return 项目列表
     */
    public Flux<ProjectRow> listProjects(long userId, long teamId, int limit, int offset) {
        return databaseClient.sql(projectSql() + " WHERE user_id = :userId AND team_id = :teamId ORDER BY updated_at DESC LIMIT :limit OFFSET :offset")
                .bind("userId", userId).bind("teamId", teamId).bind("limit", limit).bind("offset", offset)
                .map((row, metadata) -> mapProject(row)).all();
    }

    /**
     * 统计项目数量。
     *
     * @param userId 用户ID
     * @param teamId 团队空间
     * @return 数量
     */
    public Mono<Long> countProjects(long userId, long teamId) {
        return databaseClient.sql("SELECT COUNT(*) AS total FROM drama_project WHERE user_id = :userId AND team_id = :teamId")
                .bind("userId", userId).bind("teamId", teamId)
                .map((row, metadata) -> row.get("total", Long.class)).one();
    }

    /**
     * 修改名称、模型和时长。修订号不匹配时不更新。
     *
     * @param userId 用户ID
     * @param teamId 团队空间
     * @param projectId 项目ID
     * @param revision 期望修订号
     * @param name 名称
     * @param textModel 文本模型
     * @param durationSeconds 时长
     * @return 是否更新
     */
    public Mono<Boolean> updateSettings(long userId, long teamId, String projectId, int revision, String name,
                                        String textModel, int durationSeconds, String aspectRatio) {
        return databaseClient.sql("""
                UPDATE drama_project SET name = :name, text_model = :model, duration_seconds = :duration,
                    aspect_ratio = :aspectRatio, revision = revision + 1, updated_at = NOW()
                WHERE id = :id AND user_id = :userId AND team_id = :teamId AND revision = :revision
                """)
                .bind("name", name).bind("model", textModel).bind("duration", durationSeconds).bind("aspectRatio", aspectRatio)
                .bind("id", projectId).bind("userId", userId).bind("teamId", teamId).bind("revision", revision)
                .fetch().rowsUpdated().map(count -> count > 0);
    }

    /**
     * 推进或回退制作进度。
     *
     * @param userId 用户ID
     * @param teamId 团队空间
     * @param projectId 项目ID
     * @param revision 期望修订号
     * @param stage 阶段
     * @param status 项目状态
     * @param activeRequestId 活动请求，空字符串表示清空
     * @param durationSeconds 目标时长
     * @param name 名称
     * @return 是否更新
     */
    public Mono<Boolean> saveProgress(long userId, long teamId, String projectId, int revision, String stage, String status,
                                      String activeRequestId, int durationSeconds, String name) {
        return databaseClient.sql("""
                UPDATE drama_project SET current_stage = :stage, status = :status, active_request_id = :activeRequestId,
                    duration_seconds = :duration, name = :name, revision = revision + 1, updated_at = NOW()
                WHERE id = :id AND user_id = :userId AND team_id = :teamId AND revision = :revision
                """)
                .bind("stage", stage).bind("status", status)
                .bind("activeRequestId", activeRequestId == null ? "" : activeRequestId)
                .bind("duration", durationSeconds).bind("name", name)
                .bind("id", projectId).bind("userId", userId).bind("teamId", teamId).bind("revision", revision)
                .fetch().rowsUpdated().map(count -> count > 0);
    }

    /**
     * 占用或替换活动请求。已经在跑的其他请求不会被覆盖。
     *
     * @param userId 用户ID
     * @param teamId 团队空间
     * @param projectId 项目ID
     * @param revision 期望修订号
     * @param requestId 新请求ID
     * @param replacingRequestId 允许替换的当前请求，没有时为空
     * @return 是否占用成功
     */
    public Mono<Boolean> claimActive(long userId, long teamId, String projectId, int revision, String requestId,
                                     String replacingRequestId) {
        return databaseClient.sql("""
                UPDATE drama_project SET active_request_id = :requestId, revision = revision + 1, updated_at = NOW()
                WHERE id = :id AND user_id = :userId AND team_id = :teamId AND revision = :revision
                AND (
                    (:replacing <> '' AND active_request_id = :replacing)
                    OR active_request_id IS NULL OR active_request_id = ''
                    OR NOT EXISTS (
                        SELECT 1 FROM creation_agent_request existing
                        WHERE existing.id = drama_project.active_request_id AND existing.status IN ('queued', 'running')
                    )
                )
                """)
                .bind("requestId", requestId).bind("replacing", replacingRequestId == null ? "" : replacingRequestId)
                .bind("id", projectId).bind("userId", userId).bind("teamId", teamId).bind("revision", revision)
                .fetch().rowsUpdated().map(count -> count > 0);
    }

    /**
     * 仅在活动请求仍是指定请求时清空。
     *
     * @param projectId 项目ID
     * @param requestId 请求ID
     * @return 完成信号
     */
    public Mono<Void> clearActive(String projectId, String requestId) {
        return databaseClient.sql("""
                UPDATE drama_project SET active_request_id = '', updated_at = NOW()
                WHERE id = :id AND active_request_id = :requestId
                """)
                .bind("id", projectId).bind("requestId", requestId).then();
    }

    /**
     * 按请求增减已结算文本积分。
     *
     * @param projectId 项目ID
     * @param delta 积分变化
     * @return 完成信号
     */
    public Mono<Void> addCredits(String projectId, BigDecimal delta) {
        return databaseClient.sql("""
                UPDATE drama_project SET text_credits = GREATEST(0, text_credits + :delta), updated_at = NOW()
                WHERE id = :id
                """)
                .bind("id", projectId).bind("delta", delta).then();
    }

    /**
     * 插入阶段版本。
     *
     * @param row 版本
     * @param teamId 团队空间
     * @return 完成信号
     */
    public Mono<Void> insertVersion(VersionRow row, long teamId) {
        return databaseClient.sql("""
                INSERT INTO drama_stage_version (
                    id, team_id, project_id, stage, version_number, baseline_json, content_json, confirmation_status,
                    freshness, source_request_id, created_at
                ) VALUES (
                    :id, :teamId, :projectId, :stage, :versionNumber, :baseline::jsonb, :content::jsonb, :confirmation,
                    :freshness, :sourceRequestId, :createdAt
                )
                """)
                .bind("id", row.id()).bind("teamId", teamId).bind("projectId", row.projectId()).bind("stage", row.stage())
                .bind("versionNumber", row.versionNumber()).bind("baseline", row.baselineJson()).bind("content", row.contentJson())
                .bind("confirmation", row.confirmationStatus()).bind("freshness", row.freshness())
                .bind("sourceRequestId", row.sourceRequestId() == null ? "" : row.sourceRequestId())
                .bind("createdAt", row.createdAt()).then();
    }

    /**
     * 读取项目的全部版本。
     *
     * @param projectId 项目ID
     * @param teamId 团队空间
     * @return 版本列表
     */
    public Flux<VersionRow> listVersions(String projectId, long teamId) {
        return databaseClient.sql("""
                SELECT id, project_id, stage, version_number, baseline_json::text AS baseline_json, content_json::text AS content_json,
                    confirmation_status, freshness, source_request_id, confirmed_at, created_at
                FROM drama_stage_version WHERE project_id = :projectId AND team_id = :teamId
                ORDER BY stage ASC, version_number ASC
                """)
                .bind("projectId", projectId).bind("teamId", teamId)
                .map((row, metadata) -> mapVersion(row)).all();
    }

    /**
     * 删除指定阶段版本。
     *
     * @param projectId 项目ID
     * @param versionId 版本ID
     * @return 完成信号
     */
    public Mono<Void> deleteVersion(String projectId, String versionId) {
        return databaseClient.sql("""
                DELETE FROM drama_stage_version WHERE id = :id AND project_id = :projectId
                """)
                .bind("id", versionId).bind("projectId", projectId).then();
    }

    /**
     * 删除挂在指定版本上的图片和视频记录。
     *
     * @param projectId 项目ID
     * @param versionId 版本ID
     * @return 完成信号
     */
    public Mono<Void> deleteMediaByVersion(String projectId, String versionId) {
        return databaseClient.sql("""
                DELETE FROM drama_media WHERE version_id = :versionId AND project_id = :projectId
                """)
                .bind("versionId", versionId).bind("projectId", projectId).then();
    }

    /**
     * 读取下一版本号。
     *
     * @param projectId 项目ID
     * @param stage 阶段
     * @return 下一版本号
     */
    public Mono<Integer> nextVersionNumber(String projectId, String stage) {
        return databaseClient.sql("""
                SELECT COALESCE(MAX(version_number), 0) + 1 AS version_number
                FROM drama_stage_version WHERE project_id = :projectId AND stage = :stage
                """)
                .bind("projectId", projectId).bind("stage", stage)
                .map((row, metadata) -> ((Number) row.get("version_number")).intValue()).one();
    }

    /**
     * 确认仍待确认的指定版本。
     *
     * @param projectId 项目ID
     * @param versionId 版本ID
     * @return 是否确认成功
     */
    public Mono<Boolean> confirmVersion(String projectId, String versionId) {
        return databaseClient.sql("""
                UPDATE drama_stage_version SET confirmation_status = 'confirmed', confirmed_at = NOW()
                WHERE id = :id AND project_id = :projectId AND confirmation_status = 'pending'
                """)
                .bind("id", versionId).bind("projectId", projectId)
                .fetch().rowsUpdated().map(count -> count > 0);
    }

    /**
     * 把某阶段的最新版本标记为需要更新。
     *
     * @param projectId 项目ID
     * @param stage 阶段
     * @return 完成信号
     */
    public Mono<Void> markLatestStale(String projectId, String stage) {
        return databaseClient.sql("""
                UPDATE drama_stage_version SET freshness = 'needs_update'
                WHERE project_id = :projectId AND stage = :stage
                AND version_number = (
                    SELECT MAX(version_number) FROM drama_stage_version latest
                    WHERE latest.project_id = :projectId AND latest.stage = :stage
                )
                """)
                .bind("projectId", projectId).bind("stage", stage).then();
    }

    /**
     * 写入稳定请求。重复请求号不会覆盖。
     *
     * @param clientRequestId 请求号
     * @param teamId 团队空间
     * @param userId 用户ID
     * @param operation 操作
     * @param projectId 项目ID
     * @param result 初始结果
     * @return 是否首次写入
     */
    public Mono<Boolean> insertClientRequest(String clientRequestId, long teamId, long userId, String operation,
                                             String projectId, String result) {
        return databaseClient.sql("""
                INSERT INTO drama_client_request (client_request_id, team_id, user_id, operation, project_id, result_data)
                VALUES (:id, :teamId, :userId, :operation, :projectId, :result::jsonb)
                ON CONFLICT (client_request_id) DO NOTHING
                """)
                .bind("id", clientRequestId).bind("teamId", teamId).bind("userId", userId)
                .bind("operation", operation).bind("projectId", projectId == null ? "" : projectId)
                .bind("result", result).fetch().rowsUpdated().map(count -> count > 0);
    }

    /**
     * 读取稳定请求的结果。
     *
     * @param clientRequestId 请求号
     * @param userId 用户ID
     * @param teamId 团队空间
     * @return 结果JSON
     */
    public Mono<JSONObject> findClientRequest(String clientRequestId, long userId, long teamId) {
        return databaseClient.sql("""
                SELECT result_data::text AS result_data FROM drama_client_request
                WHERE client_request_id = :id AND user_id = :userId AND team_id = :teamId
                """)
                .bind("id", clientRequestId).bind("userId", userId).bind("teamId", teamId)
                .map((row, metadata) -> JSON.parseObject(row.get("result_data", String.class))).one();
    }

    /**
     * 回写稳定请求的完成结果。
     *
     * @param clientRequestId 请求号
     * @param projectId 项目ID
     * @param result 结果JSON
     * @return 完成信号
     */
    public Mono<Void> saveClientResult(String clientRequestId, String projectId, String result) {
        return databaseClient.sql("""
                UPDATE drama_client_request SET project_id = :projectId, result_data = :result::jsonb
                WHERE client_request_id = :id
                """)
                .bind("projectId", projectId).bind("result", result).bind("id", clientRequestId).then();
    }

    /**
     * 读取对话发起、尚未反馈完成的图片或视频批次。
     *
     * @param projectId 项目ID
     * @param userId 用户ID
     * @param teamId 团队空间
     * @return 请求号和结果JSON
     */
    public Flux<ChatMediaBatch> listChatMedia(String projectId, long userId, long teamId) {
        return databaseClient.sql("""
                SELECT client_request_id, result_data::text AS result_data FROM drama_client_request
                WHERE project_id = :projectId AND user_id = :userId AND team_id = :teamId AND operation = 'chat-media'
                """)
                .bind("projectId", projectId).bind("userId", userId).bind("teamId", teamId)
                .map((row, metadata) -> new ChatMediaBatch(row.get("client_request_id", String.class), row.get("result_data", String.class)))
                .all();
    }

    /**
     * 把对话生成批次标成已反馈。并发刷新时只有一次会成功。
     *
     * @param clientRequestId 请求号
     * @param result 带 notified 的结果JSON
     * @return 是否由这次调用完成标记
     */
    public Mono<Boolean> finishChatMedia(String clientRequestId, String result) {
        return databaseClient.sql("""
                UPDATE drama_client_request SET result_data = :result::jsonb
                WHERE client_request_id = :id AND COALESCE(result_data->>'notified', 'false') <> 'true'
                """)
                .bind("result", result).bind("id", clientRequestId).fetch().rowsUpdated().map(count -> count > 0);
    }

    /**
     * 回写还没反馈完的对话生成批次，用于推进待办队列。
     *
     * @param clientRequestId 请求号
     * @param result 结果JSON
     * @return 完成信号
     */
    public Mono<Void> updateChatMedia(String clientRequestId, String result) {
        return databaseClient.sql("""
                UPDATE drama_client_request SET result_data = :result::jsonb
                WHERE client_request_id = :id AND COALESCE(result_data->>'notified', 'false') <> 'true'
                """)
                .bind("result", result).bind("id", clientRequestId).then();
    }

    /** @param id 请求号 @param result 结果JSON */
    public record ChatMediaBatch(String id, String result) {
    }

    /**
     * 删除短剧会话及其主Agent请求。
     *
     * @param sessionId 会话ID
     * @param userId 用户ID
     * @return 完成信号
     */
    public Mono<Void> deleteSession(String sessionId, long userId) {
        return databaseClient.sql("DELETE FROM agent_session WHERE id = :id AND user_id = :userId")
                .bind("id", sessionId).bind("userId", userId).then();
    }

    /**
     * 删除项目及其阶段版本和稳定请求。
     *
     * @param userId 用户ID
     * @param teamId 团队空间
     * @param projectId 项目ID
     * @param revision 期望修订号
     * @return 是否删除
     */
    public Mono<Boolean> deleteProject(long userId, long teamId, String projectId, int revision) {
        return databaseClient.sql("DELETE FROM drama_client_request WHERE project_id = :id AND user_id = :userId AND team_id = :teamId")
                .bind("id", projectId).bind("userId", userId).bind("teamId", teamId).then()
                .then(databaseClient.sql("""
                        DELETE FROM drama_project WHERE id = :id AND user_id = :userId AND team_id = :teamId AND revision = :revision
                        """)
                        .bind("id", projectId).bind("userId", userId).bind("teamId", teamId).bind("revision", revision)
                        .fetch().rowsUpdated().map(count -> count > 0));
    }

    private String projectSql() {
        return """
                SELECT id, team_id, user_id, name, idea_text, story_text, text_model, session_id, current_stage, status,
                    revision, active_request_id, duration_seconds, aspect_ratio, text_credits, created_at, updated_at
                FROM drama_project
                """;
    }

    private ProjectRow mapProject(io.r2dbc.spi.Readable row) {
        return new ProjectRow(row.get("id", String.class), value(row.get("team_id", Long.class)), value(row.get("user_id", Long.class)),
                row.get("name", String.class), row.get("idea_text", String.class), row.get("story_text", String.class),
                row.get("text_model", String.class), row.get("session_id", String.class), row.get("current_stage", String.class),
                row.get("status", String.class), value(row.get("revision", Integer.class)), row.get("active_request_id", String.class),
                value(row.get("duration_seconds", Integer.class)), row.get("aspect_ratio", String.class), row.get("text_credits", BigDecimal.class),
                row.get("created_at", OffsetDateTime.class), row.get("updated_at", OffsetDateTime.class));
    }

    private VersionRow mapVersion(io.r2dbc.spi.Readable row) {
        return new VersionRow(row.get("id", String.class), row.get("project_id", String.class), row.get("stage", String.class),
                value(row.get("version_number", Integer.class)), row.get("baseline_json", String.class), row.get("content_json", String.class),
                row.get("confirmation_status", String.class), row.get("freshness", String.class), row.get("source_request_id", String.class),
                row.get("confirmed_at", OffsetDateTime.class), row.get("created_at", OffsetDateTime.class));
    }

    private static long value(Long number) {
        return number == null ? 0L : number;
    }

    private static int value(Integer number) {
        return number == null ? 0 : number;
    }

    /**
     * 短剧图片或视频生成记录。
     *
     * @param id 记录ID
     * @param projectId 项目ID
     * @param versionId 来源版本
     * @param targetKey 生成目标
     * @param mediaType 图片或视频
     * @param taskId 统一任务ID
     * @param model 模型
     * @param prompt 提示词
     * @param status 状态
     * @param resultUrl 结果地址
     * @param storageKey 存储键
     * @param mimeType 媒体类型
     * @param errorMessage 失败说明
     * @param createdAt 创建时间
     */
    public record MediaRow(String id, String projectId, String versionId, String targetKey, String mediaType, String taskId,
                           String model, String prompt, String status, String resultUrl, String storageKey, String mimeType,
                           String errorMessage, OffsetDateTime createdAt) {
    }

    /**
     * 写入一条生成记录。同一项目同一目标已有进行中的任务时，唯一索引会拒绝重复插入。
     *
     * @param teamId 团队空间
     * @param userId 用户ID
     * @param row 记录
     * @return 是否写入
     */
    public Mono<Boolean> insertMedia(long teamId, long userId, MediaRow row) {
        return databaseClient.sql("""
                INSERT INTO drama_media (
                    id, team_id, project_id, user_id, version_id, target_key, media_type, task_id, model, prompt, status,
                    result_url, storage_key, mime_type, error_message, created_at, updated_at
                ) VALUES (
                    :id, :teamId, :projectId, :userId, :versionId, :targetKey, :mediaType, :taskId, :model, :prompt, :status,
                    :resultUrl, :storageKey, :mimeType, :errorMessage, :createdAt, :createdAt
                )
                """)
                .bind("id", row.id()).bind("teamId", teamId).bind("projectId", row.projectId()).bind("userId", userId)
                .bind("versionId", row.versionId()).bind("targetKey", row.targetKey()).bind("mediaType", row.mediaType())
                .bind("taskId", row.taskId()).bind("model", row.model()).bind("prompt", row.prompt()).bind("status", row.status())
                .bind("resultUrl", row.resultUrl()).bind("storageKey", row.storageKey()).bind("mimeType", row.mimeType())
                .bind("errorMessage", row.errorMessage()).bind("createdAt", row.createdAt())
                .fetch().rowsUpdated().map(count -> count > 0);
    }

    /**
     * 任务是否还挂在某个短剧项目上。项目删除后记录会级联消失。
     *
     * @param taskId 统一任务ID
     * @return 仍有媒体记录时为 true
     */
    public Mono<Boolean> hasMediaTask(String taskId) {
        return databaseClient.sql("SELECT id FROM drama_media WHERE task_id = :taskId LIMIT 1")
                .bind("taskId", taskId)
                .map((row, metadata) -> Boolean.TRUE).one()
                .defaultIfEmpty(Boolean.FALSE)
                .contextWrite(context -> context.put(TeamScope.SYSTEM_KEY, true));
    }

    /** 项目封面图记录。 */
    public record ProjectCoverRow(String projectId, String url, String storageKey) {
    }

    /**
     * 批量读取每个项目最早生成成功的一张图片作为封面。
     *
     * @param projectIds 项目ID列表
     * @param teamId 团队空间
     * @return 封面记录
     */
    public Flux<ProjectCoverRow> findFirstImageCovers(List<String> projectIds, long teamId) {
        if (projectIds == null || projectIds.isEmpty()) return Flux.empty();
        return databaseClient.sql("""
                SELECT DISTINCT ON (project_id) project_id, result_url, storage_key
                FROM drama_media
                WHERE team_id = :teamId
                  AND project_id IN (:projectIds)
                  AND media_type = 'image'
                  AND status = 'success'
                  AND (COALESCE(result_url, '') <> '' OR COALESCE(storage_key, '') <> '')
                ORDER BY project_id, created_at ASC
                """)
                .bind("teamId", teamId)
                .bind("projectIds", projectIds)
                .map((row, metadata) -> new ProjectCoverRow(
                        row.get("project_id", String.class),
                        row.get("result_url", String.class),
                        row.get("storage_key", String.class)))
                .all();
    }

    /**
     * 按创建时间倒序读取项目的全部生成记录。
     *
     * @param projectId 项目ID
     * @param teamId 团队空间
     * @return 生成记录
     */
    public Flux<MediaRow> listMedia(String projectId, long teamId) {
        return databaseClient.sql("""
                SELECT id, project_id, version_id, target_key, media_type, task_id, model, prompt, status,
                    result_url, storage_key, mime_type, error_message, created_at
                FROM drama_media WHERE project_id = :projectId AND team_id = :teamId
                ORDER BY created_at DESC
                """)
                .bind("projectId", projectId).bind("teamId", teamId)
                .map((row, metadata) -> mapMedia(row)).all();
    }

    /**
     * 用统一任务的最新状态覆盖生成记录。
     *
     * @param id 记录ID
     * @param teamId 团队空间
     * @param status 状态
     * @param resultUrl 结果地址
     * @param storageKey 存储键
     * @param mimeType 媒体类型
     * @param errorMessage 失败说明
     * @return 完成信号
     */
    public Mono<Void> updateMedia(String id, long teamId, String status, String resultUrl, String storageKey, String mimeType, String errorMessage) {
        return databaseClient.sql("""
                UPDATE drama_media SET status = :status, result_url = :resultUrl, storage_key = :storageKey,
                    mime_type = :mimeType, error_message = :errorMessage, updated_at = :updatedAt
                WHERE id = :id AND team_id = :teamId
                """)
                .bind("status", status).bind("resultUrl", resultUrl).bind("storageKey", storageKey)
                .bind("mimeType", mimeType).bind("errorMessage", errorMessage).bind("updatedAt", OffsetDateTime.now())
                .bind("id", id).bind("teamId", teamId).then();
    }

    private MediaRow mapMedia(io.r2dbc.spi.Readable row) {
        return new MediaRow(row.get("id", String.class), row.get("project_id", String.class), row.get("version_id", String.class),
                row.get("target_key", String.class), row.get("media_type", String.class), row.get("task_id", String.class),
                row.get("model", String.class), row.get("prompt", String.class), row.get("status", String.class),
                row.get("result_url", String.class), row.get("storage_key", String.class), row.get("mime_type", String.class),
                row.get("error_message", String.class), row.get("created_at", OffsetDateTime.class));
    }
}
