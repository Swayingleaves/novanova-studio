package com.novanovastudio.agent;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.alibaba.fastjson2.JSON;
import com.novanovastudio.agent.dto.AgentToolResult;
import java.util.Map;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.data.redis.core.ReactiveStringRedisTemplate;
import org.springframework.data.redis.listener.ReactiveRedisMessageListenerContainer;
import reactor.core.publisher.Mono;

/**
 * 画布工具结果跨实例中继测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-08-13 00:00
 */
class AgentToolResultRelayTest {

    /**
     * 工具结果必须按用户进入固定Redis通道，负载保留完整结果数据。
     */
    @Test
    @SuppressWarnings("unchecked")
    void shouldPublishToolResultToUserChannel() {
        ReactiveStringRedisTemplate redisTemplate = mock(ReactiveStringRedisTemplate.class);
        ReactiveRedisMessageListenerContainer listenerContainer = mock(ReactiveRedisMessageListenerContainer.class);
        ObjectProvider<AgentTaskOrchestrator> orchestratorProvider = mock(ObjectProvider.class);
        AgentToolResultRelay relay = new AgentToolResultRelay(redisTemplate, listenerContainer, orchestratorProvider);
        AgentToolResult result = new AgentToolResult("session-1", "request-1", "call-1",
                new AgentToolResult.ToolResult(true, "画布操作完成", Map.of("nodeId", "node-1")));
        when(redisTemplate.convertAndSend(eq("novanova:creation-agent:tool-result:9"), anyString()))
                .thenReturn(Mono.just(1L));

        relay.publish(9L, result).block();

        ArgumentCaptor<String> payloadCaptor = ArgumentCaptor.forClass(String.class);
        verify(redisTemplate).convertAndSend(eq("novanova:creation-agent:tool-result:9"), payloadCaptor.capture());
        AgentToolResult payload = JSON.parseObject(payloadCaptor.getValue(), AgentToolResult.class);
        Assertions.assertEquals("session-1", payload.sessionId());
        Assertions.assertEquals("request-1", payload.requestId());
        Assertions.assertEquals("call-1", payload.callId());
        Assertions.assertEquals("node-1", payload.result().data().get("nodeId"));
    }

    /**
     * 不同用户的工具结果通道必须隔离。
     */
    @Test
    void shouldBuildIsolatedUserResultChannels() {
        Assertions.assertEquals("novanova:creation-agent:tool-result:9", AgentToolResultRelay.resultChannel(9L));
        Assertions.assertNotEquals(AgentToolResultRelay.resultChannel(9L), AgentToolResultRelay.resultChannel(10L));
    }

    /**
     * 工具回传缺少主Agent请求ID时不能唤醒本地等待器，防止跨请求串扰。
     */
    @Test
    void shouldRejectToolResultWithoutRequestId() {
        AgentTaskOrchestrator orchestrator = mock(AgentTaskOrchestrator.class);
        AgentToolResultRelay relay = new AgentToolResultRelay(mock(ReactiveStringRedisTemplate.class),
                mock(ReactiveRedisMessageListenerContainer.class), provider(orchestrator));

        relay.forward(9L, new AgentToolResult("session-1", null, "call-1",
                new AgentToolResult.ToolResult(true, "画布操作完成", Map.of())));

        verify(orchestrator, never()).submitToolResult(org.mockito.ArgumentMatchers.anyLong(),
                org.mockito.ArgumentMatchers.any(AgentToolResult.class));
    }

    /**
     * 工具回传中的空白请求ID不能唤醒本地等待器，防止绕过请求归属校验。
     */
    @Test
    void shouldRejectToolResultWithBlankRequestId() {
        AgentTaskOrchestrator orchestrator = mock(AgentTaskOrchestrator.class);
        AgentToolResultRelay relay = new AgentToolResultRelay(mock(ReactiveStringRedisTemplate.class),
                mock(ReactiveRedisMessageListenerContainer.class), provider(orchestrator));

        relay.forward(9L, new AgentToolResult("session-1", "   ", "call-1",
                new AgentToolResult.ToolResult(true, "画布操作完成", Map.of())));

        verify(orchestrator, never()).submitToolResult(org.mockito.ArgumentMatchers.anyLong(),
                org.mockito.ArgumentMatchers.any(AgentToolResult.class));
    }

    /**
     * 构造固定返回指定编排器的提供器。
     *
     * @param orchestrator AgentTaskOrchestrator 主Agent工具执行桥接
     * @return ObjectProvider<AgentTaskOrchestrator> 固定提供器
     */
    private ObjectProvider<AgentTaskOrchestrator> provider(AgentTaskOrchestrator orchestrator) {
        @SuppressWarnings("unchecked")
        ObjectProvider<AgentTaskOrchestrator> provider = mock(ObjectProvider.class);
        when(provider.getObject()).thenReturn(orchestrator);
        return provider;
    }
}
