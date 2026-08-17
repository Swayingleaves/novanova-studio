package com.novanovastudio.entity;

import java.time.OffsetDateTime;
import lombok.Data;

/**
 * 统一主Agent请求持久化实体。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-08-13 00:00
 */
@Data
public class CreationAgentRequest {

    /** 请求ID */
    private String id;

    /** 用户ID */
    private Long userId;

    /** Agent会话ID */
    private String sessionId;

    /** 入口来源 */
    private String entrySource;

    /** AgentChatRequest快照JSON */
    private String requestData;

    /** 请求状态 */
    private String status;

    /** 创作计划ID */
    private String planId;

    /** 已创建底层AI任务ID数组JSON */
    private String taskIds;

    /** 错误、取消或中断说明 */
    private String errorMessage;

    /** 开始执行时间 */
    private OffsetDateTime startedAt;

    /** 完成时间 */
    private OffsetDateTime completedAt;

    /** 创建时间 */
    private OffsetDateTime createdAt;

    /** 更新时间 */
    private OffsetDateTime updatedAt;
}
