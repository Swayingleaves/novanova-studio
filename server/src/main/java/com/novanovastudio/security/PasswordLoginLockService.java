package com.novanovastudio.security;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.ReactiveStringRedisTemplate;
import org.springframework.data.redis.core.script.RedisScript;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * @title        PasswordLoginLockService.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  基于Redis的邮箱密码登录错误锁定服务
 * @createTime   2026-07-16 10:00:00
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class PasswordLoginLockService {

    /** Redis键前缀 */
    private static final String KEY_PREFIX = "novanova:security:password-lock:";

    /** 第五次密码错误锁定时长 */
    private static final Duration FIFTH_FAILURE_LOCK_DURATION = Duration.ofMinutes(5);

    /** 第六次密码错误锁定时长 */
    private static final Duration SIXTH_FAILURE_LOCK_DURATION = Duration.ofMinutes(10);

    /** 第七次密码错误锁定时长 */
    private static final Duration SEVENTH_FAILURE_LOCK_DURATION = Duration.ofHours(2);

    /** 原子记录密码错误并写入阶梯锁定的Redis脚本 */
    private static final RedisScript<Long> RECORD_FAILURE_SCRIPT = RedisScript.of("""
            local remainingLockMillis = redis.call('pttl', KEYS[2])
            if remainingLockMillis > 0 then
                return -remainingLockMillis
            end

            local failedAttempts = redis.call('incr', KEYS[1])
            if failedAttempts == 5 then
                redis.call('psetex', KEYS[2], ARGV[1], '1')
            elseif failedAttempts == 6 then
                redis.call('psetex', KEYS[2], ARGV[2], '1')
            elseif failedAttempts >= 7 then
                redis.call('psetex', KEYS[2], ARGV[3], '1')
                redis.call('pexpire', KEYS[1], ARGV[3])
            end
            return failedAttempts
            """, Long.class);

    /** Redis模板 */
    private final ReactiveStringRedisTemplate redisTemplate;

    /**
     * 查询用户当前剩余密码锁定时长。
     *
     * @param userId Long 用户ID
     * @return Mono<Duration> 仍被锁定时返回剩余时长，未锁定时为空
     */
    public Mono<Duration> remainingLockDuration(Long userId) {
        return redisTemplate.getExpire(lockKey(userId))
                .filter(Duration::isPositive)
                .onErrorMap(this::authenticationServiceException);
    }

    /**
     * 原子记录一次密码错误并返回本次锁定结果。
     *
     * @param userId Long 用户ID
     * @return Mono<PasswordFailureResult> 错误次数和锁定信息
     */
    public Mono<PasswordFailureResult> recordFailure(Long userId) {
        List<String> lockDurations = List.of(
                String.valueOf(FIFTH_FAILURE_LOCK_DURATION.toMillis()),
                String.valueOf(SIXTH_FAILURE_LOCK_DURATION.toMillis()),
                String.valueOf(SEVENTH_FAILURE_LOCK_DURATION.toMillis())
        );
        return redisTemplate.execute(RECORD_FAILURE_SCRIPT, List.of(attemptKey(userId), lockKey(userId)), lockDurations)
                .next()
                .switchIfEmpty(Mono.error(new IllegalStateException("Redis未返回密码错误计数")))
                .map(this::toPasswordFailureResult)
                .onErrorMap(this::authenticationServiceException);
    }

    /**
     * 清除用户的密码错误次数和锁定状态。
     *
     * @param userId Long 用户ID
     * @return Mono<Void> 清理完成信号
     */
    public Mono<Void> clear(Long userId) {
        return redisTemplate.delete(attemptKey(userId), lockKey(userId))
                .then()
                .onErrorMap(this::authenticationServiceException);
    }

    /**
     * 批量查询用户密码锁定截止时间。
     *
     * @param userIds List<Long> 用户ID列表
     * @return Mono<Map<Long, OffsetDateTime>> 已锁定用户对应的锁定截止时间
     */
    public Mono<Map<Long, OffsetDateTime>> lockedUntilByUserIds(List<Long> userIds) {
        if (userIds.isEmpty()) {
            return Mono.just(Map.of());
        }
        return Flux.fromIterable(userIds)
                .flatMap(userId -> remainingLockDuration(userId)
                        .map(duration -> Map.entry(userId, OffsetDateTime.now(ZoneOffset.UTC).plus(duration))))
                .collectMap(Map.Entry::getKey, Map.Entry::getValue);
    }

    /**
     * 构建用户密码错误次数键。
     *
     * @param userId Long 用户ID
     * @return String Redis键
     */
    private String attemptKey(Long userId) {
        return KEY_PREFIX + "attempt:" + userId;
    }

    /**
     * 构建用户密码锁定键。
     *
     * @param userId Long 用户ID
     * @return String Redis键
     */
    private String lockKey(Long userId) {
        return KEY_PREFIX + "lock:" + userId;
    }

    /**
     * 将Lua脚本结果转换为密码错误结果。
     *
     * @param scriptResult Long Lua脚本返回值
     * @return PasswordFailureResult 密码错误结果
     */
    private PasswordFailureResult toPasswordFailureResult(Long scriptResult) {
        if (scriptResult == null) {
            throw new IllegalStateException("Redis返回的密码错误计数为空");
        }
        if (scriptResult < 0) {
            return new PasswordFailureResult(0, Duration.ofMillis(-scriptResult), false);
        }
        return new PasswordFailureResult(scriptResult.intValue(), lockDuration(scriptResult.intValue()), scriptResult >= 5);
    }

    /**
     * 获取指定密码错误次数对应的锁定时长。
     *
     * @param failedAttempts int 密码错误次数
     * @return Duration 锁定时长，未触发锁定时为零
     */
    private Duration lockDuration(int failedAttempts) {
        return switch (failedAttempts) {
            case 5 -> FIFTH_FAILURE_LOCK_DURATION;
            case 6 -> SIXTH_FAILURE_LOCK_DURATION;
            default -> failedAttempts >= 7 ? SEVENTH_FAILURE_LOCK_DURATION : Duration.ZERO;
        };
    }

    /**
     * 转换认证Redis服务异常。
     *
     * @param exception Throwable 原始异常
     * @return Throwable 认证业务异常
     */
    private Throwable authenticationServiceException(Throwable exception) {
        if (exception instanceof BusinessException) {
            return exception;
        }
        log.error("密码登录锁定Redis服务异常", exception);
        return new BusinessException(ErrorCode.BUSINESS_ERROR, "认证服务暂不可用，请稍后再试");
    }

    /**
     * 密码错误处理结果。
     *
     * @param failedAttempts int 本次记录后的连续错误次数
     * @param lockDuration Duration 本次或当前锁定的剩余时长
     * @param newlyLocked boolean 是否由本次错误触发锁定
     */
    public record PasswordFailureResult(int failedAttempts, Duration lockDuration, boolean newlyLocked) {
    }
}
