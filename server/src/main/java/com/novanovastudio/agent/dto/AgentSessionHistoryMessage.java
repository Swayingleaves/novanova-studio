package com.novanovastudio.agent.dto;

import java.time.OffsetDateTime;

/**
 * 用户可见的会话历史消息，不包含内部工具参数和系统提示词。
 *
 * @param id String 消息标识
 * @param role String 消息角色：user 或 assistant
 * @param text String 消息正文
 * @param meta String 消息附加信息JSON，前端据此渲染产物卡片，无附加信息时为空
 * @param createdAt OffsetDateTime 消息创建时间
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-20 12:00
 */
public record AgentSessionHistoryMessage(String id, String role, String text, String meta, OffsetDateTime createdAt) {
}
