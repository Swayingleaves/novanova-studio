package com.novanovastudio.agent;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

import com.novanovastudio.agent.AgentThinkingEventMiddleware.ThinkingEventContext;
import com.novanovastudio.agent.dto.AgentEvent;
import io.agentscope.core.agent.Agent;
import io.agentscope.core.agent.RuntimeContext;
import io.agentscope.core.event.AgentStartEvent;
import io.agentscope.core.event.ThinkingBlockDeltaEvent;
import io.agentscope.core.event.ThinkingBlockEndEvent;
import io.agentscope.core.event.ThinkingBlockStartEvent;
import io.agentscope.core.middleware.AgentInput;
import java.util.List;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import reactor.core.publisher.Flux;
import reactor.test.StepVerifier;

/**
 * 主Agent思考事件中间件测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-30 02:41
 */
class AgentThinkingEventMiddlewareTest {

    /**
     * AgentScope思考事件应按同一思考编号转换为原始增量和完成事件。
     */
    @Test
    void shouldForwardThinkingEventsWithStableThoughtId() {
        AgentEventEmitter eventEmitter = mock(AgentEventEmitter.class);
        AgentThinkingEventMiddleware middleware = new AgentThinkingEventMiddleware(eventEmitter);
        RuntimeContext runtimeContext = RuntimeContext.builder()
                .put(ThinkingEventContext.class, new ThinkingEventContext(42L, "session-1"))
                .build();
        AgentInput input = new AgentInput(List.of());
        ThinkingBlockStartEvent startEvent = new ThinkingBlockStartEvent("reply-1", "block-1");
        ThinkingBlockDeltaEvent deltaEvent = new ThinkingBlockDeltaEvent("reply-1", "block-1", "原始推理内容");
        ThinkingBlockEndEvent endEvent = new ThinkingBlockEndEvent("reply-1", "block-1");

        StepVerifier.create(middleware.onAgent(mock(Agent.class), runtimeContext, input,
                        ignored -> Flux.just(startEvent, deltaEvent, endEvent)))
                .expectNext(startEvent, deltaEvent, endEvent)
                .verifyComplete();

        ArgumentCaptor<AgentEvent> eventCaptor = ArgumentCaptor.forClass(AgentEvent.class);
        verify(eventEmitter, org.mockito.Mockito.times(2)).emit(eq(42L), eventCaptor.capture());
        List<AgentEvent> forwardedEvents = eventCaptor.getAllValues();
        Assertions.assertEquals("thought-delta", forwardedEvents.get(0).type());
        Assertions.assertEquals("reply-1:block-1", forwardedEvents.get(0).thoughtId());
        Assertions.assertEquals("原始推理内容", forwardedEvents.get(0).thoughtDelta());
        Assertions.assertEquals("thought-complete", forwardedEvents.get(1).type());
        Assertions.assertEquals("reply-1:block-1", forwardedEvents.get(1).thoughtId());
        Assertions.assertTrue(forwardedEvents.get(1).thoughtDurationMs() >= 0);
    }

    /**
     * 缺少业务上下文时应原样透传全部事件且不发送业务SSE。
     */
    @Test
    void shouldPassThroughWithoutBusinessContext() {
        AgentEventEmitter eventEmitter = mock(AgentEventEmitter.class);
        AgentThinkingEventMiddleware middleware = new AgentThinkingEventMiddleware(eventEmitter);
        AgentInput input = new AgentInput(List.of());
        ThinkingBlockDeltaEvent deltaEvent = new ThinkingBlockDeltaEvent("reply-1", "block-1", "不会转发");

        StepVerifier.create(middleware.onAgent(mock(Agent.class), RuntimeContext.empty(), input,
                        ignored -> Flux.just(deltaEvent)))
                .expectNext(deltaEvent)
                .verifyComplete();

        verifyNoInteractions(eventEmitter);
    }

    /**
     * 没有思考事件时应原样透传普通AgentScope事件且不发送思考SSE。
     */
    @Test
    void shouldPassThroughNonThinkingEvents() {
        AgentEventEmitter eventEmitter = mock(AgentEventEmitter.class);
        AgentThinkingEventMiddleware middleware = new AgentThinkingEventMiddleware(eventEmitter);
        RuntimeContext runtimeContext = RuntimeContext.builder()
                .put(ThinkingEventContext.class, new ThinkingEventContext(42L, "session-1"))
                .build();
        AgentStartEvent startEvent = new AgentStartEvent("session-1", "reply-1", "main-agent");

        StepVerifier.create(middleware.onAgent(mock(Agent.class), runtimeContext, new AgentInput(List.of()),
                        ignored -> Flux.just(startEvent)))
                .expectNext(startEvent)
                .verifyComplete();

        verify(eventEmitter, never()).emit(eq(42L), org.mockito.ArgumentMatchers.any(AgentEvent.class));
    }
}
