package com.novanovastudio.service;

import com.novanovastudio.common.CreditAmounts;
import com.novanovastudio.service.TeamTaskScopeService;
import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.agent.AgentScopeAgentFactory;
import com.novanovastudio.agent.AgentScopeModelFactory;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.dto.ScriptSourceDtos;
import com.novanovastudio.dto.StoryBibleDtos;
import com.novanovastudio.repository.ScriptSourceRepository;
import com.novanovastudio.repository.StoryBibleRepository;
import com.novanovastudio.repository.PersistenceRepository;
import io.agentscope.core.ReActAgent;
import io.agentscope.core.agent.RuntimeContext;
import io.agentscope.core.message.Msg;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.reactive.TransactionalOperator;
import reactor.core.Disposable;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 故事知识库分析执行器：按模型容量分批提取、逐批写入并归纳故事线。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-09-27 00:00
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class StoryBibleAnalysisRunner {

    /** 持久化任务的团队作用域恢复。 */
    private final TeamTaskScopeService teamTaskScopeService;
    /** 任务执行租约秒数。 */
    public static final int LEASE_SECONDS = 300;
    /** 故事线归纳每批事件数。 */
    private static final int STORYLINE_BATCH = 300;
    /** 可恢复故障的最多整项执行次数。 */
    private static final int QUICK_JOB_ATTEMPTS = 3;
    /** 失败原因最大长度。 */
    private static final int MAX_ERROR_LENGTH = 500;

    /** 知识库仓储。 */
    private final StoryBibleRepository repository;
    /** 原文仓储。 */
    private final ScriptSourceRepository sourceRepository;
    /** 读取模型允许的请求并发数。 */
    private final PersistenceRepository persistenceRepository;
    /** 文本模型解析。 */
    private final AgentScopeModelFactory modelFactory;
    /** Agent工厂。 */
    private final AgentScopeAgentFactory agentFactory;
    /** 积分服务。 */
    private final CreditService creditService;
    /** 服务配置。 */
    private final NovanovaProperties properties;
    /** 响应式事务。 */
    private final TransactionalOperator transactionalOperator;

    /**
     * 抢占并执行分析任务，可被重复投递。
     *
     * @param jobId String 任务标识
     * @return Mono&lt;Void&gt; 执行结果
     */
    public Mono<Void> process(String jobId) {
        return teamTaskScopeService.execute("story_bible_analysis_jobs", jobId, () -> processInTeam(jobId));
    }

    /**
     * 在原任务空间内执行业务，保留现有错误收尾与退款。
     * @param jobId 任务标识
     * @return 执行完成信号
     */
    private Mono<Void> processInTeam(String jobId) {
        return repository.claimJob(jobId, LEASE_SECONDS).flatMap(claimed -> {
            if (!claimed) {
                return Mono.<Void>empty();
            }
            Disposable renewal = Flux.interval(Duration.ofSeconds(LEASE_SECONDS / 3))
                    .concatMap(ignored -> repository.renewJobLease(jobId, LEASE_SECONDS))
                    .subscribe(ignored -> { }, error -> log.error("故事知识库任务续租失败: jobId={}", jobId, error));
            return repository.findJobById(jobId)
                    .flatMap(this::run)
                    .onErrorResume(error -> handleFailure(jobId, error))
                    .doFinally(signal -> renewal.dispose());
        });
    }

    /**
     * 执行故事知识库分批分析。
     *
     * @param job Job 任务
     * @return Mono&lt;Void&gt; 执行结果
     */
    private Mono<Void> run(StoryBibleRepository.Job job) {
        log.info("故事知识库分析开始: jobId={}, attempt={}", job.id(), job.attemptCount());
        Mono<AgentScopeModelFactory.TextModelSelection> model = modelFactory.resolveTextModel(job.modelValue())
                .onErrorMap(error -> new FatalException("所选文本模型已不可用：" + error.getMessage()));
        Mono<String> text = sourceRepository.normalizedText(job.documentId())
                .switchIfEmpty(Mono.error(new FatalException("原文正文缺失")));
        return Mono.zip(model, text, sourceRepository.listSections(job.documentId())
                        .filter(section -> section.parentId() == null).collectList())
                .flatMap(tuple -> {
                    Context context = new Context(job, tuple.getT1(), tuple.getT2(), tuple.getT3());
                    return runQuick(context);
                });
    }

    /**
     * 按已验证容量规划批次；同模型最多两批并行，提交时串行锁定任务行。
     * @param context Context 执行上下文
     * @return Mono&lt;Void&gt; 任务完成信号
     */
    private Mono<Void> runQuick(Context context) {
        StoryBibleRepository.Job job = context.job();
        List<StoryBibleQuickPlanner.Batch> batches = StoryBibleQuickPlanner.plan(context.text(), context.sections(),
                job.ranges(), job.quickConfiguration());
        return Flux.fromIterable(batches)
                .concatMap(batch -> repository.insertUnit(job.id(), "batch", "batch:" + batch.sequence(), batch.sequence(),
                        snapshot(batch.parts())))
                .then()
                .then(repository.updateProgress(job.id(), "extract"))
                .then(persistenceRepository.getPlatformModelRequestConcurrency(job.modelConfigId()).defaultIfEmpty(1))
                .flatMap(concurrency -> processQuickPending(context, Math.min(2, Math.max(1, concurrency))))
                .then(repository.listUnits(job.id(), "batch").collectList())
                .flatMap(units -> {
                    List<StoryBibleDtos.Candidate> all = units.stream().filter(unit -> unit.result() != null)
                            .flatMap(unit -> candidates(unit.result()).stream()).toList();
                    List<StoryBibleDtos.Candidate> finals = StoryBibleMerger.unionByAlias(all);
                    return storylines(context, finals).flatMap(lines -> repository.listGaps(job.id()).hasElements()
                            .flatMap(partial -> finishQuick(context, finals, lines, partial)));
                })
                .doOnSuccess(ignored -> log.info("故事知识库快速分析结束: jobId={}", job.id()));
    }

    /**
     * 写入全书故事线并原子结束任务，保留此前逐批提交的条目。
     * @param context Context 执行上下文
     * @param finals List&lt;Candidate&gt; 批次候选
     * @param lines List&lt;Candidate&gt; 故事线
     * @param partial boolean 是否有缺口
     * @return Mono&lt;Void&gt; 完成信号
     */
    private Mono<Void> finishQuick(Context context, List<StoryBibleDtos.Candidate> finals,
                                   List<StoryBibleDtos.Candidate> lines, boolean partial) {
        Writer writer = new Writer(context);
        Mono<Void> save = repository.finishQuickJob(context.job(), partial).flatMap(completed -> {
            if (!completed) return Mono.error(new CanceledException());
            return repository.listMatchEntries(context.job().projectId()).collectList().doOnNext(writer::index)
                    .thenMany(Flux.fromIterable(finals).filter(candidate -> "event".equals(candidate.itemType()))
                            .concatMap(writer::write))
                    .thenMany(Flux.fromIterable(lines).concatMap(writer::write))
                    .then(repository.refreshNarrativeOffsets(context.job().projectId()));
        });
        return transactionalOperator.transactional(save);
    }

    /**
     * 执行当前待处理批次，并继续处理本轮拆出的子批次。
     * @param context Context 执行上下文
     * @param concurrency int 允许并发数
     * @return Mono&lt;Void&gt; 全部批次结束信号
     */
    private Mono<Void> processQuickPending(Context context, int concurrency) {
        return repository.listUnits(context.job().id(), "batch")
                .filter(unit -> !"completed".equals(unit.status())).collectList()
                .flatMap(pending -> pending.isEmpty() ? Mono.<Void>empty()
                        : Flux.fromIterable(pending)
                                .flatMap(unit -> processQuickUnit(context, unit, !unit.unitKey().matches("batch:[0-9]+")), concurrency)
                                .then(Mono.defer(() -> processQuickPending(context, concurrency))));
    }

    /**
     * 为批次持久化原文偏移，不重复保存大段原文。
     * @param parts List&lt;Part&gt; 批次片段
     * @return JSONObject 输入快照
     */
    private JSONObject snapshot(List<StoryBibleQuickPlanner.Part> parts) {
        return new JSONObject().fluentPut("parts", parts.stream()
                .map(part -> new JSONObject().fluentPut("sectionId", part.sectionId()).fluentPut("title", part.title())
                        .fluentPut("start", part.start()).fluentPut("end", part.end())).toList());
    }

    /**
     * 执行单批快速提取；无效输出只拆分当前批，已有结果不会再次请求。
     * @param context Context 执行上下文
     * @param unit Unit 工作单元
     * @param supplement boolean 是否为补分析调用
     * @return Mono&lt;Void&gt; 处理结果
     */
    private Mono<Void> processQuickUnit(Context context, StoryBibleRepository.Unit unit, boolean supplement) {
        StoryBibleRepository.Job job = context.job();
        List<StoryBibleQuickPlanner.Part> parts = JSON.parseArray(unit.snapshot().getJSONArray("parts").toJSONString(), JSONObject.class)
                .stream().map(part -> new StoryBibleQuickPlanner.Part(part.getString("sectionId"), part.getString("title"),
                        part.getIntValue("start"), part.getIntValue("end"), context.text().substring(part.getIntValue("start"), part.getIntValue("end"))))
                .toList();
        Mono<Boolean> admission = supplement
                ? repository.reserveSupplement(job.id(), job.quickConfiguration().maximumSupplementCalls()) : Mono.just(true);
        return ensureRunning(context).then(admission).flatMap(allowed -> allowed
                ? callOnce(context, new StoryBibleQuickPlanner.Batch(unit.seq(), parts).input(), StoryBibleDtos.QuickExtraction.class)
                        .flatMap(result -> saveQuickBatch(context, unit, parts, result))
                        .onErrorResume(error -> error instanceof InvalidQuickResultException || truncatedOutput(error),
                                error -> splitQuickBatch(context, unit, parts, truncate(error.getMessage())))
                : markQuickGap(context, unit, parts, "补分析次数已达上限"));
    }

    /**
     * 仅识别明确的上下文或输出截断错误，其他渠道错误走最终失败或可重试流程。
     * @param error Throwable 调用错误
     * @return boolean 是否可通过拆批修复
     */
    private boolean truncatedOutput(Throwable error) {
        String message = error.getMessage() == null ? "" : error.getMessage().toLowerCase(java.util.Locale.ROOT);
        return message.contains("context_length_exceeded") || message.contains("maximum context length")
                || message.contains("finish_reason=length") || message.contains("output truncated");
    }

    /**
     * 校验每个片段都有原文可定位的证据，并原子提交条目和检查点。
     * @param context Context 执行上下文
     * @param unit Unit 工作单元
     * @param parts List&lt;Part&gt; 输入片段
     * @param result QuickExtraction 模型结果
     * @return Mono&lt;Void&gt; 保存结果
     */
    private Mono<Void> saveQuickBatch(Context context, StoryBibleRepository.Unit unit,
                                      List<StoryBibleQuickPlanner.Part> parts, StoryBibleDtos.QuickExtraction result) {
        if (result == null || result.sections() == null || result.sections().size() != parts.size()) {
            return Mono.error(new InvalidQuickResultException("批次输出不完整"));
        }
        Map<String, StoryBibleDtos.SectionExtraction> byKey = new HashMap<>();
        for (StoryBibleDtos.SectionExtraction section : result.sections()) {
            if (section == null || byKey.putIfAbsent(section.sectionKey(), section) != null) {
                return Mono.error(new InvalidQuickResultException("批次片段标识缺失或重复"));
            }
        }
        List<StoryBibleDtos.Candidate> candidates = new ArrayList<>();
        for (StoryBibleQuickPlanner.Part part : parts) {
            StoryBibleDtos.SectionExtraction section = byKey.get(part.key());
            if (section == null) return Mono.error(new InvalidQuickResultException("存在未分析的章节片段"));
            List<StoryBibleDtos.Candidate> extracted = StoryBibleMerger.fromExtraction(part.key(), part.text(),
                    part.start(), part.start(), section.extraction());
            if (extracted.isEmpty()) return Mono.error(new InvalidQuickResultException("章节片段没有可核对的原文引文"));
            candidates.addAll(extracted);
        }
        List<StoryBibleDtos.Candidate> ordered = StoryBibleMerger.unionByAlias(candidates);
        Writer writer = new Writer(context);
        Mono<Void> write = repository.lockRunningJob(context.job()).flatMap(running -> {
            if (!running) return Mono.error(new CanceledException());
            return repository.listMatchEntries(context.job().projectId()).collectList()
                    .doOnNext(writer::index)
                    .thenMany(Flux.fromIterable(List.of("character", "location", "relationship", "event"))
                            .concatMap(type -> Flux.fromIterable(ordered).filter(candidate -> type.equals(candidate.itemType()))
                                    .concatMap(writer::write)))
                    .then(repository.completeUnit(unit.id(), candidatesJson(ordered)))
                    .then(repository.updateProgress(context.job().id(), "extract"))
                    .then(repository.refreshNarrativeOffsets(context.job().projectId()));
        });
        return transactionalOperator.transactional(write);
    }

    /**
     * 仅拆分失败批次；无法继续拆分时记录缺口。
     * @param context Context 执行上下文
     * @param unit Unit 失败单元
     * @param parts List&lt;Part&gt; 输入片段
     * @param reason String 拆分原因
     * @return Mono&lt;Void&gt; 子批次结果
     */
    private Mono<Void> splitQuickBatch(Context context, StoryBibleRepository.Unit unit,
                                       List<StoryBibleQuickPlanner.Part> parts, String reason) {
        List<List<StoryBibleQuickPlanner.Part>> children = new ArrayList<>();
        if (parts.size() > 1) {
            int middle = parts.size() / 2;
            children.add(parts.subList(0, middle));
            children.add(parts.subList(middle, parts.size()));
        } else if (parts.getFirst().text().length() >= 2_000) {
            StoryBibleQuickPlanner.Part part = parts.getFirst();
            int middle = part.start() + part.text().length() / 2;
            if (Character.isHighSurrogate(context.text().charAt(middle - 1))) middle--;
            children.add(List.of(new StoryBibleQuickPlanner.Part(part.sectionId(), part.title(), part.start(), middle,
                    context.text().substring(part.start(), middle))));
            children.add(List.of(new StoryBibleQuickPlanner.Part(part.sectionId(), part.title(), middle, part.end(),
                    context.text().substring(middle, part.end()))));
        } else {
            return markQuickGap(context, unit, parts, reason);
        }
        List<Mono<Void>> plans = new ArrayList<>();
        for (int index = 0; index < children.size(); index++) {
            plans.add(repository.insertUnit(context.job().id(), "batch", unit.unitKey() + (index == 0 ? "a" : "b"),
                    unit.seq() * 2 + index + 1, snapshot(children.get(index))));
        }
        Mono<Void> save = repository.lockRunningJob(context.job()).flatMap(running -> running
                ? Flux.concat(plans).then(repository.completeUnit(unit.id(), new JSONObject().fluentPut("split", true)))
                : Mono.error(new CanceledException()));
        return transactionalOperator.transactional(save);
    }

    /**
     * 补分析额度耗尽时记录单片缺口，供前端展示。
     * @param context Context 执行上下文
     * @param unit Unit 工作单元
     * @param parts List&lt;Part&gt; 未覆盖片段
     * @param reason String 原因
     * @return Mono&lt;Void&gt; 保存结果
     */
    private Mono<Void> markQuickGap(Context context, StoryBibleRepository.Unit unit,
                                    List<StoryBibleQuickPlanner.Part> parts, String reason) {
        Mono<Void> save = repository.lockRunningJob(context.job()).flatMap(running -> running
                ? repository.completeUnit(unit.id(), new JSONObject().fluentPut("gap", true).fluentPut("reason", reason))
                        .then(repository.updateProgress(context.job().id(), "extract"))
                : Mono.error(new CanceledException()));
        return transactionalOperator.transactional(save);
    }

    /**
     * 按事件分批归纳故事线。
     *
     * @param context Context 执行上下文
     * @param finals List&lt;Candidate&gt; 最终候选
     * @return Mono&lt;List&lt;Candidate&gt;&gt; 故事线候选
     */
    private Mono<List<StoryBibleDtos.Candidate>> storylines(Context context, List<StoryBibleDtos.Candidate> finals) {
        List<StoryBibleDtos.Candidate> events = finals.stream().filter(candidate -> "event".equals(candidate.itemType()))
                .sorted((left, right) -> Integer.compare(firstOffset(left), firstOffset(right))).toList();
        if (events.size() < 2) {
            return Mono.just(List.of());
        }
        List<Mono<Void>> plans = new ArrayList<>();
        for (int from = 0; from < events.size(); from += STORYLINE_BATCH) {
            List<String> keys = events.subList(from, Math.min(from + STORYLINE_BATCH, events.size())).stream()
                    .map(StoryBibleDtos.Candidate::key).toList();
            plans.add(repository.insertUnit(context.job().id(), "book", "storyline:" + from / STORYLINE_BATCH,
                    10_000 + from / STORYLINE_BATCH, new JSONObject().fluentPut("keys", keys)));
        }
        Map<String, StoryBibleDtos.Candidate> byKey = new HashMap<>();
        events.forEach(event -> byKey.put(event.key(), event));
        return Flux.concat(plans).then(repository.updateProgress(context.job().id(), "book"))
                .thenMany(repository.listUnits(context.job().id(), "book"))
                .filter(unit -> unit.unitKey().startsWith("storyline:"))
                .concatMap(unit -> {
                    if ("completed".equals(unit.status())) {
                        return Mono.just(unit.result());
                    }
                    List<JSONObject> input = StoryBibleMerger.stringList(unit.snapshot().get("keys")).stream()
                            .map(byKey::get).filter(event -> event != null)
                            .map(event -> new JSONObject().fluentPut("key", event.key()).fluentPut("title", event.name())
                                    .fluentPut("summary", event.summary())
                                    .fluentPut("participants", event.attributes().get("participants")))
                            .toList();
                    return ensureRunning(context)
                            .then(callOnce(context, new JSONObject().fluentPut("requestType", "storylines").fluentPut("events", input),
                                    StoryBibleDtos.StorylineResult.class))
                            .map(result -> storylineCandidates(result, byKey, unit.unitKey()))
                            .flatMap(lines -> {
                                JSONObject result = json(candidatesJson(lines));
                                return repository.completeUnit(unit.id(), result)
                                        .then(repository.updateProgress(context.job().id(), "book")).thenReturn(result);
                            });
                })
                .collectList()
                .map(results -> results.stream().flatMap(result -> candidates(result).stream()).toList());
    }

    /**
     * 每次请求只调用一次，避免隐式重试突破补分析次数上限。
     * @param context Context 执行上下文
     * @param input JSONObject 模型输入
     * @param resultType Class&lt;T&gt; 结构化结果类型
     * @param <T> T 结果类型
     * @return Mono&lt;T&gt; 模型结果
     */
    private <T> Mono<T> callOnce(Context context, JSONObject input, Class<T> resultType) {
        return Mono.defer(() -> {
                    ReActAgent agent = agentFactory.storyBibleAgent(modelFactory.withOutputLimit(
                            context.model().agentModel(), context.job().quickConfiguration().maximumOutputTokens()));
                    return agent.call(JSON.toJSONString(input), resultType, RuntimeContext.builder()
                                    .sessionId("story-bible:" + context.job().id()).userId(String.valueOf(context.job().userId())).build())
                            .timeout(Duration.ofSeconds(properties.getAi().getStoryBibleAgent().getTimeoutSeconds()))
                            .map(message -> parseAgentResult(message, resultType, context.job().id()))
                            .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "故事知识库Agent未返回结构化结果")))
                            .doFinally(signal -> agent.close());
                });
    }

    /**
     * 读取Agent结构化结果；兼容未调用结构化工具但直接返回完整JSON的模型。
     *
     * @param message Msg 模型返回消息
     * @param resultType Class&lt;T&gt; 目标结果类型
     * @param jobId String 分析任务标识
     * @param <T> T 结果类型
     * @return T 经过类型转换的结果
     * @throws InvalidQuickResultException 模型正文不是完整JSON对象或无法按结果类型解析
     */
    private <T> T parseAgentResult(Msg message, Class<T> resultType, String jobId) {
        if (message.hasStructuredData()) {
            return message.getStructuredData(resultType);
        }
        String text = message.getTextContent();
        if (text == null || !JSON.isValidObject(text)) {
            log.warn("故事知识库Agent未返回完整JSON响应: jobId={}, responseLength={}", jobId, text == null ? 0 : text.length());
            throw new InvalidQuickResultException("模型未返回完整JSON结果");
        }
        try {
            T result = JSON.parseObject(text, resultType);
            if (result == null) {
                throw new InvalidQuickResultException("模型未返回可解析的JSON结果");
            }
            log.warn("故事知识库Agent未调用结构化输出工具，改为解析完整JSON响应: jobId={}, responseLength={}", jobId, text.length());
            return result;
        } catch (com.alibaba.fastjson2.JSONException error) {
            throw new InvalidQuickResultException("模型JSON结果不符合结构化要求");
        }
    }

    /**
     * 任务被取消或不再运行时中止。
     *
     * @param context Context 执行上下文
     * @return Mono&lt;Void&gt; 检查结果
     */
    private Mono<Void> ensureRunning(Context context) {
        return repository.jobStatus(context.job().id())
                .flatMap(status -> "running".equals(status) ? Mono.<Void>empty() : Mono.error(new CanceledException()));
    }

    /**
     * 处理任务失败：不可恢复错误最终失败并全额退款，其余错误进入可重试状态。
     *
     * @param jobId String 任务标识
     * @param error Throwable 异常
     * @return Mono&lt;Void&gt; 处理结果
     */
    private Mono<Void> handleFailure(String jobId, Throwable error) {
        if (error instanceof CanceledException) {
            log.info("故事知识库分析已停止: jobId={}", jobId);
            return Mono.empty();
        }
        String message = truncate(error instanceof BusinessException || error instanceof FatalException
                ? error.getMessage() : "分析过程出错，请稍后重试");
        return repository.findJobById(jobId).flatMap(job -> handleFailure(job, error, message));
    }

    /**
     * 按执行次数决定可重试还是最终失败。
     * @param job Job 当前任务
     * @param error Throwable 故障
     * @param message String 用户可见原因
     * @return Mono&lt;Void&gt; 状态更新
     */
    private Mono<Void> handleFailure(StoryBibleRepository.Job job, Throwable error, String message) {
        String jobId = job.id();
        if (error instanceof FatalException || job.attemptCount() >= QUICK_JOB_ATTEMPTS) {
            log.error("故事知识库分析最终失败: jobId={}", jobId, error);
            return transactionalOperator.transactional(
                    repository.transitJob(jobId, List.of("running"), "failed", message)
                            .flatMap(updated -> updated && CreditAmounts.of(job.credits()).compareTo(CreditAmounts.of(0)) > 0
                                    ? creditService.refundOperation(job.userId(), jobId, StoryBibleService.OPERATION_NAME)
                                    : Mono.<Void>empty()));
        }
        log.error("故事知识库分析中断，可重试: jobId={}", jobId, error);
        return repository.transitJob(jobId, List.of("running"), "retryable", message).then();
    }

    /**
     * 从单元结果读取候选。
     *
     * @param result JSONObject 单元结果
     * @return List&lt;Candidate&gt; 候选
     */
    private List<StoryBibleDtos.Candidate> candidates(JSONObject result) {
        List<StoryBibleDtos.Candidate> values = result == null ? null : result.getList("candidates", StoryBibleDtos.Candidate.class);
        return values == null ? List.of() : values;
    }

    /**
     * 经JSON往返得到与数据库读出一致的结果对象，保证类型化读取行为一致。
     *
     * @param result JSONObject 内存结果
     * @return JSONObject 规范结果
     */
    private JSONObject json(JSONObject result) {
        return JSON.parseObject(result.toJSONString());
    }

    /**
     * 包装候选为单元结果。
     *
     * @param candidates List&lt;Candidate&gt; 候选
     * @return JSONObject 单元结果
     */
    private JSONObject candidatesJson(List<StoryBibleDtos.Candidate> candidates) {
        return new JSONObject().fluentPut("candidates", candidates);
    }

    /**
     * 把模型故事线转换为候选，证据取所含事件的首条证据。
     *
     * @param result StorylineResult 模型结果
     * @param events Map&lt;String, Candidate&gt; 事件
     * @param prefix String 键前缀
     * @return List&lt;Candidate&gt; 故事线候选
     */
    private List<StoryBibleDtos.Candidate> storylineCandidates(StoryBibleDtos.StorylineResult result,
                                                                Map<String, StoryBibleDtos.Candidate> events, String prefix) {
        List<StoryBibleDtos.Candidate> lines = new ArrayList<>();
        if (result == null || result.storylines() == null) {
            return lines;
        }
        for (StoryBibleDtos.AiStoryline line : result.storylines()) {
            if (line == null || line.name() == null || line.name().isBlank()) {
                continue;
            }
            List<String> keys = line.eventKeys() == null ? List.of()
                    : line.eventKeys().stream().filter(events::containsKey).distinct().toList();
            if (keys.isEmpty()) {
                continue;
            }
            List<StoryBibleDtos.CandidateEvidence> evidences = keys.stream().map(events::get)
                    .map(event -> event.evidences().getFirst()).toList();
            String name = line.name().strip();
            lines.add(new StoryBibleDtos.Candidate(prefix + ":" + lines.size(), "storyline",
                    name.length() > 255 ? name.substring(0, 255) : name, line.summary() == null ? "" : line.summary().strip(),
                    List.of(), evidences, new JSONObject().fluentPut("eventKeys", keys), false));
        }
        return lines;
    }

    /**
     * 候选首条证据位置。
     *
     * @param candidate Candidate 候选
     * @return int 位置
     */
    private static int firstOffset(StoryBibleDtos.Candidate candidate) {
        return candidate.evidences() == null || candidate.evidences().isEmpty() ? Integer.MAX_VALUE : candidate.evidences().getFirst().start();
    }

    /**
     * 截断失败原因。
     *
     * @param message String 原因
     * @return String 截断后原因
     */
    private String truncate(String message) {
        String value = message == null || message.isBlank() ? "分析过程出错，请稍后重试" : message;
        return value.length() > MAX_ERROR_LENGTH ? value.substring(0, MAX_ERROR_LENGTH) : value;
    }

    /**
     * 结果写入器：匹配已有条目，锁定条目只生成待审建议，已拒绝条目抑制重复生成。
     */
    private final class Writer {
        /** 执行上下文。 */
        private final Context context;
        /** 按类型与匹配键索引的已有条目。 */
        private final Map<String, StoryBibleRepository.MatchEntry> byMatchKey = new HashMap<>();
        /** 按类型与别名键索引的已有实体。 */
        private final Map<String, StoryBibleRepository.MatchEntry> byAlias = new HashMap<>();
        /** 实体称呼到条目标识，用于写入关联。 */
        private final Map<String, String> entityIds = new HashMap<>();
        /** 事件候选键到条目标识。 */
        private final Map<String, String> eventIds = new LinkedHashMap<>();
        /** 本次已写入的条目，避免同一次分析重复匹配。 */
        private final Set<String> touched = new HashSet<>();

        /**
         * 创建写入器。
         *
         * @param context Context 执行上下文
         */
        private Writer(Context context) {
            this.context = context;
        }

        /**
         * 建立已有条目索引。
         *
         * @param entries List&lt;MatchEntry&gt; 已有条目
         */
        private void index(List<StoryBibleRepository.MatchEntry> entries) {
            for (StoryBibleRepository.MatchEntry entry : entries) {
                byMatchKey.putIfAbsent(entry.itemType() + "#" + entry.matchKey(), entry);
                if (StoryBibleMerger.ENTITY_TYPES.contains(entry.itemType())) {
                    for (String alias : entry.aliasKeys()) {
                        byAlias.putIfAbsent(entry.itemType() + "#" + alias, entry);
                        if (!"rejected".equals(entry.status())) {
                            entityIds.putIfAbsent(entry.itemType() + "#" + alias, entry.id());
                        }
                    }
                }
            }
        }

        /**
         * 写入一个候选。
         *
         * @param candidate Candidate 候选
         * @return Mono&lt;Void&gt; 写入结果
         */
        private Mono<Void> write(StoryBibleDtos.Candidate candidate) {
            if (candidate.evidences() == null || candidate.evidences().isEmpty()) {
                return Mono.empty();
            }
            // 写入前逐条校验证据文字与原文范围完全一致。
            List<StoryBibleDtos.CandidateEvidence> evidences = candidate.evidences().stream()
                    .filter(evidence -> StoryBibleSupport.matches(context.text(), evidence.start(), evidence.end(), evidence.quote()))
                    .toList();
            if (evidences.isEmpty()) {
                return Mono.empty();
            }
            String matchKey = StoryBibleMerger.matchKey(candidate);
            StoryBibleRepository.MatchEntry match = find(candidate, matchKey);
            if (match != null && "rejected".equals(match.status())) {
                return Mono.empty();
            }
            if (match != null && (match.locked() || !"ai".equals(match.origin()))) {
                remember(candidate, match.id());
                return suggest(candidate, match.id(), matchKey, evidences);
            }
            if (match != null) {
                remember(candidate, match.id());
                // 同一次分析中多个候选命中同一条目时，只首次覆盖内容，后续只追加别名与证据。
                if (!touched.add(match.id())) {
                    return details(match.id(), candidate, evidences);
                }
                StoryBibleRepository.Item item = item(match.id(), candidate, matchKey, null);
                // 关联只追加不清空，局部重分析不会丢失范围外的关联。
                return repository.updateAiItem(item, context.job().id())
                        .flatMap(updated -> updated ? details(match.id(), candidate, evidences) : Mono.<Void>empty());
            }
            String id = java.util.UUID.randomUUID().toString();
            touched.add(id);
            remember(candidate, id);
            return repository.insertItem(item(id, candidate, matchKey, null), context.job().id())
                    .then(details(id, candidate, evidences));
        }

        /**
         * 为锁定条目生成待审建议，只保留尚未出现过的证据。
         *
         * @param candidate Candidate 候选
         * @param targetId String 锁定条目标识
         * @param matchKey String 匹配键
         * @param evidences List&lt;CandidateEvidence&gt; 证据
         * @return Mono&lt;Void&gt; 写入结果
         */
        private Mono<Void> suggest(StoryBibleDtos.Candidate candidate, String targetId, String matchKey,
                                   List<StoryBibleDtos.CandidateEvidence> evidences) {
            return repository.knownEvidenceSpans(targetId).collect(java.util.stream.Collectors.toSet()).flatMap(known -> {
                List<StoryBibleDtos.CandidateEvidence> fresh = evidences.stream()
                        .filter(evidence -> !known.contains(evidence.start() + ":" + evidence.end())).toList();
                if (fresh.isEmpty()) {
                    return Mono.<Void>empty();
                }
                String id = java.util.UUID.randomUUID().toString();
                StoryBibleRepository.Item item = item(id, candidate, matchKey, targetId);
                return repository.insertItem(item, context.job().id())
                        .thenMany(Flux.fromIterable(aliases(candidate)))
                        .concatMap(alias -> repository.insertAlias(id, alias, StoryBibleSupport.normalize(alias)))
                        .thenMany(Flux.fromIterable(fresh))
                        .concatMap(evidence -> repository.insertEvidence(id, context.job().documentId(), evidence,
                                evidence.alias() == null ? null : StoryBibleSupport.normalize(evidence.alias()), context.job().id()))
                        .then();
            });
        }

        /**
         * 写入别名、证据与关联。
         *
         * @param id String 条目标识
         * @param candidate Candidate 候选
         * @param evidences List&lt;CandidateEvidence&gt; 已校验证据
         * @return Mono&lt;Void&gt; 写入结果
         */
        private Mono<Void> details(String id, StoryBibleDtos.Candidate candidate, List<StoryBibleDtos.CandidateEvidence> evidences) {
            return Flux.fromIterable(aliases(candidate))
                    .concatMap(alias -> repository.insertAlias(id, alias, StoryBibleSupport.normalize(alias)))
                    .then(repository.knownEvidenceSpans(id).collect(java.util.stream.Collectors.toSet()))
                    .flatMapMany(known -> Flux.fromIterable(evidences)
                            .filter(evidence -> !known.contains(evidence.start() + ":" + evidence.end())))
                    .concatMap(evidence -> repository.insertEvidence(id, context.job().documentId(), evidence,
                            evidence.alias() == null ? null : StoryBibleSupport.normalize(evidence.alias()), context.job().id()))
                    .thenMany(Flux.fromIterable(links(candidate)))
                    .concatMap(link -> repository.insertLink(id, link[0], link[1]))
                    .then();
        }

        /**
         * 按候选属性解析关联。
         *
         * @param candidate Candidate 候选
         * @return List&lt;String[]&gt; 被关联条目标识与角色
         */
        private List<String[]> links(StoryBibleDtos.Candidate candidate) {
            List<String[]> links = new ArrayList<>();
            JSONObject attributes = candidate.attributes();
            switch (candidate.itemType()) {
                case "relationship" -> {
                    addLink(links, "character", attributes.getString("source"), "relation_source");
                    addLink(links, "character", attributes.getString("target"), "relation_target");
                }
                case "event" -> {
                    StoryBibleMerger.stringList(attributes.get("participants"))
                            .forEach(name -> addLink(links, "character", name, "participant"));
                    addLink(links, "location", attributes.getString("location"), "location");
                }
                case "storyline" -> StoryBibleMerger.stringList(attributes.get("eventKeys")).stream()
                        .map(eventIds::get).filter(eventId -> eventId != null)
                        .forEach(eventId -> links.add(new String[]{eventId, "storyline_event"}));
                default -> { }
            }
            return links;
        }

        /**
         * 按称呼添加实体关联。
         *
         * @param links List&lt;String[]&gt; 关联
         * @param type String 实体类型
         * @param name String 称呼
         * @param role String 角色
         */
        private void addLink(List<String[]> links, String type, String name, String role) {
            String id = name == null ? null : entityIds.get(type + "#" + StoryBibleSupport.normalize(name));
            if (id != null) {
                links.add(new String[]{id, role});
            }
        }

        /**
         * 查找匹配的已有条目。
         *
         * @param candidate Candidate 候选
         * @param matchKey String 匹配键
         * @return MatchEntry 已有条目
         */
        private StoryBibleRepository.MatchEntry find(StoryBibleDtos.Candidate candidate, String matchKey) {
            StoryBibleRepository.MatchEntry match = byMatchKey.get(candidate.itemType() + "#" + matchKey);
            if (match == null && StoryBibleMerger.ENTITY_TYPES.contains(candidate.itemType())) {
                for (String alias : StoryBibleMerger.aliasKeys(candidate)) {
                    match = byAlias.get(candidate.itemType() + "#" + alias);
                    if (match != null) {
                        break;
                    }
                }
            }
            return match;
        }

        /**
         * 记录候选对应的条目，供后续关联引用。
         *
         * @param candidate Candidate 候选
         * @param id String 条目标识
         */
        private void remember(StoryBibleDtos.Candidate candidate, String id) {
            if (StoryBibleMerger.ENTITY_TYPES.contains(candidate.itemType())) {
                StoryBibleMerger.aliasKeys(candidate).forEach(alias -> entityIds.putIfAbsent(candidate.itemType() + "#" + alias, id));
            } else if ("event".equals(candidate.itemType())) {
                eventIds.put(candidate.key(), id);
            }
        }

        /**
         * 构造条目行。
         *
         * @param id String 条目标识
         * @param candidate Candidate 候选
         * @param matchKey String 匹配键
         * @param suggestFor String 建议目标
         * @return Item 条目
         */
        private StoryBibleRepository.Item item(String id, StoryBibleDtos.Candidate candidate, String matchKey, String suggestFor) {
            JSONObject attributes = candidate.attributes() == null ? new JSONObject() : new JSONObject(candidate.attributes());
            attributes.remove("anchor");
            if (candidate.uncertain()) {
                attributes.put("uncertain", true);
            }
            boolean event = "event".equals(candidate.itemType());
            String storyTime = event && attributes.getString("storyTime") != null ? attributes.getString("storyTime") : "";
            String timeStatus = event && attributes.getBooleanValue("storyTimeCertain") && !storyTime.isEmpty() ? "known" : "uncertain";
            attributes.remove("storyTime");
            attributes.remove("storyTimeCertain");
            return new StoryBibleRepository.Item(id, context.job().projectId(), context.job().documentId(), candidate.itemType(),
                    candidate.name(), candidate.summary() == null ? "" : candidate.summary(), attributes, "ai", "pending", false,
                    suggestFor, matchKey, candidate.evidences().getFirst().start(),
                    storyTime.length() > 255 ? storyTime.substring(0, 255) : storyTime, timeStatus, null, 0);
        }

        /**
         * 实体别名列表，非实体为空。
         *
         * @param candidate Candidate 候选
         * @return List&lt;String&gt; 别名
         */
        private List<String> aliases(StoryBibleDtos.Candidate candidate) {
            if (!StoryBibleMerger.ENTITY_TYPES.contains(candidate.itemType())) {
                return List.of();
            }
            List<String> aliases = new ArrayList<>();
            aliases.add(candidate.name());
            if (candidate.aliases() != null) {
                candidate.aliases().stream().filter(alias -> alias != null && alias.length() <= 255).forEach(aliases::add);
            }
            return aliases.stream().filter(alias -> !StoryBibleSupport.normalize(alias).isEmpty()).distinct().limit(50).toList();
        }
    }

    /** 执行上下文。 */
    private record Context(StoryBibleRepository.Job job, AgentScopeModelFactory.TextModelSelection model, String text,
                           List<ScriptSourceDtos.Section> sections) { }

    /** 任务已取消或不再处于运行状态。 */
    private static final class CanceledException extends RuntimeException {
        /** 创建取消异常。 */
        private CanceledException() {
            super("任务已取消", null, false, false);
        }
    }

    /** 快速模式缺少带原文证据的完整片段结果。 */
    private static final class InvalidQuickResultException extends RuntimeException {
        /**
         * 创建不完整结果异常。
         * @param message String 原因
         */
        private InvalidQuickResultException(String message) { super(message); }
    }

    /** 不可恢复的错误，最终失败并退款。 */
    private static final class FatalException extends RuntimeException {
        /**
         * 创建不可恢复错误。
         *
         * @param message String 原因
         */
        private FatalException(String message) {
            super(message);
        }
    }
}
