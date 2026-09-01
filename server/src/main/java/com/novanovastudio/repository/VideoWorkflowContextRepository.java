package com.novanovastudio.repository;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.TypeReference;
import com.novanovastudio.agent.dto.CreationSettings;
import com.novanovastudio.agent.workflow.VideoWorkflowContext;
import java.time.OffsetDateTime;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Mono;

/** 视频技能工作流上下文仓储。 */
@Repository
@RequiredArgsConstructor
public class VideoWorkflowContextRepository {

    /** R2DBC数据库客户端。 */
    private final DatabaseClient databaseClient;

    /**
     * 保存首次澄清所需的工作流上下文。
     *
     * @param userId Long 用户ID
     * @param sessionId String 会话ID
     * @param context VideoWorkflowContext 工作流上下文
     * @return Mono<Void> 保存完成信号
     */
    public Mono<Void> create(Long userId, String sessionId, VideoWorkflowContext context) {
        return databaseClient.sql("""
                INSERT INTO video_workflow_context(id, user_id, session_id, workflow_type, skill_snapshot,
                    original_request, clarification_question, answers, drafted_prompts, creation_settings, status, context_version, created_at, updated_at)
                VALUES (:id, :userId, :sessionId, :workflowType, :skillSnapshot::jsonb,
                    :originalRequest, :clarificationQuestion, :answers::jsonb, :draftedPrompts::jsonb, :settings::jsonb, 'clarifying', 1, :now, :now)
                """)
                .bind("id", context.id()).bind("userId", userId).bind("sessionId", sessionId)
                .bind("workflowType", context.workflowType()).bind("skillSnapshot", JSON.toJSONString(context.skillSnapshot()))
                .bind("originalRequest", context.originalRequest()).bind("clarificationQuestion", context.clarificationQuestion())
                .bind("answers", JSON.toJSONString(context.answers()))
                .bind("draftedPrompts", JSON.toJSONString(context.draftedPrompts() == null ? Map.of() : context.draftedPrompts()))
                .bind("settings", JSON.toJSONString(context.creationSettings()))
                .bind("now", OffsetDateTime.now()).then();
    }

    /**
     * 查询用户会话中等待回答的工作流上下文，避免仅凭会话编号跨用户读取。
     *
     * @param userId Long 用户ID
     * @param sessionId String 会话ID
     * @return Mono<VideoWorkflowContext> 工作流上下文，不存在时为空
     */
    public Mono<VideoWorkflowContext> findClarifyingByUserAndSession(Long userId, String sessionId) {
        return findByUserAndSessionStatus(userId, sessionId, "clarifying");
    }

    /**
     * 查询用户会话中等待确认提示词草案的工作流上下文。
     *
     * @param userId Long 用户ID
     * @param sessionId String 会话ID
     * @return Mono<VideoWorkflowContext> 工作流上下文，不存在时为空
     */
    public Mono<VideoWorkflowContext> findPendingConfirmByUserAndSession(Long userId, String sessionId) {
        return findByUserAndSessionStatus(userId, sessionId, "pending_confirm");
    }

    /**
     * 查询用户会话中等待确认图片结果的工作流上下文。
     *
     * @param userId Long 用户ID
     * @param sessionId String 会话ID
     * @return Mono<VideoWorkflowContext> 工作流上下文，不存在时为空
     */
    public Mono<VideoWorkflowContext> findImagePendingConfirmByUserAndSession(Long userId, String sessionId) {
        return findByUserAndSessionStatus(userId, sessionId, "image_pending_confirm");
    }

    /**
     * 按状态查询单条工作流上下文。
     *
     * @param userId Long 用户ID
     * @param sessionId String 会话ID
     * @param status String 上下文状态
     * @return Mono<VideoWorkflowContext> 工作流上下文，不存在时为空
     */
    private Mono<VideoWorkflowContext> findByUserAndSessionStatus(Long userId, String sessionId, String status) {
        return databaseClient.sql("""
                SELECT id, workflow_type, skill_snapshot::text AS skill_snapshot, original_request,
                       clarification_question, answers::text AS answers, drafted_prompts::text AS drafted_prompts,
                       generated_images::text AS generated_images,
                       creation_settings::text AS creation_settings, status, context_version
                FROM video_workflow_context
                WHERE user_id = :userId AND session_id = :sessionId AND status = :status
                ORDER BY updated_at DESC LIMIT 1
                """).bind("userId", userId).bind("sessionId", sessionId).bind("status", status)
                .map(VideoWorkflowContextRepository::mapRow).one();
    }

