package com.novanovastudio.service;

import com.novanovastudio.common.CreditAmounts;
import java.math.BigDecimal;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.agent.AgentScopeModelFactory;
import com.novanovastudio.ai.AiTaskTypes;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.StoryBibleDtos;
import com.novanovastudio.repository.CreditRepository;
import com.novanovastudio.repository.ScriptSourceRepository;
import com.novanovastudio.repository.StoryBibleRepository;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.task.StoryBibleAnalysisQueue;
import java.util.ArrayList;
import java.util.LinkedHashSet;
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
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 故事知识库报价、分析任务管理与条目人工审阅服务。
 *
 * <p>知识库独立于正式剧本表保存，所有AI结论通过原文UTF-16偏移追溯证据；
 * 人工编辑或确认的条目会被锁定，重新分析只产生待审建议。</p>
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-09-27 00:00
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class StoryBibleService {
    /** 积分流水中的业务名称。 */
    public static final String OPERATION_NAME = "故事知识库分析";
    /** 支持的条目类型。 */
    private static final Set<String> ITEM_TYPES = Set.of("character", "location", "relationship", "event", "storyline");
    /** 可合并与拆分的实体类型。 */
    private static final Set<String> ENTITY_TYPES = Set.of("character", "location");
    /** 条目状态。 */
    private static final Set<String> ITEM_STATUSES = Set.of("pending", "confirmed", "rejected");
    /** 名称最大长度。 */
    private static final int MAX_NAME_LENGTH = 255;
    /** 摘要最大长度。 */
    private static final int MAX_SUMMARY_LENGTH = 5000;
    /** 单条目最多别名数。 */
    private static final int MAX_ALIASES = 50;
    /** 详情返回的证据上限。 */
    private static final int MAX_DETAIL_EVIDENCES = 500;
    /** 单次批量确认最多处理的条目数，与条目列表每页最大条数保持一致。 */
    private static final int MAX_BATCH_CONFIRM_ITEMS = 200;

    /** 知识库仓储。 */
    private final StoryBibleRepository repository;
    /** 原文仓储。 */
    private final ScriptSourceRepository sourceRepository;
    /** 价格服务。 */
    private final StoryBiblePricingService pricingService;
    /** 模型配置服务。 */
    private final PersistenceService persistenceService;
    /** 文本模型解析。 */
    private final AgentScopeModelFactory modelFactory;
    /** 积分服务。 */
    private final CreditService creditService;
    /** 积分仓储，用于返回最新余额。 */
    private final CreditRepository creditRepository;
    /** 当前用户。 */
    private final CurrentUserProvider currentUserProvider;
    /** 响应式事务。 */
    private final TransactionalOperator transactionalOperator;
    /** 分析队列，延迟获取避免构造期依赖环。 */
    private final ObjectProvider<StoryBibleAnalysisQueue> queueProvider;

    /**
     * 按所选模型与范围报价。
     *
     * @param request QuoteRequest 报价请求
     * @return Mono&lt;Quote&gt; 报价
     */
    public Mono<StoryBibleDtos.Quote> quoteAnalysis(StoryBibleDtos.QuoteRequest request) {
        return currentUserProvider.currentUserId()
                .flatMap(userId -> quote(userId, request.projectId(), request.model(), request.sectionIds()))
                .map(QuoteContext::quote);
    }

    /**
     * 重新核算报价后幂等创建任务，并在同一事务中预扣整笔积分。
     *
     * @param request StartRequest 启动请求
     * @return Mono&lt;JobStatus&gt; 任务状态
     */
    public Mono<StoryBibleDtos.JobStatus> startAnalysis(StoryBibleDtos.StartRequest request) {
        String requestId = trimToNull(request.clientRequestId());
        if (requestId == null || requestId.length() > 64) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "客户端请求标识不合法"));
        }
        return currentUserProvider.currentUserId().flatMap(userId -> repository.findJobByRequest(userId, requestId)
                .filter(job -> Objects.equals(job.projectId(), request.projectId()))
                .flatMap(job -> status(job, userId))
                .switchIfEmpty(Mono.defer(() -> quote(userId, request.projectId(), request.model(), request.sectionIds())
                        .flatMap(context -> {
                            StoryBibleDtos.Quote quote = context.quote();
                            if (CreditAmounts.of(quote.credits()).compareTo(CreditAmounts.of(request.expectedCredits())) != 0
                                    || quote.sourceRevision() != request.expectedSourceRevision()
                                    || quote.pricingRevision() != request.expectedPricingRevision()) {
                                return Mono.error(new BusinessException(ErrorCode.DATA_CONFLICT, "报价已变化，请重新报价后确认"));
                            }
                            return create(userId, requestId, context);
                        }))));
    }

    /**
     * 查询分析任务状态，未指定任务时返回最近一次任务。
     *
     * @param request JobRequest 任务请求
     * @return Mono&lt;JobStatus&gt; 任务状态
     */
    public Mono<StoryBibleDtos.JobStatus> getAnalysisStatus(StoryBibleDtos.JobRequest request) {
        return owned(request.projectId()).flatMap(owned -> repository.findJob(owned.document().projectId(), trimToNull(request.jobId()))
                .flatMap(job -> status(job, null)));
    }

    /**
     * 续跑可重试任务，已预扣积分不再重复扣除。
     *
     * @param request JobRequest 任务请求
     * @return Mono&lt;JobStatus&gt; 任务状态
     */
    public Mono<StoryBibleDtos.JobStatus> retryAnalysis(StoryBibleDtos.JobRequest request) {
        return requireJob(request).flatMap(job -> repository.transitJob(job.id(), List.of("retryable"), "queued", "")
                .flatMap(updated -> updated
                        ? enqueue(job).then(repository.findJobById(job.id())).flatMap(latest -> status(latest, null))
                        : Mono.<StoryBibleDtos.JobStatus>error(new BusinessException(ErrorCode.BUSINESS_ERROR, "仅可重试状态的任务可以续跑"))));
    }

    /**
     * 取消未结束的任务；只扣成功完成的初始批次积分，其余退款，已提交结果保留。
     *
     * @param request JobRequest 任务请求
     * @return Mono&lt;JobStatus&gt; 任务状态
     */
    public Mono<StoryBibleDtos.JobStatus> cancelAnalysis(StoryBibleDtos.JobRequest request) {
        return requireJob(request).flatMap(job -> transactionalOperator.transactional(
                // 状态更新持有任务行锁，与逐批提交互斥，退款失败时取消一并回滚。
                repository.transitJob(job.id(), List.of("queued", "running", "retryable"), "canceled", "用户已取消")
                        .flatMap(canceled -> {
                            if (!canceled) {
                                return Mono.<Void>error(new BusinessException(ErrorCode.BUSINESS_ERROR, "任务已结束，无法取消"));
                            }
                            return repository.batchSettlement(job.id()).flatMap(settlement -> {
                                // 初始批数在报价时固定，避免取消与逐批规划并发时低估尚未提交的批次。
                                BigDecimal refund = job.initialBatchCount() == 0 ? job.credits() : CreditAmounts.divide(job.credits().multiply(BigDecimal.valueOf(job.initialBatchCount() - settlement.completedBatches())), job.initialBatchCount());
                                return creditService.refundOperation(job.userId(), job.id(), OPERATION_NAME, refund);
                            });
                        })
                        .then(Mono.defer(() -> repository.findJobById(job.id()).flatMap(latest -> status(latest, job.userId()))))))
                .doOnNext(result -> log.info("故事知识库分析已取消且按成功批次结算: jobId={}, credits={}, refundedCredits={}",
                        result.jobId(), result.credits(), result.refundedCredits()));
    }

    /**
     * 分页查询条目。
     *
     * @param request ListItemsRequest 查询请求
     * @return Mono&lt;ItemPage&gt; 分页结果
     */
    public Mono<StoryBibleDtos.ItemPage> listItems(StoryBibleDtos.ListItemsRequest request) {
        String itemType = trimToNull(request.itemType());
        if (itemType != null && !ITEM_TYPES.contains(itemType)) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "条目类型不受支持"));
        }
        String status = trimToNull(request.status());
        if (status != null && !ITEM_STATUSES.contains(status)) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "条目状态不受支持"));
        }
        String keyword = trimToNull(request.keyword());
        int page = request.page() == null || request.page() < 1 ? 1 : request.page();
        int pageSize = request.pageSize() == null ? 20 : Math.min(Math.max(request.pageSize(), 1), 200);
        boolean storyOrder = "story".equals(request.order());
        return owned(request.projectId()).flatMap(owned -> {
            String projectId = owned.document().projectId();
            return Mono.zip(repository.listItems(projectId, itemType, status, keyword, storyOrder, (page - 1) * pageSize, pageSize).collectList(),
                            repository.countItems(projectId, itemType, status, keyword))
                    .map(tuple -> new StoryBibleDtos.ItemPage(tuple.getT1(), tuple.getT2(), page, pageSize));
        });
    }

    /**
     * 读取条目详情，含别名、关联、证据与待审建议。
     *
     * @param request GetItemRequest 查询请求
     * @return Mono&lt;ItemDetail&gt; 条目详情
     */
    public Mono<StoryBibleDtos.ItemDetail> getItem(StoryBibleDtos.GetItemRequest request) {
        return owned(request.projectId()).flatMap(owned -> requireItem(owned.document().projectId(), request.itemId())
                .flatMap(item -> detail(item.id(), true)));
    }

    /**
     * 新建人工条目或编辑已有条目，编辑后锁定并视为已确认。
     *
     * @param request SaveItemRequest 保存请求
     * @return Mono&lt;ItemDetail&gt; 保存后的条目
     */
    public Mono<StoryBibleDtos.ItemDetail> saveItem(StoryBibleDtos.SaveItemRequest request) {
        String name = requireName(request.name());
        String summary = request.summary() == null ? "" : request.summary().trim();
        if (summary.length() > MAX_SUMMARY_LENGTH) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "摘要不能超过5000个字符"));
        }
        String storyTime = request.storyTime() == null ? "" : request.storyTime().trim();
        if (storyTime.length() > MAX_NAME_LENGTH) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "故事时间不能超过255个字符"));
        }
        String timeStatus = "known".equals(request.storyTimeStatus()) && !storyTime.isEmpty() ? "known" : "uncertain";
        JSONObject attributes = request.attributes() == null ? new JSONObject() : request.attributes();
        return owned(request.projectId()).flatMap(owned -> {
            String projectId = owned.document().projectId();
            String itemId = trimToNull(request.itemId());
            Mono<StoryBibleRepository.Item> existing = itemId == null ? Mono.empty() : requireItem(projectId, itemId);
            return existing.map(java.util.Optional::of).defaultIfEmpty(java.util.Optional.empty()).flatMap(optional -> {
                String itemType = optional.map(StoryBibleRepository.Item::itemType).orElse(trimToNull(request.itemType()));
                if (itemType == null || !ITEM_TYPES.contains(itemType)) {
                    return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "条目类型不受支持"));
                }
                if (optional.isPresent() && optional.get().suggestForItemId() != null) {
                    return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "待审建议只能确认或拒绝"));
                }
                List<String> aliases = ENTITY_TYPES.contains(itemType) ? aliases(name, request.aliases()) : List.of();
                String matchKey = optional.map(StoryBibleRepository.Item::matchKey)
                        .filter(key -> !ENTITY_TYPES.contains(itemType)).orElse(StoryBibleSupport.normalize(name));
                return validateLinks(projectId, itemType, request.links()).flatMap(links -> {
                    String id = optional.map(StoryBibleRepository.Item::id).orElse(UUID.randomUUID().toString());
                    StoryBibleRepository.Item item = new StoryBibleRepository.Item(id, projectId, owned.document().id(), itemType,
                            name, summary, attributes, optional.map(StoryBibleRepository.Item::origin).orElse("manual"),
                            "confirmed", true, null, matchKey, optional.map(StoryBibleRepository.Item::narrativeOffset).orElse(null),
                            storyTime, timeStatus, request.storyOrder(), request.expectedRevision());
                    Mono<Void> write = optional.isPresent()
                            ? repository.updateItem(item, null).flatMap(this::requireUpdated)
                            : repository.insertItem(item, null);
                    Mono<Void> saveAliases = ENTITY_TYPES.contains(itemType)
                            ? repository.deleteAliasesExcept(id, aliases.stream().map(StoryBibleSupport::normalize).toList())
                                    .thenMany(Flux.fromIterable(aliases))
                                    .concatMap(alias -> repository.insertAlias(id, alias, StoryBibleSupport.normalize(alias))).then()
                            : Mono.empty();
                    Mono<Void> saveLinks = request.links() == null ? Mono.empty()
                            : repository.deleteLinks(id).thenMany(Flux.fromIterable(links))
                                    .concatMap(link -> repository.insertLink(id, link.relatedItemId(), link.role())).then();
                    return transactionalOperator.transactional(write.then(saveAliases).then(saveLinks))
                            .then(Mono.defer(() -> detail(id, true)));
                });
            });
        });
    }

    /**
     * 确认条目；确认待审建议时把建议中的别名与证据并入目标条目。
     *
     * @param request ItemRequest 条目请求
     * @return Mono&lt;ItemDetail&gt; 确认后的条目
     */
    public Mono<StoryBibleDtos.ItemDetail> confirmItem(StoryBibleDtos.ItemRequest request) {
        return owned(request.projectId()).flatMap(owned -> requireItem(owned.document().projectId(), request.itemId())
                .flatMap(item -> {
                    if (item.suggestForItemId() == null) {
                        return repository.updateStatus(item.id(), request.expectedRevision(), "confirmed")
                                .flatMap(this::requireUpdated).then(Mono.defer(() -> detail(item.id(), true)));
                    }
                    String targetId = item.suggestForItemId();
                    // 先迁移别名与证据再按修订号删除建议，修订冲突时整个事务回滚。
                    return transactionalOperator.transactional(repository.moveAliases(item.id(), targetId, null)
                                    .then(repository.moveEvidences(item.id(), targetId, null, null))
                                    .then(repository.deleteItemAt(item.id(), request.expectedRevision()))
                                    .flatMap(this::requireUpdated)
                                    .then(repository.refreshNarrativeOffsets(item.projectId())))
                            .then(Mono.defer(() -> detail(targetId, true)));
                }));
    }

    /**
     * 在单个事务中确认多条待审条目，建议条目会将别名和证据迁移到目标条目。
     * @param request BatchConfirmRequest 批量确认请求
     * @return Mono<BatchConfirmResult> 已确认条目标识和数量
     */
    public Mono<StoryBibleDtos.BatchConfirmResult> confirmItems(StoryBibleDtos.BatchConfirmRequest request) {
        if (request == null || request.items() == null || request.items().isEmpty()) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_MISSING, "至少选择一条待确认内容"));
        }
        if (request.items().size() > MAX_BATCH_CONFIRM_ITEMS) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "单次最多批量确认" + MAX_BATCH_CONFIRM_ITEMS + "条内容"));
        }
        Map<String, StoryBibleDtos.BatchItemRequest> requested = new java.util.LinkedHashMap<>();
        for (StoryBibleDtos.BatchItemRequest item : request.items()) {
            String itemId = trimToNull(item == null ? null : item.itemId());
            if (itemId == null || item.expectedRevision() < 0 || requested.put(itemId, item) != null) {
                return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "批量确认条目标识或修订号不合法"));
            }
        }
        return owned(request.projectId()).flatMap(owned -> transactionalOperator.transactional(
                repository.findItemsForUpdate(owned.document().projectId(), new ArrayList<>(requested.keySet())).collectMap(StoryBibleRepository.Item::id)
                        .flatMap(items -> {
                            if (items.size() != requested.size()) {
                                return Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "部分条目不存在或不属于当前项目"));
                            }
                            Set<String> targetIds = items.values().stream().map(StoryBibleRepository.Item::suggestForItemId)
                                    .filter(Objects::nonNull).collect(java.util.stream.Collectors.toCollection(LinkedHashSet::new));
                            return repository.findItemsForUpdate(owned.document().projectId(), new ArrayList<>(targetIds)).collectMap(StoryBibleRepository.Item::id)
                                    .flatMap(targets -> confirmBatchItems(owned.document().projectId(), requested, items, targets));
                        })));
    }

    /**
     * 在单个事务中确认指定类型下全部待确认条目，不受分页与筛选影响。
     *
     * <p>修订号由服务端在事务前读取，锁定后逐条比对；期间任何条目被其他操作改动都会整体失败。</p>
     *
     * @param request BatchConfirmAllRequest 全量确认请求
     * @return Mono&lt;BatchConfirmResult&gt; 已确认条目标识和数量
     */
    public Mono<StoryBibleDtos.BatchConfirmResult> confirmAllItems(StoryBibleDtos.BatchConfirmAllRequest request) {
        String projectId = trimToNull(request == null ? null : request.projectId());
        if (projectId == null) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_MISSING, "缺少剧本项目标识"));
        }
        String itemType = trimToNull(request.itemType());
        if (itemType == null || !ITEM_TYPES.contains(itemType)) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "条目类型不合法"));
        }
        return owned(projectId).flatMap(owned -> repository.listPendingItems(owned.document().projectId(), itemType)
                .collectList().flatMap(pending -> {
                    if (pending.isEmpty()) {
                        return Mono.just(new StoryBibleDtos.BatchConfirmResult(List.of(), 0));
                    }
                    Map<String, StoryBibleDtos.BatchItemRequest> requested = new java.util.LinkedHashMap<>();
                    for (StoryBibleRepository.Item item : pending) {
                        requested.put(item.id(), new StoryBibleDtos.BatchItemRequest(item.id(), item.revision()));
                    }
                    return transactionalOperator.transactional(
                            repository.findItemsForUpdate(owned.document().projectId(), new ArrayList<>(requested.keySet()))
                                    .collectMap(StoryBibleRepository.Item::id)
                                    .flatMap(items -> {
                                        if (items.size() != requested.size()) {
                                            return Mono.error(new BusinessException(ErrorCode.DATA_CONFLICT, "条目已变化，请刷新后重新全量确认"));
                                        }
                                        Set<String> targetIds = items.values().stream().map(StoryBibleRepository.Item::suggestForItemId)
                                                .filter(Objects::nonNull).collect(java.util.stream.Collectors.toCollection(LinkedHashSet::new));
                                        return repository.findItemsForUpdate(owned.document().projectId(), new ArrayList<>(targetIds))
                                                .collectMap(StoryBibleRepository.Item::id)
                                                .flatMap(targets -> confirmBatchItems(owned.document().projectId(), requested, items, targets));
                                    }));
                }));
    }

    /**
     * 校验全部已锁定条目的状态和修订号后，按请求顺序确认或并入建议。
     *
     * @param projectId String 项目标识
     * @param requested Map&lt;String, BatchItemRequest&gt; 请求条目及修订号
     * @param items Map&lt;String, Item&gt; 已锁定的请求条目
     * @param targets Map&lt;String, Item&gt; 已锁定的建议目标条目
     * @return Mono&lt;BatchConfirmResult&gt; 确认后的条目标识和数量
     */
    private Mono<StoryBibleDtos.BatchConfirmResult> confirmBatchItems(String projectId,
                                                                        Map<String, StoryBibleDtos.BatchItemRequest> requested,
                                                                        Map<String, StoryBibleRepository.Item> items,
                                                                        Map<String, StoryBibleRepository.Item> targets) {
        for (Map.Entry<String, StoryBibleDtos.BatchItemRequest> entry : requested.entrySet()) {
            StoryBibleRepository.Item item = items.get(entry.getKey());
            if (!"pending".equals(item.status()) || item.revision() != entry.getValue().expectedRevision()) {
                return Mono.error(new BusinessException(ErrorCode.DATA_CONFLICT, "条目已变化，请刷新后重新批量确认"));
            }
            if (item.suggestForItemId() != null) {
                StoryBibleRepository.Item target = targets.get(item.suggestForItemId());
                if (target == null || target.suggestForItemId() != null || "rejected".equals(target.status())
                        || !item.itemType().equals(target.itemType())) {
                    return Mono.error(new BusinessException(ErrorCode.DATA_CONFLICT, "建议对应的目标条目已变化，请刷新后重新批量确认"));
                }
            }
        }
        return Flux.fromIterable(requested.keySet()).concatMap(itemId -> {
                    StoryBibleRepository.Item item = items.get(itemId);
                    if (item.suggestForItemId() == null) {
                        return repository.updateStatus(item.id(), item.revision(), "confirmed").flatMap(this::requireUpdated)
                                .thenReturn(item.id());
                    }
                    return repository.moveAliases(item.id(), item.suggestForItemId(), null)
                            .then(repository.moveEvidences(item.id(), item.suggestForItemId(), null, null))
                            .then(repository.deleteItemAt(item.id(), item.revision()))
                            .flatMap(this::requireUpdated)
                            .thenReturn(item.suggestForItemId());
                }).collectList()
                .flatMap(ids -> (items.values().stream().anyMatch(item -> item.suggestForItemId() != null)
                        ? repository.refreshNarrativeOffsets(projectId) : Mono.<Void>empty()).thenReturn(
                        new StoryBibleDtos.BatchConfirmResult(new ArrayList<>(new LinkedHashSet<>(ids)), ids.size())));
    }

    /**
     * 拒绝条目或待审建议，保留记录用于抑制重复生成。
     *
     * @param request ItemRequest 条目请求
     * @return Mono&lt;ItemDetail&gt; 拒绝后的条目
     */
    public Mono<StoryBibleDtos.ItemDetail> rejectItem(StoryBibleDtos.ItemRequest request) {
        return owned(request.projectId()).flatMap(owned -> requireItem(owned.document().projectId(), request.itemId())
                .flatMap(item -> repository.updateStatus(item.id(), request.expectedRevision(), "rejected")
                        .flatMap(this::requireUpdated).then(Mono.defer(() -> detail(item.id(), true)))));
    }

    /**
     * 合并同类人物或地点，源条目的别名、证据、关联与建议全部并入目标条目。
     *
     * @param request MergeRequest 合并请求
     * @return Mono&lt;ItemDetail&gt; 合并后的目标条目
     */
    public Mono<StoryBibleDtos.ItemDetail> mergeEntities(StoryBibleDtos.MergeRequest request) {
        if (Objects.equals(request.targetItemId(), request.sourceItemId())) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "不能与自身合并"));
        }
        return owned(request.projectId()).flatMap(owned -> {
            String projectId = owned.document().projectId();
            return Mono.zip(requireItem(projectId, request.targetItemId()), requireItem(projectId, request.sourceItemId()))
                    .flatMap(tuple -> {
                        StoryBibleRepository.Item target = tuple.getT1();
                        StoryBibleRepository.Item source = tuple.getT2();
                        if (!ENTITY_TYPES.contains(target.itemType()) || !target.itemType().equals(source.itemType())) {
                            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "只能合并同类型的人物或地点"));
                        }
                        if (target.suggestForItemId() != null || source.suggestForItemId() != null
                                || "rejected".equals(target.status()) || "rejected".equals(source.status())) {
                            return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "待审建议或已拒绝条目不能合并"));
                        }
                        StoryBibleRepository.Item locked = withReview(target, request.targetRevision());
                        return transactionalOperator.transactional(repository.updateItem(locked, null).flatMap(this::requireUpdated)
                                        .then(repository.moveAliases(source.id(), target.id(), null))
                                        .then(repository.insertAlias(target.id(), source.name(), StoryBibleSupport.normalize(source.name())))
                                        .then(repository.moveEvidences(source.id(), target.id(), null, null))
                                        .then(repository.repointLinks(source.id(), target.id()))
                                        .then(repository.moveSuggestions(source.id(), target.id()))
                                        .then(repository.deleteItemAt(source.id(), request.sourceRevision()))
                                        .flatMap(this::requireUpdated)
                                        .then(repository.refreshNarrativeOffsets(projectId)))
                                .then(Mono.defer(() -> detail(target.id(), true)));
                    });
        });
    }

    /**
     * 按所选别名与证据把人物或地点拆出为新条目，两者均锁定。
     *
     * @param request SplitRequest 拆分请求
     * @return Mono&lt;ItemDetail&gt; 新条目
     */
    public Mono<StoryBibleDtos.ItemDetail> splitEntity(StoryBibleDtos.SplitRequest request) {
        String name = requireName(request.name());
        List<String> aliasIds = request.aliasIds() == null ? List.of() : List.copyOf(new LinkedHashSet<>(request.aliasIds()));
        List<String> evidenceIds = request.evidenceIds() == null ? List.of() : List.copyOf(new LinkedHashSet<>(request.evidenceIds()));
        if (aliasIds.isEmpty() && evidenceIds.isEmpty()) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "请至少选择一个别名或一条证据"));
        }
        return owned(request.projectId()).flatMap(owned -> requireItem(owned.document().projectId(), request.itemId())
                .flatMap(item -> {
                    if (!ENTITY_TYPES.contains(item.itemType()) || item.suggestForItemId() != null) {
                        return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "只能拆分人物或地点"));
                    }
                    String createdId = UUID.randomUUID().toString();
                    StoryBibleRepository.Item created = new StoryBibleRepository.Item(createdId, item.projectId(), item.documentId(),
                            item.itemType(), name, "", new JSONObject(), "manual", "confirmed", true, null,
                            StoryBibleSupport.normalize(name), null, "", "uncertain", null, 0);
                    return transactionalOperator.transactional(repository.updateItem(withReview(item, request.expectedRevision()), null)
                                    .flatMap(this::requireUpdated)
                                    .then(repository.insertItem(created, null))
                                    .then(aliasIds.isEmpty() ? Mono.empty() : repository.moveAliases(item.id(), createdId, aliasIds))
                                    .then(repository.moveEvidences(item.id(), createdId, evidenceIds, aliasIds))
                                    .then(repository.insertAlias(createdId, name, StoryBibleSupport.normalize(name)))
                                    .then(repository.refreshNarrativeOffsets(item.projectId())))
                            .then(Mono.defer(() -> detail(createdId, true)));
                }));
    }

    /**
     * 最终失败时全额退款；主动取消不调用此方法，零积分任务没有扣费流水。
     *
     * @param job Job 任务
     * @return Mono&lt;Void&gt; 退款结果
     */
    public Mono<Void> refund(StoryBibleRepository.Job job) {
        return CreditAmounts.of(job.credits()).compareTo(CreditAmounts.of(0)) > 0 ? creditService.refundOperation(job.userId(), job.id(), OPERATION_NAME) : Mono.empty();
    }

    /**
     * 核算报价上下文。
     *
     * @param userId long 用户标识
     * @param projectId String 项目标识
     * @param model String 文本模型
     * @param sectionIds List&lt;String&gt; 章节或场次，为空表示全书
     * @return Mono&lt;QuoteContext&gt; 报价上下文
     */
    private Mono<QuoteContext> quote(long userId, String projectId, String model, List<String> sectionIds) {
        return document(userId, projectId).flatMap(document -> {
            if (!"completed".equals(document.status())) {
                return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "原文尚未导入完成，暂不能分析"));
            }
            if (document.confirmedRevision() == null || document.confirmedRevision() != document.revision()) {
                return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "请先在原文页确认当前结构后再分析"));
            }
            List<String> selected = sectionIds == null ? List.of()
                    : sectionIds.stream().map(this::trimToNull).filter(Objects::nonNull).distinct().toList();
            return Mono.zip(modelFactory.resolveTextModel(model), modelConfigId(model),
                            sourceRepository.normalizedText(document.id())
                                    .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.SYSTEM_ERROR, "原文正文缺失，请重新导入"))),
                            Flux.fromIterable(selected).concatMap(id -> sourceRepository.getSection(document.id(), id)
                                    .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "所选章节或场次不存在"))))
                                    .collectList())
                    .flatMap(tuple -> {
                        String text = tuple.getT3();
                        List<int[]> ranges = selected.isEmpty() ? List.of(new int[]{0, text.length()})
                                : StoryBibleSupport.mergeRanges(tuple.getT4().stream()
                                        .map(section -> new int[]{section.startOffset(), section.endOffset()}).toList());
                        int chars = StoryBibleSupport.countBillableChars(text, ranges);
                        if (chars <= 0) {
                            return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "所选范围没有可分析的文字"));
                        }
                        String modelConfigId = tuple.getT2();
                        return pricingService.find(modelConfigId)
                                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "该模型尚未配置故事知识库价格，请联系管理员")))
                                .flatMap(pricing -> {
                                    StoryBibleDtos.PricingTier tier = StoryBibleSupport.selectTier(pricing.tiers(), chars);
                                    if (tier == null) {
                                        return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR,
                                                "该模型没有覆盖" + chars + "字的价格档位，请联系管理员"));
                                    }
                                    StoryBibleDtos.QuickConfiguration configuration = pricing.quickConfiguration();
                                    if (configuration == null) {
                                        return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "该模型未配置经验证的分析容量"));
                                    }
                                    Mono<Integer> batches = sourceRepository.listSections(document.id()).filter(section -> section.parentId() == null)
                                            .collectList().map(sections -> StoryBibleQuickPlanner.plan(text, sections, ranges, configuration).size());
                                    return batches.flatMap(count -> {
                                        if (count == 0) {
                                            return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "所选范围没有可分析的章节文字"));
                                        }
                                        StoryBibleDtos.Quote quote = new StoryBibleDtos.Quote(tuple.getT1().modelValue(), chars, tier.credits(),
                                                tier.minChars(), tier.maxChars(), document.revision(), pricing.revision(), count,
                                                configuration);
                                        return Mono.just(new QuoteContext(document, modelConfigId, selected, ranges, quote));
                                    });
                                });
                    });
        });
    }

    /**
     * 创建任务并预扣积分，提交后入队。
     *
     * @param userId long 用户标识
     * @param requestId String 客户端请求标识
     * @param context QuoteContext 报价上下文
     * @return Mono&lt;JobStatus&gt; 任务状态
     */
    private Mono<StoryBibleDtos.JobStatus> create(long userId, String requestId, QuoteContext context) {
        StoryBibleDtos.Quote quote = context.quote();
        StoryBibleRepository.Job job = new StoryBibleRepository.Job(UUID.randomUUID().toString(), context.document().projectId(),
                context.document().id(), userId, requestId, quote.model(), context.modelConfigId(), context.sectionIds(),
                context.ranges(), quote.billableChars(), quote.credits(), quote.pricingRevision(), quote.sourceRevision(),
                "queued", "extract", 0, 0, 0, "", null,
                quote.quickConfiguration(), 0, quote.estimatedBatches());
        return transactionalOperator.transactional(repository.insertJob(job)
                        .then(creditService.chargeOperation(userId, job.id(), job.credits(), OPERATION_NAME, job.modelConfigId())))
                .onErrorMap(DataIntegrityViolationException.class,
                        error -> new BusinessException(ErrorCode.BUSINESS_ERROR, "该项目已有进行中的分析任务，请等待完成或取消后再试"))
                .then(Mono.fromRunnable(() -> log.info("故事知识库分析已创建: jobId={}, projectId={}, chars={}, credits={}",
                        job.id(), job.projectId(), job.billableChars(), job.credits())))
                .then(Mono.defer(() -> enqueue(job).then(repository.findJobById(job.id()))))
                .flatMap(created -> status(created, userId));
    }

    /**
     * 写入分析队列，失败时交由恢复扫描补发。
     *
     * @param job Job 任务
     * @return Mono&lt;Void&gt; 入队结果
     */
    private Mono<Void> enqueue(StoryBibleRepository.Job job) {
        return queueProvider.getObject().enqueue(job.modelConfigId(), job.id())
                .onErrorResume(error -> {
                    log.error("故事知识库分析入队失败，等待恢复扫描补发: jobId={}", job.id(), error);
                    return Mono.empty();
                });
    }

    /**
     * 组装任务状态，可附带最新积分余额。
     *
     * @param job Job 任务
     * @param balanceUserId Long 需要返回余额的用户，为空时不查询
     * @return Mono&lt;JobStatus&gt; 任务状态
     */
    private Mono<StoryBibleDtos.JobStatus> status(StoryBibleRepository.Job job, Long balanceUserId) {
        Mono<java.util.Optional<BigDecimal>> balance = balanceUserId == null ? Mono.just(java.util.Optional.empty())
                : creditRepository.getCreditBalance(balanceUserId).map(java.util.Optional::of).defaultIfEmpty(java.util.Optional.empty());
        Mono<List<StoryBibleDtos.AnalysisGap>> gaps = List.of("partial", "failed", "canceled").contains(job.status())
                ? repository.listGaps(job.id()).collectList() : Mono.just(List.of());
        Mono<BigDecimal> refunded = List.of("failed", "canceled").contains(job.status())
                ? creditService.getOperationRefundAmount(job.userId(), job.id(), OPERATION_NAME) : Mono.just(BigDecimal.ZERO);
        return Mono.zip(balance, gaps, refunded).map(tuple -> new StoryBibleDtos.JobStatus(job.id(), job.status(), job.stage(), job.processedUnits(),
                job.totalUnits(), job.modelValue(), job.billableChars(), job.credits(), job.sectionIds(), job.errorMessage(),
                job.createdAt(), tuple.getT1().orElse(null), job.supplementCalls(), tuple.getT2(), tuple.getT3()));
    }

    /**
     * 读取当前用户项目中的指定任务。
     *
     * @param request JobRequest 任务请求
     * @return Mono&lt;Job&gt; 任务
     */
    private Mono<StoryBibleRepository.Job> requireJob(StoryBibleDtos.JobRequest request) {
        String jobId = trimToNull(request.jobId());
        if (jobId == null) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_MISSING, "缺少分析任务标识"));
        }
        return owned(request.projectId()).flatMap(owned -> repository.findJob(owned.document().projectId(), jobId)
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "分析任务不存在"))));
    }

    /**
     * 组装条目详情。
     *
     * @param itemId String 条目标识
     * @param withSuggestions boolean 是否包含待审建议
     * @return Mono&lt;ItemDetail&gt; 条目详情
     */
    private Mono<StoryBibleDtos.ItemDetail> detail(String itemId, boolean withSuggestions) {
        Mono<List<StoryBibleDtos.ItemDetail>> suggestions = withSuggestions
                ? repository.listSuggestions(itemId).concatMap(suggestion -> detail(suggestion.id(), false)).collectList()
                : Mono.just(List.of());
        return Mono.zip(repository.getSummary(itemId), repository.listAliases(itemId).collectList(),
                        repository.listLinks(itemId).collectList(), repository.listReferencedBy(itemId).collectList(),
                        repository.listEvidences(itemId, MAX_DETAIL_EVIDENCES).collectList(), suggestions)
                .map(tuple -> new StoryBibleDtos.ItemDetail(tuple.getT1(), tuple.getT2(), tuple.getT3(), tuple.getT4(),
                        tuple.getT5(), tuple.getT6()));
    }

    /**
     * 校验并规范关联：关系必须恰有一方来源与一方目标，事件关联参与者与地点，故事线关联事件。
     *
     * @param projectId String 项目标识
     * @param itemType String 条目类型
     * @param links List&lt;LinkInput&gt; 关联
     * @return Mono&lt;List&lt;LinkInput&gt;&gt; 已校验关联
     */
    private Mono<List<StoryBibleDtos.LinkInput>> validateLinks(String projectId, String itemType, List<StoryBibleDtos.LinkInput> links) {
        List<StoryBibleDtos.LinkInput> values = links == null ? List.of()
                : links.stream().filter(link -> link != null && trimToNull(link.relatedItemId()) != null).distinct().toList();
        Map<String, Set<String>> allowed = Map.of(
                "relationship", Set.of("relation_source", "relation_target"),
                "event", Set.of("participant", "location"),
                "storyline", Set.of("storyline_event"));
        Set<String> roles = allowed.getOrDefault(itemType, Set.of());
        for (StoryBibleDtos.LinkInput link : values) {
            if (link.role() == null || !roles.contains(link.role())) {
                return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "关联角色与条目类型不匹配"));
            }
        }
        if ("relationship".equals(itemType) && links != null
                && (values.stream().filter(link -> "relation_source".equals(link.role())).count() != 1
                || values.stream().filter(link -> "relation_target".equals(link.role())).count() != 1)) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "关系必须指定一名来源人物和一名目标人物"));
        }
        List<String> ids = values.stream().map(StoryBibleDtos.LinkInput::relatedItemId).distinct().toList();
        return repository.findItems(projectId, ids).collectMap(StoryBibleRepository.Item::id).flatMap(found -> {
            for (StoryBibleDtos.LinkInput link : values) {
                StoryBibleRepository.Item related = found.get(link.relatedItemId());
                String expected = switch (link.role()) {
                    case "relation_source", "relation_target", "participant" -> "character";
                    case "location" -> "location";
                    default -> "event";
                };
                if (related == null || related.suggestForItemId() != null || !expected.equals(related.itemType())) {
                    return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "关联的条目不存在或类型不匹配"));
                }
            }
            return Mono.just(values);
        });
    }

    /**
     * 以人工审阅状态复制条目，用于合并与拆分时锁定并递增修订号。
     *
     * @param item Item 条目
     * @param expectedRevision long 期望修订号
     * @return Item 锁定后的条目
     */
    private StoryBibleRepository.Item withReview(StoryBibleRepository.Item item, long expectedRevision) {
        return new StoryBibleRepository.Item(item.id(), item.projectId(), item.documentId(), item.itemType(), item.name(),
                item.summary(), item.attributes(), item.origin(), "confirmed", true, null, item.matchKey(),
                item.narrativeOffset(), item.storyTime(), item.storyTimeStatus(), item.storyOrder(), expectedRevision);
    }

    /**
     * 规范别名列表，名称本身作为别名之一。
     *
     * @param name String 名称
     * @param aliases List&lt;String&gt; 请求别名
     * @return List&lt;String&gt; 别名
     */
    private List<String> aliases(String name, List<String> aliases) {
        Map<String, String> result = new java.util.LinkedHashMap<>();
        result.put(StoryBibleSupport.normalize(name), name);
        if (aliases != null) {
            for (String alias : aliases) {
                String value = trimToNull(alias);
                if (value != null && value.length() <= MAX_NAME_LENGTH && !StoryBibleSupport.normalize(value).isEmpty()) {
                    result.putIfAbsent(StoryBibleSupport.normalize(value), value);
                }
            }
        }
        if (result.size() > MAX_ALIASES) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "别名不能超过50个");
        }
        return new ArrayList<>(result.values());
    }

    /**
     * 校验名称。
     *
     * @param name String 名称
     * @return String 规范名称
     */
    private String requireName(String name) {
        String value = trimToNull(name);
        if (value == null || StoryBibleSupport.normalize(value).isEmpty()) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "名称不能为空");
        }
        if (value.length() > MAX_NAME_LENGTH) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "名称不能超过255个字符");
        }
        return value;
    }

    /**
     * 查找文本模型配置标识。
     *
     * @param model String 渠道标识::模型名称
     * @return Mono&lt;String&gt; 模型配置标识
     */
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

    /**
     * 读取当前用户的项目原文。
     *
     * @param projectId String 项目标识
     * @return Mono&lt;Owned&gt; 归属上下文
     */
    private Mono<Owned> owned(String projectId) {
        return currentUserProvider.currentUserId().flatMap(userId -> document(userId, projectId).map(document -> new Owned(userId, document)));
    }

    /**
     * 按用户与项目读取原文。
     *
     * @param userId long 用户标识
     * @param projectId String 项目标识
     * @return Mono&lt;Document&gt; 原文
     */
    private Mono<ScriptSourceRepository.Document> document(long userId, String projectId) {
        String value = trimToNull(projectId);
        if (value == null) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_MISSING, "缺少剧本项目标识"));
        }
        return sourceRepository.findByProject(userId, value)
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "该项目没有导入原文")));
    }

    /**
     * 读取项目内条目。
     *
     * @param projectId String 项目标识
     * @param itemId String 条目标识
     * @return Mono&lt;Item&gt; 条目
     */
    private Mono<StoryBibleRepository.Item> requireItem(String projectId, String itemId) {
        String value = trimToNull(itemId);
        if (value == null) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_MISSING, "缺少条目标识"));
        }
        return repository.getItem(projectId, value)
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "条目不存在")));
    }

    /**
     * 修订号不匹配时报冲突。
     *
     * @param updated boolean 是否更新成功
     * @return Mono&lt;Void&gt; 校验结果
     */
    private Mono<Void> requireUpdated(boolean updated) {
        return updated ? Mono.empty() : conflict();
    }

    /**
     * 返回修订冲突错误。
     *
     * @return Mono&lt;Void&gt; 冲突错误
     */
    private Mono<Void> conflict() {
        return Mono.error(new BusinessException(ErrorCode.DATA_CONFLICT, "条目已被其他页面或分析任务修改，请刷新后重试"));
    }

    /**
     * 去除首尾空白并按空串归一。
     *
     * @param value String 原始值
     * @return String 归一结果
     */
    private String trimToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    /** 当前用户与原文。 */
    private record Owned(long userId, ScriptSourceRepository.Document document) { }

    /** 报价上下文。 */
    private record QuoteContext(ScriptSourceRepository.Document document, String modelConfigId, List<String> sectionIds,
                                List<int[]> ranges, StoryBibleDtos.Quote quote) { }
}
