package com.novanovastudio.task;

import com.novanovastudio.repository.ScriptSourceRepository;
import com.novanovastudio.service.ScriptSourceService;
import jakarta.annotation.PreDestroy;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.event.EventListener;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.data.domain.Range;
import org.springframework.data.redis.connection.RedisStreamCommands;
import org.springframework.data.redis.connection.stream.Consumer;
import org.springframework.data.redis.connection.stream.PendingMessage;
import org.springframework.data.redis.connection.stream.ReadOffset;
import org.springframework.data.redis.connection.stream.RecordId;
import org.springframework.data.redis.connection.stream.StreamOffset;
import org.springframework.data.redis.connection.stream.StreamReadOptions;
import org.springframework.data.redis.core.ReactiveStringRedisTemplate;
import org.springframework.stereotype.Component;
import org.springframework.beans.factory.ObjectProvider;
import reactor.core.Disposable;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 复用项目Redis Stream消费模式的原文导入队列。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-09-26 00:00
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class ScriptSourceImportQueue {
    /** 原文导入消息流。 */
    private static final String STREAM = "novanova:script-source:import";
    /** 消费组。 */
    private static final String GROUP = "script-source-importers";
    /** Redis客户端。 */
    private final ReactiveStringRedisTemplate redisTemplate;
    /** 导入仓储。 */
    private final ScriptSourceRepository repository;
    /** 导入服务。 */
    private final ObjectProvider<ScriptSourceService> serviceProvider;
    /** 消费订阅。 */
    private Disposable subscription;
    /** 回收订阅。 */
    private Disposable recoverySubscription;
    /** 任务执行器。 */
    private ExecutorService executor;

    /**
     * 将数据库任务标识写入消息流。
     * @param taskId String 任务标识
     * @return Mono<Void> 入队结果
     */
    public Mono<Void> enqueue(String taskId) {
        // 消息只是唤醒信号，数据库才是任务真相，因此近似裁剪消息流防止无限增长。
        return redisTemplate.opsForStream().add(STREAM, Map.of("taskId", taskId),
                RedisStreamCommands.XAddOptions.maxlen(10_000).approximateTrimming(true)).then();
    }

    /**
     * 应用就绪后恢复数据库任务并启动消费者。
     */
    @EventListener(ApplicationReadyEvent.class)
    public void start() {
        executor = Executors.newVirtualThreadPerTaskExecutor();
        String consumer = "source-" + UUID.randomUUID();
        // 多实例部署时不能在启动时直接重置执行中任务，只重投等待中与租约已过期的任务。
        Mono<Void> ready = ensureGroup().cache();
        ready.thenMany(repository.recoverableTaskIds().concatMap(this::enqueue))
                .then().subscribe(ignored -> { }, error -> log.error("恢复原文导入任务失败", error));
        subscription = ready.thenMany(Flux.interval(Duration.ofSeconds(1)))
                .flatMap(ignored -> read(consumer).onErrorResume(error -> {
                    log.error("读取原文导入消息失败", error);
                    return Flux.empty();
                })).subscribe(message -> executor.submit(() -> handle(message)));
        recoverySubscription = Flux.interval(Duration.ofMinutes(1))
                .flatMap(ignored -> repository.recoverableTaskIds().concatMap(this::enqueue).onErrorResume(error -> {
                    log.error("补发原文导入任务失败", error);
                    return Mono.empty();
                })).subscribe();
    }

    /**
     * 停止任务执行器。
     */
    @PreDestroy
    public void stop() {
        if (subscription != null) subscription.dispose();
        if (recoverySubscription != null) recoverySubscription.dispose();
        if (executor != null) executor.shutdownNow();
    }

    /**
     * 创建消息消费组。
     * @return Mono<Void> 创建结果
     */
    private Mono<Void> ensureGroup() {
        return redisTemplate.opsForStream().createGroup(STREAM, ReadOffset.latest(), GROUP)
                .onErrorResume(error -> AiTaskQueue.isConsumerGroupExistsException(error) ? Mono.empty() : Mono.error(error)).then();
    }

    /**
     * 读取新消息与空闲待确认消息。
     * @param consumer String 消费者名称
     * @return Flux<Message> 消息流
     */
    private Flux<Message> read(String consumer) {
        Flux<Message> fresh = redisTemplate.opsForStream().read(Consumer.from(GROUP, consumer),
                StreamReadOptions.empty().count(4).block(Duration.ofSeconds(1)), StreamOffset.create(STREAM, ReadOffset.lastConsumed()))
                .map(record -> new Message(record.getId(), String.valueOf(record.getValue().get("taskId"))));
        Flux<Message> stale = redisTemplate.opsForStream().pending(STREAM, GROUP, Range.unbounded(), 10)
                .flatMapMany(pendingMessages -> Flux.fromIterable(pendingMessages)
                        .filter(message -> message.getElapsedTimeSinceLastDelivery().compareTo(Duration.ofMinutes(2)) >= 0)
                        .map(PendingMessage::getId))
                .collectList()
                .flatMapMany(recordIds -> {
                    if (recordIds.isEmpty()) {
                        return Flux.empty();
                    }
                    return redisTemplate.opsForStream()
                            .claim(STREAM, GROUP, consumer, Duration.ofMinutes(2), recordIds.toArray(RecordId[]::new))
                            .map(record -> new Message(record.getId(), String.valueOf(record.getValue().get("taskId"))));
                });
        return Flux.merge(fresh, stale);
    }

    /**
     * 执行并确认一个队列消息。
     * @param message Message 队列消息
     */
    private void handle(Message message) {
        try {
            serviceProvider.getObject().process(message.taskId()).block();
            redisTemplate.opsForStream().acknowledge(STREAM, GROUP, message.id()).block();
        } catch (Exception error) {
            log.error("原文导入消息处理失败: taskId={}", message.taskId(), error);
        }
    }

    /** 消息内容。 */
    private record Message(RecordId id, String taskId) { }
}
