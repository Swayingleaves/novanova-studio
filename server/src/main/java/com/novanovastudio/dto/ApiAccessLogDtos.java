package com.novanovastudio.dto;

import com.novanovastudio.entity.ApiAccessLog;
import java.time.OffsetDateTime;
import java.util.List;

/**
 * @title        ApiAccessLogDtos.java
 * @description  接口访问日志相关 DTO
 * @createTime   2026-08-23
 */
public final class ApiAccessLogDtos {

    /** 禁止实例化 */
    private ApiAccessLogDtos() {
    }

    /**
     * 将接口访问日志实体转换为响应 DTO。
     *
     * @param log ApiAccessLog 日志实体
     * @return ApiAccessLogResponse 响应 DTO
     */
    public static ApiAccessLogResponse toResponse(ApiAccessLog log) {
        return new ApiAccessLogResponse(log.getId(), log.getHttpMethod(), log.getRequestPath(),
                log.getClientIp(), log.getUserId(), log.getStatusCode(), log.getSuccess(),
                log.getHasError(), log.getErrorContent(), log.getRequestBody(),
                log.getDurationMs(), log.getCreatedAt());
    }

    /**
     * 接口访问日志响应
     *
     * @param id            主键
     * @param httpMethod    HTTP 方法
     * @param requestPath   请求地址
     * @param clientIp      客户端 IP
     * @param userId        用户 ID
     * @param statusCode    状态码
     * @param success       是否成功
     * @param hasError      是否有错误
     * @param errorContent  错误内容
     * @param requestBody   请求体
     * @param durationMs    耗时（毫秒）
     * @param createdAt     创建时间
     */
    public record ApiAccessLogResponse(Long id, String httpMethod, String requestPath, String clientIp,
                                       Long userId, Integer statusCode, Boolean success, Boolean hasError,
                                       String errorContent, String requestBody, Integer durationMs, OffsetDateTime createdAt) {
    }

    /**
     * 接口访问日志列表响应
     *
     * @param logs  日志列表
     * @param total 总数
     */
    public record ApiAccessLogListResponse(List<ApiAccessLogResponse> logs, long total) {
    }
}
