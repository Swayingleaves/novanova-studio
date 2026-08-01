/**
 * @title        AgentToolResult.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  前端工具执行结果回传 DTO
 * @createTime   2026-06-27 10:00:00
 */
package com.novanovastudio.agent.dto;

import com.novanovastudio.ai.AiErrorDetails;
import com.novanovastudio.ai.AiErrorSupport;
import java.util.Map;

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
     * @param error   AiErrorDetails 结构化错误详情
     */
    public record ToolResult(boolean ok, String message, Map<String, Object> data, AiErrorDetails error) {

        /**
         * 规范化前端回传的结构化错误，并兼容从结果数据读取。
         */
        public ToolResult {
            error = AiErrorSupport.fromData(error != null ? error : data == null ? null : data.get("error"));
        }

        /**
         * 创建携带数据的工具结果。
         *
         * @param ok boolean 是否成功
         * @param message String 结果说明
         * @param data Map<String, Object> 结果数据
         */
        public ToolResult(boolean ok, String message, Map<String, Object> data) {
            this(ok, message, data, null);
        }

        /**
         * 创建不携带数据的工具结果。
         *
         * @param ok boolean 是否成功
         * @param message String 结果说明
         */
        public ToolResult(boolean ok, String message) {
            this(ok, message, null, null);
        }
    }
}
