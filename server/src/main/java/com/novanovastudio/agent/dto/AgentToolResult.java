/**
 * @title        AgentToolResult.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  前端工具执行结果回传 DTO
 * @createTime   2026-06-27 10:00:00
 */
package com.novanovastudio.agent.dto;

/**
 * 前端工具执行结果回传
 *
 * @param sessionId String 会话ID
 * @param callId    String 工具调用ID
 * @param result    ToolResult 工具执行结果
 */
public record AgentToolResult(
    String sessionId,
    String callId,
    ToolResult result
) {

    /**
     * 工具执行结果
     *
     * @param ok      boolean 是否成功
     * @param message String 结果说明
     * @param data    Map 结果数据（图片URL等）
     */
    public record ToolResult(boolean ok, String message, java.util.Map<String, Object> data) {
        public ToolResult(boolean ok, String message) {
            this(ok, message, null);
        }
    }
}
