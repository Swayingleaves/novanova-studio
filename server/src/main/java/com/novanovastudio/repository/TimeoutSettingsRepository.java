package com.novanovastudio.repository;

import com.novanovastudio.dto.TimeoutDtos;
import java.time.OffsetDateTime;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Mono;

/**
 * 平台超时设置数据访问。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-10 01:50
 */
@Repository
public class TimeoutSettingsRepository {

    /** 查询和回写共用的列。 */
    private static final String COLUMNS = """
            ai_request_body_timeout_seconds, storyboard_agent_timeout_seconds, script_agent_timeout_seconds,
            story_bible_agent_timeout_seconds, task_wait_timeout_seconds, video_task_wait_timeout_seconds,
            video_composition_execution_timeout_seconds, tencent_cos_socket_timeout_milliseconds, updated_at
            """;

    /** 数据库客户端。 */
    private final DatabaseClient databaseClient;

    /**
     * 构造超时设置仓储。
     *
     * @param databaseClient DatabaseClient 数据库客户端
     */
    public TimeoutSettingsRepository(DatabaseClient databaseClient) {
        this.databaseClient = databaseClient;
    }

    /**
     * 读取唯一的超时设置。
     *
     * @return Mono<TimeoutSettingsRow> 设置和更新时间
     */
    public Mono<TimeoutSettingsRow> find() {
        return databaseClient.sql("SELECT " + COLUMNS + " FROM platform_timeout_settings WHERE id = 1")
                .map((row, metadata) -> mapRow(row))
                .one();
    }

    /**
     * 更新唯一的超时设置并返回落库结果。
     *
     * @param settings TimeoutSettings 新的超时设置
     * @return Mono<TimeoutSettingsRow> 落库后的设置
     */
    public Mono<TimeoutSettingsRow> update(TimeoutDtos.TimeoutSettings settings) {
        return databaseClient.sql("""
                        UPDATE platform_timeout_settings
                        SET ai_request_body_timeout_seconds = :aiRequestBodyTimeoutSeconds,
                            storyboard_agent_timeout_seconds = :storyboardAgentTimeoutSeconds,
                            script_agent_timeout_seconds = :scriptAgentTimeoutSeconds,
                            story_bible_agent_timeout_seconds = :storyBibleAgentTimeoutSeconds,
                            task_wait_timeout_seconds = :taskWaitTimeoutSeconds,
                            video_task_wait_timeout_seconds = :videoTaskWaitTimeoutSeconds,
                            video_composition_execution_timeout_seconds = :videoCompositionExecutionTimeoutSeconds,
                            tencent_cos_socket_timeout_milliseconds = :tencentCosSocketTimeoutMilliseconds,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE id = 1
                        RETURNING
                        """ + COLUMNS)
                .bind("aiRequestBodyTimeoutSeconds", settings.aiRequestBodyTimeoutSeconds())
                .bind("storyboardAgentTimeoutSeconds", settings.storyboardAgentTimeoutSeconds())
                .bind("scriptAgentTimeoutSeconds", settings.scriptAgentTimeoutSeconds())
                .bind("storyBibleAgentTimeoutSeconds", settings.storyBibleAgentTimeoutSeconds())
                .bind("taskWaitTimeoutSeconds", settings.taskWaitTimeoutSeconds())
                .bind("videoTaskWaitTimeoutSeconds", settings.videoTaskWaitTimeoutSeconds())
                .bind("videoCompositionExecutionTimeoutSeconds", settings.videoCompositionExecutionTimeoutSeconds())
                .bind("tencentCosSocketTimeoutMilliseconds", settings.tencentCosSocketTimeoutMilliseconds())
                .map((row, metadata) -> mapRow(row))
                .one();
    }

    /**
     * 把查询行映射为超时设置。
     *
     * @param row io.r2dbc.spi.Row 数据行
     * @return TimeoutSettingsRow 设置和更新时间
     */
    private static TimeoutSettingsRow mapRow(io.r2dbc.spi.Row row) {
        return new TimeoutSettingsRow(new TimeoutDtos.TimeoutSettings(
                row.get("ai_request_body_timeout_seconds", Integer.class),
                row.get("storyboard_agent_timeout_seconds", Integer.class),
                row.get("script_agent_timeout_seconds", Integer.class),
                row.get("story_bible_agent_timeout_seconds", Integer.class),
                row.get("task_wait_timeout_seconds", Integer.class),
                row.get("video_task_wait_timeout_seconds", Integer.class),
                row.get("video_composition_execution_timeout_seconds", Integer.class),
                row.get("tencent_cos_socket_timeout_milliseconds", Integer.class)),
                row.get("updated_at", OffsetDateTime.class));
    }

    /**
     * 超时设置和它的更新时间。
     *
     * @param settings TimeoutSettings 超时设置
     * @param updatedAt OffsetDateTime 更新时间
     */
    public record TimeoutSettingsRow(TimeoutDtos.TimeoutSettings settings, OffsetDateTime updatedAt) {
    }
}
