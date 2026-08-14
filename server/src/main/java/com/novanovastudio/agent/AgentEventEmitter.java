/**
 * @title        AgentEventEmitter.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  支持Redis跨实例转发的Agent SSE事件发射器
 * @createTime   2026-06-27 10:00:00
 */
package com.novanovastudio.agent;

import com.alibaba.fastjson2.JSON;
import com.novanovastudio.agent.dto.AgentEvent;
import jakarta.annotation.PostConstruct;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.ReactiveStringRedisTemplate;
import org.springframework.data.redis.listener.PatternTopic;
import org.springframework.data.redis.listener.ReactiveRedisMessageListenerContainer;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.publisher.Sinks;

/**
 * Agent SSE事件发射器。事件先写入Redis Pub/Sub，再由每个服务实例转发给本地SSE订阅。
 */
@Component
@Slf4j
public class AgentEventEmitter {

    /** 主Agent事件Redis通道前缀 */
    private static final String EVENT_CHANNEL_PREFIX = "novanova:creation-agent:event:";

    /** Agent执行活动服务 */
    private final AgentActivityService activityService;

    /** Redis模板，测试构造器中允许为空 */
    private final ReactiveStringRedisTemplate redisTemplate;

    /** Redis消息监听容器，测试构造器中允许为空 */
    private final ReactiveRedisMessageListenerContainer listenerContainer;

    /** 当前实例的用户事件流 */
    private final ConcurrentHashMap<Long, UserEventSink> userSinks = new ConcurrentHashMap<>();

    /** 运行中会话对应的主Agent请求ID */
    private final ConcurrentHashMap<String, String> requestIdsBySession = new ConcurrentHashMap<>();

    /**
     * 创建生产环境事件发射器。
     *
     * @param activityService AgentActivityService 执行活动服务
     * @param redisTemplate ReactiveStringRedisTemplate Redis模板
     * @param listenerContainer ReactiveRedisMessageListenerContainer Redis消息监听容器
     */
    @Autowired
    public AgentEventEmitter(AgentActivityService activityService, ReactiveStringRedisTemplate redisTemplate,
                             ReactiveRedisMessageListenerContainer listenerContainer) {
        this.activityService = activityService;
        this.redisTemplate = redisTemplate;
        this.listenerContainer = listenerContainer;
    }

    /**
     * 创建测试用本地事件发射器。
     *
     * @param activityService AgentActivityService 执行活动服务
     */
    protected AgentEventEmitter(AgentActivityService activityService) {
        this.activityService = activityService;
        this.redisTemplate = null;
        this.listenerContainer = null;
    }

    /**
     * 初始化Redis事件订阅。
     */
    @PostConstruct
    public void subscribeRedisEvents() {
        if (listenerContainer == null) {
            return;
        }
        listenerContainer.receive(new PatternTopic(EVENT_CHANNEL_PREFIX + "*"))
                .flatMap(message -> {
                    Long userId = parseChannelUserId(message.getChannel());
                    if (userId == null) {
                        return Mono.empty();
                    }
                    try {
                        deliver(userId, JSON.parseObject(message.getMessage(), AgentEvent.class));
                    } catch (Exception exception) {
                        log.error("解析主Agent Redis事件失败: channel={}", message.getChannel(), exception);
                    }
                    return Mono.empty();
                })
                .onErrorContinue((throwable, ignored) -> log.error("订阅主Agent Redis事件失败", throwable))
                .subscribe();
    }

    /**
     * 订阅指定用户事件流。
     *
     * @param userId Long 用户ID
     * @return Flux<AgentEvent> 事件流
     */
    public Flux<AgentEvent> subscribe(Long userId) {
        UserEventSink sink = userSinks.computeIfAbsent(userId,
                ignored -> new UserEventSink(Sinks.many().multicast().onBackpressureBuffer(256, false), new AtomicInteger()));
        return sink.sink().asFlux()
                .doOnSubscribe(subscription -> sink.subscriberCount().incrementAndGet())
                .doFinally(signal -> {
                    int subscribers = sink.subscriberCount().decrementAndGet();
                    if (subscribers <= 0) {
                        userSinks.computeIfPresent(userId, (ignored, current) -> current == sink ? null : current);
                    }
                });
    }

