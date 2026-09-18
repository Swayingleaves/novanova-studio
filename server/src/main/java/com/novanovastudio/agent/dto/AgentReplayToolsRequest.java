package com.novanovastudio.agent.dto;

import java.util.List;

/**
 * 页面接入进行中主Agent请求时提交的前端工具重放参数。
 *
 * @param sessionId String Agent会话ID
 * @param requestId String 主Agent请求ID
 * @param activeToolCallIds List<String> 当前页面仍在执行的工具调用ID
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-09-18 16:00
 */
public record AgentReplayToolsRequest(String sessionId, String requestId, List<String> activeToolCallIds) {
}
