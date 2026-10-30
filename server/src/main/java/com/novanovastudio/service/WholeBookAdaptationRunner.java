package com.novanovastudio.service;

import com.novanovastudio.service.TeamTaskScopeService;
import java.math.BigDecimal;
import com.novanovastudio.common.CreditAmounts;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.NovelAdaptationDtos;
import com.novanovastudio.dto.ScriptDtos;
import com.novanovastudio.dto.WholeBookAdaptationDtos;
import com.novanovastudio.dto.WholeBookAdaptationDtos.Assignment;
import com.novanovastudio.repository.NovelAdaptationJobRepository;
import com.novanovastudio.repository.NovelAdaptationRepository;
import com.novanovastudio.repository.StoryBibleRepository;
import com.novanovastudio.repository.WholeBookAdaptationRepository;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.reactive.TransactionalOperator;
import reactor.core.Disposable;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 全书改编执行器：按持久化单元顺序生成素材、分层汇总与全书策略，完成后停在集数确认停点。
 * <p>
 * 单元的输出即成功依据，重启或失败续跑只重做未完成单元；归纳类单元严格按顺序执行，
 * 前序单元的输入不可能缺失，因此依赖不满足时直接失败而不是跳过。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-10-01 22:30
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class WholeBookAdaptationRunner {

    /** 持久化任务的团队作用域恢复。 */
    private final TeamTaskScopeService teamTaskScopeService;

    /** 执行租约秒数。 */
    public static final int LEASE_SECONDS = 300;

    /** 失败原因最大长度。 */
    private static final int MAX_ERROR_LENGTH = 500;

    /** 任务仓储。 */
    private final NovelAdaptationJobRepository jobRepository;

    /** 工作流快照与生成单元。 */
    private final WholeBookAdaptationRepository repository;

    /** 剧本Agent结构化调用。 */
    private final ScriptAgentService scriptAgentService;

    /** 剧本正式数据服务，保存待审草稿并复用替换事务。 */
    private final ScriptService scriptService;

    /** 改编草稿归属与检查点。 */
    private final NovelAdaptationRepository novelAdaptationRepository;

    /** 积分服务，失败时退还未完成部分。 */
    private final CreditService creditService;

    /** 失败状态与退款一起提交，避免续跑先于退款结清。 */
    private final TransactionalOperator transactionalOperator;

    /**
     * 认领并执行一次全书改编任务，失败时记录原因并退还未结算积分。
     *
     * @param jobId String 任务标识
     * @return Mono&lt;Void&gt; 执行结果
     */
    public Mono<Void> process(String jobId) {
        return teamTaskScopeService.execute("novel_adaptation_jobs", jobId, () -> processInTeam(jobId));
    }

    /**
     * 在原任务空间内执行业务，保留现有错误收尾与退款。
     * @param jobId 任务标识
     * @return 执行完成信号
     */
    private Mono<Void> processInTeam(String jobId) {
        return jobRepository.claim(jobId, LEASE_SECONDS).flatMap(claimed -> {
            if (!claimed) return Mono.<Void>empty();
            Disposable renewal = Flux.interval(Duration.ofSeconds(LEASE_SECONDS / 3))
                    .concatMap(ignored -> jobRepository.renewLease(jobId, LEASE_SECONDS))
                    .subscribe(ignored -> { }, error -> log.warn("全书改编租约续期失败: jobId={}", jobId, error));
            return run(jobId)
                    .doFinally(signal -> renewal.dispose())
                    .onErrorResume(error -> handleFailure(jobId, error));
        });
    }

    /** 按阶段执行，未接入的阶段明确失败而不是静默跳过。 */
    private Mono<Void> run(String jobId) {
        return jobRepository.find(jobId).flatMap(job -> switch (job.phase()) {
            case WholeBookAdaptationService.PHASE_MATERIALS -> executeMaterials(job);
            case WholeBookAdaptationService.PHASE_PLANNING -> executePlanning(job);
            default -> Mono.error(new BusinessException(ErrorCode.PARAM_INVALID,
                    "全书改编阶段尚未接入执行器：" + job.phase()));
        });
    }

    /**
     * 顺序执行素材与策略的全部未完成单元，成功后停在集数确认停点。
     *
     * @param job Job 当前任务
     * @return Mono&lt;Void&gt; 执行结果
     */
    private Mono<Void> executeMaterials(NovelAdaptationJobRepository.Job job) {
        return repository.find(job.id()).flatMap(workflow -> repository.units(job.id()).collectList()
                .flatMap(units -> {
                    Map<String, StoryBibleRepository.Item> facts = new LinkedHashMap<>();
                    workflow.facts().forEach(fact -> facts.put(fact.id(), fact));
                    // 已完成单元的输出必须参与后序输入，续跑时不能因为跳过而丢依赖。
                    Map<String, JSONObject> outputs = new LinkedHashMap<>();
                    units.stream().filter(unit -> unit.output() != null)
                            .forEach(unit -> outputs.put(unit.key(), unit.output()));
                    AtomicInteger processed = new AtomicInteger(outputs.size());
                    List<WholeBookAdaptationRepository.Unit> pending = units.stream()
                            .filter(unit -> unit.output() == null).toList();
                    return Flux.fromIterable(pending)
                            .concatMap(unit -> ensureRunning(job.id())
                                    .then(Mono.defer(() -> executeUnit(job, unit, facts, outputs)))
                                    .flatMap(output -> Mono.defer(() -> repository
                                            .complete(job.id(), unit, output, null))
                                            .doOnNext(saved -> {
                                                if (saved) outputs.put(unit.key(), output);
                                            })
                                            .then(Mono.defer(() -> jobRepository.updateProgress(job.id(),
                                                    WholeBookAdaptationService.PHASE_MATERIALS, unit.stage(),
                                                    processed.incrementAndGet(), units.size())))))
                            .then(Mono.defer(() -> jobRepository.await(job.id(),
                                    WholeBookAdaptationService.PHASE_PLANNING,
                                    WholeBookAdaptationService.STAGE_STRATEGY, processed.get())))
                            .then();
                }));
    }

    /**
     * 按单元阶段构造模型输入并校验输出，素材与策略均以强类型结构化结果返回。
     *
     * @param job Job 当前任务
     * @param unit Unit 当前单元
     * @param facts Map&lt;String, Item&gt; 任务内事实索引
     * @param outputs Map&lt;String, JSONObject&gt; 已成功单元输出
     * @return Mono&lt;JSONObject&gt; 已校验输出
     */
    private Mono<JSONObject> executeUnit(NovelAdaptationJobRepository.Job job,
                                         WholeBookAdaptationRepository.Unit unit,
                                         Map<String, StoryBibleRepository.Item> facts,
                                         Map<String, JSONObject> outputs) {
        String operationId = job.id() + ":" + unit.key();
        if (WholeBookAdaptationService.STAGE_MATERIAL.equals(unit.stage())) {
            List<String> factIds = unit.input().getJSONArray("factIds").toJavaList(String.class);
            List<JSONObject> batch = factIds.stream().map(id -> {
                StoryBibleRepository.Item fact = facts.get(id);
                if (fact == null) {
                    throw new BusinessException(ErrorCode.DATA_CONFLICT, "任务引用的故事事实已变化，请重新发起");
                }
                return WholeBookAdaptationPlanner.modelFact(fact);
            }).toList();
            Map<String, Object> input = new LinkedHashMap<>();
            input.put("requestType", "material");
            input.put("instruction", "只归纳本批剧情素材：因果关系、人物变化与阶段转折，并保留可定位的事实标识。"
                    + "不写入正式大纲或分集，不逐条复述事件，故事时间不确定时必须标注。");
            input.put("context", Map.of("facts", batch, "settings", job.settings()));
            return scriptAgentService.callWholeBookUnit(job.userId(), operationId, job.modelValue(),
                            input, WholeBookAdaptationDtos.Material.class)
                    .map(material -> {
                        WholeBookAdaptationPlanner.require(material != null && material.summary() != null
                                && !material.summary().isBlank(), "素材摘要不能为空");
                        return JSON.parseObject(JSON.toJSONString(material));
                    });
        }
        List<String> sourceKeys = unit.input().getJSONArray("sourceKeys").toJavaList(String.class);
        List<JSONObject> sources = sourceKeys.stream().map(key -> {
            JSONObject output = outputs.get(key);
            if (output == null) {
                throw new BusinessException(ErrorCode.DATA_CONFLICT, "汇总来源尚未生成，不能继续归纳");
            }
            return JSONObject.of("key", key, "summary", output.getString("summary"));
        }).toList();
        Map<String, Object> context = Map.of("sources", sources, "settings", job.settings());
        if (WholeBookAdaptationService.STAGE_STRATEGY.equals(unit.stage())) {
            Map<String, Object> input = new LinkedHashMap<>();
            input.put("requestType", "strategy");
            input.put("instruction", "归纳全书故事阶段与主线，给出建议集数与压缩取舍。"
                    + "arcs 的 sourceKeys 必须精确取自输入的 sources.key；每个来源至少被一个阶段引用，不得遗漏或编造；"
                    + "recommendedEpisodes 是建议集数，最终集数由用户确认。");
            input.put("context", context);
            return scriptAgentService.callWholeBookUnit(job.userId(), operationId, job.modelValue(),
                            input, WholeBookAdaptationDtos.Strategy.class)
                    .map(strategy -> {
                        WholeBookAdaptationPlanner.validateStrategy(strategy, sourceKeys);
                        return JSON.parseObject(JSON.toJSONString(strategy));
                    });
        }
        Map<String, Object> input = new LinkedHashMap<>();
        input.put("requestType", "material");
        input.put("instruction", "把输入中的多个素材摘要归并成一段更概括的剧情素材，保持时间顺序，"
                + "只描述主线推进、关键转折与人物变化，不新增未提供的情节。");
        input.put("context", context);
        return scriptAgentService.callWholeBookUnit(job.userId(), operationId, job.modelValue(),
                        input, WholeBookAdaptationDtos.Material.class)
                .map(merged -> {
                    WholeBookAdaptationPlanner.require(merged != null && merged.summary() != null
                            && !merged.summary().isBlank(), "归并摘要不能为空");
                    return JSON.parseObject(JSON.toJSONString(merged));
                });
    }

    /**
     * 顺序执行统一规划的未完成单元，完成后停在替换确认停点。
     * <p>
     * 概览与大纲只生成一次并由全书素材摘要归纳，不再由多批完整对象轮流覆盖；
     * 人物与地点按容量分批，分集标识由服务端固定，因此分批产出的草稿不会互相覆盖。
     *
     * @param job Job 当前任务
     * @return Mono&lt;Void&gt; 执行结果
     */
    private Mono<Void> executePlanning(NovelAdaptationJobRepository.Job job) {
        return Mono.zip(repository.find(job.id()), repository.units(job.id()).collectList())
                .flatMap(input -> {
                    WholeBookAdaptationRepository.Workflow workflow = input.getT1();
                    List<WholeBookAdaptationRepository.Unit> all = input.getT2();
                    List<WholeBookAdaptationRepository.Unit> pending = all.stream()
                            .filter(unit -> WholeBookAdaptationService.PHASE_PLANNING.equals(unit.phase()))
                            .filter(unit -> unit.output() == null).toList();
                    Map<String, StoryBibleRepository.Item> facts = new LinkedHashMap<>();
                    workflow.facts().forEach(fact -> facts.put(fact.id(), fact));
                    Map<String, JSONObject> outputs = new LinkedHashMap<>();
                    all.stream().filter(unit -> unit.output() != null)
                            .forEach(unit -> outputs.put(unit.key(), unit.output()));
                    List<JSONObject> sources = rootSources(all, outputs);
                    AtomicInteger processed = new AtomicInteger((int) all.stream()
                            .filter(unit -> WholeBookAdaptationService.PHASE_PLANNING.equals(unit.phase()))
                            .filter(unit -> unit.output() != null).count());
                    return Flux.fromIterable(pending)
                            .concatMap(unit -> ensureRunning(job.id())
                                    .then(Mono.defer(() -> executePlanningUnit(job, workflow, unit, facts, outputs, sources)))
                                    .flatMap(result -> Mono.defer(() -> repository.complete(job.id(), unit,
                                                    result.output(), result.draftId()))
                                            .doOnNext(saved -> {
                                                if (saved) outputs.put(unit.key(), result.output());
                                            })
                                            .then(Mono.defer(() -> jobRepository.updateProgress(job.id(),
                                                    WholeBookAdaptationService.PHASE_PLANNING, unit.stage(),
                                                    processed.incrementAndGet(), all.size())))))
                            .then(Mono.defer(() -> jobRepository.await(job.id(),
                                    WholeBookAdaptationService.PHASE_PLANNING,
                                    WholeBookAdaptationService.STAGE_EPISODE_PLAN, all.size())))
                            .then();
                });
    }

    /**
     * 按单元阶段构造统一规划的模型输入，全局设定与设定、取舍、逐集规划各自限定输入范围。
     *
     * @param job Job 当前任务
     * @param workflow Workflow 输入快照与固定分集
     * @param unit Unit 当前单元
     * @param facts Map&lt;String, Item&gt; 任务内事实索引
     * @param outputs Map&lt;String, JSONObject&gt; 已成功单元输出
     * @param sources List&lt;JSONObject&gt; 按全书策略顺序排列的素材摘要
     * @return Mono&lt;PlanningResult&gt; 单元产出与可选草稿
     */
    private Mono<PlanningResult> executePlanningUnit(NovelAdaptationJobRepository.Job job,
                                                     WholeBookAdaptationRepository.Workflow workflow,
                                                     WholeBookAdaptationRepository.Unit unit,
                                                     Map<String, StoryBibleRepository.Item> facts,
                                                     Map<String, JSONObject> outputs,
                                                     List<JSONObject> sources) {
        int duration = job.settings().getIntValue("episodeDurationSeconds");
        switch (unit.stage()) {
            case "overview" -> {
                WholeBookAdaptationDtos.Options options = job.settings()
                        .toJavaObject(WholeBookAdaptationDtos.Options.class);
                String instruction = "根据全书策略与素材摘要生成故事概览，覆盖全书主线、人物成长与结局；"
                        + "contentType、targetEpisodeCount、targetDurationSeconds 由服务端设定，保持与输入一致。";
                return scriptAgentService.callWholeBookUnit(job.userId(), unit.key(), job.modelValue(),
                                draftInput("overview", "overview", instruction, planningContext(job, workflow,
                                        Map.of("sources", sources,
                                                "contentType", options.format(),
                                                "targetEpisodeCount", workflow.slots().size(),
                                                "targetDurationSeconds", options.episodeDurationSeconds()))),
                                ScriptDtos.GeneratedOverviewDraft.class)
                        .flatMap(generated -> {
                            JSONObject data = JSON.parseObject(JSON.toJSONString(generated.draftData()));
                            // 改编形式与目标集数由用户设置决定，模型不需要也不应该改写。
                            data.put("contentType", options.format());
                            data.put("targetEpisodeCount", Math.max(1, workflow.slots().size()));
                            data.put("targetDurationSeconds", options.episodeDurationSeconds());
                            return saveDraft(job, workflow, unit, "overview", "overview", instruction, data, true);
                        });
            }
            case "outline" -> {
                String instruction = "根据全书策略与素材摘要生成故事大纲，按故事阶段组织分节与关键事件；"
                        + "事件不要填写 episodeId，分集归属由分集规划阶段决定。";
                return scriptAgentService.callWholeBookUnit(job.userId(), unit.key(), job.modelValue(),
                                draftInput("outline", "outline", instruction,
                                        planningContext(job, workflow, Map.of("sources", sources))),
                                ScriptDtos.GeneratedOutlineDraft.class)
                        .flatMap(generated -> saveDraft(job, workflow, unit, "outline", "outline", instruction,
                                JSON.parseObject(JSON.toJSONString(assignOutlineIds(generated.draftData()))), true));
            }
            case "characters" -> {
                String instruction = "根据本批事实生成人物设定与人物之间的关系；"
                        + "证据少于3条的次要人物只填写名称、身份与简介，其余字段留空，不得编造；"
                        + "relations 只能引用本次输出的人物标识。";
                List<JSONObject> batch = factModels(facts, unit.input().getJSONArray("factIds").toJavaList(String.class));
                return scriptAgentService.callWholeBookUnit(job.userId(), unit.key(), job.modelValue(),
                                draftInput("characters", "characters", instruction,
                                        planningContext(job, workflow, Map.of("facts", batch))),
                                ScriptDtos.GeneratedCharacterDraft.class)
                        .flatMap(generated -> saveDraft(job, workflow, unit, "characters", "characters", instruction,
                                JSON.parseObject(JSON.toJSONString(assignRelationIds(generated.draftData()))), true));
            }
            case "locations" -> {
                String instruction = "根据本批事实生成地点设定，只填写 locations；"
                        + "世界观基调由全局一次生成，这里保持 worldSetting 与 worldItems 为空；"
                        + "证据不足的地点只填写名称与用途。";
                List<JSONObject> batch = factModels(facts, unit.input().getJSONArray("factIds").toJavaList(String.class));
                return scriptAgentService.callWholeBookUnit(job.userId(), unit.key(), job.modelValue(),
                                draftInput("world", "world", instruction,
                                        planningContext(job, workflow, Map.of("facts", batch))),
                                ScriptDtos.GeneratedWorldDraft.class)
                        .map(generated -> {
                            ScriptDtos.WorldDraft draft = generated.draftData();
                            return JSONObject.of("worldSetting",
                                            draft.worldSetting() == null ? new JSONObject() : draft.worldSetting(),
                                    "worldItems", draft.worldItems() == null ? List.of() : draft.worldItems(),
                                    "locations", draft.locations() == null ? List.of() : draft.locations());
                        })
                        .flatMap(data -> saveDraft(job, workflow, unit, "world", "world", instruction, data, true));
            }
            case "assignment" -> {
                int arcIndex = unit.input().getIntValue("arcIndex", 0);
                List<String> factIds = unit.input().getJSONArray("factIds").toJavaList(String.class);
                List<WholeBookAdaptationDtos.Slot> arcSlots = arcSlots(workflow.slots(), arcIndex);
                // 事件与分集都以批内序号标识模型，避免它转抄 36 位 UUID 时失手导致整批作废。
                List<JSONObject> episodes = episodeSlots(arcSlots, duration);
                String instruction = "为每个事件指定唯一处理方式：retain 保留、merge 合并、omit 省略。"
                        + "factId 必须逐字复制 events[].id 的批内序号（如 e1、e17），不得使用真实标识或其他编号；"
                        + "merge 必须填写 episodeId，且必须逐字复制 episodes[].id 的批内序号（如 ep1、ep2），不得使用集号或自行编号；"
                        + "retain 可以留空 episodeId，或指向本阶段中的某一集；omit 必须说明理由且 episodeId 留空；"
                        + "每个事件恰好出现一次，不得遗漏或重复。";
                Map<String, Object> input = new LinkedHashMap<>();
                input.put("requestType", "assignment");
                input.put("instruction", instruction);
                input.put("context", planningContext(job, workflow,
                        Map.of("events", factModels(facts, factIds, WholeBookAdaptationPlanner.EVENT_PREFIX),
                                "episodes", episodes)));
                return scriptAgentService.callWholeBookUnit(job.userId(), unit.key(), job.modelValue(),
                                input, WholeBookAdaptationDtos.Assignment.class)
                        .map(assignment -> {
                            // 先把批内序号还原为真实标识，再按真实范围校验遗漏与越界。
                            Assignment resolved = WholeBookAdaptationPlanner.resolveAssignment(assignment, factIds, arcSlots);
                            WholeBookAdaptationPlanner.validateAssignment(resolved, Set.copyOf(factIds),
                                    Set.copyOf(arcSlots.stream().map(WholeBookAdaptationDtos.Slot::id).toList()));
                            return new PlanningResult(JSON.parseObject(JSON.toJSONString(resolved)), null);
                        });
            }
            case "relations" -> {
                // 跨批关系单元尚未接入：已入库的旧单元直接标记跳过，避免落入逐集规划分支生成错误内容。
                // 新任务不再规划该单元，人物关系随人物批产出。
                log.warn("跳过尚未接入的跨批关系单元: jobId={}, unit={}", job.id(), unit.key());
                return Mono.just(new PlanningResult(JSONObject.of("skipped", true), null));
            }
            case "episodePlan" -> {
                int arcIndex = unit.input().getIntValue("arcIndex", 0);
                List<WholeBookAdaptationDtos.Slot> arcSlots = arcSlots(workflow.slots(), arcIndex);
                List<JSONObject> assignments = WholeBookAdaptationPlanner.modelAssignments(
                        outputs.entrySet().stream()
                                .filter(entry -> entry.getKey().startsWith("assignment:" + arcIndex + ":"))
                                .map(Map.Entry::getValue).toList(),
                        arcSlots);
                String instruction = "为每一集填写核心事件、主要冲突、高潮与结尾悬念；"
                        + "id 必须逐字复制 episodes[].id 的批内序号（如 ep1、ep2），不得使用真实标识或集号；"
                        + "不得增删分集，id 与 episodes 逐条对应。";
                return scriptAgentService.callWholeBookUnit(job.userId(), unit.key(), job.modelValue(),
                                draftInput("episodePlan", "episodes", instruction, planningContext(job, workflow,
                                        Map.of("episodes", episodeSlots(arcSlots, duration),
                                                "assignments", assignments))),
                                ScriptDtos.GeneratedEpisodePlanDraft.class)
                        .flatMap(generated -> {
                            // 分集身份、集号与时长以服务端固定槽位为准，模型只负责填写内容。
                            List<ScriptDtos.EpisodeSummary> resolved = WholeBookAdaptationPlanner
                                    .resolveEpisodes(generated.draftData().episodes(), arcSlots, duration);
                            WholeBookAdaptationPlanner.validateEpisodes(resolved, arcSlots);
                            return saveDraft(job, workflow, unit, "episodePlan", "episodes", instruction,
                                    new JSONObject().fluentPut("episodes", resolved), false);
                        });
            }
            default -> {
                // 未知阶段必须明确失败，不能落进某个分支产出错误内容。
                return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID,
                        "统一规划阶段不受支持的单元类型：" + unit.stage()));
            }
        }
    }

    /** 按全书策略的来源顺序汇总素材摘要，供概览与大纲一次归纳全书。 */
    private List<JSONObject> rootSources(List<WholeBookAdaptationRepository.Unit> all,
                                         Map<String, JSONObject> outputs) {
        List<String> roots = all.stream()
                .filter(unit -> WholeBookAdaptationService.STAGE_STRATEGY.equals(unit.stage()))
                .map(unit -> unit.input().getJSONArray("sourceKeys").toJavaList(String.class))
                .findFirst().orElse(List.of());
        return roots.stream().map(key -> JSONObject.of("key", key, "summary",
                outputs.getOrDefault(key, new JSONObject()).getString("summary"))).toList();
    }

    /** 统一规划单元的公共上下文，携带改编设置与已确认的全书策略。 */
    private Map<String, Object> planningContext(NovelAdaptationJobRepository.Job job,
                                                WholeBookAdaptationRepository.Workflow workflow,
                                                Map<String, Object> extra) {
        Map<String, Object> context = new LinkedHashMap<>();
        context.put("settings", job.settings());
        context.put("strategy", workflow.strategy());
        context.putAll(extra);
        return context;
    }

    /** 把事实标识展开为紧凑的模型事实对象。 */
    private List<JSONObject> factModels(Map<String, StoryBibleRepository.Item> facts, List<String> ids) {
        return ids.stream().map(id -> {
            StoryBibleRepository.Item fact = facts.get(id);
            if (fact == null) {
                throw new BusinessException(ErrorCode.DATA_CONFLICT, "任务引用的故事事实已变化，请重新发起");
            }
            return WholeBookAdaptationPlanner.modelFact(fact);
        }).toList();
    }

    /**
     * 把事实标识展开为批内序号标识的模型事实对象。
     * <p>
     * 取舍与分集规划都要求模型逐字回填事件标识，用 {@code e1} 这类批内序号代替 36 位 UUID，
     * 模型只需按输入顺序编号，长标识转抄的失手率因此降到可以忽略。
     */
    private List<JSONObject> factModels(Map<String, StoryBibleRepository.Item> facts, List<String> ids,
                                        String prefix) {
        List<JSONObject> batch = factModels(facts, ids);
        for (int index = 0; index < batch.size(); index++) {
            batch.get(index).put("id", prefix + (index + 1));
        }
        return batch;
    }

    /** 一个故事阶段的固定分集槽位。 */
    private List<WholeBookAdaptationDtos.Slot> arcSlots(List<WholeBookAdaptationDtos.Slot> slots, int arcIndex) {
        return slots.stream().filter(slot -> slot.arcIndex() == arcIndex).toList();
    }

    /**
     * 一个故事阶段的分集槽位，标识使用批内序号。
     * <p>
     * 序号在阶段内从 1 重新计数，模型看到的是与本幕一一对应的短标识。
     */
    private List<JSONObject> episodeSlots(List<WholeBookAdaptationDtos.Slot> arcSlots, int duration) {
        List<JSONObject> episodes = new ArrayList<>(arcSlots.size());
        for (int index = 0; index < arcSlots.size(); index++) {
            WholeBookAdaptationDtos.Slot slot = arcSlots.get(index);
            episodes.add(JSONObject.of("id", WholeBookAdaptationPlanner.EPISODE_PREFIX + (index + 1),
                    "episodeNumber", slot.episodeNumber(), "targetDurationSeconds", duration));
        }
        return episodes;
    }

    /** 草稿请求的统一输入结构，与剧本Agent的草稿约定一致。 */
    private Map<String, Object> draftInput(String actionType, String targetType, String instruction, Object context) {
        Map<String, Object> input = new LinkedHashMap<>();
        input.put("requestType", "draft");
        input.put("actionType", actionType);
        input.put("targetType", targetType);
        input.put("targetId", "");
        input.put("instruction", instruction);
        input.put("context", context);
        return input;
    }

    /**
     * 把大纲的结构段与事件标识换成服务端生成的唯一标识。
     *
     * <p>大纲是新写内容，没有可复用的真实标识，模型只能自造 {@code outline-act-1}、{@code event-1}
     * 这类顺序短标识；而 script_outline_sections 与 script_story_events 的标识是全局主键，
     * 同一部小说在不同项目里会生成完全相同的短标识，第二个项目应用时必然撞上第一个项目的行。
     * 事件对结构段的引用在同一批内重映射；分集与场次是后续阶段才产生的身份字段，这里一律清空。</p>
     *
     * @param draft OutlineDraft 模型产出的大纲
     * @return OutlineDraft 标识已替换的大纲
     */
    private ScriptDtos.OutlineDraft assignOutlineIds(ScriptDtos.OutlineDraft draft) {
        Map<String, String> sectionIds = new LinkedHashMap<>();
        for (ScriptDtos.OutlineSection section : draft.sections()) {
            sectionIds.put(section.id(), UUID.randomUUID().toString());
        }
        List<ScriptDtos.OutlineSection> sections = draft.sections().stream()
                .map(section -> new ScriptDtos.OutlineSection(sectionIds.get(section.id()), section.sectionType(),
                        section.title(), section.content(), section.sortOrder()))
                .toList();
        List<ScriptDtos.StoryEvent> events = draft.events().stream()
                .map(event -> new ScriptDtos.StoryEvent(UUID.randomUUID().toString(),
                        event.outlineSectionId() == null ? null : sectionIds.get(event.outlineSectionId()),
                        null, null, event.eventType(), event.title(), event.description(), event.sortOrder()))
                .toList();
        return new ScriptDtos.OutlineDraft(sections, events);
    }

    /**
     * 把人物关系的标识换成服务端生成的唯一标识。
     *
     * <p>关系是两个事实之间的关系，没有自带标识，模型会自造 {@code relation-xxx}；原因与大纲相同，
     * 必须换成唯一标识后才能落库。两端人物标识是事实标识，保持不变。</p>
     *
     * @param draft CharacterDraft 模型产出的人物草稿
     * @return CharacterDraft 关系标识已替换的人物草稿
     */
    private ScriptDtos.CharacterDraft assignRelationIds(ScriptDtos.CharacterDraft draft) {
        List<ScriptDtos.CharacterRelation> relations = draft.relations().stream()
                .map(relation -> new ScriptDtos.CharacterRelation(UUID.randomUUID().toString(),
                        relation.sourceCharacterId(), relation.targetCharacterId(), relation.relationshipType(),
                        relation.relationshipDirection(), relation.storyStage(), relation.conflictDescription(),
                        relation.description(), relation.sortOrder()))
                .toList();
        return new ScriptDtos.CharacterDraft(draft.characters(), relations);
    }

    /**
     * 保存待审草稿并写入任务归属，草稿与单元输出一起构成停点审阅内容。
     *
     * @param job Job 当前任务
     * @param workflow Workflow 输入快照
     * @param unit Unit 当前单元
     * @param actionType String 草稿动作
     * @param targetType String 草稿目标类型
     * @param instruction String 生成指令说明
     * @param data JSONObject 已生成数据
     * @param validate boolean 是否复用通用草稿结构校验
     * @return Mono&lt;PlanningResult&gt; 单元产出与草稿标识
     */
    private Mono<PlanningResult> saveDraft(NovelAdaptationJobRepository.Job job,
                                           WholeBookAdaptationRepository.Workflow workflow,
                                           WholeBookAdaptationRepository.Unit unit, String actionType,
                                           String targetType, String instruction, JSONObject data,
                                           boolean validate) {
        // 草稿来源快照必须是生成时的真实目标内容：批量应用前会拿它与应用前的项目内容全等比对，
        // 存空对象会让任何有内容的项目都被判成「目标内容已经变化」。
        return scriptService.getSnapshotForUser(job.userId(), job.projectId(), workflow.revision())
                .flatMap(snapshot -> {
                    JSONObject source = scriptService.targetSnapshot(snapshot, targetType, null);
                    Mono<JSONObject> checked = validate
                            ? scriptAgentService.validateWholeBookDraft(data, targetType, null, snapshot)
                            : Mono.just(data);
                    return checked.flatMap(validated -> scriptService.saveAiDraft(job.userId(), job.projectId(),
                                    workflow.revision(), "novelAdaptation" + draftStage(unit.stage()), targetType,
                                    null, instruction, job.modelValue(), BigDecimal.ZERO, source, validated));
                })
                .flatMap(saved -> novelAdaptationRepository.saveDraft(saved.id(), job.projectId(),
                                draftStage(unit.stage()), adaptationSettings(job, workflow), List.of())
                        .then(novelAdaptationRepository.attachJob(saved.id(), job.id()))
                        .thenReturn(new PlanningResult(JSONObject.of("draftId", saved.id()), saved.id())));
    }

    /**
     * 旧草稿表的阶段取值，与该表既有的阶段约束保持一致，避免插入被拒绝。
     *
     * @param stage String 生成单元阶段名
     * @return String 草稿阶段名
     */
    private String draftStage(String stage) {
        return switch (stage) {
            case "locations" -> "world";
            case "episodePlan" -> "episodes";
            default -> stage;
        };
    }

    /** 旧草稿表的设置快照，集数取已锁定的分集数量。 */
    private NovelAdaptationDtos.Settings adaptationSettings(NovelAdaptationJobRepository.Job job,
                                                            WholeBookAdaptationRepository.Workflow workflow) {
        WholeBookAdaptationDtos.Options options = job.settings().toJavaObject(WholeBookAdaptationDtos.Options.class);
        return new NovelAdaptationDtos.Settings(options.format(), Math.max(1, workflow.slots().size()),
                options.episodeDurationSeconds(), options.pacing(), options.adaptationLevel());
    }

    /** 一次规划生成的产出与可选草稿标识。 */
    private record PlanningResult(JSONObject output, String draftId) { }

    /** 确认任务仍在运行，取消后立即中断当前阶段。 */
    private Mono<Void> ensureRunning(String jobId) {
        return jobRepository.status(jobId)
                .flatMap(status -> "running".equals(status) ? Mono.<Void>empty() : Mono.error(new CanceledException()));
    }

    /**
     * 记录失败原因并退还本阶段未完成单元的预扣积分。
     *
     * @param jobId String 任务标识
     * @param error Throwable 失败原因
     * @return Mono&lt;Void&gt; 处理结果
     */
    private Mono<Void> handleFailure(String jobId, Throwable error) {
        if (error instanceof CanceledException) return Mono.empty();
        log.error("全书改编任务执行失败: jobId={}", jobId, error);
        return jobRepository.find(jobId).flatMap(job -> {
            if (!"running".equals(job.status())) return Mono.<Void>empty();
            String message = truncate(error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage());
            return Mono.zip(repository.find(jobId), repository.units(jobId).collectList())
                    .flatMap(input -> {
                        List<WholeBookAdaptationRepository.Unit> units = input.getT2();
                        int completed = (int) units.stream().filter(unit -> unit.output() != null).count();
                        // 只结算真实持久化的成功单元，草稿保存与进度更新之间的中断不会重复扣费。
                        Set<String> charges = new HashSet<>(units.stream()
                                .map(WholeBookAdaptationRepository.Unit::chargeId).toList());
                        return transactionalOperator.transactional(jobRepository
                                        .finish(jobId, "failed", message, completed)
                                        .flatMap(finished -> finished
                                                ? refundUnfinished(job, units, input.getT1().unitPrice(), charges)
                                                : Mono.<Void>empty()));
                    });
        });
    }

    /** 按每个预扣标识下未完成的单元数退回积分。 */
    private Mono<Void> refundUnfinished(NovelAdaptationJobRepository.Job job,
                                        List<WholeBookAdaptationRepository.Unit> units, BigDecimal unitPrice,
                                        Set<String> charges) {
        if (CreditAmounts.of(unitPrice).compareTo(CreditAmounts.of(0)) <= 0) return Mono.empty();
        return Flux.fromIterable(charges).concatMap(chargeId -> {
            int unfinished = (int) units.stream()
                    .filter(unit -> chargeId.equals(unit.chargeId()) && unit.output() == null).count();
            return unfinished == 0 ? Mono.empty()
                    : creditService.refundOperation(job.userId(), chargeId,
                            WholeBookAdaptationService.OPERATION_NAME, CreditAmounts.multiply(unitPrice, unfinished));
        }).then();
    }

    /** 截断失败原因，避免超出列长度。 */
    private String truncate(String message) {
        return message.length() <= MAX_ERROR_LENGTH ? message : message.substring(0, MAX_ERROR_LENGTH);
    }

    /** 任务被取消或不再运行。 */
    private static final class CanceledException extends RuntimeException {
        private CanceledException() { super("全书改编任务已中止"); }
    }
}
