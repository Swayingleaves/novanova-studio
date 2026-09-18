package com.novanovastudio.agent.dto;

/**
 * 当前用户在指定入口分区内仍在执行的主Agent请求。
 *
 * @param requestId String 主Agent请求ID
 * @param sessionId String Agent会话ID
 * @param status String 请求状态，queued或running
 * @param message String 状态说明
 * @param projectId String 请求携带的画布项目ID，非画布请求为空
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-09-18 16:00
 */
public record AgentActiveRequestResponse(String requestId, String sessionId, String status, String message, String projectId) {
}
