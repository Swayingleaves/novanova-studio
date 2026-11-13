package com.novanovastudio.agent.dto;

import jakarta.validation.constraints.NotBlank;

/**
 * Agent 会话取消请求。
 *
 * @param sessionId String 待取消的 Agent 会话ID
 * @param requestId String 待取消的统一主Agent请求ID
 * @param forfeitSubmittedGeneration Boolean 已发送的图片或视频请求是否确认取消且不退款
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-18 22:20
 */
public record AgentCancelRequest(
        @NotBlank(message = "business.conversationIDIsRequired") String sessionId,
        @NotBlank(message = "business.requestIDIsRequired") String requestId,
        Boolean forfeitSubmittedGeneration
) {
    /**
     * 保持只传会话和请求的调用，默认仍按可退款规则取消。
     *
     * @param sessionId String 会话ID
     * @param requestId String 请求ID
     */
    public AgentCancelRequest(String sessionId, String requestId) {
        this(sessionId, requestId, false);
    }
}
