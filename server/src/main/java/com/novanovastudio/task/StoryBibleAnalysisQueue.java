package com.novanovastudio.task;

import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.repository.StoryBibleRepository;
import com.novanovastudio.service.StoryBibleAnalysisRunner;
import jakarta.annotation.PreDestroy;
import java.time.Duration;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import reactor.core.Disposable;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 故事知识库分析队列，复用按模型限并发的Redis队列，数据库负责任务真相与恢复。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-09-27 00:00
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class StoryBibleAnalysisQueue {
    /** 队列命名空间，与图片视频任务的模型队列隔离，避免被其他调度器领取。 */
    private static final String QUEUE_PREFIX = "story-bible:";

    /** 模型任务队列。 */
    private final ModelTaskQueue modelTaskQueue;
    /** 知识库仓储。 */
    private final StoryBibleRepository repository;
    /** 分析执行器。 */
    private final StoryBibleAnalysisRunner runner;
    /** 服务配置。 */
    private final NovanovaProperties properties;
    /** 虚拟线程执行器，随组件创建，保证启动完成前的入队也能调度。 */
    private final ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();
    /** 恢复扫描订阅。 */
    private Disposable recoverySubscription;

    /**
     * 按模型并发写入队列并尝试调度。
     *
     * @param modelConfigId String 模型配置标识
     * @param jobId String 任务标识
     * @return Mono&lt;Void&gt; 入队结果
     */
    public Mono<Void> enqueue(String modelConfigId, String jobId) {
        String queueId = QUEUE_PREFIX + modelConfigId;
        // 一个模型同一时刻只领取一个知识库任务；任务内部按模型配置最多并行两个批次。
        return modelTaskQueue.updateRequestConcurrency(queueId, 1)
                .then(modelTaskQueue.enqueue(queueId, jobId))
                .then(dispatch(queueId));
    }

    /**
     * 应用就绪后启动执行器，并定期从数据库补发排队中与租约过期的任务。
     */
    @EventListener(ApplicationReadyEvent.class)
    public void start() {
        recoverySubscription = Flux.interval(Duration.ZERO, Duration.ofMinutes(1))
                .concatMap(ignored -> repository.recoverableJobs()
                        .concatMap(job -> enqueue(job.modelConfigId(), job.id()))
                        .onErrorResume(error -> {
                            log.error("补发故事知识库分析任务失败", error);
                            return Mono.empty();
                        }))
                .contextWrite(context -> context.put(com.novanovastudio.security.TeamScope.SYSTEM_KEY, true)).subscribe();
    }

    /**
     * 停止恢复扫描与执行器。
     */
    @PreDestroy
    public void stop() {
        if (recoverySubscription != null) {
            recoverySubscription.dispose();
        }
        // 不等待长任务结束，数据库租约过期后由其他实例或重启后续跑。
        executor.shutdownNow();
    }

    /**
     * 领取当前模型可执行的任务并提交到虚拟线程。
     *
     * @param queueId String 队列标识
     * @return Mono&lt;Void&gt; 调度结果
     */
    private Mono<Void> dispatch(String queueId) {
        return modelTaskQueue.claimAvailable(queueId)
                .doOnNext(jobId -> executor.submit(() -> execute(queueId, jobId)))
                .then();
    }

    /**
     * 执行任务并在结束后释放名额、补位下一个任务。
     *
     * @param queueId String 队列标识
     * @param jobId String 任务标识
     */
    private void execute(String queueId, String jobId) {
        Disposable renewal = Flux.interval(Duration.ofSeconds(properties.getAi().getTask().getLockRenewSeconds()))
                .flatMap(ignored -> modelTaskQueue.renewActiveTask(queueId, jobId))
                .subscribe(ignored -> { }, error -> log.error("故事知识库任务名额续期失败: jobId={}", jobId, error));
        try {
            runner.process(jobId).block();
        } catch (Exception error) {
            log.error("执行故事知识库分析失败: jobId={}", jobId, error);
        } finally {
            renewal.dispose();
            modelTaskQueue.releaseActiveTask(queueId, jobId)
                    .then(dispatch(queueId))
                    .subscribe(ignored -> { }, error -> log.error("补位故事知识库任务失败: jobId={}", jobId, error));
        }
    }
}
