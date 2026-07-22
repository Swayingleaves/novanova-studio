package com.novanovastudio.repository;

import com.novanovastudio.entity.AiGenerationTask;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * @title        AiTaskRepository.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  响应式AI任务仓储
 * @createTime   2026-06-24 18:25:00
 */
@Repository
@RequiredArgsConstructor
public class AiTaskRepository {

    /** 数据库客户端 */
    private final DatabaseClient databaseClient;

    /**
     * 创建AI任务
     *
     * @param task AiGenerationTask AI任务
     * @return Mono<Void> 操作结果
     */
    public Mono<Void> createTask(AiGenerationTask task) {
        // 创建任务时保存请求快照和初始结果空对象。
        return databaseClient.sql("""
                INSERT INTO ai_generation_tasks(id, user_id, task_type, model, provider, status, progress, request_data, result_data)
                VALUES (:id, :userId, :taskType, :model, :provider, :status, :progress, CAST(:requestData AS jsonb), CAST(:resultData AS jsonb))
                """)
                .bind("id", task.getId())
                .bind("userId", task.getUserId())
                .bind("taskType", task.getTaskType())
                .bind("model", task.getModel())
                .bind("provider", task.getProvider())
                .bind("status", task.getStatus())
                .bind("progress", task.getProgress())
                .bind("requestData", task.getRequestData())
                .bind("resultData", task.getResultData())
                .fetch()
                .rowsUpdated()
                .then();
    }

    /**
     * 按用户和任务ID查询任务
     *
     * @param userId Long 用户ID
     * @param taskId String 任务ID
     * @return Mono<AiGenerationTask> AI任务
     */
    public Mono<AiGenerationTask> getTask(Long userId, String taskId) {
        // 前端查询任务时限定用户ID，避免跨用户读取。
        return databaseClient.sql("""
                SELECT id, user_id, task_type, model, provider, status, progress, request_data::text AS request_data, result_data::text AS result_data,
                       error_message, started_at, completed_at, created_at, updated_at
                FROM ai_generation_tasks
                WHERE user_id = :userId AND id = :taskId
                """)
                .bind("userId", userId)
                .bind("taskId", taskId)
                .map((row, metadata) -> RowMappers.aiTask(row))
                .one();
    }

    /**
     * 按任务ID查询任务
     *
     * @param taskId String 任务ID
     * @return Mono<AiGenerationTask> AI任务
     */
    public Mono<AiGenerationTask> getTaskById(String taskId) {
        // 异步执行线程按任务ID读取任务，不依赖请求上下文。
        return databaseClient.sql("""
                SELECT id, user_id, task_type, model, provider, status, progress, request_data::text AS request_data, result_data::text AS result_data,
                       error_message, started_at, completed_at, created_at, updated_at
                FROM ai_generation_tasks
                WHERE id = :taskId
                """)
                .bind("taskId", taskId)
                .map((row, metadata) -> RowMappers.aiTask(row))
                .one();
    }

    /**
     * 查询用户任务列表
     *
     * @param userId Long 用户ID
     * @param statuses List<String> 状态筛选
     * @return Flux<AiGenerationTask> 任务列表
     */
    public Flux<AiGenerationTask> listTasks(Long userId, List<String> statuses) {
        // 基础查询限定用户ID。
        String sql = """
                SELECT id, user_id, task_type, model, provider, status, progress, request_data::text AS request_data, result_data::text AS result_data,
                       error_message, started_at, completed_at, created_at, updated_at
                FROM ai_generation_tasks
                WHERE user_id = :userId
                """;
        if (statuses != null && !statuses.isEmpty()) {
            sql += " AND status IN (" + R2dbcBindings.namedPlaceholders("status", statuses.size()) + ")";
        }
        sql += " ORDER BY created_at DESC LIMIT 200";
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql(sql).bind("userId", userId);
        if (statuses != null && !statuses.isEmpty()) {
            spec = R2dbcBindings.bindList(spec, "status", statuses);
        }
        return spec.map((row, metadata) -> RowMappers.aiTask(row)).all();
    }

    /**
     * 更新任务字段
     *
     * @param taskId String 任务ID
     * @param values Map<String, Object> 更新字段
     * @return Mono<Void> 操作结果
     */
    public Mono<Void> updateTask(String taskId, Map<String, Object> values) {
        if (values.isEmpty()) {
            return Mono.empty();
        }
        // 更新字段由服务层固定Map构造，避免外部输入控制列名。
        StringBuilder sql = new StringBuilder("UPDATE ai_generation_tasks SET updated_at = CURRENT_TIMESTAMP");
        values.keySet().forEach(column -> sql.append(", ").append(column).append(" = :").append(column));
        sql.append(" WHERE id = :taskId");
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql(sql.toString()).bind("taskId", taskId);
        for (Map.Entry<String, Object> entry : values.entrySet()) {
            spec = bindDynamicValue(spec, entry.getKey(), entry.getValue());
        }
        return spec.fetch().rowsUpdated().then();
    }

