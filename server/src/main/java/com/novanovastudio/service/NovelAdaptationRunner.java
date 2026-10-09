package com.novanovastudio.service;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.NovelAdaptationDtos;
import com.novanovastudio.repository.NovelAdaptationJobRepository;
import com.novanovastudio.repository.NovelAdaptationRepository;
import com.novanovastudio.repository.StoryBibleRepository;
import com.novanovastudio.security.CurrentUser;
import com.novanovastudio.security.CurrentUserProvider;
import java.time.Duration;
import java.util.List;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.reactive.TransactionalOperator;
import reactor.core.Disposable;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 小说改编一键流水线执行器，按阶段依次生成待审草稿，遇停点释放租约等待人工确认。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-09-29 15:20
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class NovelAdaptationRunner {

    /** 执行租约秒数。 */
    public static final int LEASE_SECONDS = 300;

    /** 失败原因最大长度。 */
    private static final int MAX_ERROR_LENGTH = 500;

    /** 任务仓储。 */
    private final NovelAdaptationJobRepository jobRepository;

    /** 故事知识库仓储。 */
    private final StoryBibleRepository storyBibleRepository;

    /** 成功草稿检查点，用于重启或失败续跑时跳过已完成批次。 */
    private final NovelAdaptationRepository novelAdaptationRepository;

    /** 改编业务服务。 */
    private final NovelAdaptationService novelAdaptationService;

    /** 剧本项目服务。 */
    private final ScriptService scriptService;

    /** 积分服务。 */
    private final CreditService creditService;

    /** 失败状态与退款一起提交，避免续跑先于退款结清。 */
    private final TransactionalOperator transactionalOperator;

    /**
     * 认领并执行一次改编任务，失败时记录原因并退还未结算积分。
     *
     * @param jobId String 任务标识
     * @return Mono&lt;Void&gt; 执行结果
     */
    public Mono<Void> process(String jobId) {
        return jobRepository.claim(jobId, LEASE_SECONDS).flatMap(claimed -> {
            if (!claimed) return Mono.<Void>empty();
            Disposable renewal = Flux.interval(Duration.ofSeconds(LEASE_SECONDS / 3))
                    .concatMap(ignored -> jobRepository.renewLease(jobId, LEASE_SECONDS))
                    .subscribe(ignored -> { }, error -> log.warn("改编任务租约续期失败: jobId={}", jobId, error));
            return run(jobId)
                    .doFinally(signal -> renewal.dispose())
                    .onErrorResume(error -> handleFailure(jobId, error));
        });
    }

    /**
     * 以任务发起人身份执行，业务层通过Reactor上下文读取当前用户。
     *
     * @param jobId String 任务标识
     * @return Mono&lt;Void&gt; 执行结果
     */
    private Mono<Void> run(String jobId) {
        return jobRepository.find(jobId).flatMap(job -> executePendingUnits(job)
                .contextWrite(context -> context.put(CurrentUserProvider.CURRENT_USER_CONTEXT_KEY,
                        new CurrentUser(job.userId(), "", "user", 1))));
    }

    /**
     * 按已保存草稿精确跳过成功调用，生成当前阶段的缺失批次后等待确认。
     *
     * @param job 任务
     * @return Mono&lt;Void&gt; 执行结果
     */
    private Mono<Void> executePendingUnits(NovelAdaptationJobRepository.Job job) {
        Set<String> factIds = Set.copyOf(job.factIds());
        return Mono.zip(storyBibleRepository.listConfirmedItemTypes(job.projectId())
                        .filter(item -> factIds.contains(item.id())).collectList(),
                scriptService.getProject(job.projectId()).flatMap(project ->
                        scriptService.getSnapshotForUser(job.userId(), job.projectId(), project.revision())),
                novelAdaptationRepository.listCheckpoints(job.id()).collectList())
                .flatMap(input -> {
                    if (input.getT1().size() != job.factIds().size()) {
                        return Mono.error(new BusinessException(ErrorCode.DATA_CONFLICT, "任务引用的故事事实已变化，请审阅后重新发起"));
                    }
                    Set<String> completed = NovelAdaptationPlan.completedKeys(input.getT3());
                    AtomicInteger processed = new AtomicInteger(input.getT3().size());
                    List<NovelAdaptationPlan.Unit> units = NovelAdaptationPlan.units(job.phase(), input.getT1(), input.getT2().project().episodes(), input.getT3());
                    String lastStage = units.isEmpty() ? job.stage() : units.getLast().stage();
                    // 当前停点的所有草稿固定使用同一修订；人工编辑后不能混合不同基线继续生成。
                    return novelAdaptationService.validateCheckpoints(job, input.getT2(), units, input.getT3())
                            .thenMany(Flux.fromIterable(units).filter(unit -> !completed.contains(unit.key()))
                            .concatMap(unit -> ensureRunning(job.id())
                                    .then(Mono.defer(() -> novelAdaptationService.generateStageDraft(job.id(),
                                            request(job, unit.stage(), unit.episodeId(), unit.factIds(), input.getT2().project().revision()))))
                                    .then(Mono.defer(() -> jobRepository.updateProgress(job.id(), job.phase(), unit.stage(),
                                            processed.incrementAndGet(), job.totalUnits())))))
                            .then(Mono.defer(() -> jobRepository.await(job.id(), job.phase(), lastStage, processed.get()))).then();
                });
    }

    /** 组装一次改编生成请求。 */
    private NovelAdaptationDtos.GenerateRequest request(NovelAdaptationJobRepository.Job job, String stage,
                                                        String episodeId, List<String> factIds, long revision) {
        return new NovelAdaptationDtos.GenerateRequest(job.projectId(), revision, stage, episodeId,
                job.settings().toJavaObject(NovelAdaptationDtos.Settings.class), factIds, job.modelValue());
    }

    /** 确认任务仍在运行，取消后立即中断当前阶段。 */
    private Mono<Void> ensureRunning(String jobId) {
        return jobRepository.status(jobId)
                .flatMap(status -> "running".equals(status) ? Mono.<Void>empty() : Mono.error(new CanceledException()));
    }

    /**
     * 记录失败原因并退还未结算的调用积分，取消流程已处理的失败不再重复退款。
     *
     * @param jobId String 任务标识
     * @param error Throwable 失败原因
     * @return Mono&lt;Void&gt; 处理结果
     */
    private Mono<Void> handleFailure(String jobId, Throwable error) {
        if (error instanceof CanceledException) return Mono.empty();
        log.error("小说改编任务执行失败: jobId={}", jobId, error);
        return jobRepository.find(jobId).flatMap(job -> {
            if (!"running".equals(job.status())) return Mono.<Void>empty();
            String message = truncate(error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage());
            // 草稿保存和进度更新之间可能发生中断，结算以真实持久化的成功批次为准。
            return transactionalOperator.transactional(novelAdaptationRepository.listCheckpoints(jobId).count().flatMap(completed ->
                    jobRepository.finish(jobId, "failed", message, completed.intValue())
                            .flatMap(finished -> finished
                                    ? jobRepository.find(jobId).flatMap(this::refundUnsettled) : Mono.<Void>empty())));
        });
    }

    /** 退还未结算的调用积分。 */
    private Mono<Void> refundUnsettled(NovelAdaptationJobRepository.Job job) {
        int credits = refundableCredits(job);
        if (credits <= 0) return Mono.empty();
        return creditService.refundOperation(job.userId(), NovelAdaptationService.chargeOperationId(job), NovelAdaptationService.OPERATION_NAME, credits);
    }

    /** 按单次调用价格计算未结算部分应退积分。 */
    private int refundableCredits(NovelAdaptationJobRepository.Job job) {
        if (job.estimatedCalls() <= 0) return 0;
        int perCall = job.credits() / job.estimatedCalls();
        return Math.max(0, perCall * (job.estimatedCalls() - job.settledCalls()));
    }

    /** 截断失败原因，避免超出列长度。 */
    private String truncate(String message) {
        return message.length() <= MAX_ERROR_LENGTH ? message : message.substring(0, MAX_ERROR_LENGTH);
    }

    /** 任务被取消或不再运行。 */
    private static final class CanceledException extends RuntimeException {
        private CanceledException() { super("改编任务已中止"); }
    }
}
