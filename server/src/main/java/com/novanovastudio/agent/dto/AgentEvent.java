/**
 * @title        AgentEvent.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  Agent SSE 事件数据结构
 * @createTime   2026-06-27 10:00:00
 */
package com.novanovastudio.agent.dto;

import java.util.Map;

/**
 * Agent SSE 事件数据结构
 *
 * @param type             String 事件类型
 * @param sessionId        String 会话ID
 * @param callId           String 工具调用ID
 * @param name             String 工具名
 * @param arguments        Map 工具参数
 * @param delta            String text-delta 时的增量文本
 * @param messageId        String AI消息ID
 * @param text             String AI最终消息文本
 * @param errorMessage     String 错误信息
 * @param thoughtId        String 思考过程ID
 * @param thoughtDelta     String 思考增量文本
 * @param thoughtDurationMs Integer 思考耗时毫秒
 * @param resultOk         Boolean 工具结果成功标志
 * @param resultMessage    String 工具结果消息
 * @param resultData       Map 工具结果数据
 * @param progress         Integer 进度百分比
 * @param taskId           String 关联任务ID
 * @param status           String 状态
 * @param action           AgentAction 前端交互动作
 */
public record AgentEvent(
    String type,
    String sessionId,
    String callId,
    String name,
    Map<String, Object> arguments,
    String delta,
    String messageId,
    String text,
    String errorMessage,
    String thoughtId,
    String thoughtDelta,
    Integer thoughtDurationMs,
    Boolean resultOk,
    String resultMessage,
    Map<String, Object> resultData,
    Integer progress,
    String taskId,
    String status,
    AgentAction action
) {

    /**
     * 构造流式文本增量事件
     *
     * @param sessionId String 会话ID
     * @param messageId String AI消息ID，与 task-complete 使用同一ID，确保前端更新同一条消息
     * @param delta     String 增量文本
     * @return AgentEvent 文本增量事件
     */
    public static AgentEvent textDelta(String sessionId, String messageId, String delta) {
        return new AgentEvent("text-delta", sessionId, null, null, null, delta, messageId, null, null, null, null, null, null, null, null, null, null, null, null);
    }

    /**
     * 构造工具执行事件，要求前端执行画布操作
     *
     * @param sessionId String 会话ID
     * @param callId    String 工具调用ID
     * @param name      String 工具名
     * @param arguments Map 工具参数
     * @return AgentEvent 工具执行事件
     */
    public static AgentEvent toolExecute(String sessionId, String callId, String name, Map<String, Object> arguments) {
        return new AgentEvent("tool-execute", sessionId, callId, name, arguments, null, null, null, null, null, null, null, null, null, null, null, null, null, null);
    }

    /**
     * 构造任务完成事件
     *
     * @param sessionId String 会话ID
     * @param messageId String AI消息ID
     * @param text      String AI最终消息文本
     * @return AgentEvent 任务完成事件
     */
    public static AgentEvent taskComplete(String sessionId, String messageId, String text) {
        return taskComplete(sessionId, messageId, text, null);
    }

    /**
     * 构造带前端交互动作的任务完成事件。
     *
     * @param sessionId String 会话ID
     * @param messageId String AI消息ID
     * @param text String AI最终消息文本
     * @param action AgentAction 前端交互动作，可为空
     * @return AgentEvent 任务完成事件
     */
    public static AgentEvent taskComplete(String sessionId, String messageId, String text, AgentAction action) {
        return new AgentEvent("task-complete", sessionId, null, null, null, null, messageId, text, null, null, null, null, null, null, null, null, null, null, action);
    }

    /**
     * 构造错误事件
     *
     * @param sessionId    String 会话ID
     * @param errorMessage String 错误信息
     * @return AgentEvent 错误事件
     */
    public static AgentEvent error(String sessionId, String errorMessage) {
        return new AgentEvent("error", sessionId, null, null, null, null, null, null, errorMessage, null, null, null, null, null, null, null, null, null, null);
    }

    /**
     * 构造思考过程增量事件
     *
     * @param sessionId String 会话ID
     * @param thoughtId String 思考ID
     * @param delta     String 增量文本
     * @return AgentEvent 思考增量事件
     */
    public static AgentEvent thoughtDelta(String sessionId, String thoughtId, String delta) {
        return new AgentEvent("thought-delta", sessionId, null, null, null, null, null, null, null, thoughtId, delta, null, null, null, null, null, null, null, null);
    }

    /**
     * 构造思考完成事件
     *
     * @param sessionId  String 会话ID
     * @param thoughtId  String 思考ID
     * @param durationMs int 思考耗时毫秒
     * @return AgentEvent 思考完成事件
     */
    public static AgentEvent thoughtComplete(String sessionId, String thoughtId, int durationMs) {
        return new AgentEvent("thought-complete", sessionId, null, null, null, null, null, null, null, thoughtId, null, durationMs, null, null, null, null, null, null, null);
    }

    /**
     * 构造生成进度事件
     *
     * @param sessionId String 会话ID
     * @param callId    String 工具调用ID
     * @param taskId    String 关联任务ID
     * @param progress  int 进度百分比
     * @param status    String 任务状态
     * @return AgentEvent 进度事件
     */
    public static AgentEvent progress(String sessionId, String callId, String taskId, int progress, String status) {
        return new AgentEvent("progress", sessionId, callId, null, null, null, null, null, null, null, null, null, null, null, null, progress, taskId, status, null);
    }

    /**
     * 构造工具执行结果事件
     *
     * @param sessionId String 会话ID
     * @param callId    String 工具调用ID
     * @param ok        boolean 是否成功
     * @param message   String 结果说明
     * @param data      Map 结果数据
     * @return AgentEvent 工具结果事件
     */
    public static AgentEvent toolResult(String sessionId, String callId, boolean ok, String message, Map<String, Object> data) {
        return new AgentEvent("tool-result", sessionId, callId, null, null, null, null, null, null, null, null, null, ok, message, data, null, null, null, null);
    }

    /**
     * 构造前端工具取消事件，用于服务端等待超时后中止对应浏览器任务。
     *
     * @param sessionId String 会话ID
     * @param callId String 工具调用ID
     * @param message String 取消原因
     * @return AgentEvent 工具取消事件
     */
    public static AgentEvent toolCancel(String sessionId, String callId, String message) {
        return new AgentEvent("tool-cancel", sessionId, callId, null, null, null, null, message, null,
                null, null, null, null, null, null, null, null, "canceled", null);
    }

    /**
     * 构造提示事件，用于向用户推送过程性提示（如模型不支持视频编辑时降级说明）。
     *
     * @param sessionId String 会话ID
     * @param message   String 提示文本
     * @return AgentEvent 提示事件
     */
    public static AgentEvent notice(String sessionId, String message) {
        return new AgentEvent("notice", sessionId, null, null, null, null, null, message, null, null, null, null, null, null, null, null, null, null, null);
    }

    /**
     * 构造会话已停止事件。
     *
     * @param sessionId String Agent 会话ID
     * @param message String 停止提示文本
     * @return AgentEvent 会话停止事件
     */
    public static AgentEvent canceled(String sessionId, String message) {
        return new AgentEvent("canceled", sessionId, null, null, null, null, null, message, null, null, null, null, null, null, null, null, null, null, null);
    }

    /**
     * 构造计划已创建事件。
     *
     * @param sessionId String 会话ID
     * @param planId String 计划ID
     * @param summary String 计划摘要
     * @param taskCount int 任务数量
     * @return AgentEvent 计划事件
     */
    public static AgentEvent planCreated(String sessionId, String planId, String summary, int taskCount) {
        return new AgentEvent("plan-created", sessionId, null, null, null, null, null, summary, null, null, null, null,
                null, null, Map.of("planId", planId, "summary", summary == null ? "" : summary, "taskCount", taskCount), null, null, "created", null);
    }

    /**
     * 构造计划任务状态事件。
     *
     * @param sessionId String 会话ID
     * @param planId String 计划ID
     * @param taskId String 计划任务ID
     * @param status String 任务状态
     * @param message String 状态说明
     * @return AgentEvent 计划任务状态事件
     */
    public static AgentEvent planTaskStatus(String sessionId, String planId, String taskId, String status, String message) {
        return new AgentEvent("plan-task-status", sessionId, taskId, null, null, null, null, message, null, null, null, null,
                null, null, Map.of("planId", planId, "taskId", taskId, "message", message == null ? "" : message), null, null, status, null);
    }

    /**
     * 构造提示词准备完成事件。
     *
     * @param sessionId String 会话ID
     * @param planId String 计划ID
     * @param taskId String 计划任务ID
     * @param strategy String 提示词策略
     * @return AgentEvent 提示词准备事件
     */
    public static AgentEvent promptPrepared(String sessionId, String planId, String taskId, String strategy) {
        return new AgentEvent("prompt-prepared", sessionId, taskId, null, null, null, null, "提示词已准备", null, null, null, null,
                null, null, Map.of("planId", planId, "taskId", taskId, "strategy", strategy), null, null, "prepared", null);
    }

}
