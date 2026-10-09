package com.novanovastudio.service;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.repository.NovelAdaptationJobRepository;
import com.novanovastudio.repository.StoryBibleRepository;
import com.novanovastudio.repository.WholeBookAdaptationRepository;
import com.novanovastudio.security.CurrentUser;
import com.novanovastudio.security.CurrentUserProvider;
import java.time.Duration;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
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
 * 逐集正文批量执行器：按集顺序生成场次与正文，按模式决定是否立即写入正式剧本。
 * <p>
 * 失败即停在当前分集，已成功的分集保留为唯一成功依据；续跑从缺失分集继续，
 * 取消或失败时未完成分集的预扣积分退回。任务运行中持续刷新进度，前端据此显示分集级进度。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-10-09 11:30
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class EpisodeBodiesRunner {
    /** 执行租约秒数。 */
    public static final int LEASE_SECONDS = 300;
    /** 失败原因最大长度。 */
    private static final int MAX_ERROR_LENGTH = 500;

    /** 任务仓储。 */
    private final NovelAdaptationJobRepository jobRepository;

    /** 快照与生成单元仓储。 */
    private final WholeBookAdaptationRepository repository;

    /** 故事知识库仓储，按分集读取已确认事实。 */
    private final StoryBibleRepository storyBibleRepository;

    /** 逐集正文业务服务。 */
    private final EpisodeBodiesService service;

    /** 剧本服务，用于读取生成基线的正式项目快照。 */
    private final ScriptService scriptService;

    /** 积分服务，取消或失败时退回未完成分集的预扣积分。 */
    private final CreditService creditService;

    /** 失败状态与退款一起提交，避免续跑先于退款结清。 */
    private final TransactionalOperator transactionalOperator;

    /**
     * 认领并执行一次正文批量任务，失败时记录原因并退还未完成分集的积分。
     *
     * @param jobId String 任务标识
     * @return Mono&lt;Void&gt; 执行结果
     */
    public Mono<Void> process(String jobId) {
        return jobRepository.claim(jobId, LEASE_SECONDS).flatMap(claimed -> {
            if (!claimed) return Mono.<Void>empty();
            Disposable renewal = Flux.interval(Duration.ofSeconds(LEASE_SECONDS / 3))
                    .concatMap(ignored -> jobRepository.renewLease(jobId, LEASE_SECONDS))
                    .subscribe(ignored -> { }, error -> log.warn("分集正文批量租约续期失败: jobId={}", jobId, error));
            return run(jobId)
                    .doFinally(signal -> renewal.dispose())
                    .onErrorResume(error -> handleFailure(jobId, error));
        });
    }

    /**
     * 以任务发起人身份执行，业务层通过 Reactor 上下文读取当前用户。
     *
     * @param jobId String 任务标识
     * @return Mono&lt;Void&gt; 执行结果
     */
    private Mono<Void> run(String jobId) {
        return jobRepository.find(jobId)
                .flatMap(job -> executePending(job)
                        // 生成与写入都要以任务发起人身份执行：队列线程没有 HTTP 会话，
                        // 不注入当前用户会在第一个需要鉴权的步骤以“请先登录”失败。
                        .contextWrite(context -> context.put(CurrentUserProvider.CURRENT_USER_CONTEXT_KEY,
                                new CurrentUser(job.userId(), "", "user", 1))));
    }

    /**
     * 顺序处理所有未完成分集，全部结束后把任务标记为完成。
     *
     * @param job Job 当前任务
     * @return Mono&lt;Void&gt; 执行结果
     */
    private Mono<Void> executePending(NovelAdaptationJobRepository.Job job) {
        String jobId = job.id();
        return repository.units(jobId).collectList()
                .flatMap(units -> {
                    List<WholeBookAdaptationRepository.Unit> bodies = units.stream()
                            .filter(unit -> EpisodeBodiesService.PHASE_BODIES.equals(unit.phase())).toList();
                    boolean apply = EpisodeBodiesService.MODE_APPLY.equals(job.settings().getString("mode"));
                    List<WholeBookAdaptationRepository.Unit> pending = bodies.stream()
                            .filter(unit -> !finished(unit, apply)).toList();
                    AtomicInteger processed = new AtomicInteger(bodies.size() - pending.size());
                    if (pending.isEmpty()) {
                        return completeJob(job, bodies.size());
                    }
                    // 事实快照在执行阶段一次读取：报价不为整本书上千条事实付出读取代价，
                    // 这里再按事件取舍把每集的上下文收敛到本集事实。
                    return storyBibleRepository.listConfirmedItems(job.projectId()).collectList()
                            .flatMap(facts -> {
                                Map<String, StoryBibleRepository.Item> factIndex = new LinkedHashMap<>();
                                facts.forEach(fact -> factIndex.put(fact.id(), fact));
                                Set<String> known = factIndex.keySet();
                                // 事件取舍结果属于已应用的规划任务：正文批量是独立任务，
                                // 按自己的 jobId 查规划单元永远为空，必须按项目回溯最近一次已应用的任务。
                                return repository.latestCompletedOutputs(job.projectId(),
                                                WholeBookAdaptationService.PHASE_PLANNING, "assignment")
                                        .collectList()
                                        .map(EpisodeBodiesPlanner::episodeFacts)
                                        .flatMap(assignments -> Flux
                                                .fromIterable(pending)
                                                .concatMap(unit -> ensureRunning(jobId)
                                                        .then(Mono.defer(() -> processUnit(job, unit,
                                                                factIndex, assignments, known)))
                                                        .flatMap(draftId -> finishUnit(job, unit, draftId))
                                                        .then(Mono.defer(() -> jobRepository.progress(jobId,
                                                                processed.incrementAndGet(), bodies.size()))))
                                                .then(Mono.defer(() -> completeJob(job, bodies.size()))));
                            });
                });
    }

    /**
     * 生成一集的正文并返回草稿标识；草稿已存在时直接复用，模型调用只发生一次。
     * <p>
     * 快照与草稿基线一律取<b>当前</b>项目修订号，不能用整批开始时的固定基线：立即写入模式下
     * 每应用一集就递增一次项目修订号，沿用固定基线会让第二集起在取快照时就报「剧本已在其他页面更新」，
     * 而草稿的基线修订号也要与写入时的修订号一致，否则批量应用会以「基于旧修订生成」拒绝。
     *
     * @param job Job 当前任务
     * @param unit Unit 当前分集单元
     * @param factIndex Map&lt;String, Item&gt; 事实索引
     * @param assignments Map&lt;String, List&lt;String&gt;&gt; 分集事实范围
     * @param known Set&lt;String&gt; 全书已确认事实标识
     * @return Mono&lt;String&gt; 草稿标识
     */
    private Mono<String> processUnit(NovelAdaptationJobRepository.Job job,
                                     WholeBookAdaptationRepository.Unit unit,
                                     Map<String, StoryBibleRepository.Item> factIndex,
                                     Map<String, List<String>> assignments, Set<String> known) {
        String draftId = unit.output() == null ? null : unit.output().getString("draftId");
        if (draftId != null) return Mono.just(draftId);
        String episodeId = unit.input().getString("episodeId");
        if (episodeId == null || episodeId.isBlank()) {
            return Mono.error(new BusinessException(ErrorCode.DATA_CONFLICT, "生成单元缺少目标分集，请重新发起"));
        }
        return scriptService.getProject(job.projectId())
                .flatMap(project -> scriptService
                        .getSnapshotForUser(job.userId(), job.projectId(), project.revision())
                        .flatMap(snapshot -> service.generateDraft(job, project.revision(), episodeId,
                                service.bodyInput(job, snapshot, episodeId,
                                        service.factScope(assignments, known, episodeId), factIndex))));
    }

    /**
     * 按模式处理生成结果：先保存生成产出，再按模式写入正式剧本，最后才标记完成。
     * <p>
     * 标记完成必须放在写入之后：完成标记是续跑的唯一依据，先标记会让中断在两步之间时，
     * 该集被当成已完成而永远不会写回正式剧本。只出草稿模式没有写入步骤，生成成功即完成。
     *
     * @param job Job 当前任务
     * @param unit Unit 当前分集单元
     * @param draftId String 草稿标识
     * @return Mono&lt;Void&gt; 处理结果
     */
    private Mono<Void> finishUnit(NovelAdaptationJobRepository.Job job,
                                  WholeBookAdaptationRepository.Unit unit, String draftId) {
        return repository.generate(job.id(), unit, draftId)
                .flatMap(saved -> saved ? Mono.just(draftId)
                        : Mono.error(new BusinessException(ErrorCode.DATA_CONFLICT, "任务已结束，本次生成结果未结算")))
                .then(Mono.defer(() -> EpisodeBodiesService.MODE_APPLY.equals(job.settings().getString("mode"))
                        ? service.applyDraft(job, draftId) : Mono.<Void>empty()))
                .then(Mono.defer(() -> repository.markApplied(job.id(), unit)))
                .then();
    }

    /** 全部单元成功后结束任务。 */
    private Mono<Void> completeJob(NovelAdaptationJobRepository.Job job, int total) {
        return jobRepository.finish(job.id(), "completed", "", total)
                .doOnNext(done -> log.info("分集正文批量已完成: jobId={}, episodes={}", job.id(), total))
                .then();
    }

    /** 确认任务仍在运行，取消后立即中断当前阶段。 */
    private Mono<Void> ensureRunning(String jobId) {
        return jobRepository.status(jobId)
                .flatMap(status -> "running".equals(status) ? Mono.<Void>empty()
                        : Mono.error(new CanceledException()));
    }

    /** 单元是否已真正完成：只出草稿时生成即完成，立即写入时还要求已写回正式剧本。 */
    private boolean finished(WholeBookAdaptationRepository.Unit unit, boolean apply) {
        return unit.output() != null && (!apply || unit.completedAt() != null);
    }

    /**
     * 记录失败原因并退还未完成分集的预扣积分。
     *
     * @param jobId String 任务标识
     * @param error Throwable 失败原因
     * @return Mono&lt;Void&gt; 处理结果
     */
    private Mono<Void> handleFailure(String jobId, Throwable error) {
        if (error instanceof CanceledException) return Mono.empty();
        log.error("分集正文批量执行失败: jobId={}", jobId, error);
        return jobRepository.find(jobId).flatMap(job -> {
            if (!"running".equals(job.status())) return Mono.<Void>empty();
            String message = truncate(error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage());
            return Mono.zip(repository.find(jobId), repository.units(jobId).collectList())
                    .flatMap(input -> {
                        boolean apply = EpisodeBodiesService.MODE_APPLY.equals(job.settings().getString("mode"));
                        List<WholeBookAdaptationRepository.Unit> units = input.getT2().stream()
                                .filter(unit -> EpisodeBodiesService.PHASE_BODIES.equals(unit.phase())).toList();
                        int done = (int) units.stream().filter(unit -> finished(unit, apply)).count();
                        int unitPrice = input.getT1().unitPrice();
                        Set<String> charges = new HashSet<>(units.stream()
                                .map(WholeBookAdaptationRepository.Unit::chargeId).toList());
                        return transactionalOperator.transactional(jobRepository
                                        .finish(jobId, "failed", message, done)
                                        .flatMap(finished -> finished
                                                ? Flux.fromIterable(charges).concatMap(chargeId ->
                                                        refund(job, units, apply, chargeId, unitPrice)).then()
                                                : Mono.<Void>empty()))
                                .then();
                    });
        });
    }

    /** 按单个预扣标识下未完成的分集数退回积分。 */
    private Mono<Void> refund(NovelAdaptationJobRepository.Job job,
                              List<WholeBookAdaptationRepository.Unit> units, boolean apply,
                              String chargeId, int unitPrice) {
        if (unitPrice <= 0) return Mono.empty();
        int unfinished = (int) units.stream()
                .filter(unit -> chargeId.equals(unit.chargeId()))
                .filter(unit -> !finished(unit, apply)).count();
        return unfinished == 0 ? Mono.empty()
                : creditService.refundOperation(job.userId(), chargeId, "分集正文批量生成", unfinished * unitPrice);
    }

    /** 截断失败原因，避免超出列长度。 */
    private String truncate(String message) {
        return message.length() <= MAX_ERROR_LENGTH ? message : message.substring(0, MAX_ERROR_LENGTH);
    }

    /** 用户主动取消时抛出的内部控制信号。 */
    private static final class CanceledException extends RuntimeException {
        /** 使用固定原因创建取消信号。 */
        private CanceledException() { super("分集正文批量任务已中止"); }
    }
}
