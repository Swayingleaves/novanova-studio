package com.novanovastudio.service;

import java.math.BigDecimal;
import com.novanovastudio.common.CreditAmounts;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.agent.AgentScopeModelFactory;
import com.novanovastudio.ai.AiTaskTypes;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.NovelAdaptationDtos;
import com.novanovastudio.dto.WholeBookAdaptationDtos;
import com.novanovastudio.dto.WholeBookAdaptationDtos.Slot;
import com.novanovastudio.dto.WholeBookAdaptationDtos.Strategy;
import com.novanovastudio.repository.NovelAdaptationJobRepository;
import com.novanovastudio.repository.NovelAdaptationRepository;
import com.novanovastudio.repository.StoryBibleRepository;
import com.novanovastudio.repository.WholeBookAdaptationRepository;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.task.NovelAdaptationQueue;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.reactive.TransactionalOperator;
import reactor.core.publisher.Mono;

/**
 * 全书改编：分批提炼素材、归纳全书策略、人工确认集数后固定分集，按阶段预扣积分。
 * <p>
 * 每阶段以 {@code novel_adaptation_units} 的持久化输出作为唯一成功依据，续跑只重做未完成单元；
 * 预扣标识按阶段区分，避免三段计费共用同一操作标识被幂等判重而静默跳过扣费。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-10-01 22:30
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class WholeBookAdaptationService {
    /** 素材与策略阶段，一次跑完全书素材归纳与统一策略。 */
    public static final String PHASE_MATERIALS = "materials";
    /** 统一规划阶段，产出全局设定、固定分集与事件取舍。 */
    public static final String PHASE_PLANNING = "planning";
    /** 逐集正文阶段。 */
    public static final String PHASE_DRAFTS = "drafts";
    /** 素材批单元阶段名。 */
    public static final String STAGE_MATERIAL = "material";
    /** 全书策略单元阶段名。 */
    public static final String STAGE_STRATEGY = "strategy";
    /** 逐集规划单元阶段名，也是统一规划停点的标识。 */
    public static final String STAGE_EPISODE_PLAN = "episodePlan";
    /** 素材批单元所属阶段的旧草稿表阶段名。 */
    private static final Set<String> MATERIAL_STAGES = Set.of(STAGE_MATERIAL, STAGE_STRATEGY, "summary");
    /** 计费操作名称，三段共用，靠操作标识区分。 */
    public static final String OPERATION_NAME = "全书改编";

    /** 当前用户提供器。 */
    private final CurrentUserProvider currentUserProvider;

    /** 剧本服务，校验用户归属、项目修订与快照。 */
    private final ScriptService scriptService;

    /** 全书改编快照、单元与阶段认领。 */
    private final WholeBookAdaptationRepository repository;

    /** 一键改编任务仓储。 */
    private final NovelAdaptationJobRepository jobRepository;

    /** 改编草稿归属，停点确认按任务读取本任务的待审草稿。 */
    private final NovelAdaptationRepository novelAdaptationRepository;

    /** 积分服务。 */
    private final CreditService creditService;

    /** 文本模型工厂。 */
    private final AgentScopeModelFactory modelFactory;

    /** 平台模型配置访问，用于解析所选模型的配置标识。 */
    private final PersistenceService persistenceService;

    /** 任务与单元的事务边界。 */
    private final TransactionalOperator transactionalOperator;

    /** 流水线队列，延迟获取避免与执行器形成循环依赖。 */
    private final ObjectProvider<NovelAdaptationQueue> queueProvider;

    /**
     * 免费报价：锁定全部已确认事实后规划素材与策略单元，给出调用次数与预扣积分。
     *
     * @param request 项目、模型与改编设置
     * @return Mono&lt;Quote&gt; 报价与输入指纹
     */
    public Mono<WholeBookAdaptationDtos.Quote> quote(WholeBookAdaptationDtos.QuoteRequest request) {
        return currentUserProvider.currentUserId()
                .flatMap(userId -> prepare(userId, request.projectId(), request.expectedRevision(),
                        request.model(), request.options()).map(Prepared::quote));
    }

    /**
     * 启动全书改编任务：持久化输入快照与生成单元、预扣素材与策略阶段积分后入队。
     *
     * @param request 已确认报价的启动请求
     * @return Mono&lt;View&gt; 任务状态
     */
    public Mono<WholeBookAdaptationDtos.View> start(WholeBookAdaptationDtos.StartRequest request) {
        return currentUserProvider.currentUserId().flatMap(userId ->
                jobRepository.findByRequest(userId, request.clientRequestId()).flatMap(this::view)
                        .switchIfEmpty(Mono.defer(() -> prepare(userId, request.projectId(), request.expectedRevision(),
                                        request.model(), request.options())
                                .flatMap(prepared -> {
                                    if (CreditAmounts.of(prepared.credits()).compareTo(CreditAmounts.of(request.expectedCredits())) != 0
                                            || !prepared.fingerprint().equals(request.expectedFingerprint())) {
                                        return Mono.error(new BusinessException(ErrorCode.DATA_CONFLICT,
                                                "事实、模型价格或改编设置已变化，请重新报价"));
                                    }
                                    String jobId = UUID.randomUUID().toString();
                                    String chargeId = chargeId(jobId, PHASE_MATERIALS);
                                    NovelAdaptationJobRepository.Job job = new NovelAdaptationJobRepository.Job(jobId,
                                            request.projectId(), userId, request.clientRequestId(), prepared.modelValue(),
                                            prepared.modelConfigId(), JSON.parseObject(JSON.toJSONString(prepared.options())),
                                            prepared.factIds(), PHASE_MATERIALS, STAGE_MATERIAL, "queued",
                                            prepared.calls(), 0, prepared.calls(), 0, prepared.credits(), "", null, 0);
                                    WholeBookAdaptationRepository.Workflow workflow = new WholeBookAdaptationRepository.Workflow(
                                            jobId, prepared.revision(), prepared.facts(), prepared.links(), new JSONObject(),
                                            null, List.<Slot>of(), List.<String>of(), prepared.unitPrice());
                                    return transactionalOperator.transactional(jobRepository.insert(job)
                                                    // 单元的外键指向工作流行，必须先写入快照再落单元。
                                                    .then(repository.insert(workflow))
                                                    .then(repository.plan(jobId, PHASE_MATERIALS, prepared.units(), chargeId))
                                                    .then(creditService.chargeOperation(userId, chargeId,
                                                            prepared.credits(), OPERATION_NAME, prepared.modelConfigId())))
                                            .onErrorMap(DataIntegrityViolationException.class, error ->
                                                    new BusinessException(ErrorCode.BUSINESS_ERROR,
                                                            "该项目已有进行中的改编任务，请等待完成或取消后再试"))
                                            .then(enqueue(prepared.modelConfigId(), jobId))
                                            .then(jobRepository.find(jobId)).flatMap(this::view);
                                }))));
    }

    /**
     * 查询任务当前阶段、单元进度、建议策略与锁定集数。
     *
     * @param request 项目与任务标识
     * @return Mono&lt;View&gt; 任务状态
     */
    public Mono<WholeBookAdaptationDtos.View> status(WholeBookAdaptationDtos.JobRequest request) {
        return requireJob(request.projectId(), request.jobId()).flatMap(this::view);
    }

    /**
     * 查询项目当前或最近的一次改编任务，刷新后保留停点确认与失败续跑入口。
     *
     * @param projectId String 项目标识
     * @return Mono&lt;List&lt;View&gt;&gt; 至多一个任务
     */
    public Mono<List<WholeBookAdaptationDtos.View>> active(String projectId) {
        return scriptService.getProject(projectId)
                .then(jobRepository.findLatest(projectId).flatMap(this::view))
                .map(List::of)
                .defaultIfEmpty(List.of());
    }

    /**
     * 策略停点上确认最终集数并按最大余数法固定全部分集身份，重复确认返回既有结果。
     *
     * @param request 用户确认的修订、续跑次数与最终集数
     * @return Mono&lt;View&gt; 已锁定集数的任务状态
     */
    public Mono<WholeBookAdaptationDtos.View> advance(WholeBookAdaptationDtos.AdvanceRequest request) {
        return requireJob(request.projectId(), request.jobId()).flatMap(job -> {
            if (!"awaiting".equals(job.status())) {
                return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "当前任务不在等待确认状态"));
            }
            if (!PHASE_PLANNING.equals(job.phase())) {
                return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "当前停点不需要确认集数"));
            }
            if (job.retryCount() != request.expectedRetryCount()) {
                return Mono.error(new BusinessException(ErrorCode.DATA_CONFLICT, "任务已变化，请刷新后重试"));
            }
            return Mono.zip(repository.find(job.id()), repository.units(job.id()).collectList())
                    .flatMap(input -> {
                        WholeBookAdaptationRepository.Workflow workflow = input.getT1();
                        List<WholeBookAdaptationRepository.Unit> units = input.getT2();
                        if (workflow.revision() != request.expectedRevision()) {
                            return Mono.error(new BusinessException(ErrorCode.DATA_CONFLICT, "正式剧本已变化，请刷新后重新确认"));
                        }
                        Strategy strategy = strategyOf(units);
                        if (strategy == null) {
                            return Mono.error(new BusinessException(ErrorCode.DATA_CONFLICT, "全书策略尚未生成，无法确认集数"));
                        }
                        // 已生成过统一规划单元时幂等返回，不重复规划或扣费。
                        // 只锁定了集数但尚未规划的任务（例如升级前完成确认的）必须继续规划，
                        // 否则会永久停在策略停点，且确认接口找不到任何可应用的草稿。
                        if (units.stream().anyMatch(unit -> PHASE_PLANNING.equals(unit.phase()))) {
                            return jobRepository.find(job.id()).flatMap(this::view);
                        }
                        List<Slot> slots = WholeBookAdaptationPlanner.slots(job.id(), strategy, request.episodeCount());
                        List<WholeBookAdaptationPlanner.Unit> planned = WholeBookAdaptationPlanner.planning(
                                strategy, slots, workflow.facts(), arcFactIds(units, strategy));
                        String chargeId = chargeId(job.id(), PHASE_PLANNING);
                        BigDecimal credits = CreditAmounts.multiply(workflow.unitPrice(), planned.size());
                        return transactionalOperator.transactional(repository.strategy(job.id(), strategy)
                                        .then(repository.configuration(job.id(), workflow.revision(), slots))
                                        .then(repository.plan(job.id(), PHASE_PLANNING, planned, chargeId))
                                        .then(jobRepository.stage(job.id(), PHASE_PLANNING, planned.size(), credits)
                                                .flatMap(staged -> staged ? Mono.<Void>empty()
                                                        : Mono.error(new BusinessException(ErrorCode.DATA_CONFLICT,
                                                                "任务状态已变化，请刷新后重试"))))
                                        .then(creditService.chargeOperation(job.userId(), chargeId, credits, OPERATION_NAME, job.modelConfigId())))
                                .doOnSuccess(ignored -> log.info("全书改编已确认集数并进入统一规划: jobId={}, episodeCount={}, "
                                                + "arcs={}, units={}, credits={}", job.id(), request.episodeCount(),
                                        strategy.arcs().size(), planned.size(), credits))
                                .then(enqueue(job.modelConfigId(), job.id()))
                                .then(jobRepository.find(job.id())).flatMap(this::view);
                    });
        });
    }

    /**
     * 统一规划停点上应用待审草稿，替换概览、大纲、设定与分集，并结束任务。
     * <p>
     * 应用在单个事务内完成，正式内容、来源关联与旧版本快照一起提交；失败或取消时全部回滚。
     *
     * @param request 项目与任务标识
     * @return Mono&lt;View&gt; 任务状态
     */
    public Mono<WholeBookAdaptationDtos.View> confirm(WholeBookAdaptationDtos.JobRequest request) {
        return requireJob(request.projectId(), request.jobId()).flatMap(job -> {
            if (!"awaiting".equals(job.status()) || !PHASE_PLANNING.equals(job.phase())) {
                return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "当前任务不在等待确认统一规划的状态"));
            }
            return repository.units(job.id()).collectList().flatMap(units -> {
                // 策略停点与规划停点的任务状态相同，靠是否已生成规划单元区分，避免给出误导提示。
                if (units.stream().noneMatch(unit -> PHASE_PLANNING.equals(unit.phase()))) {
                    return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID,
                            "统一规划尚未生成，请先确认集数并等待规划完成"));
                }
                return novelAdaptationRepository.listJobDrafts(job.id()).collectList().flatMap(drafts -> {
                    List<String> draftIds = drafts.stream()
                            .filter(draft -> "pending".equals(draft.status()))
                            .filter(draft -> !MATERIAL_STAGES.contains(draft.stage()))
                            .map(NovelAdaptationDtos.JobDraft::draftId).toList();
                    if (draftIds.isEmpty()) {
                        return Mono.error(new BusinessException(ErrorCode.DATA_CONFLICT,
                                "统一规划没有可应用的草稿，请检查任务是否生成失败"));
                    }
                    return scriptService.getProject(job.projectId()).flatMap(project ->
                                    transactionalOperator.transactional(scriptService.applyAdaptationDrafts(
                                                    job.projectId(), project.revision(), draftIds))
                                            .then(Mono.defer(() -> jobRepository.finish(job.id(), "completed", "", job.totalUnits()))
                                                    .flatMap(finished -> finished ? Mono.<Void>empty()
                                                            : Mono.error(new BusinessException(ErrorCode.DATA_CONFLICT,
                                                                    "任务状态已变化，请刷新后重试")))))
                            .doOnSuccess(ignored -> log.info("全书改编已应用统一规划: jobId={}, drafts={}",
                                    job.id(), draftIds.size()))
                            .then(jobRepository.find(job.id())).flatMap(this::view);
                });
            });
        });
    }

    /**
     * 从失败处继续：只重算未完成单元的费用，成功单元保留且不再调用模型。
     * <p>
     * 未完成单元绑定新的预扣标识，因此重复提交不会重复扣费，取消或再次失败只退还本次未完成部分。
     *
     * @param request 项目与任务标识
     * @return Mono&lt;View&gt; 任务状态
     */
    public Mono<WholeBookAdaptationDtos.View> retry(WholeBookAdaptationDtos.JobRequest request) {
        return requireJob(request.projectId(), request.jobId()).flatMap(job -> {
            if (!"failed".equals(job.status())) {
                return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "只有失败任务可以从缺失单元继续"));
            }
            return Mono.zip(repository.find(job.id()), repository.units(job.id()).collectList())
                    .flatMap(input -> {
                        WholeBookAdaptationRepository.Workflow workflow = input.getT1();
                        List<WholeBookAdaptationRepository.Unit> units = input.getT2();
                        int unfinished = (int) units.stream().filter(unit -> unit.output() == null).count();
                        if (unfinished == 0) {
                            return Mono.error(new BusinessException(ErrorCode.DATA_CONFLICT,
                                    "所有生成单元都已成功，请直接确认应用或取消任务"));
                        }
                        int completed = units.size() - unfinished;
                        BigDecimal credits = CreditAmounts.multiply(workflow.unitPrice(), unfinished);
                        String chargeId = chargeId(job.id(), job.phase()) + ":retry:" + (job.retryCount() + 1);
                        return transactionalOperator.transactional(repository.reassign(job.id(), job.phase(), chargeId)
                                        .then(jobRepository.retry(job, completed, unfinished, credits))
                                        .flatMap(staged -> staged ? Mono.<Void>empty()
                                                : Mono.error(new BusinessException(ErrorCode.DATA_CONFLICT,
                                                        "任务状态已变化，请刷新后重试")))
                                        .then(creditService.chargeOperation(job.userId(), chargeId, credits, OPERATION_NAME, job.modelConfigId())))
                                .doOnSuccess(ignored -> log.info("全书改编从失败单元继续: jobId={}, completed={}, "
                                                + "unfinished={}, credits={}", job.id(), completed, unfinished, credits))
                                .then(enqueue(job.modelConfigId(), job.id()))
                                .then(jobRepository.find(job.id())).flatMap(this::view);
                    });
        });
    }

    /**
     * 把故事阶段的来源范围展开为素材批覆盖的事实标识，供事件取舍按阶段分批。
     * <p>
     * 汇总单元按执行顺序逐层展开，因此高层汇总也能追溯到自己覆盖的全部素材批事实。
     *
     * @param units List&lt;Unit&gt; 任务全部单元
     * @param strategy Strategy 已确认的全书策略
     * @return Map&lt;Integer, List&lt;String&gt;&gt; 故事阶段序号到事实标识
     */
    private Map<Integer, List<String>> arcFactIds(List<WholeBookAdaptationRepository.Unit> units, Strategy strategy) {
        Map<String, List<String>> scopes = new LinkedHashMap<>();
        units.stream().filter(unit -> STAGE_MATERIAL.equals(unit.stage())).forEach(unit -> scopes.put(unit.key(),
                unit.input().getJSONArray("factIds").toJavaList(String.class)));
        units.stream().filter(unit -> "summary".equals(unit.stage())).forEach(unit -> {
            List<String> collected = new ArrayList<>();
            unit.input().getJSONArray("sourceKeys").toJavaList(String.class)
                    .forEach(key -> collected.addAll(scopes.getOrDefault(key, List.of())));
            scopes.put(unit.key(), collected);
        });
        Map<Integer, List<String>> arcFactIds = new LinkedHashMap<>();
        for (int arc = 0; arc < strategy.arcs().size(); arc++) {
            List<String> collected = new ArrayList<>();
            strategy.arcs().get(arc).sourceKeys()
                    .forEach(key -> collected.addAll(scopes.getOrDefault(key, List.of())));
            arcFactIds.put(arc, collected);
        }
        return arcFactIds;
    }

    /**
     * 取消任务并按未完成单元退回本阶段预扣积分，已完成产出保留。
     *
     * @param request 项目与任务标识
     * @return Mono&lt;View&gt; 任务状态
     */
    public Mono<WholeBookAdaptationDtos.View> cancel(WholeBookAdaptationDtos.JobRequest request) {
        return requireJob(request.projectId(), request.jobId()).flatMap(job -> {
            if (!Set.of("queued", "running", "awaiting").contains(job.status())) return view(job);
            return Mono.zip(repository.find(job.id()), repository.units(job.id()).collectList())
                    .flatMap(input -> {
                        List<WholeBookAdaptationRepository.Unit> units = input.getT2();
                        int unfinished = (int) units.stream().filter(unit -> unit.output() == null).count();
                        BigDecimal refund = CreditAmounts.multiply(input.getT1().unitPrice(), unfinished);
                        return transactionalOperator.transactional(jobRepository
                                        .finish(job.id(), "canceled", "", units.size() - unfinished)
                                        .flatMap(finished -> finished && CreditAmounts.of(refund).compareTo(CreditAmounts.of(0)) > 0
                                                ? creditService.refundOperation(job.userId(),
                                                        chargeId(job.id(), job.phase()), OPERATION_NAME, refund)
                                                : Mono.<Void>empty()))
                                .then(jobRepository.find(job.id())).flatMap(this::view);
                    });
        });
    }

    /**
     * 读取事实快照并按容量规划素材单元，报价与执行共用同一份规划。
     *
     * @param userId Long 用户标识
     * @param projectId String 项目标识
     * @param expectedRevision long 期望项目修订
     * @param model String 文本模型值
     * @param options Options 改编设置，不含集数
     * @return Mono&lt;Prepared&gt; 快照、单元规划与报价
     */
    private Mono<Prepared> prepare(long userId, String projectId, long expectedRevision, String model,
                                   WholeBookAdaptationDtos.Options options) {
        return scriptService.getSnapshotForUser(userId, projectId, expectedRevision)
                .flatMap(snapshot -> Mono.zip(modelFactory.resolveTextModel(model), modelConfigId(model))
                        .flatMap(selection -> Mono.zip(repository.facts(projectId).collectList(),
                                        repository.links(projectId).collectList())
                                .map(input -> {
                                    List<StoryBibleRepository.Item> facts = input.getT1();
                                    List<WholeBookAdaptationPlanner.Unit> units =
                                            WholeBookAdaptationPlanner.materials(facts);
                                    return new Prepared(snapshot.project().revision(), selection.getT1().modelValue(),
                                            selection.getT2(), selection.getT1().creditCost(), facts, input.getT2(), units,
                                            fingerprint(snapshot.project().revision(), facts, model, options), options);
                                })));
    }

    /** 读取属于当前用户可访问项目的任务。 */
    private Mono<NovelAdaptationJobRepository.Job> requireJob(String projectId, String jobId) {
        return scriptService.getProject(projectId)
                .then(jobRepository.find(jobId))
                .filter(job -> projectId.equals(job.projectId()))
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "改编任务不存在")));
    }

    /** 组装任务状态视图，历史任务没有工作流快照时以任务表数据退化展示。 */
    private Mono<WholeBookAdaptationDtos.View> view(NovelAdaptationJobRepository.Job job) {
        Mono<Optional<WholeBookAdaptationRepository.Workflow>> workflow = repository.find(job.id())
                .map(Optional::of).defaultIfEmpty(Optional.empty());
        return Mono.zip(workflow, repository.units(job.id()).collectList())
                .map(input -> buildView(job, input.getT1().orElse(null), input.getT2()));
    }

    /** 汇总进度、策略与锁定集数，供报价复核和前端停点展示。 */
    private WholeBookAdaptationDtos.View buildView(NovelAdaptationJobRepository.Job job,
                                                   WholeBookAdaptationRepository.Workflow workflow,
                                                   List<WholeBookAdaptationRepository.Unit> units) {
        int processed = (int) units.stream().filter(unit -> unit.output() != null).count();
        List<Slot> slots = workflow == null ? List.of() : workflow.slots();
        BigDecimal unitPrice = workflow == null || CreditAmounts.of(workflow.unitPrice()).compareTo(CreditAmounts.of(0)) <= 0
                ? perCall(job) : workflow.unitPrice();
        BigDecimal refunded = Set.of("canceled", "failed").contains(job.status())
                ? CreditAmounts.multiply(unitPrice, (units.size() - processed)) : BigDecimal.ZERO;
        return new WholeBookAdaptationDtos.View(job.id(), job.phase(), job.stage(), job.status(),
                units.isEmpty() ? job.totalUnits() : units.size(), processed, job.credits(), refunded,
                job.errorMessage(), workflow == null ? 0L : workflow.revision(),
                job.retryCount(), job.settings().toJavaObject(WholeBookAdaptationDtos.Options.class),
                strategyOf(units), slots.size(), slots, workflow == null);
    }

    /** 提取已成功保存的全书策略。 */
    private Strategy strategyOf(List<WholeBookAdaptationRepository.Unit> units) {
        return units.stream().filter(unit -> STAGE_STRATEGY.equals(unit.stage()))
                .map(WholeBookAdaptationRepository.Unit::output).filter(Objects::nonNull)
                .findFirst().map(output -> JSON.parseObject(output.toJSONString(), Strategy.class)).orElse(null);
    }

    /**
     * 按阶段生成预扣标识，保证三段计费各自独立且续跑幂等。
     *
     * @param jobId String 任务标识
     * @param phase String 计费阶段
     * @return String 预扣操作标识
     */
    public static String chargeId(String jobId, String phase) {
        return jobId + ":stage:" + phase;
    }

    /** 输入指纹，覆盖事实范围、项目修订、模型与改编设置。 */
    private String fingerprint(long revision, List<StoryBibleRepository.Item> facts, String model,
                               WholeBookAdaptationDtos.Options options) {
        return Integer.toHexString(Objects.hash(revision, model, options,
                facts.stream().map(StoryBibleRepository.Item::id).toList()));
    }

    /** 按单次调用价格推算单价，仅用于历史任务或快照缺失时的退化展示。 */
    private BigDecimal perCall(NovelAdaptationJobRepository.Job job) {
        return job.estimatedCalls() <= 0 ? BigDecimal.ZERO : CreditAmounts.divide(job.credits(), job.estimatedCalls());
    }

    /** 写入改编队列，失败时交由恢复扫描补发。 */
    private Mono<Void> enqueue(String modelConfigId, String jobId) {
        return queueProvider.getObject().enqueue(modelConfigId, jobId)
                .onErrorResume(error -> {
                    log.error("全书改编任务入队失败，等待恢复扫描补发: jobId={}", jobId, error);
                    return Mono.empty();
                });
    }

    /** 解析所选文本模型对应的平台模型配置标识，队列按该标识限并发。 */
    private Mono<String> modelConfigId(String model) {
        String value = model == null ? "" : model.trim();
        int separator = value.indexOf("::");
        if (separator <= 0) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "所选文本模型格式不合法"));
        }
        String channelId = value.substring(0, separator);
        String modelName = value.substring(separator + 2);
        return persistenceService.getPlatformModelConfigs().flatMap(configs -> configs.stream()
                .filter(config -> AiTaskTypes.TEXT.equals(config.modelType()) && channelId.equals(config.channelId())
                        && modelName.equals(config.modelName()))
                .findFirst().map(config -> Mono.just(config.id()))
                .orElseGet(() -> Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "所选文本模型不可用"))));
    }

    /** 一次启动的输入快照与单元规划。 */
    private record Prepared(long revision, String modelValue, String modelConfigId, BigDecimal unitPrice,
                            List<StoryBibleRepository.Item> facts, List<JSONObject> links,
                            List<WholeBookAdaptationPlanner.Unit> units, String fingerprint,
                            WholeBookAdaptationDtos.Options options) {
        List<String> factIds() { return facts.stream().map(StoryBibleRepository.Item::id).toList(); }
        int calls() { return units.size(); }
        BigDecimal credits() { return CreditAmounts.multiply(unitPrice, calls()); }
        WholeBookAdaptationDtos.Quote quote() {
            return new WholeBookAdaptationDtos.Quote(revision, PHASE_MATERIALS, calls(), credits(), fingerprint);
        }
    }
}
