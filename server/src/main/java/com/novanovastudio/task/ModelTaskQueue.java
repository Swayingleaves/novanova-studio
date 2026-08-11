package com.novanovastudio.task;

import com.novanovastudio.config.NovanovaProperties;
import java.time.Duration;
import java.util.List;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.ReactiveStringRedisTemplate;
import org.springframework.data.redis.core.script.RedisScript;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * @title        ModelTaskQueue.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  按模型限制并发的Redis任务队列
 * @createTime   2026-08-10 00:00:00
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class ModelTaskQueue {

    /** 模型队列键前缀 */
    private static final String QUEUE_KEY_PREFIX = "novanova:ai-task:model-queue:";

    /** 等待任务键后缀 */
    private static final String PENDING_KEY_SUFFIX = ":pending";

    /** 已入队任务键后缀 */
    private static final String QUEUED_KEY_SUFFIX = ":queued";

    /** 活动任务键后缀 */
    private static final String ACTIVE_KEY_SUFFIX = ":active";

    /** 模型同时并发数键后缀 */
    private static final String REQUEST_CONCURRENCY_KEY_SUFFIX = ":request-concurrency";

    /** 写入等待队列脚本 */
    private static final RedisScript<Long> ENQUEUE_SCRIPT = RedisScript.of("""
            local time = redis.call('TIME')
            local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
            redis.call('zremrangebyscore', KEYS[3], '-inf', now)
            if redis.call('zscore', KEYS[3], ARGV[1]) then
                return 0
            end
            if redis.call('sadd', KEYS[2], ARGV[1]) == 1 then
                redis.call('rpush', KEYS[1], ARGV[1])
                return 1
            end
            return 0
            """, Long.class);

    /** 领取一个可执行任务脚本 */
    private static final RedisScript<String> CLAIM_SCRIPT = RedisScript.of("""
            local time = redis.call('TIME')
            local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
            redis.call('zremrangebyscore', KEYS[3], '-inf', now)
            local requestConcurrency = tonumber(redis.call('get', KEYS[4]))
            if not requestConcurrency or requestConcurrency < 1 then
                return nil
            end
            if redis.call('zcard', KEYS[3]) >= requestConcurrency then
                return nil
            end
            local taskId = redis.call('lpop', KEYS[1])
            if not taskId then
                return nil
            end
            redis.call('srem', KEYS[2], taskId)
            redis.call('zadd', KEYS[3], now + tonumber(ARGV[1]), taskId)
            return taskId
            """, String.class);

    /** 续约活动任务脚本 */
    private static final RedisScript<Long> RENEW_SCRIPT = RedisScript.of("""
            local time = redis.call('TIME')
            local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
            if redis.call('zscore', KEYS[1], ARGV[1]) then
                redis.call('zadd', KEYS[1], now + tonumber(ARGV[2]), ARGV[1])
                return 1
            end
            return 0
            """, Long.class);

    /** 释放活动任务脚本 */
    private static final RedisScript<Long> RELEASE_SCRIPT = RedisScript.of("return redis.call('zrem', KEYS[1], ARGV[1])", Long.class);

    /** Redis模板 */
    private final ReactiveStringRedisTemplate redisTemplate;

    /** 服务配置 */
    private final NovanovaProperties properties;

    /**
     * 将任务写入指定模型的等待队列。
     *
     * @param modelConfigId String 模型配置ID
     * @param taskId String 任务ID
     * @return Mono<Void> 入队结果
     */
    public Mono<Void> enqueue(String modelConfigId, String taskId) {
        return redisTemplate.execute(ENQUEUE_SCRIPT, queueKeys(modelConfigId), List.of(taskId))
                .next()
                .doOnNext(added -> {
                    if (added != null && added > 0) {
                        log.info("模型任务已入队: modelConfigId={}, taskId={}", modelConfigId, taskId);
                    }
                })
                .then();
    }

    /**
     * 初始化模型同时并发数。
     *
     * @param modelConfigId String 模型配置ID
     * @param requestConcurrency int 模型同时并发数
     * @return Mono<Void> 初始化结果
     */
    public Mono<Void> initializeRequestConcurrency(String modelConfigId, int requestConcurrency) {
        if (requestConcurrency < 1) {
            return Mono.error(new IllegalArgumentException("模型同时并发数必须大于0"));
        }
        return redisTemplate.opsForValue()
                .setIfAbsent(requestConcurrencyKey(modelConfigId), String.valueOf(requestConcurrency))
                .then();
    }

    /**
     * 更新模型同时并发数。
     *
     * @param modelConfigId String 模型配置ID
     * @param requestConcurrency int 模型同时并发数
     * @return Mono<Void> 更新结果
     */
    public Mono<Void> updateRequestConcurrency(String modelConfigId, int requestConcurrency) {
        if (requestConcurrency < 1) {
            return Mono.error(new IllegalArgumentException("模型同时并发数必须大于0"));
        }
        return redisTemplate.opsForValue()
                .set(requestConcurrencyKey(modelConfigId), String.valueOf(requestConcurrency))
                .then();
    }

    /**
     * 领取当前模型所有可执行任务。
     *
     * @param modelConfigId String 模型配置ID
     * @return Flux<String> 已领取任务ID流
     */
    public Flux<String> claimAvailable(String modelConfigId) {
        return claimNext(modelConfigId)
                .expand(ignored -> claimNext(modelConfigId));
    }

    /**
     * 续约模型活动任务。
     *
     * @param modelConfigId String 模型配置ID
     * @param taskId String 任务ID
     * @return Mono<Boolean> 是否续约成功
     */
    public Mono<Boolean> renewActiveTask(String modelConfigId, String taskId) {
        return redisTemplate.execute(RENEW_SCRIPT, List.of(activeTaskKey(modelConfigId)), List.of(taskId, activeLeaseMillis()))
                .next()
                .map(result -> result != null && result > 0)
                .defaultIfEmpty(false);
    }

    /**
     * 释放模型活动任务名额。
     *
     * @param modelConfigId String 模型配置ID
     * @param taskId String 任务ID
     * @return Mono<Void> 释放结果
     */
    public Mono<Void> releaseActiveTask(String modelConfigId, String taskId) {
        return redisTemplate.execute(RELEASE_SCRIPT, List.of(activeTaskKey(modelConfigId)), List.of(taskId))
                .next()
                .doOnNext(released -> log.info("释放模型任务名额: modelConfigId={}, taskId={}, released={}", modelConfigId, taskId, released))
                .then();
    }

    /**
     * 构造模型等待队列键。
     *
     * @param modelConfigId String 模型配置ID
     * @return String Redis等待队列键
     */
    static String pendingQueueKey(String modelConfigId) {
        return queueKeyPrefix(modelConfigId) + PENDING_KEY_SUFFIX;
    }

    /**
     * 构造模型已入队任务集合键。
     *
     * @param modelConfigId String 模型配置ID
     * @return String Redis已入队任务集合键
     */
    static String queuedTaskKey(String modelConfigId) {
        return queueKeyPrefix(modelConfigId) + QUEUED_KEY_SUFFIX;
    }

    /**
     * 构造模型活动任务集合键。
     *
     * @param modelConfigId String 模型配置ID
     * @return String Redis活动任务集合键
     */
    static String activeTaskKey(String modelConfigId) {
        return queueKeyPrefix(modelConfigId) + ACTIVE_KEY_SUFFIX;
    }

    /**
     * 构造模型同时并发数键。
     *
     * @param modelConfigId String 模型配置ID
     * @return String Redis模型同时并发数键
     */
    static String requestConcurrencyKey(String modelConfigId) {
        return queueKeyPrefix(modelConfigId) + REQUEST_CONCURRENCY_KEY_SUFFIX;
    }

    /**
     * 领取一个可执行任务。
     *
     * @param modelConfigId String 模型配置ID
     * @return Mono<String> 已领取任务ID，无可执行任务时为空
     */
    private Mono<String> claimNext(String modelConfigId) {
        return redisTemplate.execute(CLAIM_SCRIPT, queueKeys(modelConfigId), List.of(activeLeaseMillis()))
                .next()
                .filter(StringUtils::hasText);
    }

    /**
     * 组装单个模型的Redis键。
     *
     * @param modelConfigId String 模型配置ID
     * @return List<String> 等待、已入队、活动任务和并发配置键
     */
    private List<String> queueKeys(String modelConfigId) {
        return List.of(pendingQueueKey(modelConfigId), queuedTaskKey(modelConfigId), activeTaskKey(modelConfigId), requestConcurrencyKey(modelConfigId));
    }

    /**
     * 获取活动任务租约时长毫秒数。
     *
     * @return String Redis脚本使用的租约时长毫秒数
     */
    private String activeLeaseMillis() {
        return String.valueOf(Duration.ofSeconds(properties.getAi().getTask().getLockTtlSeconds()).toMillis());
    }

    /**
     * 构造模型队列键公共前缀。
     *
     * @param modelConfigId String 模型配置ID
     * @return String Redis键前缀
     */
    private static String queueKeyPrefix(String modelConfigId) {
        // Redis Cluster 的 Lua 脚本要求同一脚本访问的键位于同一哈希槽。
        return QUEUE_KEY_PREFIX + "{" + modelConfigId + "}";
    }
}
