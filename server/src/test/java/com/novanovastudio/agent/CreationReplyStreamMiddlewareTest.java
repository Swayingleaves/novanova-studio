package com.novanovastudio.agent;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

import com.novanovastudio.agent.CreationReplyStreamMiddleware.CreationReplyStreamContext;
import com.novanovastudio.agent.dto.AgentEvent;
import io.agentscope.core.agent.Agent;
import io.agentscope.core.agent.RuntimeContext;
import io.agentscope.core.event.TextBlockDeltaEvent;
import io.agentscope.core.event.TextBlockEndEvent;
import io.agentscope.core.event.TextBlockStartEvent;
import io.agentscope.core.middleware.AgentInput;
import java.util.List;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import reactor.core.publisher.Flux;
import reactor.test.StepVerifier;

/**
 * 创作对话回复流中间件测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-20 22:59
 */
class CreationReplyStreamMiddlewareTest {

    /**
     * 应从分片JSON中增量抽取summary字段并正确解码转义字符与Unicode。
     */
    @Test
    void shouldStreamSummaryFieldAcrossSplitChunks() {
        AgentEventEmitter eventEmitter = mock(AgentEventEmitter.class);
        CreationReplyStreamMiddleware middleware = new CreationReplyStreamMiddleware(eventEmitter);
        RuntimeContext runtimeContext = RuntimeContext.builder()
                .put(CreationReplyStreamContext.class, new CreationReplyStreamContext(
                        12L, "session-1", "assistant-1", List.of("summary", "clarificationQuestion")))
                .build();

        Flux<io.agentscope.core.event.AgentEvent> upstream = Flux.just(
                new TextBlockStartEvent("reply-1", "block-1"),
                new TextBlockDeltaEvent("reply-1", "block-1", "{\"intent\":\"image\",\"sum"),
                new TextBlockDeltaEvent("reply-1", "block-1", "mary\":\"将生成 1 张\\n高保真\\u4e2d"),
                new TextBlockDeltaEvent("reply-1", "block-1", "文界面\",\"tasks\":[]}"),
                new TextBlockEndEvent("reply-1", "block-1")
        );

        StepVerifier.create(middleware.onAgent(mock(Agent.class), runtimeContext, new AgentInput(List.of()),
                        ignored -> upstream))
                .expectNextCount(5)
                .verifyComplete();

        ArgumentCaptor<AgentEvent> captor = ArgumentCaptor.forClass(AgentEvent.class);
        verify(eventEmitter, atLeastOnce()).emit(eq(12L), captor.capture());
        List<AgentEvent> events = captor.getAllValues();
        Assertions.assertTrue(events.stream().allMatch(event -> "text-delta".equals(event.type())));
        Assertions.assertTrue(events.stream().allMatch(event -> "assistant-1".equals(event.messageId())));
        String combined = events.stream().map(AgentEvent::delta).collect(Collectors.joining());
        Assertions.assertEquals("将生成 1 张\n高保真中文界面", combined);
    }

    /**
     * 当summary为空字符串时，应跳过并流式抽取clarificationQuestion。
     */
    @Test
    void shouldSkipEmptySummaryAndStreamClarificationQuestion() {
        AgentEventEmitter eventEmitter = mock(AgentEventEmitter.class);
        CreationReplyStreamMiddleware middleware = new CreationReplyStreamMiddleware(eventEmitter);
        RuntimeContext runtimeContext = RuntimeContext.builder()
                .put(CreationReplyStreamContext.class, new CreationReplyStreamContext(
                        12L, "session-2", "assistant-2", List.of("summary", "clarificationQuestion")))
                .build();

        Flux<io.agentscope.core.event.AgentEvent> upstream = Flux.just(
                new TextBlockStartEvent("reply-2", "block-1"),
                new TextBlockDeltaEvent("reply-2", "block-1", "{\"summary\":\"\",\"clarificationQuestion\":\"请问需要什么风格？\"}"),
                new TextBlockEndEvent("reply-2", "block-1")
        );

        StepVerifier.create(middleware.onAgent(mock(Agent.class), runtimeContext, new AgentInput(List.of()),
                        ignored -> upstream))
                .expectNextCount(3)
                .verifyComplete();

        ArgumentCaptor<AgentEvent> captor = ArgumentCaptor.forClass(AgentEvent.class);
        verify(eventEmitter, atLeastOnce()).emit(eq(12L), captor.capture());
        String combined = captor.getAllValues().stream().map(AgentEvent::delta).collect(Collectors.joining());
        Assertions.assertEquals("请问需要什么风格？", combined);
    }

    /**
     * 缺少流式业务上下文时应原样透传且不发送事件。
     */
    @Test
    void shouldPassThroughWithoutStreamContext() {
        AgentEventEmitter eventEmitter = mock(AgentEventEmitter.class);
        CreationReplyStreamMiddleware middleware = new CreationReplyStreamMiddleware(eventEmitter);
        TextBlockDeltaEvent deltaEvent = new TextBlockDeltaEvent("reply-3", "block-1", "{\"summary\":\"不发送\"}");

        StepVerifier.create(middleware.onAgent(mock(Agent.class), RuntimeContext.empty(), new AgentInput(List.of()),
                        ignored -> Flux.just(deltaEvent)))
                .expectNext(deltaEvent)
                .verifyComplete();

        verifyNoInteractions(eventEmitter);
    }
}
