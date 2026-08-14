package com.novanovastudio.repository;

import com.alibaba.fastjson2.JSON;
import com.novanovastudio.entity.CreationAgentRequest;
import java.time.OffsetDateTime;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 统一主Agent请求队列数据库访问。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-08-13 00:00
 */
@Repository
@RequiredArgsConstructor
public class CreationAgentRequestRepository {

    /** 响应式数据库客户端 */
    private final DatabaseClient databaseClient;

    /**
     * 创建一条等待调度的主Agent请求。
     *
     * @param request CreationAgentRequest 请求实体
     * @return Mono<Void> 保存完成信号
     */
    public Mono<Void> create(CreationAgentRequest request) {
        return databaseClient.sql("""
                INSERT INTO creation_agent_request (
                    id, user_id, session_id, entry_source, request_data, status, plan_id, task_ids,
                    error_message, created_at, updated_at
                ) VALUES (
                    :id, :userId, :sessionId, :entrySource, :requestData::jsonb, :status, NULL, '[]'::jsonb,
                    '', :createdAt, :createdAt
                )
                """)
                .bind("id", request.getId())
                .bind("userId", request.getUserId())
                .bind("sessionId", request.getSessionId())
                .bind("entrySource", request.getEntrySource())
                .bind("requestData", text(request.getRequestData()))
                .bind("status", request.getStatus())
                .bind("createdAt", request.getCreatedAt() == null ? OffsetDateTime.now() : request.getCreatedAt())
                .then();
    }

    /**
     * 查询指定用户的一条主Agent请求。
     *
     * @param userId Long 用户ID
     * @param requestId String 请求ID
     * @return Mono<CreationAgentRequest> 请求实体
     */
    public Mono<CreationAgentRequest> findByIdForUser(Long userId, String requestId) {
        return databaseClient.sql(selectSql() + " WHERE id = :requestId AND user_id = :userId")
                .bind("requestId", requestId)
                .bind("userId", userId)
                .map((row, metadata) -> map(row))
                .one();
    }

    /**
     * 查询一条主Agent请求。
     *
     * @param requestId String 请求ID
     * @return Mono<CreationAgentRequest> 请求实体
     */
    public Mono<CreationAgentRequest> findById(String requestId) {
        return databaseClient.sql(selectSql() + " WHERE id = :requestId")
                .bind("requestId", requestId)
                .map((row, metadata) -> map(row))
                .one();
    }

    /**
     * 读取请求当前状态，供提交接口处理领取竞态。
     *
     * @param requestId String 请求ID
     * @return Mono<String> 当前状态
     */
    public Mono<String> findStatusById(String requestId) {
        return databaseClient.sql("SELECT status FROM creation_agent_request WHERE id = :requestId")
                .bind("requestId", requestId)
                .map((row, metadata) -> row.get("status", String.class))
                .one();
    }

    /**
     * 条件领取请求，避免被取消或已结束的请求重复执行。
     *
     * @param requestId String 请求ID
     * @return Mono<Boolean> 是否由queued切换为running
     */
    public Mono<Boolean> markRunningIfQueued(String requestId) {
        return databaseClient.sql("""
                UPDATE creation_agent_request
                SET status = 'running', error_message = '', started_at = COALESCE(started_at, NOW()), updated_at = NOW()
                WHERE id = :requestId AND status = 'queued'
                """)
                .bind("requestId", requestId)
                .fetch()
                .rowsUpdated()
                .map(rows -> rows > 0);
    }

    /**
     * 条件取消排队请求。
     *
     * @param userId Long 用户ID
     * @param requestId String 请求ID
     * @param message String 取消说明
     * @return Mono<Boolean> 是否成功取消排队请求
     */
    public Mono<Boolean> cancelQueuedIfQueued(Long userId, String requestId, String message) {
        return terminalUpdate("""
                UPDATE creation_agent_request
                SET status = 'canceled', error_message = :message, completed_at = NOW(), updated_at = NOW()
                WHERE id = :requestId AND user_id = :userId AND status = 'queued'
                """, userId, requestId, message);
    }

    /**
     * 条件取消运行中的请求。
     *
     * @param userId Long 用户ID
     * @param requestId String 请求ID
     * @param message String 取消说明
     * @return Mono<Boolean> 是否成功写入取消终态
     */
    public Mono<Boolean> cancelRunningIfRunning(Long userId, String requestId, String message) {
        return terminalUpdate("""
                UPDATE creation_agent_request
                SET status = 'canceled', error_message = :message, completed_at = NOW(), updated_at = NOW()
                WHERE id = :requestId AND user_id = :userId AND status = 'running'
                """, userId, requestId, message);
    }

    /**
     * 将运行中的请求标记为服务重启中断。
     *
     * @param requestId String 请求ID
     * @param message String 中断说明
     * @return Mono<Boolean> 是否成功标记中断
     */
    public Mono<Boolean> interruptRunningIfRunning(String requestId, String message) {
        return databaseClient.sql("""
                UPDATE creation_agent_request
                SET status = 'interrupted', error_message = :message, completed_at = NOW(), updated_at = NOW()
                WHERE id = :requestId AND status = 'running'
                """)
                .bind("requestId", requestId)
                .bind("message", text(message))
                .fetch()
                .rowsUpdated()
                .map(rows -> rows > 0);
    }