    /**
     * 推送事件给指定用户。
     *
     * @param userId Long 用户ID
     * @param event AgentEvent 事件
     */
    public void emit(Long userId, AgentEvent event) {
        AgentEvent enriched = enrichRequestId(event);
        if (redisTemplate == null) {
            deliver(userId, enriched);
            return;
        }
        redisTemplate.convertAndSend(EVENT_CHANNEL_PREFIX + userId, JSON.toJSONString(enriched))
                .subscribe(
                        ignored -> {
                        },
                        exception -> log.error("发布主Agent Redis事件失败: userId={}", userId, exception)
                );
    }

    /**
     * 绑定正在执行的会话和本次主Agent请求。
     *
     * @param sessionId String Agent会话ID
     * @param requestId String 主Agent请求ID
     */
    public void bindRequest(String sessionId, String requestId) {
        if (sessionId != null && requestId != null) {
            requestIdsBySession.put(sessionId, requestId);
        }
    }

    /**
     * 解绑已结束请求。
     *
     * @param sessionId String Agent会话ID
     * @param requestId String 主Agent请求ID
     */
    public void unbindRequest(String sessionId, String requestId) {
        if (sessionId != null && requestId != null) {
            requestIdsBySession.remove(sessionId, requestId);
        }
    }

    /**
     * 判断请求是否仍绑定为当前实例该会话的运行主Agent。
     *
     * @param sessionId String Agent会话ID
     * @param requestId String 主Agent请求ID
     * @return boolean 是否匹配
     */
    public boolean matchesBoundRequest(String sessionId, String requestId) {
        return sessionId != null && requestId != null && requestId.equals(requestIdsBySession.get(sessionId));
    }

    /**
     * 保存指定生成轮次的最新执行活动。
     *
     * @param userId Long 当前用户ID
     * @param sessionId String Agent会话ID
     * @param roundId String 生成轮次ID
     * @return Mono<Void> 保存结果
     */
    public Mono<Void> persistRoundActivities(Long userId, String sessionId, String roundId) {
        return activityService.persistRoundActivities(userId, sessionId, roundId);
    }

    /**
     * 清理用户连接。
     *
     * @param userId Long 用户ID
     */
    public void remove(Long userId) {
        UserEventSink userEventSink = userSinks.remove(userId);
        if (userEventSink != null) {
            userEventSink.sink().tryEmitComplete();
        }
    }

    /**
     * 向当前实例的SSE连接分发Redis事件。
     *
     * @param userId Long 用户ID
     * @param event AgentEvent 事件
     */
    private void deliver(Long userId, AgentEvent event) {
        if (event == null) {
            return;
        }
        activityService.record(event);
        UserEventSink userEventSink = userSinks.get(userId);
        if (userEventSink != null) {
            userEventSink.sink().tryEmitNext(event);
        }
        if ("task-complete".equals(event.type()) || "canceled".equals(event.type()) || "error".equals(event.type())) {
            activityService.clear(event.sessionId());
        }
    }

    /**
     * 为当前运行会话补齐请求ID。
     *
     * @param event AgentEvent 原始事件
     * @return AgentEvent 带请求ID的事件
     */
    private AgentEvent enrichRequestId(AgentEvent event) {
        if (event == null || event.requestId() != null || event.sessionId() == null) {
            return event;
        }
        String requestId = requestIdsBySession.get(event.sessionId());
        return requestId == null ? event : event.withRequestId(requestId);
    }

    /**
     * 从Redis通道解析用户ID。
     *
     * @param channel String Redis通道名
     * @return Long 用户ID，无法解析时返回null
     */
    private Long parseChannelUserId(String channel) {
        try {
            int index = channel.lastIndexOf(':');
            return index < 0 ? null : Long.parseLong(channel.substring(index + 1));
        } catch (Exception exception) {
            return null;
        }
    }

    /**
     * 本地用户事件流及订阅数量。
     *
     * @param sink Sinks.Many<AgentEvent> 事件流
     * @param subscriberCount AtomicInteger 订阅数量
     */
    private record UserEventSink(Sinks.Many<AgentEvent> sink, AtomicInteger subscriberCount) {
    }
}
