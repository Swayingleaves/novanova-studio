package com.novanovastudio.task;

import java.time.Duration;
import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.ReactiveStringRedisTemplate;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Mono;

/**
 * 视频合成任务的跨实例取消标记。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-08-11 00:00
 */
@Component
@RequiredArgsConstructor
public class VideoCompositionTaskCancellation {

    /** 取消标记键前缀 */
    private static final String CANCEL_KEY_PREFIX = "novanova:video-composition:cancel:";

    /** Redis模板 */
    private final ReactiveStringRedisTemplate redisTemplate;

    /**
     * 写入任务取消标记。
     *
     * @param taskId String 任务ID
     * @return Mono<Void> 写入结果
     */
    public Mono<Void> requestCancellation(String taskId) {
        return redisTemplate.opsForValue().set(cancelKey(taskId), "1", Duration.ofHours(2)).then();
    }

    /**
     * 查询任务是否已请求取消。
     *
     * @param taskId String 任务ID
     * @return Mono<Boolean> 是否已请求取消
     */
    public Mono<Boolean> isCancellationRequested(String taskId) {
        return redisTemplate.hasKey(cancelKey(taskId)).defaultIfEmpty(false);
    }

    /**
     * 清除任务取消标记。
     *
     * @param taskId String 任务ID
     * @return Mono<Void> 清除结果
     */
    public Mono<Void> clearCancellation(String taskId) {
        return redisTemplate.delete(cancelKey(taskId)).then();
    }

    /**
     * 构造任务取消标记键。
     *
     * @param taskId String 任务ID
     * @return String Redis键
     */
    static String cancelKey(String taskId) {
        return CANCEL_KEY_PREFIX + taskId;
    }
}