    /**
     * 查询用户会话中最新一条工作流上下文（任意状态），供视频阶段执行时读取已确认的图片结果。
     *
     * @param userId Long 用户ID
     * @param sessionId String 会话ID
     * @return Mono<VideoWorkflowContext> 工作流上下文，不存在时为空
     */
    public Mono<VideoWorkflowContext> findLatestByUserAndSession(Long userId, String sessionId) {
        return databaseClient.sql("""
                SELECT id, workflow_type, skill_snapshot::text AS skill_snapshot, original_request,
                       clarification_question, answers::text AS answers, drafted_prompts::text AS drafted_prompts,
                       generated_images::text AS generated_images,
                       creation_settings::text AS creation_settings, status, context_version
                FROM video_workflow_context
                WHERE user_id = :userId AND session_id = :sessionId
                ORDER BY updated_at DESC LIMIT 1
                """).bind("userId", userId).bind("sessionId", sessionId)
                .map(VideoWorkflowContextRepository::mapRow).one();
    }

    /**
     * 行数据转上下文对象。
     *
     * @param row Row 查询行
     * @param metadata RowMetadata 行元数据
     * @return VideoWorkflowContext 工作流上下文
     */
    private static VideoWorkflowContext mapRow(io.r2dbc.spi.Row row, io.r2dbc.spi.RowMetadata metadata) {
        return new VideoWorkflowContext(
                row.get("id", String.class), row.get("workflow_type", String.class),
                JSON.parseObject(row.get("skill_snapshot", String.class), new TypeReference<Map<String, Object>>() {}),
                row.get("original_request", String.class), row.get("clarification_question", String.class),
                JSON.parseArray(row.get("answers", String.class), String.class),
                JSON.parseObject(row.get("drafted_prompts", String.class), new TypeReference<Map<String, Object>>() {}),
                JSON.parseObject(row.get("generated_images", String.class), new TypeReference<Map<String, Object>>() {}),
                JSON.parseObject(row.get("creation_settings", String.class), CreationSettings.class),
                row.get("status", String.class), row.get("context_version", Integer.class));
    }

    /**
     * 保存助手起草的提示词并将上下文推进到待确认状态，防止并发轮次重复推进。
     *
     * @param context VideoWorkflowContext 已合并回答的上下文
     * @param drafts Map<String, Object> 起草的阶段提示词
     * @return Mono<VideoWorkflowContext> 已推进状态的工作流上下文，上下文已被其他请求处理时为空
     */
    public Mono<VideoWorkflowContext> saveDrafts(VideoWorkflowContext context, Map<String, Object> drafts) {
        VideoWorkflowContext pending = new VideoWorkflowContext(context.id(), context.workflowType(), context.skillSnapshot(),
                context.originalRequest(), context.clarificationQuestion(), context.answers(), drafts, context.generatedImages(),
                context.creationSettings(),
                "pending_confirm", context.contextVersion() == null ? 1 : context.contextVersion() + 1);
        return databaseClient.sql("""
                UPDATE video_workflow_context
                SET answers = :answers::jsonb, drafted_prompts = :drafts::jsonb,
                    creation_settings = :settings::jsonb, status = 'pending_confirm',
                    context_version = :version, updated_at = NOW()
                WHERE id = :id AND status IN ('clarifying', 'pending_confirm')
                """).bind("answers", JSON.toJSONString(pending.answers()))
                .bind("drafts", JSON.toJSONString(drafts == null ? Map.of() : drafts))
                .bind("settings", JSON.toJSONString(pending.creationSettings()))
                .bind("version", pending.contextVersion())
                .bind("id", pending.id()).fetch().rowsUpdated()
                .flatMap(updated -> updated >= 1 ? Mono.just(pending) : Mono.<VideoWorkflowContext>empty());
    }

    /**
     * 用户确认草案后将上下文推进到已规划状态，仅允许从待确认状态流转。
     *
     * @param context VideoWorkflowContext 待确认的上下文
     * @return Mono<VideoWorkflowContext> 已确认的工作流上下文，上下文已被其他请求处理时为空
     */
    public Mono<VideoWorkflowContext> confirmDrafts(VideoWorkflowContext context) {
        VideoWorkflowContext next = new VideoWorkflowContext(context.id(), context.workflowType(), context.skillSnapshot(),
                context.originalRequest(), context.clarificationQuestion(), context.answers(), context.draftedPrompts(),
                context.generatedImages(), context.creationSettings(), "planned",
                context.contextVersion() == null ? 1 : context.contextVersion() + 1);
        // 确认草案时同步持久化最新页面设置（用户可能在卡片调整了图片模型/比例/清晰度/画质），
        // 避免图片阶段计划从上下文读到旧默认值（如 1:1/2K）。
        return databaseClient.sql("""
                UPDATE video_workflow_context
                SET status = 'planned', creation_settings = :settings::jsonb,
                    context_version = :version, updated_at = NOW()
                WHERE id = :id AND status = 'pending_confirm'
                """).bind("settings", JSON.toJSONString(next.creationSettings()))
                .bind("version", next.contextVersion())
                .bind("id", next.id()).fetch().rowsUpdated()
                .flatMap(updated -> updated == 1 ? Mono.just(next) : Mono.<VideoWorkflowContext>empty());
    }

