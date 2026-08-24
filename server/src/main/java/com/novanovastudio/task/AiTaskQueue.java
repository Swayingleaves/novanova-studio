package com.novanovastudio.task;

import com.novanovastudio.config.NovanovaProperties;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Range;
import org.springframework.data.redis.connection.stream.Consumer;
import org.springframework.data.redis.connection.stream.MapRecord;
import org.springframework.data.redis.connection.stream.PendingMessage;
import org.springframework.data.redis.connection.stream.ReadOffset;
import org.springframework.data.redis.connection.stream.RecordId;
import org.springframework.data.redis.connection.stream.StreamOffset;
import org.springframework.data.redis.connection.stream.StreamReadOptions;
import org.springframework.data.redis.core.ReactiveStringRedisTemplate;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * @title        AiTaskQueue.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  Redis Stream AI任务队列
 * @createTime   2026-06-29 10:58:00
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class AiTaskQueue {

    /** 任务ID字段名 */
    private static final String FIELD_TASK_ID = "taskId";

    /** Redis模板 */
    private final ReactiveStringRedisTemplate redisTemplate;

    /** 服务配置 */
    private final NovanovaProperties properties;

    /** 消费组是否已确认存在 */
    private final AtomicBoolean consumerGroupReady = new AtomicBoolean(false);

    /**
     * 将任务写入队列。
     *
     * @param taskId String 任务ID
     * @return Mono<Void> 入队结果
     */
    public Mono<Void> enqueue(String taskId) {
        // 任务队列只保存任务ID，执行时以数据库任务快照为准。
        return ensureConsumerGroup()
                .then(redisTemplate.opsForStream()
                .add(streamKey(), Map.of(FIELD_TASK_ID, taskId))
                .doOnSuccess(recordId -> log.info("AI任务已入队: taskId={}, recordId={}", taskId, recordId))
                .then());
    }

    /**
     * 创建消费组。
     *
     * @return Mono<Void> 创建结果
     */
    public Mono<Void> ensureConsumerGroup() {
        if (consumerGroupReady.get()) {
            return Mono.empty();
        }
        // 从最新消息开始建组；启动恢复会把未完成任务重新入队。
        return redisTemplate.opsForStream()
                .createGroup(streamKey(), ReadOffset.latest(), consumerGroup())
                .doOnSuccess(result -> {
                    consumerGroupReady.set(true);
                    log.info("AI任务消费组已创建: streamKey={}, group={}", streamKey(), consumerGroup());
                })
                .onErrorResume(exception -> {
                    if (isConsumerGroupExistsException(exception)) {
                        consumerGroupReady.set(true);
                        log.info("AI任务消费组已存在: streamKey={}, group={}", streamKey(), consumerGroup());
                        return Mono.empty();
                    }
                    log.error("创建AI任务消费组失败: streamKey={}, group={}", streamKey(), consumerGroup(), exception);
                    return Mono.error(exception);
                })
                .then();
    }

    /**
     * 判断异常是否为消费组已存在。
     *
     * @param exception Throwable 异常
     * @return boolean 是否为消费组已存在
     */
    static boolean isConsumerGroupExistsException(Throwable exception) {
        // Lettuce原始BUSYGROUP异常会被Spring包装，需要沿cause链递归识别。
        return hasCauseMessage(exception, "BUSYGROUP");
    }

    /**
     * 判断异常是否为消费组或Stream丢失（NOGROUP）。
     *
     * @param exception Throwable 异常
     * @return boolean 是否为NOGROUP
     */
    static boolean isNoGroupException(Throwable exception) {
        return hasCauseMessage(exception, "NOGROUP");
    }

    /**
     * 沿cause链匹配异常消息关键字。
     *
     * @param exception Throwable 异常
     * @param keyword String 关键字
     * @return boolean 是否命中
     */
    private static boolean hasCauseMessage(Throwable exception, String keyword) {
        Throwable current = exception;
        while (current != null) {
            String message = current.getMessage();
            if (message != null && message.contains(keyword)) {
                return true;
            }
            current = current.getCause();
        }
        return false;
    }

    /**
     * 消费组或Stream丢失（Redis重启/清库）后重建，供读取流程自愈。
     *
     * @return Mono<Void> 重建完成信号
     */
    private Mono<Void> recreateConsumerGroup() {
        log.warn("AI任务消费组丢失，尝试重建: streamKey={}, group={}", streamKey(), consumerGroup());
        consumerGroupReady.set(false);
        return ensureConsumerGroup();
    }

    /**
     * 读取新队列消息。
     *
     * @param consumerName String 消费者名称
     * @return Flux<AiTaskQueueMessage> 队列消息
     */
    public Flux<AiTaskQueueMessage> readNewMessages(String consumerName) {
        // XREADGROUP 使用lastConsumed读取尚未投递给消费组的新消息。
        StreamReadOptions options = StreamReadOptions.empty()
                .count(properties.getAi().getTask().getReadBatchSize())
                .block(Duration.ofSeconds(properties.getAi().getTask().getReadBlockSeconds()));
        return redisTemplate.opsForStream()
                .read(Consumer.from(consumerGroup(), consumerName), options, StreamOffset.create(streamKey(), ReadOffset.lastConsumed()))
                .map(this::toMessage)
                .filter(message -> message.taskId() != null && !message.taskId().isBlank())
                // Stream或消费组丢失时重建后交由外层repeat重读，避免无限NOGROUP
                .onErrorResume(exception -> isNoGroupException(exception)
                        ? recreateConsumerGroup().then(Mono.delay(Duration.ofSeconds(1))).thenMany(Flux.empty())
                        : Flux.error(exception));
    }

    /**
     * 重新认领长期未确认消息。
     *
     * @param consumerName String 消费者名称
     * @return Flux<AiTaskQueueMessage> 重新认领的消息
     */
    public Flux<AiTaskQueueMessage> claimIdleMessages(String consumerName) {
        // 先读取pending明细，再用XCLAIM转移给当前消费者。
        Duration idleTime = Duration.ofSeconds(properties.getAi().getTask().getPendingClaimIdleSeconds());
        return redisTemplate.opsForStream()
                .pending(streamKey(), consumerGroup(), Range.unbounded(), properties.getAi().getTask().getReadBatchSize())
                .flatMapMany(pendingMessages -> Flux.fromIterable(pendingMessages)
                        .filter(message -> message.getElapsedTimeSinceLastDelivery().compareTo(idleTime) >= 0)
                        .map(PendingMessage::getId))
                .collectList()
                .flatMapMany(recordIds -> {
                    if (recordIds.isEmpty()) {
                        return Flux.empty();
                    }
                    return redisTemplate.opsForStream()
                            .claim(streamKey(), consumerGroup(), consumerName, idleTime, recordIds.toArray(RecordId[]::new))
                            .map(this::toMessage)
                            .filter(message -> message.taskId() != null && !message.taskId().isBlank());
                })
                // 消费组丢失时重建，pending明细已随之丢失，本轮直接跳过
                .onErrorResume(exception -> isNoGroupException(exception)
                        ? recreateConsumerGroup().thenMany(Flux.empty())
                        : Flux.error(exception));
    }

    /**
     * 确认队列消息。
     *
     * @param message AiTaskQueueMessage 队列消息
     * @return Mono<Void> 确认结果
     */
    public Mono<Void> acknowledge(AiTaskQueueMessage message) {
        // 消息确认只代表当前Stream记录处理完成，不代表任务一定成功。
        return redisTemplate.opsForStream()
                .acknowledge(streamKey(), consumerGroup(), RecordId.of(message.recordId()))
                .doOnSuccess(count -> log.info("确认AI任务队列消息: taskId={}, recordId={}, count={}", message.taskId(), message.recordId(), count))
                .then();
    }

    /**
     * 转换Redis Stream记录。
     *
     * @param record MapRecord<String, Object, Object> Stream记录
     * @return AiTaskQueueMessage 队列消息
     */
    private AiTaskQueueMessage toMessage(MapRecord<String, Object, Object> record) {
        Object taskId = record.getValue().get(FIELD_TASK_ID);
        return new AiTaskQueueMessage(record.getId().getValue(), taskId == null ? "" : String.valueOf(taskId));
    }

    /**
     * 获取Stream键。
     *
     * @return String Stream键
     */
    private String streamKey() {
        return properties.getAi().getTask().getStreamKey();
    }

    /**
     * 获取消费组名称。
     *
     * @return String 消费组名称
     */
    private String consumerGroup() {
        return properties.getAi().getTask().getConsumerGroup();
    }
}
