/**
 * @title        AgentController.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  画布 Agent 对话接口
 * @createTime   2026-06-27 10:00:00
 */
package com.novanovastudio.controller;

import com.novanovastudio.agent.AgentEventEmitter;
import com.novanovastudio.agent.AgentTaskOrchestrator;
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
 * 画布 Agent 对话接口，提供发起对话、订阅 SSE 事件流、回传前端工具结果三个端点。
 */
@RestController
@RequestMapping("/api/v1/ai/agent")
@RequiredArgsConstructor
@Slf4j
public class AgentController {

    private final AgentTaskOrchestrator orchestrator;
    private final AgentEventEmitter eventEmitter;
    private final CurrentUserProvider currentUserProvider;

    /**
     * 发起对话。接收用户消息和画布快照，异步启动 Agent Loop，立即返回 sessionId 供前端订阅事件。
     *
     * @param request AgentChatRequest 对话请求
     * @return Mono<ApiResponse<Map<String, String>>> sessionId
     */
    @PostMapping("/chat")
    public Mono<ApiResponse<Map<String, String>>> chat(@RequestBody AgentChatRequest request) {
        log.info("Agent 对话请求: profile={}, sessionId={}, message={}", request.profile(), request.sessionId(), request.message());
        return currentUserProvider.currentUserId()
            .flatMap(userId -> orchestrator.startChat(userId, request))
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
                .flatMap(userId -> orchestrator.cancelChat(userId, request.sessionId()))
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
