package com.novanovastudio.task;

import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.repository.PersistenceRepository;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import java.time.Duration;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import reactor.core.Disposable;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * @title        ModelTaskExecutionDispatcher.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  按模型并发数调度AI任务执行
 * @createTime   2026-08-10 00:00:00
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class ModelTaskExecutionDispatcher {

    /** 模型任务队列 */
    private final ModelTaskQueue modelTaskQueue;

    /** AI任务执行器 */
    private final AiTaskExecutionRunner taskExecutionRunner;

    /** 持久化仓储 */
    private final PersistenceRepository persistenceRepository;

    /** 服务配置 */
    private final NovanovaProperties properties;

    /** 虚拟线程执行器 */
    private ExecutorService executorService;

    /**
     * 初始化模型任务执行器。
     */
    @PostConstruct
    public void start() {
        executorService = Executors.newVirtualThreadPerTaskExecutor();
    }

    /**
     * 停止模型任务执行器。
     */
    @PreDestroy
    public void stop() {
        if (executorService != null) {
            executorService.close();
        }
    }

    /**
     * 按当前数据库配置将任务写入模型队列。
     *
     * @param modelConfigId String 模型配置ID
     * @param taskId String 任务ID
     * @return Mono<Void> 入队和调度结果
     */
    public Mono<Void> enqueue(String modelConfigId, String taskId) {
        return currentRequestConcurrency(modelConfigId)
                .flatMap(requestConcurrency -> modelTaskQueue.initializeRequestConcurrency(modelConfigId, requestConcurrency)
                        .then(modelTaskQueue.enqueue(modelConfigId, taskId))
                        .then(dispatchAvailable(modelConfigId)));
    }

    /**
     * 使用数据库中更新后的并发数重新调度等待任务。
     *
     * @param modelConfigId String 模型配置ID
     * @return Mono<Void> 调度结果
     */
    public Mono<Void> refresh(String modelConfigId) {
        return currentRequestConcurrency(modelConfigId)
                .flatMap(requestConcurrency -> modelTaskQueue.updateRequestConcurrency(modelConfigId, requestConcurrency)
                        .then(dispatchAvailable(modelConfigId)));
    }

    /**
     * 领取当前模型可执行的全部任务并提交给虚拟线程。
     *
     * @param modelConfigId String 模型配置ID
     * @return Mono<Void> 调度结果
     */
    private Mono<Void> dispatchAvailable(String modelConfigId) {
        return modelTaskQueue.claimAvailable(modelConfigId)
                .doOnNext(taskId -> submit(modelConfigId, taskId))
                .then();
    }

    /**
     * 将已领取的模型任务提交到虚拟线程。
     *
     * @param modelConfigId String 模型配置ID
     * @param taskId String 任务ID
     */
    private void submit(String modelConfigId, String taskId) {
        try {
            executorService.submit(() -> executeClaimedTask(modelConfigId, taskId));
        } catch (RuntimeException exception) {
            log.error("提交模型任务执行失败: modelConfigId={}, taskId={}", modelConfigId, taskId, exception);
            modelTaskQueue.releaseActiveTask(modelConfigId, taskId)
                    // 提交线程失败时任务已从等待队列移出，必须放回队列，避免任务永久停留在pending状态。
                    .then(modelTaskQueue.enqueue(modelConfigId, taskId))
                    .doOnSuccess(ignored -> log.info("提交失败的模型任务已回到等待队列: modelConfigId={}, taskId={}", modelConfigId, taskId))
                    .subscribe(
                            ignored -> {
                            },
                            releaseException -> log.error("提交失败后恢复模型任务队列失败: modelConfigId={}, taskId={}", modelConfigId, taskId, releaseException)
                    );
        }
    }

    /**
     * 执行已领取的模型任务，并在结束后释放名额。
     *
     * @param modelConfigId String 模型配置ID
     * @param taskId String 任务ID
     */
    private void executeClaimedTask(String modelConfigId, String taskId) {
        Disposable renewDisposable = null;
        try {
            renewDisposable = Flux.interval(Duration.ofSeconds(properties.getAi().getTask().getLockRenewSeconds()))
                    .flatMap(ignored -> modelTaskQueue.renewActiveTask(modelConfigId, taskId))
                    .subscribe(renewed -> {
                        if (!Boolean.TRUE.equals(renewed)) {
                            log.info("模型任务名额续期未生效: modelConfigId={}, taskId={}", modelConfigId, taskId);
                        }
                    });
            taskExecutionRunner.execute("model-" + modelConfigId, taskId)
                    .block();
        } catch (Exception exception) {
            log.error("执行模型任务失败: modelConfigId={}, taskId={}", modelConfigId, taskId, exception);
        } finally {
            if (renewDisposable != null) {
                renewDisposable.dispose();
            }
            // 无论执行器返回错误还是同步抛出异常，都要释放当前模型名额。
            releaseAndDispatchNext(modelConfigId, taskId);
        }
    }

    /**
     * 释放任务名额并按当前配置补位等待任务。
     *
     * @param modelConfigId String 模型配置ID
     * @param taskId String 任务ID
     */
    private void releaseAndDispatchNext(String modelConfigId, String taskId) {
        modelTaskQueue.releaseActiveTask(modelConfigId, taskId)
                .then(dispatchAvailable(modelConfigId))
                .subscribe(
                        ignored -> {
                        },
                        exception -> log.error("补位模型任务失败: modelConfigId={}, taskId={}", modelConfigId, taskId, exception)
                );
    }

    /**
     * 查询当前模型同时并发数。
     *
     * @param modelConfigId String 模型配置ID
     * @return Mono<Integer> 模型同时并发数
     */
    private Mono<Integer> currentRequestConcurrency(String modelConfigId) {
        return persistenceRepository.getPlatformModelRequestConcurrency(modelConfigId)
                .filter(value -> value != null && value > 0)
                .switchIfEmpty(Mono.error(new IllegalStateException("模型配置不存在或并发数不合法: " + modelConfigId)));
    }
}