    /**
     * 用户要求修改草案时将上下文退回对话状态。
     *
     * @param context VideoWorkflowContext 待确认的上下文
     * @return Mono<VideoWorkflowContext> 已退回的工作流上下文，上下文已被其他请求处理时为空
     */
    public Mono<VideoWorkflowContext> reopenDrafts(VideoWorkflowContext context) {
        return transitionStatus(context, "pending_confirm", "clarifying");
    }

    /**
     * 在乐观锁保护下流转上下文状态。
     *
     * @param context VideoWorkflowContext 当前上下文
     * @param from String 原状态
     * @param to String 目标状态
     * @return Mono<VideoWorkflowContext> 已流转的上下文，状态已变化时为空
     */
    private Mono<VideoWorkflowContext> transitionStatus(VideoWorkflowContext context, String from, String to) {
        VideoWorkflowContext next = new VideoWorkflowContext(context.id(), context.workflowType(), context.skillSnapshot(),
                context.originalRequest(), context.clarificationQuestion(), context.answers(), context.draftedPrompts(),
                context.generatedImages(), context.creationSettings(), to, context.contextVersion() == null ? 1 : context.contextVersion() + 1);
        return databaseClient.sql("""
                UPDATE video_workflow_context
                SET status = :status, context_version = :version, updated_at = NOW()
                WHERE id = :id AND status = :fromStatus
                """).bind("status", to).bind("version", next.contextVersion())
                .bind("id", next.id()).bind("fromStatus", from).fetch().rowsUpdated()
                .flatMap(updated -> updated == 1 ? Mono.just(next) : Mono.<VideoWorkflowContext>empty());
    }

    /**
     * 保存图片阶段生成的首帧/尾帧结果并将上下文推进到图片待确认状态。
     * 图片阶段计划执行前上下文已由 confirmDrafts 推进到 planned，故允许从 planned 流转；
     * 修改提示词重跑场景下允许从 image_pending_confirm 流转。
     *
     * @param context VideoWorkflowContext 待确认的上下文
     * @param images Map<String, Object> 图片阶段结果，key 为任务角色（first_frame/last_frame）
     * @return Mono<VideoWorkflowContext> 已推进状态的工作流上下文，上下文已被其他请求处理时为空
     */
    public Mono<VideoWorkflowContext> saveGeneratedImages(VideoWorkflowContext context, Map<String, Object> images) {
        VideoWorkflowContext next = context.withGeneratedImages(images);
        return databaseClient.sql("""
                UPDATE video_workflow_context
                SET generated_images = :images::jsonb, status = 'image_pending_confirm',
                    context_version = :version, updated_at = NOW()
                WHERE id = :id AND status IN ('planned', 'pending_confirm', 'image_pending_confirm')
                """).bind("images", JSON.toJSONString(images == null ? Map.of() : images))
                .bind("version", next.contextVersion())
                .bind("id", next.id()).fetch().rowsUpdated()
                .flatMap(updated -> updated >= 1 ? Mono.just(next) : Mono.<VideoWorkflowContext>empty());
    }

    /**
     * 用户确认使用已生成图片后将上下文推进到已规划状态，仅允许从图片待确认状态流转。
     *
     * @param context VideoWorkflowContext 图片待确认的上下文
     * @return Mono<VideoWorkflowContext> 已确认的工作流上下文，上下文已被其他请求处理时为空
     */
    public Mono<VideoWorkflowContext> confirmGeneratedImages(VideoWorkflowContext context) {
        VideoWorkflowContext next = context.confirmedImages();
        return databaseClient.sql("""
                UPDATE video_workflow_context
                SET status = 'planned', context_version = :version, updated_at = NOW()
                WHERE id = :id AND status = 'image_pending_confirm'
                """).bind("version", next.contextVersion())
                .bind("id", next.id()).fetch().rowsUpdated()
                .flatMap(updated -> updated == 1 ? Mono.just(next) : Mono.<VideoWorkflowContext>empty());
    }

    /**
     * 用户要求修改提示词时将上下文退回澄清状态，仅允许从图片待确认状态流转。
     *
     * @param context VideoWorkflowContext 图片待确认的上下文
     * @return Mono<VideoWorkflowContext> 已退回的工作流上下文，上下文已被其他请求处理时为空
     */
    public Mono<VideoWorkflowContext> reopenImages(VideoWorkflowContext context) {
        return transitionStatus(context, "image_pending_confirm", "clarifying");
    }

    /**
     * 更新用户会话中工作流上下文的终态。
     *
     * @param userId Long 用户ID
     * @param sessionId String Agent会话ID
     * @param status String 工作流终态：completed、failed或canceled
     * @return Mono<Void> 更新完成信号
     */
    public Mono<Void> updateStatusByUserAndSession(Long userId, String sessionId, String status) {
        return databaseClient.sql("""
                UPDATE video_workflow_context
                SET status = :status, context_version = context_version + 1, updated_at = NOW()
                WHERE user_id = :userId AND session_id = :sessionId
                  AND status IN ('clarifying', 'pending_confirm', 'image_pending_confirm', 'planned')
                """)
                .bind("status", status)
                .bind("userId", userId)
                .bind("sessionId", sessionId)
                .then();
    }
}
