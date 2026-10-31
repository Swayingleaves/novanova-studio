package com.novanovastudio.service;

import java.math.BigDecimal;
import com.novanovastudio.common.CreditAmounts;

import com.alibaba.fastjson2.JSON;
import com.novanovastudio.agent.AgentScopeModelFactory;
import com.novanovastudio.ai.AiTaskTypes;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.NovelAdaptationDtos;
import com.novanovastudio.dto.ScriptDtos;
import com.novanovastudio.dto.StoryBibleDtos;
import com.novanovastudio.repository.NovelAdaptationJobRepository;
import com.novanovastudio.repository.NovelAdaptationRepository;
import com.novanovastudio.repository.StoryBibleRepository;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.task.NovelAdaptationQueue;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.reactive.TransactionalOperator;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 基于用户选定且已确认的故事事实组织逐阶段小说改编。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-09-28 18:00
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class NovelAdaptationService {
    /** 单次生成的事实正文上限，超过时要求用户缩小选择；一键流水线按阶段分流后通常一批即可完成。 */
    private static final int MAXIMUM_FACT_CHARACTERS = 80_000;

    /** 一键流水线的计费操作名称，每次续跑使用独立的预扣与退款标识。 */
    public static final String OPERATION_NAME = "小说改编一键生成";

    /** 骨架阶段顺序执行，人物与地点先落，便于大纲直接引用已归纳的角色名。 */
    public static final List<String> SKELETON_STAGES = List.of("overview", "characters", "world", "outline");

    /** 各阶段的输入条目类型，一键流水线按此分流事实；单集正文的剧情已在分集规划中确定，只补人物与地点设定。 */
    public static final Map<String, List<String>> STAGE_TYPES = Map.of(
            "overview", List.of("character", "location", "relationship", "event", "storyline"),
            "characters", List.of("character", "relationship"),
            "world", List.of("location"),
            "outline", List.of("event", "storyline"),
            "episodes", List.of("event", "storyline"),
            "episode", List.of("character", "location"));

    /** 需要逐条原文依据的阶段：归纳人物与地点设定必须核对原文，其余阶段只带事实摘要以控制单次输入容量。 */
    public static final Set<String> EVIDENCE_STAGES = Set.of("characters", "world");

    /**
     * 单批条数上限。同时受两个约束：上下文按JSON序列化长度校验（12万字符），
     * 以及模型单次调用的输出量与耗时（超时600秒）。输出与条数成正比的阶段必须用更小的批。
     */
    public static final int FEATURE_BATCH_SIZE = 60;
    public static final int BULK_BATCH_SIZE = 200;

    /** 概览只产出一个对象、大纲与分集产出归纳结果、单集正文每集一条，均按此批上限。 */
    public static final Map<String, Integer> STAGE_BATCH_SIZE = Map.of(
            "overview", 600, "outline", 400, "episodes", 400, "episode", 60);

    /** 单集正文最多补充的人物与地点条数，按证据数取最相关的前若干条。 */
    public static final int FEATURE_LIMIT = 40;

    /** 分档阈值：证据条数达到该值的条目按主要条目处理，低于则只保留名称与说明。 */
    public static final int MINOR_EVIDENCE_THRESHOLD = 3;

    /** 当前用户提供器。 */
    private final CurrentUserProvider currentUserProvider;

    /** 剧本服务，校验用户归属与项目修订。 */
    private final ScriptService scriptService;

    /** 故事知识库数据库访问。 */
    private final StoryBibleRepository storyBibleRepository;

    /** 剧本专用文本模型服务。 */
    private final ScriptAgentService scriptAgentService;

    /** 改编来源数据库访问。 */
    private final NovelAdaptationRepository novelAdaptationRepository;

    /** 关联与资产创建的原子事务。 */
    private final TransactionalOperator transactionalOperator;

    /** 一键改编任务仓储。 */
    private final NovelAdaptationJobRepository jobRepository;

    /** 积分服务。 */
    private final CreditService creditService;

    /** 文本模型工厂，用于按模型读取单次调用积分。 */
    private final AgentScopeModelFactory modelFactory;

    /** 平台模型配置访问，用于解析所选文本模型的配置标识。 */
    private final PersistenceService persistenceService;

    /** 流水线队列，延迟获取避免与执行器形成循环依赖。 */
    private final ObjectProvider<NovelAdaptationQueue> queueProvider;

    /**
     * 读取选定事实并生成待人工确认的改编草稿。
     *
     * @param request 改编阶段、设定、目标与事实标识
     * @return 已持久化的剧本草稿
     */
    public Mono<ScriptDtos.AiDraft> generateDraft(NovelAdaptationDtos.GenerateRequest request) {
        return generateDraft(request, false);
    }

    /**
     * 读取事实并生成草稿，区分单次扣费与任务预扣场景。
     * @param request GenerateRequest 本批生成请求
     * @param prepaid boolean 是否已由任务预扣
     * @return Mono&lt;AiDraft&gt; 已保存草稿
     */
    private Mono<ScriptDtos.AiDraft> generateDraft(NovelAdaptationDtos.GenerateRequest request, boolean prepaid) {
        return generateDraft(request, prepaid, null);
    }

    /**
     * 组织任务批次输入，并在保存生成结果时原子记录任务归属。
     * @param request GenerateRequest 本批生成请求
     * @param prepaid boolean 是否由任务预扣
     * @param jobId String 所属任务标识，单次生成时为空
     * @return Mono&lt;AiDraft&gt; 已保存草稿
     */
    private Mono<ScriptDtos.AiDraft> generateDraft(NovelAdaptationDtos.GenerateRequest request, boolean prepaid, String jobId) {
        if (request.factIds().size() != Set.copyOf(request.factIds()).size()) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "故事事实不能重复选择"));
        }
        return currentUserProvider.currentUserId()
                .flatMap(userId -> scriptService.getSnapshotForUser(userId, request.projectId(), request.expectedRevision()))
                .flatMap(snapshot -> {
                    validateStage(request, snapshot);
                    return Flux.fromIterable(request.factIds()).concatMap(id -> storyBibleRepository.getItem(request.projectId(), id)
                            .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "所选故事事实不存在")))
                            .flatMap(item -> {
                                if (!"confirmed".equals(item.status()) || item.suggestForItemId() != null) {
                                    return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "只能选择已确认的故事事实"));
                                }
                                return evidencesFor(request.stage(), id).map(evidences ->
                                        new NovelAdaptationDtos.Fact(item.id(), item.revision(), item.itemType(),
                                                item.name(), item.summary(), item.storyTime(), evidences.stream()
                                                .map(evidence -> new NovelAdaptationDtos.FactEvidence(evidence.startOffset(),
                                                        evidence.endOffset(), evidence.quote()))
                                                .toList()));
                            })).collectList().flatMap(facts -> {
                        if (facts.stream().mapToInt(fact -> fact.name().length() + fact.summary().length()
                                + fact.evidences().stream().mapToInt(evidence -> evidence.quote().length()).sum()).sum()
                                > MAXIMUM_FACT_CHARACTERS) {
                            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID,
                                    "所选事实超过单次生成容量，请缩小事实范围"));
                        }
                        return scriptAgentService.generateAdaptationDraft(request, snapshot, facts, prepaid, jobId);
                    });
                });
    }

    /**
     * 免费检查事实版本、目标存续和故事时间不确定性。
     *
     * @param projectId 共享项目标识
     * @return 待人工审阅问题列表
     */
    public Mono<List<NovelAdaptationDtos.ConsistencyIssue>> checkConsistency(String projectId) {
        return scriptService.getProject(projectId).flatMap(project -> Mono.zip(
                novelAdaptationRepository.listSourceImpacts(projectId).collectList(),
                storyBibleRepository.listUncertainEvents(projectId).collectList())
                .map(result -> {
                    List<NovelAdaptationDtos.ConsistencyIssue> issues = new ArrayList<>();
                    Set<String> outlineIds = new HashSet<>();
                    project.outlineSections().forEach(section -> outlineIds.add(section.id()));
                    project.storyEvents().forEach(event -> outlineIds.add(event.id()));
                    Set<String> episodeIds = new HashSet<>();
                    project.episodes().forEach(episode -> episodeIds.add(episode.id()));
                    for (NovelAdaptationDtos.SourceImpact impact : result.getT1()) {
                        if (impact.needsReview()) {
                            issues.add(new NovelAdaptationDtos.ConsistencyIssue("sourceRevision", "warning",
                                    "故事事实已变化", "改编内容仍引用旧版事实，请审阅后选择局部更新范围",
                                    impact.factId(), impact.targetType(), impact.targetId()));
                        }
                        if (("outline".equals(impact.targetType()) && !outlineIds.contains(impact.targetId()))
                                || ("episode".equals(impact.targetType()) && !episodeIds.contains(impact.targetId()))) {
                            issues.add(new NovelAdaptationDtos.ConsistencyIssue("missingTarget", "warning",
                                    "改编目标已删除", "来源关联对应的正式内容已不存在",
                                    impact.factId(), impact.targetType(), impact.targetId()));
                        }
                    }
                    result.getT2().forEach(item -> issues.add(new NovelAdaptationDtos.ConsistencyIssue(
                                    "uncertainTime", "info", "事件时间待确认", "该事件的故事发生顺序尚未确认，生成时需人工判断",
                                    item.id(), "storyBible", item.id())));
                    return issues;
                }));
    }

    /**
     * 用户确认费用后对剧本与所选事实做模型深入一致性分析。
     *
     * @param request 已确认的模型、事实与项目修订号
     * @return 持久化的剧本分析报告
     */
    public Mono<ScriptDtos.AnalysisReport> analyzeConsistency(NovelAdaptationDtos.AnalyzeRequest request) {
        if (request.factIds().size() != Set.copyOf(request.factIds()).size()) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "故事事实不能重复选择"));
        }
        return currentUserProvider.currentUserId()
                .flatMap(userId -> scriptService.getSnapshotForUser(userId, request.projectId(), request.expectedRevision()))
                .flatMap(snapshot -> Flux.fromIterable(request.factIds()).concatMap(id -> storyBibleRepository.getItem(request.projectId(), id)
                        .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "所选故事事实不存在")))
                        .flatMap(item -> "confirmed".equals(item.status())
                                ? Mono.just(new NovelAdaptationDtos.Fact(item.id(), item.revision(), item.itemType(),
                                item.name(), item.summary(), item.storyTime(), List.of()))
                                : Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "只能分析已确认事实"))))
                        .collectList().flatMap(facts -> scriptAgentService.analyzeAdaptationConsistency(request,
                                snapshot, facts)));
    }

    /**
     * 查询改编草稿的用户设置和生成时事实快照。
     *
     * @param projectId 共享剧本项目标识
     * @return 草稿来源列表
     */
    public Mono<List<NovelAdaptationDtos.DraftSource>> listDraftSources(String projectId) {
        return scriptService.getProject(projectId).then(novelAdaptationRepository.listDraftSources(projectId).collectList());
    }

    /**
     * 查询上游事实变更对正式改编内容的影响，不修改已完成产物。
     *
     * @param projectId 共享剧本项目标识
     * @return 来源影响列表
     */
    public Mono<List<NovelAdaptationDtos.SourceImpact>> listSourceImpacts(String projectId) {
        return scriptService.getProject(projectId).then(novelAdaptationRepository.listSourceImpacts(projectId).collectList());
    }

    /**
     * 一键改编报价：锁定全部已确认事实后按阶段分流估算调用次数与预扣积分。
     *
     * @param request 启动请求
     * @return Mono&lt;JobQuote&gt; 报价
     */
    public Mono<NovelAdaptationDtos.JobQuote> quotePipeline(NovelAdaptationDtos.StartJobRequest request) {
        return currentUserProvider.currentUserId()
                .flatMap(userId -> prepare(userId, request))
                .map(prepared -> new NovelAdaptationDtos.JobQuote(prepared.factIds().size(), prepared.skeletonCalls(),
                        prepared.episodeCalls(), prepared.calls(), prepared.credits()));
    }

    /**
     * 启动一键改编任务：锁定事实快照、预扣积分并入队执行，重复提交返回既有任务。
     *
     * @param request 启动请求
     * @return Mono&lt;JobView&gt; 任务状态
     */
    public Mono<NovelAdaptationDtos.JobView> startPipeline(NovelAdaptationDtos.StartJobRequest request) {
        return currentUserProvider.currentUserId().flatMap(userId ->
                jobRepository.findByRequest(userId, request.clientRequestId()).flatMap(this::view)
                        .switchIfEmpty(Mono.defer(() -> prepare(userId, request).flatMap(prepared -> {
                            String jobId = UUID.randomUUID().toString();
                            NovelAdaptationJobRepository.Job job = new NovelAdaptationJobRepository.Job(jobId,
                                    request.projectId(), userId, request.clientRequestId(), request.model(),
                                    prepared.modelConfigId(),
                                    JSON.parseObject(JSON.toJSONString(request.settings())),
                                    prepared.factIds(), "skeleton", "overview", "queued", prepared.calls(), 0,
                                    prepared.calls(), 0, prepared.credits(), "", null, 0);
                            return transactionalOperator.transactional(
                                            // 每次一键改编整体重建，先清掉上次失败或中断留下的待审草稿。
                                            novelAdaptationRepository.deletePendingAdaptationDrafts(request.projectId())
                                                    .then(jobRepository.insert(job))
                                                    .then(creditService.chargeOperation(userId, jobId,
                                                            prepared.credits(), OPERATION_NAME, prepared.modelConfigId())))
                                    .onErrorMap(DataIntegrityViolationException.class, error ->
                                            new BusinessException(ErrorCode.BUSINESS_ERROR,
                                                    "该项目已有进行中的改编任务，请等待完成或取消后再试"))
                                    .then(Mono.defer(() -> enqueue(prepared.modelConfigId(), jobId)))
                                    .then(Mono.defer(() -> jobRepository.find(jobId)))
                                    .flatMap(this::view);
                        }))));
    }

    /**
     * 一键流水线生成一份阶段草稿并归属任务，停点确认时按任务查询这些草稿。
     *
     * @param jobId 任务标识
     * @param request 改编生成请求
     * @return Mono&lt;AiDraft&gt; 生成的草稿
     */
    public Mono<ScriptDtos.AiDraft> generateStageDraft(String jobId, NovelAdaptationDtos.GenerateRequest request) {
        // 模型调用不持有数据库事务，草稿与任务归属在生成后的保存事务中一起提交。
        return generateDraft(request, true, jobId);
    }

    /**
     * 查询一键改编任务状态与产出的草稿。
     * @param request JobRequest 项目与任务标识
     * @return Mono&lt;JobView&gt; 任务状态
     */
    public Mono<NovelAdaptationDtos.JobView> pipelineStatus(NovelAdaptationDtos.JobRequest request) {
        return requireJob(request.projectId(), request.jobId()).flatMap(this::view);
    }

    /**
     * 查询项目当前或最近的一键改编任务，刷新后保留失败续跑入口。
     *
     * @param projectId String 项目标识
     * @return Mono&lt;List&lt;JobView&gt;&gt; 至多一个任务
     */
    public Mono<List<NovelAdaptationDtos.JobView>> listActivePipeline(String projectId) {
        return scriptService.getProject(projectId)
                .then(jobRepository.findLatest(projectId).flatMap(this::view))
                .map(List::of)
                .defaultIfEmpty(List.of());
    }

    /**
     * 查询失败任务的续跑费用，已成功草稿与正式内容保留。
     * @param request JobRequest 项目与失败任务标识
     * @return Mono&lt;RetryQuote&gt; 当前修订、缺失调用数与待预扣积分
     */
    public Mono<NovelAdaptationDtos.RetryQuote> quoteRetryPipeline(NovelAdaptationDtos.JobRequest request) {
        return requireJob(request.projectId(), request.jobId()).flatMap(this::prepareRetry);
    }

    /**
     * 用户确认报价后将失败任务重新排队，只执行尚未保存成功的批次。
     * @param request RetryJobRequest 用户确认的修订、费用与续跑次数
     * @return Mono&lt;JobView&gt; 续跑后的任务状态
     */
    public Mono<NovelAdaptationDtos.JobView> retryPipeline(NovelAdaptationDtos.RetryJobRequest request) {
        return requireJob(request.projectId(), request.jobId()).flatMap(job -> {
            if (Set.of("queued", "running", "awaiting", "completed").contains(job.status())
                    && job.retryCount() == request.expectedRetryCount() + 1) return view(job);
            return prepareRetry(job).flatMap(quote -> {
                if (quote.revision() != request.expectedRevision() || quote.remainingCalls() != request.expectedRemainingCalls()
                        || CreditAmounts.of(quote.credits()).compareTo(CreditAmounts.of(request.expectedCredits())) != 0 || job.retryCount() != request.expectedRetryCount()) {
                    return Mono.error(new BusinessException(ErrorCode.DATA_CONFLICT, "续跑条件或费用已变化，请重新确认"));
                }
                BigDecimal perCall = job.estimatedCalls() == 0 ? BigDecimal.ZERO : CreditAmounts.divide(job.credits(), job.estimatedCalls());
                return transactionalOperator.transactional(jobRepository.retry(job, quote.completedCalls(), quote.remainingCalls(),
                                CreditAmounts.multiply(perCall, (quote.completedCalls() + quote.remainingCalls())))
                        .flatMap(updated -> updated
                                ? creditService.chargeOperation(job.userId(), job.id() + ":retry:" + (job.retryCount() + 1),
                                        quote.credits(), OPERATION_NAME, job.modelConfigId())
                                : Mono.error(new BusinessException(ErrorCode.DATA_CONFLICT, "任务状态已变化，请刷新后重试"))))
                        .onErrorMap(DataIntegrityViolationException.class, error -> new BusinessException(ErrorCode.DATA_CONFLICT,
                                "该项目已有进行中的改编任务，不能继续旧任务"))
                        .doOnSuccess(ignored -> log.info("小说改编失败任务已续跑: jobId={}, retryCount={}, completedCalls={}, remainingCalls={}, credits={}",
                                job.id(), job.retryCount() + 1, quote.completedCalls(), quote.remainingCalls(), quote.credits()))
                        .then(Mono.defer(() -> enqueue(job.modelConfigId(), job.id())))
                        .then(Mono.defer(() -> jobRepository.find(job.id()))).flatMap(this::view);
            });
        });
    }

    /**
     * 复用成功草稿校验续跑基线，按现有分批规则计算当前与后续阶段的缺失调用。
     * @param job Job 失败任务
     * @return Mono&lt;RetryQuote&gt; 续跑报价
     */
    private Mono<NovelAdaptationDtos.RetryQuote> prepareRetry(NovelAdaptationJobRepository.Job job) {
        if (!"failed".equals(job.status())) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "只有失败任务可以从当前阶段继续"));
        }
        Set<String> factIds = Set.copyOf(job.factIds());
        return scriptService.getProject(job.projectId())
                .flatMap(project -> scriptService.getSnapshotForUser(job.userId(), job.projectId(), project.revision()))
                .flatMap(snapshot -> Mono.zip(novelAdaptationRepository.listCheckpoints(job.id()).collectList(),
                        storyBibleRepository.listConfirmedItemTypes(job.projectId())
                                .filter(item -> factIds.contains(item.id())).collectList())
                        .flatMap(input -> {
                            List<NovelAdaptationRepository.DraftCheckpoint> checkpoints = input.getT1();
                            List<StoryBibleRepository.ItemTypeRef> items = input.getT2();
                            if (items.size() != job.factIds().size()) {
                                return Mono.error(new BusinessException(ErrorCode.DATA_CONFLICT, "任务所选事实已变化，请审阅后重新发起"));
                            }
                            Set<String> completed = NovelAdaptationPlan.completedKeys(checkpoints);
                            List<NovelAdaptationPlan.Unit> current = NovelAdaptationPlan.units(job.phase(), items, snapshot.project().episodes(), checkpoints);
                            int remaining = (int) current.stream().filter(unit -> !completed.contains(unit.key())).count();
                            if ("skeleton".equals(job.phase())) remaining += NovelAdaptationPlan.units("episodes", items, List.of()).size();
                            if (!"drafts".equals(job.phase())) {
                                int episodeCount = snapshot.project().episodes().isEmpty()
                                        ? job.settings().getIntValue("episodeCount") : snapshot.project().episodes().size();
                                remaining += episodeCount * NovelAdaptationPlan.units("drafts", items,
                                        List.of(new ScriptDtos.EpisodeSummary("planned", 1, "预期分集", "", "", "", "", "", 0, "planning", 0))).size();
                            }
                            BigDecimal perCall = job.estimatedCalls() == 0 ? BigDecimal.ZERO : CreditAmounts.divide(job.credits(), job.estimatedCalls());
                            NovelAdaptationDtos.RetryQuote quote = new NovelAdaptationDtos.RetryQuote(snapshot.project().revision(),
                                    job.phase(), checkpoints.size(), remaining, CreditAmounts.multiply(perCall, remaining), job.retryCount());
                            return validateCheckpoints(job, snapshot, current, checkpoints)
                                    .thenReturn(quote);
                        }));
    }

    /**
     * 报价和后台恢复共用检查点校验，避免排队期间内容变化后仍跳过旧草稿。
     * @param job Job 当前任务
     * @param snapshot ProjectSnapshot 当前正式内容
     * @param units List&lt;Unit&gt; 当前阶段规划
     * @param checkpoints List&lt;DraftCheckpoint&gt; 已保存草稿
     * @return Mono&lt;Void&gt; 校验通过信号
     * @throws BusinessException 草稿被放弃、事实或正式目标发生变化时拒绝恢复
     */
    public Mono<Void> validateCheckpoints(NovelAdaptationJobRepository.Job job, ScriptDtos.ProjectSnapshot snapshot,
                                          List<NovelAdaptationPlan.Unit> units,
                                          List<NovelAdaptationRepository.DraftCheckpoint> checkpoints) {
        Set<String> currentKeys = units.stream().map(NovelAdaptationPlan.Unit::key).collect(java.util.stream.Collectors.toSet());
        for (NovelAdaptationRepository.DraftCheckpoint checkpoint : checkpoints) {
            if (!Set.of("pending", "applied").contains(checkpoint.status())) {
                return Mono.error(new BusinessException(ErrorCode.DATA_CONFLICT, "任务草稿已被放弃，不能直接继续"));
            }
            // 已应用的前置阶段允许后续阶段更新；待审产物必须仍与正式内容共享同一基线。
            if ("pending".equals(checkpoint.status())) {
                if (checkpoint.baseRevision() != snapshot.project().revision()
                        || !Objects.equals(checkpoint.sourceData(), scriptService.targetSnapshot(snapshot,
                                checkpoint.stage(), checkpoint.targetId()))) {
                    return Mono.error(new BusinessException(ErrorCode.DATA_CONFLICT, "正式内容已变化，无法复用待审草稿，请先审阅"));
                }
                String key = new NovelAdaptationPlan.Unit(checkpoint.stage(), checkpoint.targetId(),
                        checkpoint.facts().stream().map(NovelAdaptationDtos.Fact::id).toList()).key();
                if (!currentKeys.contains(key)) {
                    return Mono.error(new BusinessException(ErrorCode.DATA_CONFLICT, "事实分批范围已变化，不能直接续跑旧草稿"));
                }
            }
        }
        return Flux.fromIterable(checkpoints).concatMap(checkpoint ->
                novelAdaptationRepository.requireCurrentFacts(job.projectId(), checkpoint.facts())).then();
    }

    /**
     * 确定当前执行尝试的扣费与退款标识，首次执行沿用任务标识。
     * @param job Job 当前任务
     * @return String 独立计费操作标识
     */
    public static String chargeOperationId(NovelAdaptationJobRepository.Job job) {
        return job.retryCount() == 0 ? job.id() : job.id() + ":retry:" + job.retryCount();
    }

    /**
     * 应用当前停点的待审草稿并继续执行，最后一站完成后任务结束。
     *
     * @param request 任务请求
     * @return Mono&lt;JobView&gt; 任务状态
     */
    public Mono<NovelAdaptationDtos.JobView> confirmPipeline(NovelAdaptationDtos.JobRequest request) {
        return requireJob(request.projectId(), request.jobId()).flatMap(job -> {
            if (!"awaiting".equals(job.status())) {
                return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "当前任务不在等待确认状态"));
            }
            String nextPhase = switch (job.phase()) {
                case "skeleton" -> "episodes";
                case "episodes" -> "drafts";
                default -> null;
            };
            // 停点内容与任务推进一起提交，应用失败或任务被取消时整批回滚。
            return transactionalOperator.transactional(applyJobDrafts(job)
                    .then(Mono.defer(() -> nextPhase == null
                            ? jobRepository.finish(job.id(), "completed", "", job.settledCalls())
                            : jobRepository.resume(job.id(), nextPhase)))
                    .flatMap(updated -> updated ? Mono.<Void>empty() : Mono.error(new BusinessException(
                            ErrorCode.DATA_CONFLICT, "改编任务状态已变化，请刷新后重试"))))
                    .then(Mono.defer(() -> nextPhase == null ? Mono.<Void>empty() : enqueue(job.modelConfigId(), job.id())))
                    .then(Mono.defer(() -> jobRepository.find(job.id())))
                    .flatMap(this::view);
        });
    }

    /**
     * 取消一键改编任务并退还未结算的调用积分。
     *
     * @param request 任务请求
     * @return Mono&lt;JobView&gt; 任务状态
     */
    public Mono<NovelAdaptationDtos.JobView> cancelPipeline(NovelAdaptationDtos.JobRequest request) {
        return requireJob(request.projectId(), request.jobId()).flatMap(job -> {
            if (!Set.of("queued", "running", "awaiting").contains(job.status())) return view(job);
            int settled = Math.min(job.settledCalls(), job.estimatedCalls());
            BigDecimal refund = refundableCredits(job, settled);
            return transactionalOperator.transactional(jobRepository.finish(job.id(), "canceled", "", settled)
                    .flatMap(finished -> finished && CreditAmounts.of(refund).compareTo(CreditAmounts.of(0)) > 0
                            ? creditService.refundOperation(job.userId(), chargeOperationId(job), OPERATION_NAME, refund).then()
                            : Mono.<Void>empty()))
                    .then(Mono.defer(() -> jobRepository.find(job.id())))
                    .flatMap(this::view);
        });
    }

    /**
     * 应用任务在当前停点产出的待审草稿，默认覆盖全部已有目标。
     *
     * @param job 任务
     * @return Mono&lt;Void&gt; 应用结果
     */
    private Mono<Void> applyJobDrafts(NovelAdaptationJobRepository.Job job) {
        List<String> stages = switch (job.phase()) {
            case "skeleton" -> SKELETON_STAGES;
            case "episodes" -> List.of("episodes");
            default -> List.of("episode");
        };
        return jobDrafts(job)
                .flatMap(drafts -> scriptService.getProject(job.projectId())
                        .flatMap(project -> scriptService.applyAdaptationDrafts(job.projectId(), project.revision(),
                                drafts.stream().filter(draft -> stages.contains(draft.stage()) && "pending".equals(draft.status()))
                                        .map(NovelAdaptationDtos.JobDraft::draftId).toList())));
    }

    /** 读取属于当前用户可访问项目的任务。 */
    private Mono<NovelAdaptationJobRepository.Job> requireJob(String projectId, String jobId) {
        return scriptService.getProject(projectId)
                .then(jobRepository.find(jobId))
                .filter(job -> projectId.equals(job.projectId()))
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "改编任务不存在")));
    }

    /**
     * 阶段输入条目，单集正文只补证据最多的若干人物与地点。
     *
     * @param stage 改编阶段
     * @param types 事实类型分组
     * @return List&lt;ItemTypeRef&gt; 阶段输入条目
     */
    public static List<StoryBibleRepository.ItemTypeRef> stageItems(
            String stage, Map<String, List<StoryBibleRepository.ItemTypeRef>> types) {
        List<StoryBibleRepository.ItemTypeRef> items = new ArrayList<>();
        for (String type : STAGE_TYPES.getOrDefault(stage, List.of())) {
            items.addAll(types.getOrDefault(type, List.of()));
        }
        if (!"episode".equals(stage)) return items;
        // 单集正文只补证据最多的若干人物与地点：次要条目分档后只有名称与说明，全量喂入既占容量也无助于写戏。
        List<StoryBibleRepository.ItemTypeRef> majors = items.stream()
                .filter(item -> item.evidenceCount() >= MINOR_EVIDENCE_THRESHOLD)
                .sorted(Comparator.comparingInt(StoryBibleRepository.ItemTypeRef::evidenceCount).reversed())
                .limit(FEATURE_LIMIT).toList();
        return majors.isEmpty() ? items : majors;
    }

    /**
     * 按批上限切分阶段输入。人物与地点按分档分别合批：要产出完整设定的条目输出量大、用小批，
     * 只产出名称与说明的条目可以合批。
     *
     * @param stage 改编阶段
     * @param items 阶段输入条目
     * @return List&lt;List&lt;String&gt;&gt; 每批的条目标识
     */
    public static List<List<String>> stageBatches(String stage, List<StoryBibleRepository.ItemTypeRef> items) {
        List<List<String>> batches = new ArrayList<>();
        if ("characters".equals(stage) || "world".equals(stage)) {
            batches.addAll(split(items.stream()
                    .filter(item -> item.evidenceCount() >= MINOR_EVIDENCE_THRESHOLD)
                    .map(StoryBibleRepository.ItemTypeRef::id).toList(), FEATURE_BATCH_SIZE));
            batches.addAll(split(items.stream()
                    .filter(item -> item.evidenceCount() < MINOR_EVIDENCE_THRESHOLD)
                    .map(StoryBibleRepository.ItemTypeRef::id).toList(), BULK_BATCH_SIZE));
            return batches;
        }
        batches.addAll(split(items.stream().map(StoryBibleRepository.ItemTypeRef::id).toList(),
                STAGE_BATCH_SIZE.getOrDefault(stage, BULK_BATCH_SIZE)));
        return batches;
    }

    /** 按上限切分标识列表。 */
    private static List<List<String>> split(List<String> ids, int size) {
        List<List<String>> batches = new ArrayList<>();
        for (int i = 0; i < ids.size(); i += size) {
            batches.add(ids.subList(i, Math.min(i + size, ids.size())));
        }
        return batches;
    }

    /** 阶段实际批数，与实际执行的分批逻辑完全一致。 */
    private int stageBatchCount(String stage, Map<String, List<StoryBibleRepository.ItemTypeRef>> types) {
        return stageBatches(stage, stageItems(stage, types)).size();
    }

    /**
     * 读取全部已确认事实与模型价格，按阶段分流估算调用次数。
     *
     * @param userId 用户标识
     * @param request 启动请求
     * @return Mono&lt;Prepared&gt; 输入快照与报价
     */
    private Mono<Prepared> prepare(long userId, NovelAdaptationDtos.StartJobRequest request) {
        return scriptService.getSnapshotForUser(userId, request.projectId(), request.expectedRevision())
                .flatMap(snapshot -> Mono.zip(modelFactory.resolveTextModel(request.model()),
                                modelConfigId(request.model()))
                        .flatMap(model -> storyBibleRepository.listConfirmedItemTypes(request.projectId()).collectList()
                                .map(items -> {
                                    // 报价与实际执行共用同一套分流与分批逻辑，保证显示的次数就是真实调用次数。
                                    Map<String, List<StoryBibleRepository.ItemTypeRef>> types = new HashMap<>();
                                    for (StoryBibleRepository.ItemTypeRef item : items) {
                                        types.computeIfAbsent(item.itemType(), key -> new ArrayList<>()).add(item);
                                    }
                                    int skeletonCalls = stageBatchCount("episodes", types);
                                    for (String stage : SKELETON_STAGES) skeletonCalls += stageBatchCount(stage, types);
                                    int episodes = snapshot.project().episodes().isEmpty()
                                            ? request.settings().episodeCount() : snapshot.project().episodes().size();
                                    int episodeCalls = episodes * Math.max(1, stageBatchCount("episode", types));
                                    return new Prepared(items.stream().map(StoryBibleRepository.ItemTypeRef::id).toList(),
                                            model.getT2(), model.getT1().creditCost(), skeletonCalls, episodeCalls);
                                })));
    }

    /** 组装任务状态视图。 */
    private Mono<NovelAdaptationDtos.JobView> view(NovelAdaptationJobRepository.Job job) {
        BigDecimal refunded = Set.of("canceled", "failed").contains(job.status())
                ? refundableCredits(job, job.settledCalls()) : BigDecimal.ZERO;
        return jobDrafts(job).map(drafts -> new NovelAdaptationDtos.JobView(job.id(), job.phase(), job.stage(),
                job.status(), job.totalUnits(), job.processedUnits(), job.estimatedCalls(), job.settledCalls(),
                job.credits(), refunded, job.errorMessage(),
                job.createdAt() == null ? "" : job.createdAt().toString(), drafts));
    }

    /** 任务产出的待审草稿，按任务标识精确查询。 */
    private Mono<List<NovelAdaptationDtos.JobDraft>> jobDrafts(NovelAdaptationJobRepository.Job job) {
        return novelAdaptationRepository.listJobDrafts(job.id()).collectList();
    }

    /** 按单次调用价格计算未结算部分应退积分。 */
    private BigDecimal refundableCredits(NovelAdaptationJobRepository.Job job, int settled) {
        if (job.estimatedCalls() <= 0) return BigDecimal.ZERO;
        BigDecimal perCall = CreditAmounts.divide(job.credits(), job.estimatedCalls());
        return CreditAmounts.multiply(perCall, Math.max(0, job.estimatedCalls() - Math.min(settled, job.estimatedCalls())));
    }

    /** 写入改编队列，失败时交由恢复扫描补发。 */
    private Mono<Void> enqueue(String modelConfigId, String jobId) {
        return queueProvider.getObject().enqueue(modelConfigId, jobId)
                .onErrorResume(error -> {
                    log.error("小说改编任务入队失败，等待恢复扫描补发: jobId={}", jobId, error);
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

    /** 按阶段读取事实证据；只有人物与地点归纳需要原文依据，其余阶段不带引文。 */
    private Mono<List<StoryBibleDtos.Evidence>> evidencesFor(String stage, String itemId) {
        return EVIDENCE_STAGES.contains(stage)
                ? storyBibleRepository.listEvidences(itemId, 3).collectList()
                : Mono.just(List.of());
    }

    /** 一键改编的输入快照与报价。 */
    private record Prepared(List<String> factIds, String modelConfigId, BigDecimal creditCost,
                            int skeletonCalls, int episodeCalls) {
        int calls() { return skeletonCalls + episodeCalls; }
        BigDecimal credits() { return CreditAmounts.multiply(creditCost, calls()); }
    }

    /**
     * 校验分阶段生成的前置内容与同一项目的目标集。
     * @param request GenerateRequest 生成请求
     * @param snapshot ProjectSnapshot 项目完整快照
     * @throws BusinessException 缺少前置大纲或正式分集时拒绝生成
     */
    private void validateStage(NovelAdaptationDtos.GenerateRequest request, ScriptDtos.ProjectSnapshot snapshot) {
        if ("episodes".equals(request.stage()) && snapshot.project().outlineSections().isEmpty()) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "请先审阅并应用故事大纲");
        }
        if ("episode".equals(request.stage())) {
            if (!StringUtils.hasText(request.episodeId()) || snapshot.project().episodes().stream()
                    .noneMatch(episode -> episode.id().equals(request.episodeId()))) {
                throw new BusinessException(ErrorCode.PARAM_INVALID, "请先确认分集规划并选择目标集");
            }
        } else if (StringUtils.hasText(request.episodeId())) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "只有单集改编可以指定目标集");
        }
    }
}
