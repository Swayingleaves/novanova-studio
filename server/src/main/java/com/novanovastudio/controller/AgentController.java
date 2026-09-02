/**
 * @title        AgentController.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  统一创作 Agent 对话接口
 * @createTime   2026-06-27 10:00:00
 */
package com.novanovastudio.controller;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.agent.AgentEventEmitter;
import com.novanovastudio.agent.CreationAgentOrchestrator;
import com.novanovastudio.agent.CreationEntrySource;
import com.novanovastudio.agent.AgentToolResultRelay;
import com.novanovastudio.agent.dto.AgentCancelRequest;
import com.novanovastudio.agent.dto.AgentChatRequest;
import com.novanovastudio.agent.dto.AgentRequestStatusResponse;
import com.novanovastudio.agent.dto.CreationAgentChatResponse;
import com.novanovastudio.agent.dto.AgentEvent;
import com.novanovastudio.agent.dto.AgentToolResult;
import com.novanovastudio.common.ApiResponse;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.repository.CreationAgentRequestRepository;
import com.novanovastudio.security.CurrentUserProvider;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
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

    private final CreationAgentOrchestrator creationAgentOrchestrator;
    private final AgentEventEmitter eventEmitter;
    private final AgentToolResultRelay toolResultRelay;
    private final CreationAgentRequestRepository creationAgentRequestRepository;
    private final CurrentUserProvider currentUserProvider;

    /**
     * 发起对话。接收用户消息、入口来源和生成设置，创建主Agent请求并进入对应分区队列。
     *
     * @param request AgentChatRequest 对话请求
     * @return Mono<ApiResponse<CreationAgentChatResponse>> 会话、请求和当前排队状态
     */
    @PostMapping("/chat")
    public Mono<ApiResponse<CreationAgentChatResponse>> chat(@RequestBody AgentChatRequest request) {
        if (request == null || !CreationEntrySource.supported(request.entrySource())) {
            return Mono.error(new com.novanovastudio.common.BusinessException(
                    com.novanovastudio.common.ErrorCode.PARAM_INVALID, "Agent入口来源不合法"));
        }
        log.info("Agent 对话请求: entrySource={}, sessionId={}, message={}", request.entrySource(), request.sessionId(), request.message());
        log.info("Agent 对话请求详情: {}", JSONObject.toJSONString(request));
        return currentUserProvider.currentUserId()
            .flatMap(userId -> creationAgentOrchestrator.startChat(userId, request))
            .map(ApiResponse::ok);
    }

    /**
     * 按请求ID停止当前用户的主Agent请求及其关联生成任务。
     *
     * @param request AgentCancelRequest 会话取消请求
     * @return Mono<ApiResponse<Void>> 停止结果
     */
    @PostMapping("/cancelChat")
    public Mono<ApiResponse<Void>> cancelChat(@Valid @RequestBody AgentCancelRequest request) {
        log.info("停止 Agent 对话请求: sessionId={}, requestId={}", request.sessionId(), request.requestId());
        return currentUserProvider.currentUserId()
                .flatMap(userId -> creationAgentOrchestrator.cancelChat(userId, request.requestId()))
                .thenReturn(ApiResponse.ok(null));
    }

    /**
     * 按请求ID查询当前用户的主Agent请求状态，供前端在SSE事件丢失时对账终态。
     *
     * @param requestId String 主Agent请求ID
     * @return Mono<ApiResponse<AgentRequestStatusResponse>> 请求状态和终态说明
     */
    @GetMapping("/requestStatus")
    public Mono<ApiResponse<AgentRequestStatusResponse>> requestStatus(@RequestParam String requestId) {
        return currentUserProvider.currentUserId()
                .flatMap(userId -> creationAgentRequestRepository.findByIdForUser(userId, requestId))
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "主Agent请求不存在")))
                .map(request -> ApiResponse.ok(new AgentRequestStatusResponse(
                        request.getStatus(), request.getErrorMessage() == null ? "" : request.getErrorMessage())));
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
    public Mono<ApiResponse<Void>> submitToolResult(@Valid @RequestBody AgentToolResult request) {
        log.info("Agent 工具结果回传: sessionId={}, requestId={}, callId={}",
                request.sessionId(), request.requestId(), request.callId());
        return currentUserProvider.currentUserId()
            .flatMap(userId -> toolResultRelay.publish(userId, request))
            .thenReturn(ApiResponse.ok(null));
    }
}
