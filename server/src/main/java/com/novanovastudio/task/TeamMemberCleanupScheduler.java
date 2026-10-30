package com.novanovastudio.task;

import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.common.SystemMessage;
import com.novanovastudio.repository.TeamRepository;
import com.novanovastudio.security.TeamScope;
import com.novanovastudio.service.AiTaskService;
import com.novanovastudio.service.StorageBillingService;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 可重试的成员移除清理，先停止任务，再清理对象与私有创作数据。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-18 10:00
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class TeamMemberCleanupScheduler {
    /** 扫描和行映射。 */
    private final TeamRepository repository;
    /** 参数化写入。 */
    private final DatabaseClient databaseClient;
    /** 使用已有任务取消与原路退款。 */
    private final ObjectProvider<AiTaskService> aiTaskServiceProvider;
    /** 物理对象清理。 */
    private final StorageBillingService storageBillingService;
    /** 各类业务沿用原有取消结算规则。 */
    private final ObjectProvider<com.novanovastudio.service.NovelAdaptationService> novelAdaptationService;
    /** 故事分析按成功批次结算。 */
    private final ObjectProvider<com.novanovastudio.service.StoryBibleService> storyBibleService;
    /** 正文批量生成按已完成集结算。 */
    private final ObjectProvider<com.novanovastudio.service.EpisodeBodiesService> episodeBodiesService;
    /** 全书改编按已完成单元结算。 */
    private final ObjectProvider<com.novanovastudio.service.WholeBookAdaptationService> wholeBookAdaptationService;
    /** 视频合成取消控制。 */
    private final ObjectProvider<com.novanovastudio.service.VideoCompositionTaskService> videoCompositionTaskService;
    /** 主Agent请求取消控制。 */
    private final ObjectProvider<com.novanovastudio.agent.CreationAgentOrchestrator> creationAgentOrchestrator;
    /** 避免同实例定时重入。 */
    private final AtomicBoolean running = new AtomicBoolean();
    /** 停用后排队任务取消扫描，和实际对象清理独立执行。 */
    private final AtomicBoolean canceling = new AtomicBoolean();

    /** 停用成员或团队时取消未派发任务；已发出的调用沿用原业务收尾。 */
    @Scheduled(fixedDelay = 15000)
    public void cancelSuspendedQueuedTasks() {
        if (!canceling.compareAndSet(false, true)) return;
        repository.query("SELECT members.team_id, members.user_id FROM team_members members JOIN teams ON teams.id = members.team_id WHERE NOT teams.enabled OR members.member_status <> 'active'", Map.of())
                .concatMap(member -> {
                    long teamId = member.getLongValue("teamId"), userId = member.getLongValue("userId");
                    return repository.query("SELECT id FROM ai_generation_tasks WHERE team_id = :team AND user_id = :user AND status = 'pending' AND NOT data_purged", Map.of("team", teamId, "user", userId))
                            .concatMap(task -> aiTaskServiceProvider.getObject().cancelTaskForUser(userId, task.getString("id")))
                            .then(cancelOtherTasks(teamId, userId, true))
                            .contextWrite(context -> new TeamScope(teamId, "member").apply(context)
                                    .put(com.novanovastudio.security.CurrentUserProvider.CURRENT_USER_CONTEXT_KEY, new com.novanovastudio.security.CurrentUser(userId, null, "user", 1)))
                            .onErrorResume(error -> { log.error("取消停用空间的排队任务失败：teamId={}, userId={}", teamId, userId, error); return Mono.empty(); });
                }).then(cancelRevokedResourceTasks())
                .contextWrite(context -> context.put(TeamScope.SYSTEM_KEY, true)).doFinally(signal -> canceling.set(false))
                .subscribe(ignored -> { }, error -> log.error("扫描停用空间排队任务失败", error));
    }

    /** @return 平台授权撤销或显式资源禁用后取消未派发的AI任务 */
    private Mono<Void> cancelRevokedResourceTasks() {
        return repository.query("""
                SELECT tasks.id, tasks.team_id, tasks.user_id FROM ai_generation_tasks tasks WHERE tasks.team_id > 0
                  AND tasks.status = 'pending' AND NOT tasks.data_purged AND (
                    NOT EXISTS(SELECT 1 FROM platform_ai_model_configs models WHERE models.model_config_id = tasks.model_config_id
                        AND (models.team_id = tasks.team_id OR (models.team_id = 0 AND EXISTS(SELECT 1 FROM team_resource_grants grants
                            WHERE grants.team_id = tasks.team_id AND resource_type = 'model' AND resource_id = models.model_config_id))))
                    OR NOT EXISTS(SELECT 1 FROM team_resource_preferences preferences WHERE preferences.team_id = tasks.team_id
                        AND resource_type = 'model' AND resource_id = tasks.model_config_id AND enabled)
                    OR (tasks.storage_id_snapshot IS NOT NULL AND NOT EXISTS(SELECT 1 FROM platform_object_storage_configs storages
                        WHERE storages.storage_id = tasks.storage_id_snapshot AND storages.status = 1 AND (storages.team_id = tasks.team_id
                            OR (storages.team_id = 0 AND EXISTS(SELECT 1 FROM team_resource_grants grants WHERE grants.team_id = tasks.team_id
                                AND resource_type = 'objectStorage' AND resource_id = storages.storage_id))))))
                """, Map.of()).concatMap(task -> aiTaskServiceProvider.getObject().cancelTaskForUser(task.getLongValue("userId"), task.getString("id"))
                        .contextWrite(context -> new TeamScope(task.getLongValue("teamId"), "member").apply(context))).then();
    }

    /** 扫描持久化移除任务，错误保留供下次重试。 */
    @Scheduled(fixedDelay = 15000)
    public void clean() {
        if (!running.compareAndSet(false, true)) return;
        repository.query("SELECT * FROM team_member_cleanup_jobs WHERE completed_at IS NULL ORDER BY last_attempt_at NULLS FIRST, requested_at LIMIT 20", Map.of())
                .concatMap(job -> databaseClient.sql("UPDATE team_member_cleanup_jobs SET last_attempt_at = CURRENT_TIMESTAMP WHERE team_id = :team AND user_id = :user")
                        .bind("team", job.getLongValue("teamId")).bind("user", job.getLongValue("userId")).fetch().rowsUpdated().then(cleanMember(job)).onErrorResume(error -> {
                    log.error("移除成员清理失败：teamId={}, userId={}", job.getLongValue("teamId"), job.getLongValue("userId"), error);
                    return databaseClient.sql("UPDATE team_member_cleanup_jobs SET last_error = :error WHERE team_id = :team AND user_id = :user")
                            .bind("error", error.getMessage() == null ? "清理失败" : error.getMessage()).bind("team", job.getLongValue("teamId")).bind("user", job.getLongValue("userId")).fetch().rowsUpdated().then();
                }))
                .contextWrite(context -> context.put(TeamScope.SYSTEM_KEY, true))
                .doFinally(signal -> running.set(false)).subscribe(ignored -> { }, error -> log.error("扫描团队成员清理任务失败", error));
    }

    /**
     * 清理单个成员，账本和用户身份永不删除。
     * @param job 清理任务
     * @return 清理完成信号
     */
    private Mono<Void> cleanMember(JSONObject job) {
        long teamId = job.getLongValue("teamId"), userId = job.getLongValue("userId");
        return repository.query("SELECT id FROM ai_generation_tasks WHERE team_id = :team AND user_id = :user AND status IN ('pending','queued','running')", Map.of("team", teamId, "user", userId))
                .concatMap(task -> aiTaskServiceProvider.getObject().cancelTaskForUser(userId, task.getString("id")))
                .then(cancelOtherTasks(teamId, userId, false))
                .then(databaseClient.sql("UPDATE storage_objects SET deletion_requested_at = COALESCE(deletion_requested_at, CURRENT_TIMESTAMP) WHERE team_id = :team AND user_id = :user AND deleted_at IS NULL")
                        .bind("team", teamId).bind("user", userId).fetch().rowsUpdated())
                .then(storageBillingService.deletePendingObjects())
                .then(repository.query("SELECT COUNT(*) remaining FROM storage_objects WHERE team_id = :team AND user_id = :user AND deleted_at IS NULL", Map.of("team", teamId, "user", userId)).single())
                .flatMap(result -> {
                    if (result.getLongValue("remaining") > 0) return Mono.empty();
                    // 删除根项目会通过现有外键级联清理剧本、分镜、小说和导出内容，保留生成任务供流水外键追溯。
                    return databaseClient.sql("UPDATE ai_generation_tasks SET data_purged = TRUE, request_data = '{}'::jsonb, result_data = '{}'::jsonb, error_message = '' WHERE team_id = :team AND user_id = :user")
                            .bind("team", teamId).bind("user", userId).fetch().rowsUpdated()
                            .thenMany(Flux.fromIterable(java.util.List.of("script_projects", "canvas_projects", "assets", "generation_logs", "media_files", "video_composition_tasks", "agent_session", "user_configs", "user_notification_reads")))
                            .concatMap(table -> databaseClient.sql("DELETE FROM " + table + " WHERE team_id = :team AND user_id = :user")
                                    .bind("team", teamId).bind("user", userId).fetch().rowsUpdated())
                            .then(databaseClient.sql("UPDATE team_member_cleanup_jobs SET completed_at = CURRENT_TIMESTAMP, last_error = NULL WHERE team_id = :team AND user_id = :user")
                                    .bind("team", teamId).bind("user", userId).fetch().rowsUpdated()).then();
                }).contextWrite(context -> new TeamScope(teamId, "member").apply(context)
                        .put(com.novanovastudio.security.CurrentUserProvider.CURRENT_USER_CONTEXT_KEY,
                                new com.novanovastudio.security.CurrentUser(userId, null, "user", 1)));
    }

    /**
     * 取消成员剩余业务任务，复用各业务已实现的幂等退款与状态更新。
     * @param teamId 清理空间
     * @param userId 被移除成员
     * @param onlyQueued 只取消未派发任务，保留在途外部调用
     * @return 取消结算完成信号
     */
    private Mono<Void> cancelOtherTasks(long teamId, long userId, boolean onlyQueued) {
        Map<String, Object> parameters = Map.of("team", teamId, "user", userId);
        return repository.query("SELECT id, project_id, phase, EXISTS(SELECT 1 FROM novel_adaptation_workflows workflows WHERE workflows.job_id = jobs.id) whole_book FROM novel_adaptation_jobs jobs WHERE team_id = :team AND user_id = :user AND " + (onlyQueued ? "status = 'queued'" : "status IN ('queued','running','awaiting')"), parameters)
                .concatMap(task -> {
                    String projectId = task.getString("projectId"), taskId = task.getString("id");
                    if ("bodies".equals(task.getString("phase"))) return episodeBodiesService.getObject().cancel(new com.novanovastudio.dto.EpisodeBodiesDtos.JobRequest(projectId, taskId)).then();
                    if (task.getBooleanValue("wholeBook")) return wholeBookAdaptationService.getObject().cancel(new com.novanovastudio.dto.WholeBookAdaptationDtos.JobRequest(projectId, taskId)).then();
                    return novelAdaptationService.getObject().cancelPipeline(new com.novanovastudio.dto.NovelAdaptationDtos.JobRequest(projectId, taskId)).then();
                })
                .thenMany(repository.query("SELECT id, project_id FROM story_bible_analysis_jobs WHERE team_id = :team AND user_id = :user AND " + (onlyQueued ? "status = 'queued'" : "status IN ('queued','running','retryable')"), parameters)
                        .concatMap(task -> storyBibleService.getObject().cancelAnalysis(new com.novanovastudio.dto.StoryBibleDtos.JobRequest(task.getString("projectId"), task.getString("id")))))
                .thenMany(repository.query("SELECT id FROM video_composition_tasks WHERE team_id = :team AND user_id = :user AND " + (onlyQueued ? "status = 'pending'" : "status IN ('queued','running','pending')"), parameters)
                        .concatMap(task -> videoCompositionTaskService.getObject().cancelTask(task.getString("id"))))
                .thenMany(repository.query("SELECT id FROM creation_agent_request WHERE team_id = :team AND user_id = :user AND " + (onlyQueued ? "status = 'queued'" : "status IN ('queued','running')"), parameters)
                        .concatMap(task -> creationAgentOrchestrator.getObject().cancelChat(userId, task.getString("id"))))
                .then(databaseClient.sql("UPDATE script_source_import_tasks tasks SET status = 'failed', error_message = '成员已移除' FROM script_source_documents documents WHERE tasks.document_id = documents.id AND tasks.team_id = :team AND documents.user_id = :user AND " + (onlyQueued ? "tasks.status = 'queued'" : "tasks.status IN ('queued','running')"))
                        .bind("team", teamId).bind("user", userId).fetch().rowsUpdated()).then();
    }
}
