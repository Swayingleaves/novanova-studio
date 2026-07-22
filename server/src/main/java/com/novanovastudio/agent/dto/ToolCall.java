/**
 * @title        ToolCall.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  LLM 工具调用
 * @createTime   2026-07-06 10:00:00
 */
package com.novanovastudio.agent.dto;

/**
 * LLM 工具调用，保持与当前 AgentTaskOrchestrator 私有 record 一致的结构。
 *
 * @param id       String 调用ID
 * @param function ToolCallFunction 函数信息
 */
public record ToolCall(String id, ToolCallFunction function) {
}
