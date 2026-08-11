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
 * 画布视频合成任务的Redis FIFO队列。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-08-11 00:00
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class VideoCompositionTaskQueue {

    /** 队列分区标识 */
    private static final String QUEUE_PARTITION = "global";

    /** Redis键前缀 */
    private static final String QUEUE_KEY_PREFIX = "novanova:video-composition:queue:";

    /** 等待任务键后缀 */
    private static final String PENDING_KEY_SUFFIX = ":pending";

    /** 已入队任务集合键后缀 */
    private static final String QUEUED_KEY_SUFFIX = ":queued";

    /** 活动任务租约键后缀 */
    private static final String ACTIVE_KEY_SUFFIX = ":active";

    /** 并发数键后缀 */
    private static final String CONCURRENCY_KEY_SUFFIX = ":concurrency";

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

    /** 原子领取可执行任务脚本 */
    private static final RedisScript<String> CLAIM_SCRIPT = RedisScript.of("""
            local time = redis.call('TIME')
            local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
            redis.call('zremrangebyscore', KEYS[3], '-inf', now)
            local concurrency = tonumber(redis.call('get', KEYS[4]))
            if not concurrency or concurrency < 1 then
                return nil
            end
            if redis.call('zcard', KEYS[3]) >= concurrency then
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

    /** 活动任务续约脚本 */
    private static final RedisScript<Long> RENEW_SCRIPT = RedisScript.of("""
            local time = redis.call('TIME')
            local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
            if redis.call('zscore', KEYS[1], ARGV[1]) then
                redis.call('zadd', KEYS[1], now + tonumber(ARGV[2]), ARGV[1])
                return 1
            end
            return 0
            """, Long.class);

    /** 查询活动任务租约脚本 */
    private static final RedisScript<Long> HAS_ACTIVE_SCRIPT = RedisScript.of("""
            local time = redis.call('TIME')
            local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
            redis.call('zremrangebyscore', KEYS[1], '-inf', now)
            if redis.call('zscore', KEYS[1], ARGV[1]) then
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
     * 将任务写入FIFO等待队列。
     *
     * @param taskId String 视频合成任务ID
     * @return Mono<Void> 入队结果
     */
    public Mono<Void> enqueue(String taskId) {
        return redisTemplate.execute(ENQUEUE_SCRIPT, queueKeys(), List.of(taskId))
                .next()
                .doOnNext(added -> {
                    if (added != null && added > 0) {
                        log.info("视频合成任务已入队: taskId={}", taskId);
                    }
                })
                .then();
    }

    /**
     * 更新合成任务并发数。
     *
     * @param concurrency int 同时执行任务数量
     * @return Mono<Void> 更新结果
     */
    public Mono<Void> updateConcurrency(int concurrency) {
        if (concurrency < 1) {
            return Mono.error(new IllegalArgumentException("视频合成任务并发数必须大于0"));
        }
        return redisTemplate.opsForValue().set(concurrencyKey(), String.valueOf(concurrency)).then();
    }

    /**
     * 领取全部当前可执行任务。
     *
     * @return Flux<String> 已领取任务ID流
     */
    public Flux<String> claimAvailable() {
        return claimNext().expand(ignored -> claimNext());
    }

    /**
     * 续约活动任务。
     *
     * @param taskId String 任务ID
     * @return Mono<Boolean> 是否续约成功
     */
    public Mono<Boolean> renewActiveTask(String taskId) {
        return redisTemplate.execute(RENEW_SCRIPT, List.of(activeTaskKey()), List.of(taskId, activeLeaseMilliseconds()))
                .next()
                .map(result -> result != null && result > 0)
                .defaultIfEmpty(false);
    }

    /**
     * 判断任务是否仍由某个实例持有活动租约。
     *
     * @param taskId String 任务ID
     * @return Mono<Boolean> true表示任务仍在执行，false表示可以恢复排队
     */
    public Mono<Boolean> hasActiveTask(String taskId) {
        return redisTemplate.execute(HAS_ACTIVE_SCRIPT, List.of(activeTaskKey()), List.of(taskId))
                .next()
                .map(result -> result != null && result > 0)
                .defaultIfEmpty(false);
    }

    /**
     * 释放活动任务名额。
     *
     * @param taskId String 任务ID
     * @return Mono<Void> 释放结果
     */
    public Mono<Void> releaseActiveTask(String taskId) {
        return redisTemplate.execute(RELEASE_SCRIPT, List.of(activeTaskKey()), List.of(taskId))
                .next()
                .doOnNext(released -> log.info("释放视频合成任务名额: taskId={}, released={}", taskId, released))
                .then();
    }

    /**
     * 构造等待队列Redis键。
     *
     * @return String 等待队列键
     */
    static String pendingQueueKey() {
        return queueKeyPrefix() + PENDING_KEY_SUFFIX;
    }

    /**
     * 构造已入队任务集合Redis键。
     *
     * @return String 已入队任务集合键
     */
    static String queuedTaskKey() {
        return queueKeyPrefix() + QUEUED_KEY_SUFFIX;
    }

    /**
     * 构造活动任务租约Redis键。
     *
     * @return String 活动任务租约键
     */
    static String activeTaskKey() {
        return queueKeyPrefix() + ACTIVE_KEY_SUFFIX;
    }

    /**
     * 构造并发数Redis键。
     *
     * @return String 并发数键
     */
    static String concurrencyKey() {
        return queueKeyPrefix() + CONCURRENCY_KEY_SUFFIX;
    }

    /**
     * 领取一个可执行任务。
     *
     * @return Mono<String> 已领取任务ID，无可执行任务时为空
     */
    private Mono<String> claimNext() {
        return redisTemplate.execute(CLAIM_SCRIPT, queueKeys(), List.of(activeLeaseMilliseconds()))
                .next()
                .filter(StringUtils::hasText);
    }

    /**
     * 获取Redis Lua脚本需要访问的全部键。
     *
     * @return List<String> 队列键列表
     */
    private List<String> queueKeys() {
        return List.of(pendingQueueKey(), queuedTaskKey(), activeTaskKey(), concurrencyKey());
    }

    /**
     * 获取活动任务租约毫秒数。
     *
     * @return String 租约毫秒数
     */
    private String activeLeaseMilliseconds() {
        int seconds = Math.max(1, properties.getAi().getVideoComposition().getActiveLeaseSeconds());
        return String.valueOf(Duration.ofSeconds(seconds).toMillis());
    }

    /**
     * 构造带Redis Cluster哈希标签的键前缀。
     *
     * @return String 队列键公共前缀
     */
    private static String queueKeyPrefix() {
        return QUEUE_KEY_PREFIX + "{" + QUEUE_PARTITION + "}";
    }
}
