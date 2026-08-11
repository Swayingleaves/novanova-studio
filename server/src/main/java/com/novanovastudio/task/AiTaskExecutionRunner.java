package com.novanovastudio.task;

import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.logging.MappedDiagnosticContext;
import com.novanovastudio.service.AiTaskService;
import java.time.Duration;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Component;
import reactor.core.Disposable;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * @title        AiTaskExecutionRunner.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  受Redis任务锁保护的AI任务执行器
 * @createTime   2026-08-10 00:00:00
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class AiTaskExecutionRunner {

    /** Redis任务锁 */
    private final RedisTaskLock taskLock;

    /** AI任务服务提供器 */
    private final ObjectProvider<AiTaskService> aiTaskServiceProvider;

    /** 服务配置 */
    private final NovanovaProperties properties;

    /**
     * 执行指定任务，并保证多实例下仅有一个执行器实际执行。
     *
     * @param executorName String 执行器名称
     * @param taskId String 任务ID
     * @return Mono<Void> 执行结果
     */
    public Mono<Void> execute(String executorName, String taskId) {
        String lockValue = taskLock.newLockValue(executorName);
        return taskLock.tryLock(taskId, lockValue)
                .flatMap(locked -> {
                    if (!Boolean.TRUE.equals(locked)) {
                        log.info("跳过AI任务执行: taskId={}, reason={}", taskId, "未获取到锁");
                        return Mono.empty();
                    }
                    Disposable renewDisposable = Flux.interval(Duration.ofSeconds(properties.getAi().getTask().getLockRenewSeconds()))
                            .flatMap(ignored -> taskLock.renew(taskId, lockValue))
                            .contextWrite(context -> MappedDiagnosticContext.put(context, MappedDiagnosticContext.TASK_ID, taskId))
                            .subscribe(renewed -> {
                                if (!Boolean.TRUE.equals(renewed)) {
                                    log.info("AI任务锁续期未生效: taskId={}", taskId);
                                }
                            });
                    return aiTaskServiceProvider.getObject().executeQueuedTask(taskId)
                            .doFinally(signal -> {
                                renewDisposable.dispose();
                                taskLock.release(taskId, lockValue)
                                        .contextWrite(context -> MappedDiagnosticContext.put(context, MappedDiagnosticContext.TASK_ID, taskId))
                                        .subscribe(
                                                ignored -> {
                                                },
                                                exception -> log.error("释放AI任务锁失败: taskId={}", taskId, exception)
                                        );
                            });
                });
    }
}
