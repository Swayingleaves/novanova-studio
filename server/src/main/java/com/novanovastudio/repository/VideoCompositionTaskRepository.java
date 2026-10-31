package com.novanovastudio.repository;

import com.alibaba.fastjson2.JSON;

import com.novanovastudio.common.SystemMessage;

import com.novanovastudio.entity.VideoCompositionTask;
import lombok.RequiredArgsConstructor;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 画布视频合成任务数据访问仓储。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-08-11 00:00
 */
@Repository
@RequiredArgsConstructor
public class VideoCompositionTaskRepository {

    /** 数据库客户端 */
    private final DatabaseClient databaseClient;

    /**
     * 创建视频合成任务。
     *
     * @param task VideoCompositionTask 待保存任务
     * @return Mono<Void> 保存结果
     */
    public Mono<Void> createTask(VideoCompositionTask task) {
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                INSERT INTO video_composition_tasks(id, user_id, status, progress, source_storage_keys, task_type, project_id, input_snapshot, result_data, error_message)
                VALUES (:id, :userId, :status, :progress, CAST(:sourceStorageKeys AS jsonb), :taskType, :projectId, CAST(:inputSnapshot AS jsonb), CAST(:resultData AS jsonb), :errorMessage)
                """)
                .bind("id", task.getId())
                .bind("userId", task.getUserId())
                .bind("status", task.getStatus())
                .bind("progress", task.getProgress())
                .bind("sourceStorageKeys", task.getSourceStorageKeys())
                .bind("taskType", task.getTaskType() == null ? "canvasComposition" : task.getTaskType())
                .bind("inputSnapshot", task.getInputSnapshot() == null ? "{}" : task.getInputSnapshot())
                .bind("resultData", task.getResultData())
                .bind("errorMessage", task.getErrorMessage() == null ? "" : task.getErrorMessage());
        spec = task.getProjectId() == null ? spec.bindNull("projectId", String.class) : spec.bind("projectId", task.getProjectId());
        return spec.fetch()
                .rowsUpdated()
                .then();
    }

    /**
     * 按用户和任务ID查询任务。
     *
     * @param userId Long 用户ID
     * @param taskId String 任务ID
     * @return Mono<VideoCompositionTask> 任务数据
     */
    public Mono<VideoCompositionTask> getTask(Long userId, String taskId) {
        return queryTask("WHERE user_id = :userId AND id = :taskId")
                .bind("userId", userId)
                .bind("taskId", taskId)
                .map((row, metadata) -> RowMappers.videoCompositionTask(row))
                .one();
    }

    /**
     * 按任务ID查询任务。
     *
     * @param taskId String 任务ID
     * @return Mono<VideoCompositionTask> 任务数据
     */
    public Mono<VideoCompositionTask> getTaskById(String taskId) {
        return queryTask("WHERE id = :taskId")
                .bind("taskId", taskId)
                .map((row, metadata) -> RowMappers.videoCompositionTask(row))
                .one();
    }

    /**
     * 查询当前用户在项目下最近的分镜导出任务。
     * @param userId 当前用户标识
     * @param projectId 漫剧项目标识
     * @return 最近导出任务
     */
    public Mono<VideoCompositionTask> getLatestStoryboardExport(Long userId, String projectId) {
        return queryTask("WHERE user_id = :userId AND project_id = :projectId AND task_type = 'storyboardExport' ORDER BY created_at DESC, id DESC LIMIT 1")
                .bind("userId", userId).bind("projectId", projectId)
                .map((row, metadata) -> RowMappers.videoCompositionTask(row)).one();
    }

    /**
     * 将等待中的任务原子标记为执行中。
     *
     * @param taskId String 任务ID
     * @return Mono<Boolean> 是否成功领取任务
     */
    public Mono<Boolean> markTaskRunning(String taskId) {
        return databaseClient.sql("""
                UPDATE video_composition_tasks
                SET status = 'running', progress = 0, error_message = '', error_message_key = '', error_message_arguments = '[]'::jsonb, started_at = CURRENT_TIMESTAMP, completed_at = NULL, updated_at = CURRENT_TIMESTAMP
                WHERE id = :taskId AND status = 'pending'
                """)
                .bind("taskId", taskId)
                .fetch()
                .rowsUpdated()
                .map(count -> count != null && count > 0);
    }

    /**
     * 更新运行中任务进度。
     *
     * @param taskId String 任务ID
     * @param progress int 任务进度
     * @return Mono<Void> 更新结果
     */
    public Mono<Void> updateProgress(String taskId, int progress) {
        return databaseClient.sql("""
                UPDATE video_composition_tasks
                SET progress = GREATEST(progress, :progress), updated_at = CURRENT_TIMESTAMP
                WHERE id = :taskId AND status = 'running'
                """)
                .bind("taskId", taskId)
                .bind("progress", Math.max(0, Math.min(99, progress)))
                .fetch()
                .rowsUpdated()
                .then();
    }

    /**
     * 完成运行中任务。
     *
     * @param taskId String 任务ID
     * @param status String 终态
     * @param resultData String 合成结果JSON
     * @param errorMessage String 错误信息
     * @return Mono<Boolean> 是否成功更新任务
     */
    public Mono<Boolean> finishRunningTask(String taskId, String status, String resultData, SystemMessage errorMessage) {
        return databaseClient.sql("""
                UPDATE video_composition_tasks
                SET status = :status, progress = 100, result_data = CAST(:resultData AS jsonb), error_message = :errorMessage, error_message_key = :errorMessageKey, error_message_arguments = CAST(:errorMessageArguments AS jsonb),
                    completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                WHERE id = :taskId AND status = 'running'
                """)
                .bind("taskId", taskId)
                .bind("status", status)
                .bind("resultData", resultData == null ? "{}" : resultData)
                .bind("errorMessage", errorMessage == null ? "" : errorMessage.diagnostic())
                .bind("errorMessageKey", errorMessage == null ? "" : errorMessage.key())
                .bind("errorMessageArguments", JSON.toJSONString(errorMessage == null ? new Object[0] : errorMessage.arguments()))
                .fetch()
                .rowsUpdated()
                .map(count -> count != null && count > 0);
    }

    /**
     * 取消尚未完成的任务。
     *
     * @param userId Long 用户ID
     * @param taskId String 任务ID
     * @return Mono<Boolean> 是否成功取消任务
     */
    public Mono<Boolean> cancelTask(Long userId, String taskId) {
        return databaseClient.sql("""
                UPDATE video_composition_tasks
                SET status = 'canceled', progress = 100, error_message = '任务已取消', error_message_key = 'system.taskCanceled', error_message_arguments = '[]'::jsonb, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                WHERE user_id = :userId AND id = :taskId AND status IN ('pending', 'running')
                """)
                .bind("userId", userId)
                .bind("taskId", taskId)
                .fetch()
                .rowsUpdated()
                .map(count -> count != null && count > 0);
    }

    /**
     * 查询可恢复的等待任务。
     *
     * @return Flux<VideoCompositionTask> 等待任务列表
     */
    public Flux<VideoCompositionTask> listPendingTasks() {
        return queryTask("WHERE status = 'pending' ORDER BY created_at ASC, id ASC")
                .map((row, metadata) -> RowMappers.videoCompositionTask(row))
                .all();
    }

    /**
     * 查询运行中的任务，用于根据Redis活动租约恢复已失去执行实例的任务。
     *
     * @return Flux<VideoCompositionTask> 运行中任务列表
     */
    public Flux<VideoCompositionTask> listRunningTasks() {
        return queryTask("WHERE status = 'running' ORDER BY created_at ASC, id ASC")
                .map((row, metadata) -> RowMappers.videoCompositionTask(row))
                .all();
    }

    /**
     * 将没有活动执行租约的运行中任务原子重新排队。
     *
     * @param taskId String 任务ID
     * @return Mono<Boolean> 是否成功重新排队
     */
    public Mono<Boolean> requeueInactiveRunningTask(String taskId) {
        return databaseClient.sql("""
                UPDATE video_composition_tasks
                SET status = 'pending', progress = 0, error_message = '执行实例已断开，任务已重新排队', error_message_key = 'system.taskRequeued', error_message_arguments = '[]'::jsonb,
                    started_at = NULL, completed_at = NULL, updated_at = CURRENT_TIMESTAMP
                WHERE id = :taskId AND status = 'running'
                """)
                .bind("taskId", taskId)
                .fetch()
                .rowsUpdated()
                .map(count -> count != null && count > 0);
    }

    /**
     * 组装任务查询SQL。
     *
     * @param condition String 查询条件
     * @return DatabaseClient.GenericExecuteSpec 查询规格
     */
    private DatabaseClient.GenericExecuteSpec queryTask(String condition) {
        return databaseClient.sql("""
                SELECT id, user_id, status, progress, source_storage_keys::text AS source_storage_keys, task_type, project_id,
                       input_snapshot::text AS input_snapshot, result_data::text AS result_data,
                       error_message, error_message_key, error_message_arguments::text AS error_message_arguments, started_at, completed_at, created_at, updated_at
                FROM video_composition_tasks
                """ + condition);
    }
}
