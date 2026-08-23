package com.novanovastudio.entity;

import java.time.OffsetDateTime;
import lombok.Data;

/**
 * @title        ApiAccessLog.java
 * @description  接口访问日志实体
 * @createTime   2026-08-23
 */
@Data
public class ApiAccessLog {

    /** 主键 */
    private Long id;

    /** HTTP 方法（GET/POST 等，大写） */
    private String httpMethod;

    /** 请求地址（路径+查询参数已脱敏） */
    private String requestPath;

    /** 客户端 IP */
    private String clientIp;

    /** 用户 ID，未登录为 null */
    private Long userId;

    /** 响应状态码 */
    private Integer statusCode;

    /** 是否成功（status_code < 400） */
    private Boolean success;

    /** 是否有错误（status_code >= 400） */
    private Boolean hasError;

    /** 失败响应正文（截断） */
    private String errorContent;

    /** 请求体/参数（脱敏+截断） */
    private String requestBody;

    /** 耗时（毫秒） */
    private Integer durationMs;

    /** 创建时间 */
    private OffsetDateTime createdAt;
}
