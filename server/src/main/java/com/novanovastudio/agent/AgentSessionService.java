/**
 * @title        AgentSessionService.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  Agent 会话服务
 * @createTime   2026-06-27 10:00:00
 */
package com.novanovastudio.agent;

import com.novanovastudio.common.SystemMessage;

import com.novanovastudio.agent.dto.AgentMessage;
import com.novanovastudio.agent.dto.AgentSession;
import com.novanovastudio.agent.dto.AgentSessionHistoryMessage;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * Agent 会话服务，负责会话的创建、加载、消息追加和持久化。
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class AgentSessionService {

    private final AgentSessionRepository repository;

    /**
     * 获取或创建会话，有 sessionId 则加载，无则新建（默认 canvas profile）
     *
     * @param userId    Long 用户ID
     * @param sessionId String 会话ID，为空则创建新会话
     * @return Mono<AgentSession> 会话
     */
    public Mono<AgentSession> getOrCreateSession(Long userId, String sessionId) {
        return getOrCreateSession(userId, sessionId, null);
    }

    /**
     * 获取或创建会话，有 sessionId 则加载，无则按指定 profile 新建。
     *
     * @param userId    Long 用户ID
     * @param sessionId String 会话ID，为空则创建新会话
     * @param profile   String 会话类型，为空时默认 canvas
     * @return Mono<AgentSession> 会话
     */
    public Mono<AgentSession> getOrCreateSession(Long userId, String sessionId, String profile) {
        if (StringUtils.hasText(sessionId)) {
            return repository.findById(userId, sessionId)
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, SystemMessage.of("business.conversationNotFound"))));
        }
        return createSession(userId, profile);
    }

    /**
     * 创建新会话（默认 canvas profile）
     *
     * @param userId Long 用户ID
     * @return Mono<AgentSession> 新会话
     */
    public Mono<AgentSession> createSession(Long userId) {
        return createSession(userId, AgentSession.PROFILE_CANVAS);
    }

    /**
     * 创建新会话
     *
     * @param userId  Long 用户ID
     * @param profile String 会话类型
     * @return Mono<AgentSession> 新会话
     */
    public Mono<AgentSession> createSession(Long userId, String profile) {
        AgentSession session = new AgentSession(
            UUID.randomUUID().toString(),
            userId,
            "新对话",
            profile != null ? profile : AgentSession.PROFILE_CANVAS,
            new ArrayList<>(),
            OffsetDateTime.now(),
            OffsetDateTime.now()
        );
        return repository.insert(session).thenReturn(session);
    }

    /**
     * 追加用户消息
     *
     * @param sessionId String 会话ID
     * @param messageId String 消息ID
     * @param text      String 消息文本
     * @return Mono<Void>
     */
    public Mono<Void> appendUserMessage(String sessionId, String messageId, String text) {
        return repository.appendMessage(sessionId, new AgentMessage(messageId, "user", text, null));
    }

    /**
     * 追加助手消息
     *
     * @param sessionId String 会话ID
     * @param messageId String 消息ID
     * @param text      String 消息文本
     * @return Mono<Void>
     */
    public Mono<Void> appendAssistantMessage(String sessionId, String messageId, String text) {
        return repository.appendMessage(sessionId, new AgentMessage(messageId, "assistant", text, null));
    }

    /**
     * 追加任意消息（tool 角色等），直接委托仓库写入。
     *
     * @param sessionId String 会话ID
     * @param message  AgentMessage 消息
     * @return Mono<Void>
     */
    public Mono<Void> appendMessage(String sessionId, AgentMessage message) {
        return repository.appendMessage(sessionId, message);
    }

    /**
     * 持久化会话，结束时调用
     *
     * @param session AgentSession 会话
     * @return Mono<Void>
     */
    public Mono<Void> persist(AgentSession session) {
        return repository.update(session);
    }

    /**
     * 查询用户所有会话
     *
     * @param userId Long 用户ID
     * @return Flux<AgentSession> 会话列表
     */
    public Flux<AgentSession> listSessions(Long userId) {
        return repository.listByUserId(userId);
    }

    /**
     * 查询当前用户在当前空间中的对话正文，用于恢复没有生成轮次的历史记录。
     *
     * @param userId Long 当前用户标识
     * @param sessionId String 会话标识
     * @return Mono<List<AgentSessionHistoryMessage>> 按保存顺序排列的用户和助手消息
     * @throws BusinessException 会话标识为空或会话不属于当前用户和空间时抛出
     */
    public Mono<List<AgentSessionHistoryMessage>> getSessionHistory(Long userId, String sessionId) {
        if (!StringUtils.hasText(sessionId)) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_MISSING, "会话标识不能为空"));
        }
        // 仅查询既有会话；仓储同时受当前团队作用域约束，内部消息不返回前端。
        return repository.findById(userId, sessionId)
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND,
                        SystemMessage.of("business.conversationNotFound"))))
                .map(session -> session.messages().stream()
                        .filter(message -> "user".equals(message.role()) || "assistant".equals(message.role()))
                        .filter(message -> StringUtils.hasText(message.text()))
                        .map(message -> new AgentSessionHistoryMessage(message.id(), message.role(), message.text()))
                        .toList());
    }

    /**
     * 删除会话
     *
     * @param userId    Long 用户ID
     * @param sessionId String 会话ID
     * @return Mono<Void>
     */
    public Mono<Void> deleteSession(Long userId, String sessionId) {
        return repository.deleteById(userId, sessionId);
    }
}
