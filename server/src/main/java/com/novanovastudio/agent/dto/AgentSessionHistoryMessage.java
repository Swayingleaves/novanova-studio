package com.novanovastudio.agent.dto;

/**
 * 用户可见的会话历史消息，不包含内部工具参数和系统提示词。
 *
 * @param id String 消息标识
 * @param role String 消息角色：user 或 assistant
 * @param text String 消息正文
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-20 12:00
 */
public record AgentSessionHistoryMessage(String id, String role, String text) {
}