    /**
     * 将运行中的请求更新为执行终态。
     *
     * @param requestId String 请求ID
     * @param status String success或failed
     * @param message String 错误说明
     * @return Mono<Boolean> 是否成功更新
     */
    public Mono<Boolean> finishRunning(String requestId, String status, String message) {
        return databaseClient.sql("""
                UPDATE creation_agent_request
                SET status = :status, error_message = :message, completed_at = NOW(), updated_at = NOW()
                WHERE id = :requestId AND status = 'running'
                """)
                .bind("requestId", requestId)
                .bind("status", status)
                .bind("message", text(message))
                .fetch()
                .rowsUpdated()
                .map(rows -> rows > 0);
    }

    /**
     * 回写主Agent创建的计划ID。
     *
     * @param requestId String 请求ID
     * @param planId String 创作计划ID
     * @return Mono<Void> 更新完成信号
     */
    public Mono<Void> updatePlanId(String requestId, String planId) {
        return databaseClient.sql("""
                UPDATE creation_agent_request
                SET plan_id = :planId, updated_at = NOW()
                WHERE id = :requestId AND status IN ('running', 'canceled', 'failed', 'interrupted')
                """)
                .bind("requestId", requestId)
                .bind("planId", planId)
                .then();
    }

    /**
     * 追加一个已创建的底层AI任务ID，重复写入不会重复保存。
     *
     * @param requestId String 请求ID
     * @param taskId String 底层AI任务ID
     * @return Mono<Void> 更新完成信号
     */
    public Mono<Void> appendTaskId(String requestId, String taskId) {
        return databaseClient.sql("""
                UPDATE creation_agent_request
                SET task_ids = CASE
                    WHEN task_ids @> jsonb_build_array(CAST(:taskId AS text)) THEN task_ids
                    ELSE task_ids || jsonb_build_array(CAST(:taskId AS text))
                END,
                updated_at = NOW()
                WHERE id = :requestId AND status IN ('running', 'canceled', 'failed', 'interrupted')
                """)
                .bind("requestId", requestId)
                .bind("taskId", taskId)
                .then();
    }

    /**
     * 按创建时间读取等待恢复的请求。
     *
     * @return Flux<CreationAgentRequest> queued请求流
     */
    public Flux<CreationAgentRequest> listQueuedRequests() {
        return databaseClient.sql(selectSql() + " WHERE status = 'queued' ORDER BY created_at ASC, id ASC")
                .map((row, metadata) -> map(row))
                .all();
    }

    /**
     * 按创建时间读取运行中的请求，用于检查失效租约。
     *
     * @return Flux<CreationAgentRequest> running请求流
     */
    public Flux<CreationAgentRequest> listRunningRequests() {
        return databaseClient.sql(selectSql() + " WHERE status = 'running' ORDER BY created_at ASC, id ASC")
                .map((row, metadata) -> map(row))
                .all();
    }

    /**
     * 使用指定SQL执行带用户条件的终态更新。
     *
     * @param sql String 更新SQL
     * @param userId Long 用户ID
     * @param requestId String 请求ID
     * @param message String 终态说明
     * @return Mono<Boolean> 是否更新成功
     */
    private Mono<Boolean> terminalUpdate(String sql, Long userId, String requestId, String message) {
        return databaseClient.sql(sql)
                .bind("userId", userId)
                .bind("requestId", requestId)
                .bind("message", text(message))
                .fetch()
                .rowsUpdated()
                .map(rows -> rows > 0);
    }

    /**
     * 主查询字段，JSONB统一转换为文本供Fastjson解析。
     *
     * @return String 查询SQL字段部分
     */
    private String selectSql() {
        return """
                SELECT id, user_id, session_id, entry_source, request_data::text AS request_data, status,
                       COALESCE(plan_id, '') AS plan_id, task_ids::text AS task_ids, error_message,
                       started_at, completed_at, created_at, updated_at
                FROM creation_agent_request
                """;
    }

    /**
     * 映射数据库行到请求实体。
     *
     * @param row io.r2dbc.spi.Row 数据库行
     * @return CreationAgentRequest 请求实体
     */
    private CreationAgentRequest map(io.r2dbc.spi.Row row) {
        CreationAgentRequest request = new CreationAgentRequest();
        request.setId(row.get("id", String.class));
        request.setUserId(row.get("user_id", Long.class));
        request.setSessionId(row.get("session_id", String.class));
        request.setEntrySource(row.get("entry_source", String.class));
        request.setRequestData(row.get("request_data", String.class));
        request.setStatus(row.get("status", String.class));
        request.setPlanId(row.get("plan_id", String.class));
        request.setTaskIds(row.get("task_ids", String.class));
        request.setErrorMessage(row.get("error_message", String.class));
        request.setStartedAt(row.get("started_at", OffsetDateTime.class));
        request.setCompletedAt(row.get("completed_at", OffsetDateTime.class));
        request.setCreatedAt(row.get("created_at", OffsetDateTime.class));
        request.setUpdatedAt(row.get("updated_at", OffsetDateTime.class));
        return request;
    }

    /**
     * 解析已创建底层任务ID数组。
     *
     * @param request CreationAgentRequest 请求实体
     * @return List<String> 任务ID列表
     */
    public List<String> taskIds(CreationAgentRequest request) {
        if (request == null || request.getTaskIds() == null || request.getTaskIds().isBlank()) {
            return List.of();
        }
        return JSON.parseArray(request.getTaskIds(), String.class);
    }

    /**
     * 将可空字符串转换为空字符串，避免R2DBC空值绑定歧义。
     *
     * @param value String 原值
     * @return String 非空文本
     */
    private String text(String value) {
        return value == null ? "" : value;
    }
}
