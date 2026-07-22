/**
 * @title        AgentEventEmitter.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  SSE 事件发射器，基于 Reactor Sinks.Many 管理用户事件流
 * @createTime   2026-06-27 10:00:00
 */
package com.novanovastudio.agent;

import com.novanovastudio.agent.dto.AgentEvent;
import java.util.concurrent.ConcurrentHashMap;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Sinks;

/**
 * SSE 事件发射器，每个用户维护一个 Sinks.Many 事件流，支持一对多事件推送。
 */
@Component
@Slf4j
public class AgentEventEmitter {

    /** userId → Sink，每个用户一个事件流 */
    private final ConcurrentHashMap<Long, Sinks.Many<AgentEvent>> userSinks = new ConcurrentHashMap<>();

    /**
     * 订阅用户事件流，前端 SSE 连接时调用
     *
     * @param userId Long 用户ID
     * @return Flux<AgentEvent> 事件流
     */
    public Flux<AgentEvent> subscribe(Long userId) {
        // 使用 multicast 多播，允许重连后继续接收事件；缓冲区设 256 防止背压丢事件。
        return userSinks.computeIfAbsent(userId,
            k -> Sinks.many().multicast().onBackpressureBuffer(256, false)
        ).asFlux();
    }

    /**
     * 推送事件给指定用户
     *
     * @param userId Long 用户ID
     * @param event  AgentEvent 事件
     */
    public void emit(Long userId, AgentEvent event) {
        Sinks.Many<AgentEvent> sink = userSinks.get(userId);
        if (sink != null) {
            sink.tryEmitNext(event);
        }
    }

    /**
     * 清理用户连接，用户登出时调用
     *
     * @param userId Long 用户ID
     */
    public void remove(Long userId) {
        Sinks.Many<AgentEvent> sink = userSinks.remove(userId);
        if (sink != null) {
            sink.tryEmitComplete();
        }
    }
}
