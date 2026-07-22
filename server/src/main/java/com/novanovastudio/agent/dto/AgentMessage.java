/**
 * @title        AgentMessage.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  Agent 会话消息
 * @createTime   2026-06-27 10:00:00
 */
package com.novanovastudio.agent.dto;

import java.time.OffsetDateTime;

/**
 * Agent 会话消息
 *
 * @param id                String 消息ID
 * @param role              String 角色：user | assistant | tool | system
 * @param text              String 消息文本
 * @param meta              String 元数据JSON
 * @param toolName          String 工具名（role=tool 时）
 * @param toolArgs          String 工具参数 JSON
 * @param toolResult        String 工具结果 JSON
 * @param thoughtText       String 思考过程文本
 * @param thoughtDurationMs Integer 思考耗时毫秒
 * @param createdAt         OffsetDateTime 创建时间
 */
public record AgentMessage(
    String id,
    String role,
    String text,
    String meta,
    String toolName,
    String toolArgs,
    String toolResult,
    String thoughtText,
    Integer thoughtDurationMs,
    OffsetDateTime createdAt
) {

    /** 兼容旧构造器 */
    public AgentMessage(String id, String role, String text, String meta) {
        this(id, role, text, meta, null, null, null, null, null, null);
    }
}
