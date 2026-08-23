package com.novanovastudio.repository;

import com.novanovastudio.entity.ApiAccessLog;
import java.time.Instant;
import java.util.regex.Pattern;
import lombok.RequiredArgsConstructor;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * @title        ApiAccessLogRepository.java
 * @description  接口访问日志仓储
 * @createTime   2026-08-23
 */
@Repository
@RequiredArgsConstructor
public class ApiAccessLogRepository {

    /** 数据库客户端 */
    private final DatabaseClient databaseClient;

    /** 数字关键字匹配 */
    private static final Pattern NUMERIC = Pattern.compile("\\d+");

    /**
     * 插入一条接口访问日志。
     *
     * @param log ApiAccessLog 日志实体
     * @return Mono<Long> 自增主键
     */
    public Mono<Long> insert(ApiAccessLog log) {
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                INSERT INTO api_logs(http_method, request_path, client_ip, user_id,
                                      status_code, success, has_error, error_content,
                                      request_body, duration_ms)
                VALUES (:httpMethod, :requestPath, :clientIp, :userId,
                        :statusCode, :success, :hasError, :errorContent,
                        :requestBody, :durationMs)
                RETURNING id
                """)
                .bind("httpMethod", log.getHttpMethod())
                .bind("requestPath", log.getRequestPath())
                .bind("clientIp", log.getClientIp())
                .bind("statusCode", log.getStatusCode())
                .bind("success", log.getSuccess())
                .bind("hasError", log.getHasError())
                .bind("durationMs", log.getDurationMs());
        spec = R2dbcBindings.bindNullable(spec, "userId", log.getUserId(), Long.class);
        spec = R2dbcBindings.bindNullable(spec, "errorContent", log.getErrorContent(), String.class);
        spec = R2dbcBindings.bindNullable(spec, "requestBody", log.getRequestBody(), String.class);
        return spec.map((row, metadata) -> row.get("id", Long.class)).one();
    }

    /**
     * 分页查询接口访问日志。
     *
     * @param query   ApiLogQuery 查询条件
     * @param page    int 页码（从 1 开始）
     * @param pageSize int 每页数量
     * @return Flux<ApiAccessLog> 日志流
     */
    public Flux<ApiAccessLog> listLogs(ApiLogQuery query, int page, int pageSize) {
        String sql = """
                SELECT id, http_method, request_path, client_ip, user_id, status_code,
                       success, has_error, error_content, request_body, duration_ms, created_at
                FROM api_logs
                WHERE 1 = 1
                """ + buildFilters(query) + """
                ORDER BY created_at DESC, id DESC
                LIMIT :limit OFFSET :offset
                """;
        return bindFilters(databaseClient.sql(sql), query)
                .bind("limit", pageSize)
                .bind("offset", (long) (page - 1) * pageSize)
                .map((row, metadata) -> RowMappers.apiAccessLog(row))
                .all();
    }

    /**
     * 统计符合查询条件的日志总数。
     *
     * @param query ApiLogQuery 查询条件
     * @return Mono<Long> 总数
     */
    public Mono<Long> countLogs(ApiLogQuery query) {
        String sql = "SELECT COUNT(*) AS total FROM api_logs WHERE 1 = 1 " + buildFilters(query);
        return bindFilters(databaseClient.sql(sql), query)
                .map((row, meta) -> row.get("total", Long.class))
                .one();
    }

    /**
     * 删除早于指定时间的日志（保留期清理）。
     *
     * @param cutoff Instant 时间阈值
     * @return Mono<Integer> 删除行数
     */
    public Mono<Long> deleteOld(Instant cutoff) {
        return databaseClient.sql("DELETE FROM api_logs WHERE created_at < :cutoff")
                .bind("cutoff", cutoff)
                .fetch()
                .rowsUpdated();
    }

    /**
     * 构建 WHERE 片段。
     *
     * @param query ApiLogQuery 查询条件
     * @return String SQL 片段
     */
    private String buildFilters(ApiLogQuery query) {
        StringBuilder builder = new StringBuilder();
        if (query.keyword() != null && !query.keyword().isBlank()) {
            builder.append(" AND (client_ip ILIKE :keyword OR request_path ILIKE :keyword");
            if (NUMERIC.matcher(query.keyword().trim()).matches()) {
                builder.append(" OR user_id = :keywordNumber");
            }
            builder.append(")");
        }
        if ("success".equals(query.result())) {
            builder.append(" AND success = TRUE");
        } else if ("error".equals(query.result())) {
            builder.append(" AND has_error = TRUE");
        }
        return builder.toString();
    }

    /**
     * 绑定查询参数。
     *
     * @param spec  GenericExecuteSpec SQL 执行规格
     * @param query ApiLogQuery 查询条件
     * @return GenericExecuteSpec 绑定后的规格
     */
    private DatabaseClient.GenericExecuteSpec bindFilters(DatabaseClient.GenericExecuteSpec spec, ApiLogQuery query) {
        DatabaseClient.GenericExecuteSpec bound = spec;
        if (query.keyword() != null && !query.keyword().isBlank()) {
            bound = bound.bind("keyword", "%" + query.keyword().trim() + "%");
            if (NUMERIC.matcher(query.keyword().trim()).matches()) {
                bound = bound.bind("keywordNumber", Long.parseLong(query.keyword().trim()));
            }
        }
        return bound;
    }

    /**
     * 接口访问日志查询条件
     *
     * @param keyword 关键字（匹配 IP / 路径 / 用户 ID）
     * @param result  结果筛选 success / error / null
     */
    public record ApiLogQuery(String keyword, String result) {
    }
}
