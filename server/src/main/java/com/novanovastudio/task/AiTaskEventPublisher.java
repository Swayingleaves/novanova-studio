package com.novanovastudio.task;

import com.alibaba.fastjson2.JSON;
import com.novanovastudio.dto.AiTaskDtos;
import jakarta.annotation.PostConstruct;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.ReactiveStringRedisTemplate;
import org.springframework.data.redis.listener.PatternTopic;
import org.springframework.data.redis.listener.ReactiveRedisMessageListenerContainer;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.publisher.Sinks;

/**
 * @title        AiTaskEventPublisher.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  响应式AI任务事件发布器
 * @createTime   2026-06-24 18:40:00
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class AiTaskEventPublisher {

    /** 任务事件Redis通道前缀 */
    private static final String EVENT_CHANNEL_PREFIX = "novanova:ai-task:event:";

    /** 任务取消Redis键前缀 */
    private static final String CANCEL_KEY_PREFIX = "novanova:ai-task:cancel:";

    /** Redis模板 */
    private final ReactiveStringRedisTemplate redisTemplate;

    /** Redis消息监听容器 */
    private final ReactiveRedisMessageListenerContainer listenerContainer;

    /** 本地用户事件流 */
    private final Map<Long, UserEventSink> userSinks = new ConcurrentHashMap<>();

    /**
     * 初始化Redis事件订阅
     */
    @PostConstruct
    public void subscribeRedisEvents() {
        // 订阅所有用户AI任务事件，并转发到本实例内存事件流。
        listenerContainer.receive(new PatternTopic(EVENT_CHANNEL_PREFIX + "*"))
                .flatMap(message -> {
                    String channel = message.getChannel();
                    String payload = message.getMessage();
                    Long userId = parseChannelUserId(channel);
                    if (userId == null) {
                        return Mono.empty();
                    }
                    try {
                        AiTaskDtos.AiTaskEvent event = JSON.parseObject(payload, AiTaskDtos.AiTaskEvent.class);
                        UserEventSink sink = userSinks.get(userId);
                        if (sink != null) {
                            sink.sink().tryEmitNext(event);
                        }
                    } catch (Exception exception) {
                        log.error("解析AI任务Redis事件失败: channel={}", channel, exception);
                    }
                    return Mono.empty();
                })
                .onErrorContinue((throwable, ignored) -> log.error("订阅AI任务Redis事件失败", throwable))
                .subscribe();
    }

    /**
     * 订阅指定用户任务事件
     *
     * @param userId Long 用户ID
     * @return Flux<AiTaskEvent> 事件流
     */
    public Flux<AiTaskDtos.AiTaskEvent> subscribe(Long userId) {
        // 为当前用户创建或复用本地事件流，并在订阅建立时先发一个ping事件。
        UserEventSink sink = userSinks.computeIfAbsent(userId, ignored -> new UserEventSink(Sinks.many().multicast().directBestEffort(), new AtomicInteger()));
        return Flux.concat(
                Mono.just(new AiTaskDtos.AiTaskEvent("ping", null)),
                sink.sink().asFlux()
        )
                .doOnSubscribe(subscription -> {
                    int subscribers = sink.subscriberCount().incrementAndGet();
                    log.info("订阅AI任务事件: userId={}, subscribers={}", userId, subscribers);
                })
                .doFinally(signalType -> {
                    // 仅在最后一个订阅结束时回收当前用户的本地事件流，避免并发订阅互相影响。
                    int subscribers = sink.subscriberCount().decrementAndGet();
                    if (subscribers <= 0) {
                        userSinks.computeIfPresent(userId, (ignored, currentSink) -> currentSink == sink ? null : currentSink);
                    }
                    log.info("结束订阅AI任务事件: userId={}, signal={}, subscribers={}", userId, signalType, Math.max(subscribers, 0));
                });
    }

    /**
     * 发布任务事件
     *
     * @param userId Long 用户ID
     * @param event AiTaskEvent 任务事件
     * @return Mono<Void> 发布结果
     */
    public Mono<Void> publish(Long userId, AiTaskDtos.AiTaskEvent event) {
        // 只发布到Redis Pub/Sub，再由统一订阅链路转发到本地事件流，避免同实例重复推送。
        log.debug("发布AI任务事件: userId={}, event={}", userId, JSON.toJSONString(event));
        String payload = JSON.toJSONString(event);
        return redisTemplate.convertAndSend(EVENT_CHANNEL_PREFIX + userId, payload)
                .doOnError(exception -> log.error("发布AI任务Redis事件失败: userId={}", userId, exception))
                .onErrorResume(exception -> Mono.empty())
                .then();
    }

    /**
     * 标记任务取消请求
     *
     * @param taskId String 任务ID
     * @return Mono<Void> 标记结果
     */
    public Mono<Void> markCancelRequested(String taskId) {
        // 取消标记只保留短TTL，避免Redis长期堆积历史任务键。
        return redisTemplate.opsForValue().set(CANCEL_KEY_PREFIX + taskId, "1", Duration.ofHours(2)).then();
    }

    /**
     * 判断任务是否请求取消
     *
     * @param taskId String 任务ID
     * @return Mono<Boolean> 是否请求取消
     */
    public Mono<Boolean> isCancelRequested(String taskId) {
        // 异步执行线程通过该键判断是否应提前停止。
        return redisTemplate.hasKey(CANCEL_KEY_PREFIX + taskId).defaultIfEmpty(false);
    }

    /**
     * 解析通道中的用户ID
     *
     * @param channel String 通道名
     * @return Long 用户ID
     */
    private Long parseChannelUserId(String channel) {
        // 通道名固定为novanova:ai-task:event:{userId}格式。
        try {
            int index = channel.lastIndexOf(':');
            return index < 0 ? null : Long.parseLong(channel.substring(index + 1));
        } catch (Exception exception) {
            return null;
        }
    }

    /**
     * 用户事件流包装
     *
     * @param sink Sinks.Many<AiTaskEvent> 事件流
     * @param subscriberCount AtomicInteger 订阅数量
     */
    private record UserEventSink(Sinks.Many<AiTaskDtos.AiTaskEvent> sink, AtomicInteger subscriberCount) {
    }
}
