package com.novanovastudio.task;

import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.service.VideoCompositionTaskService;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import java.time.Duration;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Component;
import reactor.core.Disposable;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 视频合成任务的全站FIFO调度器。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-08-11 00:00
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class VideoCompositionTaskDispatcher {

    /** 视频合成任务队列 */
    private final VideoCompositionTaskQueue taskQueue;

    /** 视频合成任务服务提供器 */
    private final ObjectProvider<VideoCompositionTaskService> taskServiceProvider;

    /** 服务配置 */
    private final NovanovaProperties properties;

    /** 虚拟线程执行器 */
    private ExecutorService executorService;

    /**
     * 初始化调度执行器。
     */
    @PostConstruct
    public void start() {
        executorService = Executors.newVirtualThreadPerTaskExecutor();
    }

    /**
     * 停止调度执行器。
     */
    @PreDestroy
    public void stop() {
        if (executorService != null) {
            executorService.close();
        }
    }

    /**
     * 将任务写入队列并立即调度可执行任务。
     *
     * @param taskId String 任务ID
     * @return Mono<Void> 调度结果
     */
    public Mono<Void> enqueue(String taskId) {
        int concurrency = Math.max(1, properties.getAi().getVideoComposition().getConcurrency());
        return taskQueue.updateConcurrency(concurrency)
                .then(taskQueue.enqueue(taskId))
                .then(dispatchAvailable());
    }

    /**
     * 领取全部可执行任务并提交虚拟线程。
     *
     * @return Mono<Void> 调度结果
     */
    private Mono<Void> dispatchAvailable() {
        return taskQueue.claimAvailable()
                .doOnNext(this::submit)
                .then();
    }

    /**
     * 提交已领取任务。
     *
     * @param taskId String 任务ID
     */
    private void submit(String taskId) {
        try {
            executorService.submit(() -> executeClaimedTask(taskId));
        } catch (RuntimeException exception) {
            log.error("提交视频合成任务失败: taskId={}", taskId, exception);
            taskQueue.releaseActiveTask(taskId)
                    .then(taskQueue.enqueue(taskId))
                    .subscribe(
                            ignored -> log.info("提交失败的视频合成任务已重新入队: taskId={}", taskId),
                            requeueException -> log.error("恢复视频合成任务队列失败: taskId={}", taskId, requeueException)
                    );
        }
    }

    /**
     * 执行已领取任务，并在结束后释放名额。
     *
     * @param taskId String 任务ID
     */
    private void executeClaimedTask(String taskId) {
        Disposable renewDisposable = null;
        try {
            int renewSeconds = Math.max(1, properties.getAi().getVideoComposition().getLeaseRenewSeconds());
            renewDisposable = Flux.interval(Duration.ofSeconds(renewSeconds))
                    .flatMap(ignored -> taskQueue.renewActiveTask(taskId))
                    .subscribe(renewed -> {
                        if (!Boolean.TRUE.equals(renewed)) {
                            log.info("视频合成任务租约续期未生效: taskId={}", taskId);
                        }
                    });
            taskServiceProvider.getObject().executeQueuedTask(taskId).block();
        } catch (Exception exception) {
            log.error("执行视频合成任务失败: taskId={}", taskId, exception);
        } finally {
            if (renewDisposable != null) {
                renewDisposable.dispose();
            }
            taskQueue.releaseActiveTask(taskId)
                    .then(dispatchAvailable())
                    .subscribe(
                            ignored -> {
                            },
                            exception -> log.error("补位视频合成任务失败: taskId={}", taskId, exception)
                    );
        }
    }
}
