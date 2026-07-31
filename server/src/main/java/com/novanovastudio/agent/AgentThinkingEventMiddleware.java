package com.novanovastudio.agent;

import com.novanovastudio.agent.dto.AgentEvent;
import io.agentscope.core.agent.Agent;
import io.agentscope.core.agent.RuntimeContext;
import io.agentscope.core.event.ThinkingBlockDeltaEvent;
import io.agentscope.core.event.ThinkingBlockEndEvent;
import io.agentscope.core.event.ThinkingBlockStartEvent;
import io.agentscope.core.middleware.AgentInput;
import io.agentscope.core.middleware.MiddlewareBase;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.function.Function;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Flux;

/**
 * 主Agent思考事件中间件，将AgentScope思考事件实时转发为业务SSE事件。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-30 02:41
 */
@Component
@RequiredArgsConstructor
public class AgentThinkingEventMiddleware implements MiddlewareBase {

    /** Agent事件发射器 */
    private final AgentEventEmitter eventEmitter;

    /**
     * 旁路观察主Agent事件流并转发思考增量与完成事件。
     *
     * @param agent Agent 当前Agent实例
     * @param runtimeContext RuntimeContext 当前调用上下文
     * @param input AgentInput 当前Agent输入
     * @param next Function 后续中间件或Agent核心逻辑
     * @return Flux&lt;io.agentscope.core.event.AgentEvent&gt; 原始AgentScope事件流
     */
    @Override
    public Flux<io.agentscope.core.event.AgentEvent> onAgent(
            Agent agent,
            RuntimeContext runtimeContext,
            AgentInput input,
            Function<AgentInput, Flux<io.agentscope.core.event.AgentEvent>> next) {
        ThinkingEventContext eventContext = runtimeContext.get(ThinkingEventContext.class);
        if (eventContext == null) {
            return next.apply(input);
        }
        Map<String, Long> startTimes = new HashMap<>();
        return next.apply(input).doOnNext(event -> {
            if (event instanceof ThinkingBlockStartEvent startEvent) {
                startTimes.put(thoughtId(startEvent.getReplyId(), startEvent.getBlockId()), System.nanoTime());
            } else if (event instanceof ThinkingBlockDeltaEvent deltaEvent) {
                String thoughtId = thoughtId(deltaEvent.getReplyId(), deltaEvent.getBlockId());
                eventEmitter.emit(eventContext.userId(), AgentEvent.thoughtDelta(
                        eventContext.sessionId(), thoughtId, deltaEvent.getDelta()));
            } else if (event instanceof ThinkingBlockEndEvent endEvent) {
                String thoughtId = thoughtId(endEvent.getReplyId(), endEvent.getBlockId());
                Long startTime = startTimes.remove(thoughtId);
                if (startTime != null) {
                    long elapsedMilliseconds = TimeUnit.NANOSECONDS.toMillis(
                            Math.max(0L, System.nanoTime() - startTime));
                    int durationMilliseconds = (int) Math.min(Integer.MAX_VALUE, elapsedMilliseconds);
                    eventEmitter.emit(eventContext.userId(), AgentEvent.thoughtComplete(
                            eventContext.sessionId(), thoughtId, durationMilliseconds));
                }
            }
        });
    }

    /**
     * 组合AgentScope回复编号和思考块编号。
     *
     * @param replyId String AgentScope回复编号
     * @param blockId String AgentScope思考块编号
     * @return String 当前调用内唯一的思考编号
     */
    private String thoughtId(String replyId, String blockId) {
        return replyId + ":" + blockId;
    }

    /**
     * 当前主Agent调用的思考事件业务上下文。
     *
     * @param userId Long 当前已认证用户编号
     * @param sessionId String 前端Agent会话编号
     */
    public record ThinkingEventContext(Long userId, String sessionId) {
    }
}
