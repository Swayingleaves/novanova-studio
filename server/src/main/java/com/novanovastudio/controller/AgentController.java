/**
 * @title        AgentController.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  统一创作 Agent 对话接口
 * @createTime   2026-06-27 10:00:00
 */
package com.novanovastudio.controller;

import com.novanovastudio.agent.AgentEventEmitter;
import com.novanovastudio.agent.AgentTaskOrchestrator;
import com.novanovastudio.agent.CreationAgentOrchestrator;
import com.novanovastudio.agent.CreationEntrySource;
import com.novanovastudio.agent.dto.AgentCancelRequest;
import com.novanovastudio.agent.dto.AgentChatRequest;
import com.novanovastudio.agent.dto.AgentEvent;
import com.novanovastudio.agent.dto.AgentToolResult;
import com.novanovastudio.common.ApiResponse;
import com.novanovastudio.security.CurrentUserProvider;
import java.util.Map;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 统一创作 Agent 对话接口，提供发起对话、订阅SSE事件流和回传画布工具结果三个端点。
 */
@RestController
@RequestMapping("/api/v1/ai/agent")
@RequiredArgsConstructor
@Slf4j
public class AgentController {

    private final AgentTaskOrchestrator orchestrator;
    private final CreationAgentOrchestrator creationAgentOrchestrator;
    private final AgentEventEmitter eventEmitter;
    private final CurrentUserProvider currentUserProvider;

    /**
     * 发起对话。接收用户消息、入口来源和生成设置，异步启动主Agent计划，立即返回sessionId。
     *
     * @param request AgentChatRequest 对话请求
     * @return Mono<ApiResponse<Map<String, String>>> sessionId
     */
    @PostMapping("/chat")
    public Mono<ApiResponse<Map<String, String>>> chat(@RequestBody AgentChatRequest request) {
        if (request == null || !CreationEntrySource.supported(request.entrySource())) {
            return Mono.error(new com.novanovastudio.common.BusinessException(
                    com.novanovastudio.common.ErrorCode.PARAM_INVALID, "Agent入口来源不合法"));
        }
        log.info("Agent 对话请求: entrySource={}, sessionId={}, message={}", request.entrySource(), request.sessionId(), request.message());
        return currentUserProvider.currentUserId()
            .flatMap(userId -> creationAgentOrchestrator.supports(request.entrySource())
                    ? creationAgentOrchestrator.startChat(userId, request)
                    : orchestrator.startChat(userId, request))
            .map(sessionId -> ApiResponse.ok(Map.of("sessionId", sessionId)));
    }

    /**
     * 停止当前用户的活跃 Agent 会话及其关联生成任务。
     *
     * @param request AgentCancelRequest 会话取消请求
     * @return Mono<ApiResponse<Void>> 停止结果
     */
    @PostMapping("/cancelChat")
    public Mono<ApiResponse<Void>> cancelChat(@Valid @RequestBody AgentCancelRequest request) {
        log.info("停止 Agent 对话请求: sessionId={}", request.sessionId());
        return currentUserProvider.currentUserId()
                .flatMap(userId -> creationAgentOrchestrator.isActive(request.sessionId())
                        ? creationAgentOrchestrator.cancelChat(userId, request.sessionId())
                        : orchestrator.cancelChat(userId, request.sessionId()))
                .thenReturn(ApiResponse.ok(null));
    }

    /**
     * 订阅 SSE 事件流。前端建立长连接，接收 text-delta、tool-execute、task-complete、error 事件。
     *
     * @return Flux<ServerSentEvent<AgentEvent>> SSE 事件流
     */
    @GetMapping(value = "/events", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<AgentEvent>> subscribe() {
        return currentUserProvider.currentUserId()
            .flatMapMany(eventEmitter::subscribe)
            .map(event -> ServerSentEvent.<AgentEvent>builder()
                .event(event.type())
                .data(event)
                .build());
    }

    /**
     * 前端工具执行结果回传。Agent Loop 阻塞等待此结果后继续。
     *
     * @param request AgentToolResult 工具结果
     * @return Mono<ApiResponse<Void>>
     */
    @PostMapping("/tool-result")
    public Mono<ApiResponse<Void>> submitToolResult(@RequestBody AgentToolResult request) {
        log.info("Agent 工具结果回传: sessionId={}, callId={}", request.sessionId(), request.callId());
        return currentUserProvider.currentUserId()
            .flatMap(userId -> {
                orchestrator.submitToolResult(userId, request);
                return Mono.just(ApiResponse.ok(null));
            });
    }
}
