package com.novanovastudio.task;

import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.repository.NovelAdaptationJobRepository;
import com.novanovastudio.repository.WholeBookAdaptationRepository;
import com.novanovastudio.service.EpisodeBodiesRunner;
import com.novanovastudio.service.NovelAdaptationRunner;
import com.novanovastudio.service.WholeBookAdaptationRunner;
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
 * 小说改编一键流水线队列，复用按模型限并发的Redis队列，数据库负责任务真相与恢复。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-09-29 15:30
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class NovelAdaptationQueue {
    /** 队列命名空间，与其他模型队列隔离，避免被其他调度器领取。 */
    private static final String QUEUE_PREFIX = "novel-adaptation:";

    /** 模型任务队列。 */
    private final ModelTaskQueue modelTaskQueue;
    /** 改编任务仓储。 */
    private final NovelAdaptationJobRepository repository;
    /** 改编执行器：分阶段单次生成的旧流程，只服务升级前遗留的任务。 */
    private final NovelAdaptationRunner legacyRunner;
    /** 全书改编执行器。 */
    private final WholeBookAdaptationRunner wholeBookRunner;
    /** 逐集正文批量执行器。 */
    private final EpisodeBodiesRunner episodeBodiesRunner;
    /** 工作流快照仓储，按是否存在快照区分新旧任务。 */
    private final WholeBookAdaptationRepository workflowRepository;
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
        // 一个模型同一时刻只领取一个改编任务，避免与故事知识库分析争抢同一渠道。
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
                .concatMap(ignored -> repository.listRecoverable()
                        .concatMap(job -> enqueue(job.modelConfigId(), job.id()))
                        .onErrorResume(error -> {
                            log.error("补发小说改编任务失败", error);
                            return Mono.empty();
                        }))
                .subscribe();
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
     * 执行任务并在结束后释放名额、补位下一个任务；进入等待人工确认的任务会自然退出名额。
     *
     * @param queueId String 队列标识
     * @param jobId String 任务标识
     */
    private void execute(String queueId, String jobId) {
        Disposable renewal = Flux.interval(Duration.ofSeconds(properties.getAi().getTask().getLockRenewSeconds()))
                .flatMap(ignored -> modelTaskQueue.renewActiveTask(queueId, jobId))
                .subscribe(ignored -> { }, error -> log.error("小说改编任务名额续期失败: jobId={}", jobId, error));
        try {
            // 全书改编、逐集正文批量与升级前的旧任务共用同一张任务表：
            // 写入目标分集的是正文批量，有快照但无目标分集的是全书改编，都没有的是旧流程。
            workflowRepository.isEpisodeBodies(jobId)
                    .flatMap(bodies -> bodies ? episodeBodiesRunner.process(jobId)
                            : workflowRepository.exists(jobId)
                                    .flatMap(wholeBook -> wholeBook ? wholeBookRunner.process(jobId)
                                            : legacyRunner.process(jobId)))
                    .block();
        } catch (Exception error) {
            log.error("执行小说改编任务失败: jobId={}", jobId, error);
        } finally {
            renewal.dispose();
            modelTaskQueue.releaseActiveTask(queueId, jobId)
                    .then(dispatch(queueId))
                    .subscribe(ignored -> { }, error -> log.error("补位小说改编任务失败: jobId={}", jobId, error));
        }
    }
}
