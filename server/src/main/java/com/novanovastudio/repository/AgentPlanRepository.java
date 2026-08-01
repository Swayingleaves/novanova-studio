package com.novanovastudio.repository;

import com.alibaba.fastjson2.JSON;
import com.novanovastudio.agent.dto.CreationPlan;
import com.novanovastudio.agent.dto.CreationSettings;
import com.novanovastudio.agent.dto.CreationTask;
import java.time.OffsetDateTime;
import lombok.RequiredArgsConstructor;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.reactive.TransactionalOperator;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * Agent创作计划及计划任务数据库访问。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-23 00:00
 */
@Repository
@RequiredArgsConstructor
public class AgentPlanRepository {

    /** 响应式数据库客户端 */
    private final DatabaseClient databaseClient;
    /** 响应式事务操作器 */
    private final TransactionalOperator transactionalOperator;

    /**
     * 保存计划和全部初始任务。
     *
     * @param userId Long 用户ID
     * @param sessionId String 会话ID
     * @param plan CreationPlan 创作计划
     * @return Mono<Void> 保存完成信号
     */
    public Mono<Void> create(Long userId, String sessionId, CreationPlan plan) {
        Mono<Void> insertPlan = databaseClient.sql("""
                INSERT INTO agent_plan(id, user_id, session_id, intent, entry_source, summary, creation_settings, status, created_at, updated_at)
                VALUES (:id, :userId, :sessionId, :intent, :entrySource, :summary, :settings::jsonb, 'pending', :now, :now)
                """)
                .bind("id", plan.planId())
                .bind("userId", userId)
                .bind("sessionId", sessionId)
                .bind("intent", text(plan.intent()))
                .bind("entrySource", plan.entrySource())
                .bind("summary", text(plan.summary()))
                .bind("settings", JSON.toJSONString(plan.creationSettings()))
                .bind("now", OffsetDateTime.now())
                .then();
        return insertPlan.thenMany(Flux.fromIterable(plan.tasks())
                .concatMap(task -> insertTask(plan.planId(), task)))
                .then()
                .as(transactionalOperator::transactional);
    }

    /**
     * 查询当前会话最近一次创作计划的生成设置，供用户发送重试指令时恢复历史风格。
     *
     * @param userId Long 用户ID
     * @param sessionId String Agent会话ID
     * @return Mono<CreationSettings> 最近创作计划的生成设置；不存在时为空
     */
    public Mono<CreationSettings> findLatestCreationSettings(Long userId, String sessionId) {
        return databaseClient.sql("""
                SELECT creation_settings::text AS creation_settings
                FROM agent_plan
                WHERE user_id = :userId
                  AND session_id = :sessionId
                ORDER BY created_at DESC
                LIMIT 1
                """)
                .bind("userId", userId)
                .bind("sessionId", sessionId)
                .map((row, metadata) -> row.get("creation_settings", String.class))
                .one()
                .flatMap(json -> json == null || json.isBlank()
                        ? Mono.empty()
                        : Mono.just(JSON.parseObject(json, CreationSettings.class)));
    }

    /**
     * 更新计划状态。
     *
     * @param planId String 计划ID
     * @param status String 状态
     * @param errorMessage String 错误信息
     * @return Mono<Void> 更新完成信号
     */
    public Mono<Void> updatePlanStatus(String planId, String status, String errorMessage) {
        return databaseClient.sql("""
                UPDATE agent_plan
                SET status = :status, error_message = :errorMessage, updated_at = NOW(),
                    completed_at = CASE WHEN :terminal THEN NOW() ELSE completed_at END
                WHERE id = :planId AND (status <> 'canceled' OR :status = 'canceled')
                """)
                .bind("status", status)
                .bind("errorMessage", text(errorMessage))
                .bind("terminal", java.util.Set.of("success", "partial_failed", "failed", "canceled").contains(status))
                .bind("planId", planId)
                .then();
    }

    /**
     * 将计划中尚未完成的任务和计划本身统一标记为已取消。
     *
     * @param planId String 计划ID
     * @return Mono<Void> 取消状态保存完成信号
     */
    public Mono<Void> cancelPlan(String planId) {
        Mono<Void> cancelTasks = databaseClient.sql("""
                UPDATE agent_plan_task
                SET status = 'canceled', error_message = '已停止生成', updated_at = NOW(), completed_at = NOW()
                WHERE plan_id = :planId AND status IN ('pending', 'running')
                """)
                .bind("planId", planId)
                .then();
        return cancelTasks.then(updatePlanStatus(planId, "canceled", "已停止生成"))
                .as(transactionalOperator::transactional);
    }

    /**
     * 更新计划任务执行状态和结构化结果。
     *
     * @param planId String 计划ID
     * @param taskId String 计划任务ID
     * @param status String 状态
     * @param promptStrategy String 提示词策略
     * @param finalPrompt String 最终提示词
     * @param resultData Object 执行结果
     * @param errorMessage String 错误信息
     * @return Mono<Void> 更新完成信号
     */
    public Mono<Void> updateTask(String planId, String taskId, String status, String promptStrategy,
                                 String finalPrompt, Object resultData, String errorMessage) {
        return databaseClient.sql("""
                UPDATE agent_plan_task
                SET status = :status, prompt_strategy = :promptStrategy, final_prompt = :finalPrompt,
                    result_data = :resultData::jsonb, error_message = :errorMessage, updated_at = NOW(),
                    started_at = CASE WHEN :running AND started_at IS NULL THEN NOW() ELSE started_at END,
                    completed_at = CASE WHEN :terminal THEN NOW() ELSE completed_at END
                WHERE plan_id = :planId AND task_id = :taskId
                  AND (status <> 'canceled' OR :status = 'canceled')
                """)
                .bind("status", status)
                .bind("promptStrategy", text(promptStrategy))
                .bind("finalPrompt", text(finalPrompt))
                .bind("resultData", JSON.toJSONString(resultData == null ? java.util.Map.of() : resultData))
                .bind("errorMessage", text(errorMessage))
                .bind("running", "running".equals(status))
                .bind("terminal", java.util.Set.of("success", "failed", "skipped", "canceled").contains(status))
                .bind("planId", planId)
                .bind("taskId", taskId)
                .then();
    }

    /**
     * 插入单个计划任务。
     *
     * @param planId String 计划ID
     * @param task CreationTask 计划任务
     * @return Mono<Void> 插入完成信号
     */
    private Mono<Void> insertTask(String planId, CreationTask task) {
        return databaseClient.sql("""
                INSERT INTO agent_plan_task(plan_id, task_id, task_type, action, original_prompt, dependencies,
                                            tool_name, tool_arguments, status, created_at, updated_at)
                VALUES (:planId, :taskId, :taskType, :action, :prompt, :dependencies::jsonb,
                        :toolName, :toolArguments::jsonb, 'pending', NOW(), NOW())
                """)
                .bind("planId", planId)
                .bind("taskId", task.taskId())
                .bind("taskType", task.taskType())
                .bind("action", task.action())
                .bind("prompt", task.prompt())
                .bind("dependencies", JSON.toJSONString(task.dependsOn() == null ? java.util.List.of() : task.dependsOn()))
                .bind("toolName", text(task.toolName()))
                .bind("toolArguments", JSON.toJSONString(task.toolArguments() == null ? java.util.Map.of() : task.toolArguments()))
                .then();
    }

    /**
     * 将可空字符串转换为空字符串，避免R2DBC空值绑定歧义。
     *
     * @param value String 原值
     * @return String 非空字符串
     */
    private String text(String value) {
        return value == null ? "" : value;
    }
}
