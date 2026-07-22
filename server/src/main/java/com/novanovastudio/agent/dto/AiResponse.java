/**
 * @title        AiResponse.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  LLM 回复结构
 * @createTime   2026-07-06 10:00:00
 */
package com.novanovastudio.agent.dto;

import java.util.List;

/**
 * LLM 回复，包含文本内容和工具调用列表。
 *
 * @param text      String 文本回复
 * @param toolCalls List<ToolCall> 工具调用列表
 */
public record AiResponse(String text, List<ToolCall> toolCalls) {
}
