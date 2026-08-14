package com.novanovastudio.agent;

import static org.mockito.Mockito.mock;

import com.novanovastudio.agent.dto.AgentEvent;
import com.novanovastudio.repository.PersistenceRepository;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import reactor.test.StepVerifier;

/**
 * 主Agent SSE事件请求归属测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-08-13 00:00
 */
class AgentEventEmitterTest {

    /**
     * 执行中的会话发出的普通事件必须自动携带当前主Agent请求ID。
     */
    @Test
    void shouldEnrichBoundSessionEventsWithRequestId() {
        AgentEventEmitter emitter = new AgentEventEmitter(new AgentActivityService(mock(PersistenceRepository.class)));
        emitter.bindRequest("session-1", "request-1");

        StepVerifier.create(emitter.subscribe(1L).take(1))
                .then(() -> emitter.emit(1L, AgentEvent.notice("session-1", "正在生成")))
                .assertNext(event -> {
                    Assertions.assertEquals("notice", event.type());
                    Assertions.assertEquals("session-1", event.sessionId());
                    Assertions.assertEquals("request-1", event.requestId());
                })
                .verifyComplete();
    }
}
