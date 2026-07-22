/**
 * @title        AgentSessionRepository.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  Agent 会话数据库访问
 * @createTime   2026-06-27 10:00:00
 */
package com.novanovastudio.agent;

import com.alibaba.fastjson2.JSON;
import com.novanovastudio.agent.dto.AgentMessage;
import com.novanovastudio.agent.dto.AgentSession;
import java.time.OffsetDateTime;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * Agent 会话数据库访问层，基于 Spring R2DBC DatabaseClient 与显式 SQL。
 */
@Repository
@RequiredArgsConstructor
public class AgentSessionRepository {

    private final DatabaseClient databaseClient;

    /**
     * 按用户ID和会话ID查询会话
     *
     * @param userId    Long 用户ID
     * @param sessionId String 会话ID
     * @return Mono<AgentSession> 会话
     */
    public Mono<AgentSession> findById(Long userId, String sessionId) {
        return databaseClient.sql("SELECT * FROM agent_session WHERE id = :id AND user_id = :userId")
            .bind("id", sessionId)
            .bind("userId", userId)
            .map((row, meta) -> new AgentSession(
                row.get("id", String.class),
                row.get("user_id", Long.class),
                row.get("title", String.class),
                row.get("profile", String.class),
                parseMessages(row.get("messages", String.class)),
                row.get("created_at", OffsetDateTime.class),
                row.get("updated_at", OffsetDateTime.class)
            ))
            .one();
    }

    /**
     * 插入新会话
     *
     * @param session AgentSession 会话
     * @return Mono<Void>
     */
    public Mono<Void> insert(AgentSession session) {
        return databaseClient.sql("""
            INSERT INTO agent_session (id, user_id, title, profile, messages, created_at, updated_at)
            VALUES (:id, :userId, :title, :profile, :messages::jsonb, :createdAt, :updatedAt)
            """)
            .bind("id", session.id())
            .bind("userId", session.userId())
            .bind("title", session.title())
            .bind("profile", session.profile())
            .bind("messages", JSON.toJSONString(session.messages()))
            .bind("createdAt", session.createdAt())
            .bind("updatedAt", session.updatedAt())
            .then();
    }

    /**
     * 更新会话
     *
     * @param session AgentSession 会话
     * @return Mono<Void>
     */
    public Mono<Void> update(AgentSession session) {
        // 不覆写 messages 列：消息通过 appendMessage 逐条写入，避免覆盖
        return databaseClient.sql("""
            UPDATE agent_session SET title = :title, updated_at = NOW()
            WHERE id = :id AND user_id = :userId
            """)
            .bind("id", session.id())
            .bind("userId", session.userId())
            .bind("title", session.title())
            .then();
    }

    /**
     * 追加消息到会话，使用 JSONB 拼接运算符
     *
     * @param sessionId String 会话ID
     * @param message  AgentMessage 消息
     * @return Mono<Void>
     */
    public Mono<Void> appendMessage(String sessionId, AgentMessage message) {
        return databaseClient.sql("""
            UPDATE agent_session
            SET messages = messages || :message::jsonb, updated_at = NOW()
            WHERE id = :id
            """)
            .bind("id", sessionId)
            .bind("message", JSON.toJSONString(message))
            .then();
    }

    /**
     * 查询用户所有会话，按更新时间倒序
     *
     * @param userId Long 用户ID
     * @return Flux<AgentSession> 会话列表
     */
    public Flux<AgentSession> listByUserId(Long userId) {
        return databaseClient.sql("SELECT * FROM agent_session WHERE user_id = :userId ORDER BY updated_at DESC")
            .bind("userId", userId)
            .map((row, meta) -> new AgentSession(
                row.get("id", String.class),
                row.get("user_id", Long.class),
                row.get("title", String.class),
                row.get("profile", String.class),
                parseMessages(row.get("messages", String.class)),
                row.get("created_at", OffsetDateTime.class),
                row.get("updated_at", OffsetDateTime.class)
            ))
            .all();
    }

    /**
     * 删除会话
     *
     * @param userId    Long 用户ID
     * @param sessionId String 会话ID
     * @return Mono<Void>
     */
    public Mono<Void> deleteById(Long userId, String sessionId) {
        return databaseClient.sql("DELETE FROM agent_session WHERE id = :id AND user_id = :userId")
            .bind("id", sessionId)
            .bind("userId", userId)
            .then();
    }

    /**
     * 解析 messages JSONB 字段为消息列表
     *
     * @param json String JSON 字符串
     * @return List<AgentMessage> 消息列表
     */
    private List<AgentMessage> parseMessages(String json) {
        if (json == null || json.isBlank()) return List.of();
        return JSON.parseArray(json).toList(AgentMessage.class);
    }
}
