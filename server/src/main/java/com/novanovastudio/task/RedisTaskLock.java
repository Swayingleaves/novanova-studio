package com.novanovastudio.task;

import com.novanovastudio.config.NovanovaProperties;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.ReactiveStringRedisTemplate;
import org.springframework.data.redis.core.script.RedisScript;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Mono;

/**
 * @title        RedisTaskLock.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  Redis任务分布式锁
 * @createTime   2026-06-29 11:02:00
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class RedisTaskLock {

    /** 任务锁键前缀 */
    private static final String LOCK_KEY_PREFIX = "novanova:ai-task:lock:";

    /** 续期脚本 */
    private static final RedisScript<Long> RENEW_SCRIPT = RedisScript.of("""
            if redis.call('get', KEYS[1]) == ARGV[1] then
                return redis.call('pexpire', KEYS[1], ARGV[2])
            end
            return 0
            """, Long.class);

    /** 释放脚本 */
    private static final RedisScript<Long> RELEASE_SCRIPT = RedisScript.of("""
            if redis.call('get', KEYS[1]) == ARGV[1] then
                return redis.call('del', KEYS[1])
            end
            return 0
            """, Long.class);

    /** Redis模板 */
    private final ReactiveStringRedisTemplate redisTemplate;

    /** 服务配置 */
    private final NovanovaProperties properties;

    /**
     * 创建任务锁键。
     *
     * @param taskId String 任务ID
     * @return String 任务锁键
     */
    public static String lockKey(String taskId) {
        return LOCK_KEY_PREFIX + taskId;
    }

    /**
     * 创建锁值。
     *
     * @param consumerName String 消费者名称
     * @return String 锁值
     */
    public String newLockValue(String consumerName) {
        return consumerName + ":" + UUID.randomUUID();
    }

    /**
     * 尝试获取任务锁。
     *
     * @param taskId String 任务ID
     * @param lockValue String 锁值
     * @return Mono<Boolean> 是否获取成功
     */
    public Mono<Boolean> tryLock(String taskId, String lockValue) {
        // SET NX PX保证跨实例只有一个消费者能执行同一任务。
        return redisTemplate.opsForValue()
                .setIfAbsent(lockKey(taskId), lockValue, Duration.ofSeconds(properties.getAi().getTask().getLockTtlSeconds()))
                .defaultIfEmpty(false);
    }

    /**
     * 续期任务锁。
     *
     * @param taskId String 任务ID
     * @param lockValue String 锁值
     * @return Mono<Boolean> 是否续期成功
     */
    public Mono<Boolean> renew(String taskId, String lockValue) {
        // 续期前校验锁值，避免续期其他实例的新锁。
        String ttlMillis = String.valueOf(Duration.ofSeconds(properties.getAi().getTask().getLockTtlSeconds()).toMillis());
        return redisTemplate.execute(RENEW_SCRIPT, List.of(lockKey(taskId)), List.of(lockValue, ttlMillis))
                .next()
                .map(count -> count != null && count > 0)
                .defaultIfEmpty(false);
    }

    /**
     * 释放任务锁。
     *
     * @param taskId String 任务ID
     * @param lockValue String 锁值
     * @return Mono<Void> 释放结果
     */
    public Mono<Void> release(String taskId, String lockValue) {
        // 释放前校验锁值，避免删除其他实例持有的新锁。
        return redisTemplate.execute(RELEASE_SCRIPT, List.of(lockKey(taskId)), List.of(lockValue))
                .next()
                .doOnNext(count -> log.info("释放AI任务锁: taskId={}, released={}", taskId, count))
                .then();
    }
}