    /**
     * 更新任务JSON结果字段
     *
     * @param taskId String 任务ID
     * @param values Map<String, Object> 普通字段
     * @param resultData String 结果JSON
     * @return Mono<Void> 操作结果
     */
    public Mono<Void> updateTaskJson(String taskId, Map<String, Object> values, String resultData) {
        // 更新字段由服务层固定Map构造，resultData单独按jsonb写入。
        StringBuilder sql = new StringBuilder("UPDATE ai_generation_tasks SET updated_at = CURRENT_TIMESTAMP");
        values.keySet().forEach(column -> sql.append(", ").append(column).append(" = :").append(column));
        if (resultData != null) {
            sql.append(", result_data = CAST(:resultData AS jsonb)");
        }
        sql.append(" WHERE id = :taskId");
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql(sql.toString()).bind("taskId", taskId);
        for (Map.Entry<String, Object> entry : values.entrySet()) {
            spec = bindDynamicValue(spec, entry.getKey(), entry.getValue());
        }
        if (resultData != null) {
            spec = spec.bind("resultData", resultData);
        }
        return spec.fetch().rowsUpdated().then();
    }

    /**
     * 仅更新未结束任务。
     *
     * @param taskId String 任务ID
     * @param values Map<String, Object> 普通字段
     * @param resultData String 结果JSON
     * @return Mono<Boolean> 是否成功更新未结束任务
     */
    public Mono<Boolean> updateTaskIfNotTerminal(String taskId, Map<String, Object> values, String resultData) {
        // 未结束状态条件由数据库保证，避免多个消费者并发更新时覆盖已结束任务。
        StringBuilder sql = new StringBuilder("UPDATE ai_generation_tasks SET updated_at = CURRENT_TIMESTAMP");
        values.keySet().forEach(column -> sql.append(", ").append(column).append(" = :").append(column));
        if (resultData != null) {
            sql.append(", result_data = CAST(:resultData AS jsonb)");
        }
        sql.append(" WHERE id = :taskId AND status IN ('pending', 'running')");
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql(sql.toString()).bind("taskId", taskId);
        for (Map.Entry<String, Object> entry : values.entrySet()) {
            spec = bindDynamicValue(spec, entry.getKey(), entry.getValue());
        }
        if (resultData != null) {
            spec = spec.bind("resultData", resultData);
        }
        return spec.fetch().rowsUpdated().map(rows -> rows > 0);
    }

    /**
     * 查询需要启动恢复的未完成任务ID
     *
     * @param runningRecoverBefore OffsetDateTime 运行中任务恢复阈值
     * @return Flux<String> 任务ID列表
     */
    public Flux<String> listRecoverableTaskIds(OffsetDateTime runningRecoverBefore) {
        // pending任务直接恢复，running任务超过阈值后恢复，避免重启时误伤正在执行的任务。
        return databaseClient.sql("""
                SELECT id
                FROM ai_generation_tasks
                WHERE status = 'pending'
                   OR (status = 'running' AND updated_at < :runningRecoverBefore)
                ORDER BY created_at ASC
                LIMIT 500
                """)
                .bind("runningRecoverBefore", runningRecoverBefore)
                .map((row, metadata) -> row.get("id", String.class))
                .all();
    }

    /**
     * 将超时运行中任务恢复为等待状态
     *
     * @param runningRecoverBefore OffsetDateTime 运行中任务恢复阈值
     * @return Mono<Void> 恢复结果
     */
    public Mono<Void> recoverTimeoutRunningTasks(OffsetDateTime runningRecoverBefore) {
        // 只恢复超时running任务，pending任务保持原状态等待消费。
        return databaseClient.sql("""
                UPDATE ai_generation_tasks
                SET status = 'pending', progress = 0, error_message = '', started_at = NULL,
                    updated_at = CURRENT_TIMESTAMP
                WHERE status = 'running' AND updated_at < :runningRecoverBefore
                """)
                .bind("runningRecoverBefore", runningRecoverBefore)
                .fetch()
                .rowsUpdated()
                .then();
    }

    /**
     * 条件切换任务为运行中
     *
     * @param taskId String 任务ID
     * @return Mono<Boolean> 是否切换成功
     */
    public Mono<Boolean> markTaskRunningIfExecutable(String taskId) {
        // 只有pending或running任务允许进入执行，终态任务不会被重复拉起。
        return databaseClient.sql("""
                UPDATE ai_generation_tasks
                SET status = 'running', progress = 5, error_message = '',
                    started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = :taskId AND status IN ('pending', 'running')
                """)
                .bind("taskId", taskId)
                .fetch()
                .rowsUpdated()
                .map(rows -> rows > 0);
    }

    /**
     * 绑定动态字段值
     *
     * @param spec GenericExecuteSpec SQL执行规格
     * @param name String 参数名
     * @param value Object 参数值
     * @return GenericExecuteSpec 绑定后的执行规格
     */
    private DatabaseClient.GenericExecuteSpec bindDynamicValue(DatabaseClient.GenericExecuteSpec spec, String name, Object value) {
        // 动态更新字段需要兼容空值和常见时间、数字、字符串类型。
        if (value == null) {
            return spec.bindNull(name, Object.class);
        }
        return spec.bind(name, value);
    }
}
