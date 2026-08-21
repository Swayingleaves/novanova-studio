package com.novanovastudio.agent;

import com.novanovastudio.config.NovanovaProperties;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.ReactiveStringRedisTemplate;
import org.springframework.data.redis.core.ScanOptions;
import org.springframework.data.redis.core.script.RedisScript;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 按用户和入口来源分区的统一主Agent Redis FIFO队列。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-08-13 00:00
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class CreationAgentRequestQueue {

    /** Redis键前缀 */
    private static final String QUEUE_KEY_PREFIX = "novanova:creation-agent:queue:";

    /** 等待队列键后缀 */
    private static final String PENDING_KEY_SUFFIX = ":pending";

    /** 已入队请求集合键后缀 */
    private static final String QUEUED_KEY_SUFFIX = ":queued";

    /** 活动请求租约键后缀 */
    private static final String ACTIVE_KEY_SUFFIX = ":active";

    /** 过期请求恢复租约键后缀 */
    private static final String RECOVERY_KEY_SUFFIX = ":recovery-lock";

    /** 取消标记键前缀 */
    private static final String CANCEL_KEY_PREFIX = "novanova:creation-agent:cancel:";

    /** 写入等待队列脚本 */
    private static final RedisScript<Long> ENQUEUE_SCRIPT = RedisScript.of("""
            if redis.call('zscore', KEYS[3], ARGV[1]) then
                return 0
            end
            if redis.call('sadd', KEYS[2], ARGV[1]) == 1 then
                redis.call('rpush', KEYS[1], ARGV[1])
                return 1
            end
            return 0
            """, Long.class);

    /** 将失租但未被恢复实例接管的请求恢复到队头并释放活动租约脚本。 */
    private static final RedisScript<Long> REQUEUE_EXPIRED_CLAIM_SCRIPT = RedisScript.of("""
            if redis.call('exists', KEYS[4]) == 1 then
                return 0
            end
            if redis.call('zrem', KEYS[3], ARGV[1]) == 0 then
                return 0
            end
            if redis.call('sadd', KEYS[2], ARGV[1]) == 1 then
                redis.call('lpush', KEYS[1], ARGV[1])
            end
            return 1
            """, Long.class);

    /** 持有恢复租约时，将未开始请求恢复到队头并原子释放恢复租约脚本。 */
    private static final RedisScript<Long> REQUEUE_RECOVERED_CLAIM_SCRIPT = RedisScript.of("""
            if redis.call('get', KEYS[4]) ~= ARGV[2] then
                return 0
            end
            redis.call('zrem', KEYS[3], ARGV[1])
            if redis.call('sadd', KEYS[2], ARGV[1]) == 1 then
                redis.call('lpush', KEYS[1], ARGV[1])
            end
            redis.call('del', KEYS[4])
            return 1
            """, Long.class);

    /** 原子领取单个请求脚本，每个分区固定一个活动名额 */
    private static final RedisScript<String> CLAIM_SCRIPT = RedisScript.of("""
            if redis.call('exists', KEYS[4]) == 1 then
                return nil
            end
            if redis.call('zcard', KEYS[3]) >= 1 then
                return nil
            end
            local time = redis.call('TIME')
            local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
            local requestId = redis.call('lpop', KEYS[1])
            if not requestId then
                return nil
            end
            redis.call('srem', KEYS[2], requestId)
            redis.call('zadd', KEYS[3], now + tonumber(ARGV[1]), requestId)
            return requestId
            """, String.class);

    /** 活动请求续约脚本 */
    private static final RedisScript<Long> RENEW_SCRIPT = RedisScript.of("""
            local time = redis.call('TIME')
            local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
            local expiresAt = redis.call('zscore', KEYS[1], ARGV[1])
            if expiresAt and tonumber(expiresAt) > now then
                redis.call('zadd', KEYS[1], now + tonumber(ARGV[2]), ARGV[1])
                return 1
            end
            return 0
            """, Long.class);

    /** 查询活动租约脚本 */
    private static final RedisScript<Long> HAS_ACTIVE_SCRIPT = RedisScript.of("""
            local time = redis.call('TIME')
            local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
            local expiresAt = redis.call('zscore', KEYS[1], ARGV[1])
            if expiresAt and tonumber(expiresAt) > now then
                return 1
            end
            return 0
            """, Long.class);

    /** 普通释放活动租约脚本；恢复收尾期间不得提前放行后续请求。 */
    private static final RedisScript<Long> RELEASE_SCRIPT = RedisScript.of("""
            local recoveryValue = redis.call('get', KEYS[2])
            if recoveryValue and string.sub(recoveryValue, 1, string.len(ARGV[1]) + 1) == ARGV[1] .. '|' then
                return 0
            end
            return redis.call('zrem', KEYS[1], ARGV[1])
            """, Long.class);

    /** 持有恢复租约时释放活动名额并删除恢复租约脚本。 */
    private static final RedisScript<Long> RELEASE_RECOVERED_ACTIVE_SCRIPT = RedisScript.of("""
            if redis.call('get', KEYS[2]) ~= ARGV[2] then
                return 0
            end
            redis.call('zrem', KEYS[1], ARGV[1])
            redis.call('del', KEYS[2])
            return 1
            """, Long.class);

    /** 为失效活动请求原子领取恢复租约脚本。 */
    private static final RedisScript<Long> CLAIM_EXPIRED_RECOVERY_SCRIPT = RedisScript.of("""
            local time = redis.call('TIME')
            local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
            local expiresAt = redis.call('zscore', KEYS[1], ARGV[1])
            if not expiresAt or tonumber(expiresAt) > now then
                return 0
            end
            if redis.call('set', KEYS[2], ARGV[2], 'NX', 'PX', ARGV[3]) then
                return 1
            end
            return 0
            """, Long.class);

    /** 为没有活动租约的运行请求原子领取恢复租约脚本。 */
    private static final RedisScript<Long> CLAIM_RECOVERY_SCRIPT = RedisScript.of("""
            local time = redis.call('TIME')
            local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
            local expiresAt = redis.call('zscore', KEYS[1], ARGV[1])
            if expiresAt and tonumber(expiresAt) > now then
                return 0
            end
            local activeRequestIds = redis.call('zrangebyscore', KEYS[1], '(' .. now, '+inf', 'LIMIT', 0, 1)
            if #activeRequestIds > 0 then
                return 0
            end
            if redis.call('set', KEYS[2], ARGV[2], 'NX', 'PX', ARGV[3]) then
                return 1
            end
            return 0
            """, Long.class);

    /** 按令牌释放恢复租约脚本。 */
    private static final RedisScript<Long> RELEASE_RECOVERY_SCRIPT = RedisScript.of("""
            if redis.call('get', KEYS[1]) ~= ARGV[1] then
                return 0
            end
            return redis.call('del', KEYS[1])
            """, Long.class);

    /** 持有恢复租约时续约脚本。 */
    private static final RedisScript<Long> RENEW_RECOVERY_SCRIPT = RedisScript.of("""
            if redis.call('get', KEYS[1]) ~= ARGV[1] then
                return 0
            end
            redis.call('pexpire', KEYS[1], ARGV[2])
            return 1
            """, Long.class);

    /** 原子移除排队请求脚本 */
    private static final RedisScript<Long> REMOVE_QUEUED_SCRIPT = RedisScript.of("""
            local removed = redis.call('lrem', KEYS[1], 0, ARGV[1])
            redis.call('srem', KEYS[2], ARGV[1])
            return removed
            """, Long.class);

    /** 读取一个过期活动租约脚本，不直接删除以便调度器先完成中断收尾。 */
    private static final RedisScript<String> EXPIRED_ACTIVE_REQUEST_SCRIPT = RedisScript.of("""
            local time = redis.call('TIME')
            local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
            local requestIds = redis.call('zrangebyscore', KEYS[1], '-inf', now, 'LIMIT', 0, 1)
            return requestIds[1]
            """, String.class);

    /** 读取当前活动租约脚本，不区分租约是否过期。 */
    private static final RedisScript<String> ACTIVE_REQUEST_SCRIPT = RedisScript.of("""
            local requestIds = redis.call('zrange', KEYS[1], 0, 0)
            return requestIds[1]
            """, String.class);

    /** 为已取消但仍持有活动名额的请求原子领取恢复权脚本。 */
    private static final RedisScript<Long> CLAIM_CANCELED_ACTIVE_RECOVERY_SCRIPT = RedisScript.of("""
            local activeRequestIds = redis.call('zrange', KEYS[1], 0, 0)
            if activeRequestIds[1] ~= ARGV[1] then
                return 0
            end
            if redis.call('set', KEYS[2], ARGV[2], 'NX', 'PX', ARGV[3]) then
                return 1
            end
            return 0
            """, Long.class);

    /** Redis模板 */
    private final ReactiveStringRedisTemplate redisTemplate;

    /** 服务配置 */
    private final NovanovaProperties properties;

    /**
     * 将请求写入所属用户和入口来源的FIFO等待队列。
     *
     * @param userId Long 用户ID
     * @param entrySource String 入口来源
     * @param requestId String 请求ID
     * @return Mono<Void> 入队完成信号
     */
    public Mono<Void> enqueue(Long userId, String entrySource, String requestId) {
        return redisTemplate.execute(ENQUEUE_SCRIPT, queueKeys(userId, entrySource), List.of(requestId))
                .next()
                .doOnNext(added -> {
                    if (added != null && added > 0) {
                        log.info("主Agent请求已入队: userId={}, entrySource={}, requestId={}", userId, entrySource, requestId);
                    }
                })
                .then();
    }

    /**
     * 将失租但尚未开始的请求原子恢复到队头并释放活动租约。
     *
     * @param userId Long 用户ID
     * @param entrySource String 入口来源
     * @param requestId String 请求ID
     * @return Mono<Void> 恢复入队完成信号
     */
    public Mono<Void> requeueExpiredClaim(Long userId, String entrySource, String requestId) {
        return redisTemplate.execute(REQUEUE_EXPIRED_CLAIM_SCRIPT,
                        recoveryQueueKeys(userId, entrySource), List.of(requestId))
                .next()
                .doOnNext(added -> {
                    if (added != null && added > 0) {
                        log.info("主Agent未开始请求已恢复到队头: userId={}, entrySource={}, requestId={}",
                                userId, entrySource, requestId);
                    }
                })
                .then();
    }

    /**
     * 领取当前分区可执行的全部请求；每个分区最多领取一个。
     *
     * @param userId Long 用户ID
     * @param entrySource String 入口来源
     * @return Flux<String> 已领取请求ID流
     */
    public Flux<String> claimAvailable(Long userId, String entrySource) {
        return claimNext(userId, entrySource).expand(ignored -> claimNext(userId, entrySource));
    }

    /**
     * 续约已领取请求的活动租约。
     *
     * @param userId Long 用户ID
     * @param entrySource String 入口来源
     * @param requestId String 请求ID
     * @return Mono<Boolean> 是否续约成功
     */
    public Mono<Boolean> renewActiveRequest(Long userId, String entrySource, String requestId) {
        return redisTemplate.execute(RENEW_SCRIPT, List.of(activeRequestKey(userId, entrySource)),
                        List.of(requestId, activeLeaseMilliseconds()))
                .next()
                .map(result -> result != null && result > 0)
                .defaultIfEmpty(false);
    }

    /**
     * 查询请求是否仍持有活动租约。
     *
     * @param userId Long 用户ID
     * @param entrySource String 入口来源
     * @param requestId String 请求ID
     * @return Mono<Boolean> 是否仍有有效活动租约
     */
    public Mono<Boolean> hasActiveRequest(Long userId, String entrySource, String requestId) {
        return redisTemplate.execute(HAS_ACTIVE_SCRIPT, List.of(activeRequestKey(userId, entrySource)), List.of(requestId))
                .next()
                .map(result -> result != null && result > 0)
                .defaultIfEmpty(false);
    }

    /**
     * 扫描并原子领取所有已过期活动租约的恢复权。
     * <p>
     * 每个过期请求同一时刻只有一个服务实例可以取得恢复权。调用方必须在恢复租约有效期内
     * 完成中断或取消收尾后释放名额，避免多实例重复取消任务，或旧执行实例提前放行后续请求。
     *
     * @return Flux<ExpiredActiveRequest> 已取得恢复权的过期活动租约流
     */
    public Flux<ExpiredActiveRequest> listExpiredActiveRequests() {
        ScanOptions options = ScanOptions.scanOptions()
                .match(QUEUE_KEY_PREFIX + "*" + ACTIVE_KEY_SUFFIX)
                .count(100)
                .build();
        return redisTemplate.scan(options)
                .distinct()
                .concatMap(activeKey -> redisTemplate.execute(EXPIRED_ACTIVE_REQUEST_SCRIPT, List.of(activeKey), List.of())
                        .next()
                        .filter(StringUtils::hasText)
                        .flatMap(requestId -> Mono.justOrEmpty(parseExpiredActiveRequest(activeKey, requestId)))
                        .flatMap(this::claimExpiredRecovery));
    }

    /**
     * 扫描当前所有活动请求，用于收敛已取消但租约尚未到期的遗留名额。
     *
     * @return Flux<ActiveRequest> 当前活动请求流
     */
    public Flux<ActiveRequest> listActiveRequests() {
        ScanOptions options = ScanOptions.scanOptions()
                .match(QUEUE_KEY_PREFIX + "*" + ACTIVE_KEY_SUFFIX)
                .count(100)
                .build();
        return redisTemplate.scan(options)
                .distinct()
                .concatMap(activeKey -> redisTemplate.execute(ACTIVE_REQUEST_SCRIPT, List.of(activeKey), List.of())
                        .next()
                        .filter(StringUtils::hasText)
                        .flatMap(requestId -> Mono.justOrEmpty(parseActiveRequest(activeKey, requestId))));
    }

    /**
     * 为已取消但仍持有活动名额的请求领取恢复权。
     *
     * @param userId Long 用户ID
     * @param entrySource String 入口来源
     * @param requestId String 请求ID
     * @return Mono<RecoveryClaim> 恢复权；活动名额已变更或已被其他实例领取时为空
     */
    public Mono<RecoveryClaim> claimCanceledActiveRecovery(Long userId, String entrySource, String requestId) {
        RecoveryClaim recoveryClaim = new RecoveryClaim(userId, entrySource, requestId, UUID.randomUUID().toString());
        return redisTemplate.execute(CLAIM_CANCELED_ACTIVE_RECOVERY_SCRIPT,
                        List.of(activeRequestKey(userId, entrySource), recoveryKey(userId, entrySource)),
                        List.of(requestId, recoveryValue(recoveryClaim), recoveryLeaseMilliseconds()))
                .next()
                .filter(result -> result != null && result > 0)
                .map(ignored -> recoveryClaim);
    }

    /**
     * 为已确认没有有效活动租约的运行请求领取恢复权。
     *
     * @param userId Long 用户ID
     * @param entrySource String 入口来源
     * @param requestId String 请求ID
     * @return Mono<RecoveryClaim> 恢复权；已被其他实例领取时为空
     */
    public Mono<RecoveryClaim> claimMissingLeaseRecovery(Long userId, String entrySource, String requestId) {
        RecoveryClaim recoveryClaim = new RecoveryClaim(userId, entrySource, requestId, UUID.randomUUID().toString());
        return redisTemplate.execute(CLAIM_RECOVERY_SCRIPT,
                        List.of(activeRequestKey(userId, entrySource), recoveryKey(userId, entrySource)),
                        List.of(requestId, recoveryValue(recoveryClaim), recoveryLeaseMilliseconds()))
                .next()
                .filter(result -> result != null && result > 0)
                .map(ignored -> recoveryClaim);
    }

    /**
     * 释放当前分区的活动名额。
     *
     * @param userId Long 用户ID
     * @param entrySource String 入口来源
     * @param requestId String 请求ID
     * @return Mono<Void> 释放完成信号
     */
    public Mono<Void> releaseActiveRequest(Long userId, String entrySource, String requestId) {
        return redisTemplate.execute(RELEASE_SCRIPT,
                        List.of(activeRequestKey(userId, entrySource), recoveryKey(userId, entrySource)), List.of(requestId))
                .next()
                .doOnNext(released -> log.info("释放主Agent请求名额: userId={}, entrySource={}, requestId={}, released={}",
                        userId, entrySource, requestId, released))
                .then();
    }

    /**
     * 持有恢复权时将未开始请求恢复到队头并释放恢复租约。
     *
     * @param recoveryClaim RecoveryClaim 当前实例持有的恢复权
     * @return Mono<Void> 恢复完成信号
     */
    public Mono<Void> requeueRecoveredClaim(RecoveryClaim recoveryClaim) {
        return redisTemplate.execute(REQUEUE_RECOVERED_CLAIM_SCRIPT,
                        recoveryQueueKeys(recoveryClaim), List.of(recoveryClaim.requestId(), recoveryValue(recoveryClaim)))
                .next()
                .doOnNext(added -> {
                    if (added != null && added > 0) {
                        log.info("主Agent未开始请求已恢复到队头: userId={}, entrySource={}, requestId={}",
                                recoveryClaim.userId(), recoveryClaim.entrySource(), recoveryClaim.requestId());
                    }
                })
                .then();
    }

    /**
     * 持有恢复权时释放活动名额并清理恢复租约。
     *
     * @param recoveryClaim RecoveryClaim 当前实例持有的恢复权
     * @return Mono<Void> 释放完成信号
     */
    public Mono<Void> releaseRecoveredActiveRequest(RecoveryClaim recoveryClaim) {
        return redisTemplate.execute(RELEASE_RECOVERED_ACTIVE_SCRIPT,
                        List.of(activeRequestKey(recoveryClaim.userId(), recoveryClaim.entrySource()),
                                recoveryKey(recoveryClaim.userId(), recoveryClaim.entrySource())),
                        List.of(recoveryClaim.requestId(), recoveryValue(recoveryClaim)))
                .next()
                .doOnNext(released -> log.info("恢复收尾释放主Agent请求名额: userId={}, entrySource={}, requestId={}, released={}",
                        recoveryClaim.userId(), recoveryClaim.entrySource(), recoveryClaim.requestId(), released))
                .then();
    }

    /**
     * 放弃尚未完成的恢复权；仅持有相同令牌的实例可删除。
     *
     * @param recoveryClaim RecoveryClaim 当前实例持有的恢复权
     * @return Mono<Void> 释放完成信号
     */
    public Mono<Void> releaseRecoveryClaim(RecoveryClaim recoveryClaim) {
        return redisTemplate.execute(RELEASE_RECOVERY_SCRIPT,
                        List.of(recoveryKey(recoveryClaim.userId(), recoveryClaim.entrySource())),
                        List.of(recoveryValue(recoveryClaim)))
                .next()
                .then();
    }

    /**
     * 续约当前实例持有的恢复权，防止长时间取消任务或计划收尾时被其他实例重复接管。
     *
     * @param recoveryClaim RecoveryClaim 当前实例持有的恢复权
     * @return Mono<Boolean> 是否仍持有并完成续约
     */
    public Mono<Boolean> renewRecoveryClaim(RecoveryClaim recoveryClaim) {
        return redisTemplate.execute(RENEW_RECOVERY_SCRIPT,
                        List.of(recoveryKey(recoveryClaim.userId(), recoveryClaim.entrySource())),
                        List.of(recoveryValue(recoveryClaim), recoveryLeaseMilliseconds()))
                .next()
                .map(result -> result != null && result > 0)
                .defaultIfEmpty(false);
    }

    /**
     * 原子移除尚在等待队列中的请求。
     *
     * @param userId Long 用户ID
     * @param entrySource String 入口来源
     * @param requestId String 请求ID
     * @return Mono<Void> 移除完成信号
     */
    public Mono<Void> removeQueuedRequest(Long userId, String entrySource, String requestId) {
        return redisTemplate.execute(REMOVE_QUEUED_SCRIPT,
                        List.of(pendingQueueKey(userId, entrySource), queuedRequestKey(userId, entrySource)), List.of(requestId))
                .next()
                .doOnNext(removed -> log.info("移除排队主Agent请求: userId={}, entrySource={}, requestId={}, removed={}",
                        userId, entrySource, requestId, removed))
                .then();
    }

    /**
     * 写入运行请求的取消标记。
     *
     * @param requestId String 请求ID
     * @return Mono<Void> 写入完成信号
     */
    public Mono<Void> markCancelRequested(String requestId) {
        return redisTemplate.opsForValue().set(cancelKey(requestId), "1", Duration.ofHours(2)).then();
    }

    /**
     * 判断运行请求是否已收到取消标记。
     *
     * @param requestId String 请求ID
     * @return Mono<Boolean> 是否已请求取消
     */
    public Mono<Boolean> isCancelRequested(String requestId) {
        return redisTemplate.hasKey(cancelKey(requestId)).defaultIfEmpty(false);
    }

    /**
     * 构造等待队列键。
     *
     * @param userId Long 用户ID
     * @param entrySource String 入口来源
     * @return String Redis等待队列键
     */
    static String pendingQueueKey(Long userId, String entrySource) {
        return queueKeyPrefix(userId, entrySource) + PENDING_KEY_SUFFIX;
    }

    /**
     * 构造排队去重集合键。
     *
     * @param userId Long 用户ID
     * @param entrySource String 入口来源
     * @return String Redis去重集合键
     */
    static String queuedRequestKey(Long userId, String entrySource) {
        return queueKeyPrefix(userId, entrySource) + QUEUED_KEY_SUFFIX;
    }

    /**
     * 构造活动租约键。
     *
     * @param userId Long 用户ID
     * @param entrySource String 入口来源
     * @return String Redis活动租约键
     */
    static String activeRequestKey(Long userId, String entrySource) {
        return queueKeyPrefix(userId, entrySource) + ACTIVE_KEY_SUFFIX;
    }

    /**
     * 构造分区恢复租约键。
     *
     * @param userId Long 用户ID
     * @param entrySource String 入口来源
     * @return String Redis恢复租约键
     */
    static String recoveryKey(Long userId, String entrySource) {
        return queueKeyPrefix(userId, entrySource) + RECOVERY_KEY_SUFFIX;
    }

    /**
     * 从活动租约键解析用户和入口来源分区。
     *
     * @param activeKey String Redis活动租约键
     * @param requestId String 请求ID
     * @return ExpiredActiveRequest 解析结果；键格式不合法时返回null
     */
    private static ExpiredActiveRequest parseExpiredActiveRequest(String activeKey, String requestId) {
        ActiveRequest activeRequest = parseActiveRequest(activeKey, requestId);
        return activeRequest == null ? null : new ExpiredActiveRequest(activeRequest.userId(), activeRequest.entrySource(),
                activeRequest.requestId());
    }

    /**
     * 从活动租约键解析用户和入口来源分区。
     *
     * @param activeKey String Redis活动租约键
     * @param requestId String 请求ID
     * @return ActiveRequest 解析结果；键格式不合法时返回null
     */
    private static ActiveRequest parseActiveRequest(String activeKey, String requestId) {
        if (!StringUtils.hasText(activeKey) || !StringUtils.hasText(requestId)
                || !activeKey.startsWith(QUEUE_KEY_PREFIX) || !activeKey.endsWith(ACTIVE_KEY_SUFFIX)) {
            return null;
        }
        String partition = activeKey.substring(QUEUE_KEY_PREFIX.length(), activeKey.length() - ACTIVE_KEY_SUFFIX.length());
        if (!partition.startsWith("{") || !partition.endsWith("}")) {
            return null;
        }
        String[] values = partition.substring(1, partition.length() - 1).split(":", 2);
        if (values.length != 2 || !CreationEntrySource.supported(values[1])) {
            return null;
        }
        try {
            return new ActiveRequest(Long.parseLong(values[0]), values[1], requestId);
        } catch (NumberFormatException exception) {
            return null;
        }
    }

    /**
     * 领取一个可执行请求。
     *
     * @param userId Long 用户ID
     * @param entrySource String 入口来源
     * @return Mono<String> 已领取请求ID，无可执行请求时为空
     */
    private Mono<String> claimNext(Long userId, String entrySource) {
        return redisTemplate.execute(CLAIM_SCRIPT, queueKeys(userId, entrySource), List.of(activeLeaseMilliseconds()))
                .next()
                .filter(StringUtils::hasText);
    }

    /**
     * 原子领取一条过期活动请求的恢复权。
     *
     * @param expiredRequest ExpiredActiveRequest 已发现的过期活动请求
     * @return Mono<ExpiredActiveRequest> 已附带恢复令牌的请求；已被其他实例领取时为空
     */
    private Mono<ExpiredActiveRequest> claimExpiredRecovery(ExpiredActiveRequest expiredRequest) {
        RecoveryClaim recoveryClaim = new RecoveryClaim(expiredRequest.userId(), expiredRequest.entrySource(),
                expiredRequest.requestId(), UUID.randomUUID().toString());
        return redisTemplate.execute(CLAIM_EXPIRED_RECOVERY_SCRIPT,
                        List.of(activeRequestKey(expiredRequest.userId(), expiredRequest.entrySource()),
                                recoveryKey(expiredRequest.userId(), expiredRequest.entrySource())),
                        List.of(expiredRequest.requestId(), recoveryValue(recoveryClaim), recoveryLeaseMilliseconds()))
                .next()
                .filter(result -> result != null && result > 0)
                .map(ignored -> expiredRequest.withRecoveryToken(recoveryClaim.token()));
    }

    /**
     * 组装同一Redis哈希槽中的队列键。
     *
     * @param userId Long 用户ID
     * @param entrySource String 入口来源
     * @return List<String> 等待、去重和活动租约键
     */
    private List<String> queueKeys(Long userId, String entrySource) {
        return List.of(pendingQueueKey(userId, entrySource), queuedRequestKey(userId, entrySource),
                activeRequestKey(userId, entrySource), recoveryKey(userId, entrySource));
    }

    /**
     * 组装恢复请求需要访问的同分区队列键及请求恢复租约键。
     *
     * @param recoveryClaim RecoveryClaim 当前实例持有的恢复权
     * @return List<String> 等待、去重、活动与恢复租约键
     */
    private List<String> recoveryQueueKeys(RecoveryClaim recoveryClaim) {
        return recoveryQueueKeys(recoveryClaim.userId(), recoveryClaim.entrySource());
    }

    /**
     * 组装恢复请求需要访问的同分区队列键及分区恢复租约键。
     *
     * @param userId Long 用户ID
     * @param entrySource String 入口来源
     * @return List<String> 等待、去重、活动与恢复租约键
     */
    private List<String> recoveryQueueKeys(Long userId, String entrySource) {
        return List.of(pendingQueueKey(userId, entrySource), queuedRequestKey(userId, entrySource),
                activeRequestKey(userId, entrySource), recoveryKey(userId, entrySource));
    }

    /**
     * 读取活动租约时长。
     *
     * @return String 租约毫秒数
     */
    private String activeLeaseMilliseconds() {
        return String.valueOf(Duration.ofSeconds(properties.getAi().getTask().getLockTtlSeconds()).toMillis());
    }

    /**
     * 读取恢复收尾租约时长。
     *
     * @return String 恢复租约毫秒数
     */
    private String recoveryLeaseMilliseconds() {
        return activeLeaseMilliseconds();
    }

    /**
     * 构造Redis恢复租约保存的请求和令牌值。
     *
     * @param recoveryClaim RecoveryClaim 恢复执行权
     * @return String Redis恢复租约值
     */
    private static String recoveryValue(RecoveryClaim recoveryClaim) {
        return recoveryClaim.requestId() + "|" + recoveryClaim.token();
    }

    /**
     * 构造Redis Cluster哈希标签分区前缀。
     *
     * @param userId Long 用户ID
     * @param entrySource String 入口来源
     * @return String 队列键公共前缀
     */
    private static String queueKeyPrefix(Long userId, String entrySource) {
        return QUEUE_KEY_PREFIX + "{" + userId + ":" + entrySource + "}";
    }

    /**
     * 构造请求取消标记键。
     *
     * @param requestId String 请求ID
     * @return String 取消标记键
     */
    private static String cancelKey(String requestId) {
        return CANCEL_KEY_PREFIX + requestId;
    }

    /**
     * 已失效但尚未释放的主Agent活动租约。
     *
     * @param userId Long 用户ID
     * @param entrySource String 入口来源
     * @param requestId String 请求ID
     */
    public record ExpiredActiveRequest(Long userId, String entrySource, String requestId, String recoveryToken) {

        /**
         * 创建未领取恢复权的过期活动请求。
         *
         * @param userId Long 用户ID
         * @param entrySource String 入口来源
         * @param requestId String 请求ID
         */
        public ExpiredActiveRequest(Long userId, String entrySource, String requestId) {
            this(userId, entrySource, requestId, "");
        }

        /**
         * 将恢复令牌附加到当前过期请求。
         *
         * @param token String 恢复租约令牌
         * @return ExpiredActiveRequest 已领取恢复权的请求
         */
        private ExpiredActiveRequest withRecoveryToken(String token) {
            return new ExpiredActiveRequest(userId, entrySource, requestId, token);
        }

        /**
         * 转换为通用恢复权对象。
         *
         * @return RecoveryClaim 恢复权
         */
        public RecoveryClaim recoveryClaim() {
            return new RecoveryClaim(userId, entrySource, requestId, recoveryToken);
        }
    }

    /**
     * 当前持有活动名额的主Agent请求。
     *
     * @param userId Long 用户ID
     * @param entrySource String 入口来源
     * @param requestId String 请求ID
     */
    public record ActiveRequest(Long userId, String entrySource, String requestId) {
    }

    /**
     * 失租请求的恢复执行权。
     *
     * @param userId Long 用户ID
     * @param entrySource String 入口来源
     * @param requestId String 请求ID
     * @param token String Redis恢复租约令牌
     */
    public record RecoveryClaim(Long userId, String entrySource, String requestId, String token) {
    }
}
