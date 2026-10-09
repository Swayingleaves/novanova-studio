package com.novanovastudio.service;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.agent.AgentScopeModelFactory;
import com.novanovastudio.ai.AiTaskTypes;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.EpisodeBodiesDtos;
import com.novanovastudio.dto.NovelAdaptationDtos;
import com.novanovastudio.dto.ScriptDtos;
import com.novanovastudio.repository.NovelAdaptationJobRepository;
import com.novanovastudio.repository.NovelAdaptationRepository;
import com.novanovastudio.repository.StoryBibleRepository;
import com.novanovastudio.repository.WholeBookAdaptationRepository;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.task.NovelAdaptationQueue;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;
import org.springframework.transaction.reactive.TransactionalOperator;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Mono;

/**
 * 逐集正文批量生成：把已固定的分集一次排队写成场次与正文。
 * <p>
 * 全书改编只负责到分集规划，场次与正文是独立的按集生成；一本长篇动辄上百集，逐集手工发起无法完成，
 * 因此这里把同一段生成按分集排队，复用全书改编的任务与生成单元：单元输出是唯一成功依据，
 * 续跑只重做未完成的分集，取消或失败按未完成单元退回预扣积分。
 * <p>
 * 两种模式：{@code draft} 只生成待审草稿，在剧本工作台审阅后应用；{@code apply} 生成后立即写入正式剧本。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-10-09 11:00
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class EpisodeBodiesService {
    /** 逐集正文批量任务所属阶段。 */
    public static final String PHASE_BODIES = "bodies";
    /** 生成正文的单元阶段名。 */
    public static final String STAGE_BODY = "body";
    /** 立即写入正式剧本的模式。 */
    public static final String MODE_APPLY = "apply";
    /** 只生成待审草稿的模式。 */
    public static final String MODE_DRAFT = "draft";
    /** 计费操作名，取消或失败按未完成分集退回。 */
    private static final String OPERATION_NAME = "分集正文批量生成";

    /** 单场最短秒数：总时长除以它得到场次数上限。 */
    private static final int MIN_SCENE_SECONDS = 12;

    /** 单场最长秒数：总时长除以它得到场次数下限。 */
    private static final int MAX_SCENE_SECONDS = 20;

    /** 当前用户提供器。 */
    private final CurrentUserProvider currentUserProvider;

    /** 剧本服务，负责用户归属、修订校验、快照与草稿应用。 */
    private final ScriptService scriptService;

    /** 剧本Agent，复用整书单元调用与草稿结构校验。 */
    private final ScriptAgentService scriptAgentService;

    /** 全书改编快照与生成单元。 */
    private final WholeBookAdaptationRepository repository;

    /** 改编任务仓储。 */
    private final NovelAdaptationJobRepository jobRepository;

    /** 改编草稿归属与待审草稿读取。 */
    private final NovelAdaptationRepository novelAdaptationRepository;

    /** 积分服务。 */
    private final CreditService creditService;

    /** 文本模型工厂。 */
    private final AgentScopeModelFactory modelFactory;

    /** 平台模型配置访问，用于解析所选模型的配置标识。 */
    private final PersistenceService persistenceService;

    /** 分集正文定价，报价与启动共用同一份单价。 */
    private final EpisodeBodiesPricingService pricingService;

    /** 任务与单元的事务边界。 */
    private final TransactionalOperator transactionalOperator;

    /** 流水线队列，延迟获取避免与执行器形成循环依赖。 */
    private final ObjectProvider<NovelAdaptationQueue> queueProvider;

    /**
     * 免费报价：锁定目标分集与模型价格，给出调用次数与预扣积分。
     *
     * @param request 项目、修订、模型、模式与目标分集
     * @return Mono&lt;Quote&gt; 报价与输入指纹
     */
    public Mono<EpisodeBodiesDtos.Quote> quote(EpisodeBodiesDtos.QuoteRequest request) {
        return currentUserProvider.currentUserId()
                .flatMap(userId -> prepare(userId, request.projectId(), request.expectedRevision(), request.model(),
                        request.mode(), request.episodeIds()).map(Prepared::quote));
    }

    /**
     * 查询所选文本模型的每集积分，供界面在报价前显示单价。
     * <p>
     * 单价来自后台的分集正文定价，与报价、启动取自同一处；模型未解析到配置或尚未定价时积分为空。
     *
     * @param model String 模型值，形如 channelId::modelName
     * @return Mono&lt;UnitPrice&gt; 单价
     */
    public Mono<EpisodeBodiesDtos.UnitPrice> unitPrice(String model) {
        return modelConfigId(model).flatMap(pricingService::findCredits)
                .map(credits -> new EpisodeBodiesDtos.UnitPrice(credits))
                .defaultIfEmpty(new EpisodeBodiesDtos.UnitPrice(null));
    }

    /**
     * 启动任务：保存输入快照、规划分集单元、保存整批检查点版本后预扣积分并入队。
     * <p>
     * 按客户端请求标识幂等：重复提交同一标识时直接返回已存在的任务，不会重复建任务、重复预扣或重复排队。
     *
     * @param request 已确认报价的启动请求
     * @return Mono&lt;Job&gt; 任务进度
     */
    public Mono<EpisodeBodiesDtos.Job> start(EpisodeBodiesDtos.StartRequest request) {
        return currentUserProvider.currentUserId().flatMap(userId -> jobRepository
                .findByRequest(userId, request.clientRequestId())
                .flatMap(existing -> {
                    if (!PHASE_BODIES.equals(existing.phase()) || !request.projectId().equals(existing.projectId())) {
                        return Mono.error(new BusinessException(ErrorCode.DATA_CONFLICT,
                                "该请求已经提交过其他任务，请刷新后查看当前进度"));
                    }
                    log.info("分集正文批量重复提交，复用已有任务: jobId={}", existing.id());
                    return view(existing);
                })
                .switchIfEmpty(Mono.defer(() -> prepare(userId, request.projectId(), request.expectedRevision(),
                                request.model(), request.mode(), request.episodeIds())
                        .flatMap(prepared -> {
                            if (prepared.credits() != request.expectedCredits()
                                    || !prepared.fingerprint().equals(request.expectedFingerprint())) {
                                return Mono.error(new BusinessException(ErrorCode.DATA_CONFLICT,
                                        "分集、模型价格或项目内容已变化，请重新报价"));
                            }
                            String jobId = UUID.randomUUID().toString();
                            String chargeId = WholeBookAdaptationService.chargeId(jobId, PHASE_BODIES);
                            NovelAdaptationJobRepository.Job job = new NovelAdaptationJobRepository.Job(jobId,
                                    request.projectId(), userId, request.clientRequestId(), prepared.modelValue(),
                                    prepared.modelConfigId(), settings(request.mode(), prepared), List.<String>of(),
                                    PHASE_BODIES, STAGE_BODY, "queued", prepared.episodeIds().size(), 0,
                                    prepared.episodeIds().size(), 0, prepared.credits(), "",
                                    (java.time.OffsetDateTime) null, 0);
                            // 逐集连续写入不适合逐条保存完整快照，整批开始前只留一个可回退检查点。
                            return transactionalOperator.transactional(jobRepository.save(job)
                                            .then(repository.insert(new WholeBookAdaptationRepository.Workflow(jobId,
                                                    prepared.revision(), prepared.facts(), List.of(), new JSONObject(),
                                                    null, List.of(), prepared.episodeIds(), prepared.unitPrice())))
                                            .then(repository.planEpisodes(jobId, PHASE_BODIES, STAGE_BODY,
                                                    prepared.episodeIds(), chargeId))
                                            .then(creditService.chargeOperation(userId, chargeId, prepared.credits(),
                                                    OPERATION_NAME)))
                                    .then(scriptService.createCheckpointVersion(request.projectId(),
                                            prepared.revision(), userId, "批量生成分集正文前",
                                            "发起逐集正文批量生成：" + prepared.episodeIds().size() + " 集"))
                                    .doOnSuccess(ignored -> log.info(
                                            "分集正文批量已启动: jobId={}, episodes={}, mode={}, credits={}",
                                            jobId, prepared.episodeIds().size(), request.mode(), prepared.credits()))
                                    .then(enqueue(prepared.modelConfigId(), jobId))
                                    .then(jobRepository.find(jobId)).flatMap(this::view);
                        }))));
    }

    /**
     * 查询任务进度，刷新后保留续跑与取消入口。
     *
     * @param projectId String 项目标识
     * @param jobId String 任务标识
     * @return Mono&lt;Job&gt; 任务进度
     */
    public Mono<EpisodeBodiesDtos.Job> status(String projectId, String jobId) {
        return requireJob(projectId, jobId).flatMap(this::view);
    }

    /**
     * 读取项目最近一次正文批量任务；项目还没有任何一次任务时返回空。
     *
     * @param projectId String 项目标识
     * @return Mono&lt;Job&gt; 最近任务
     */
    public Mono<EpisodeBodiesDtos.Job> latest(String projectId) {
        return scriptService.getProject(projectId)
                .then(jobRepository.findLatestByPhase(projectId, PHASE_BODIES))
                .flatMap(this::view);
    }

    /**
     * 从失败或取消处继续：已完成单元保留，只重做未完成的分集，不重复扣费。
     *
     * @param request 项目与任务标识
     * @return Mono&lt;Job&gt; 任务进度
     */
    public Mono<EpisodeBodiesDtos.Job> retry(EpisodeBodiesDtos.JobRequest request) {
        return requireJob(request.projectId(), request.jobId()).flatMap(job -> {
            if (!Set.of("failed", "canceled").contains(job.status())) {
                return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID,
                        "只有失败或已取消的任务可以从缺失分集继续"));
            }
            return Mono.zip(repository.find(job.id()), repository.units(job.id()).collectList())
                    .flatMap(input -> {
                        boolean apply = MODE_APPLY.equals(mode(job));
                        List<WholeBookAdaptationRepository.Unit> bodies = bodies(input.getT2());
                        List<String> unfinished = bodies.stream().filter(unit -> !finished(unit, apply))
                                .map(unit -> unit.input().getString("episodeId")).filter(Objects::nonNull).toList();
                        if (unfinished.isEmpty()) {
                            return Mono.error(new BusinessException(ErrorCode.DATA_CONFLICT,
                                    "所有分集都已生成，请直接查看进度或重新发起"));
                        }
                        // 续跑沿用原预扣标识：只重做未完成分集，已经结算的部分不再扣费也不再退款。
                        return transactionalOperator.transactional(repository
                                        .planEpisodes(job.id(), PHASE_BODIES, STAGE_BODY, unfinished,
                                                WholeBookAdaptationService.chargeId(job.id(), PHASE_BODIES))
                                        .then(jobRepository.requeue(job.id()))
                                        .flatMap(requeued -> requeued ? Mono.<Void>empty()
                                                : Mono.error(new BusinessException(ErrorCode.DATA_CONFLICT,
                                                        "任务状态已变化，请刷新后重试"))))
                                .doOnSuccess(ignored -> log.info("分集正文批量从缺失分集继续: jobId={}, unfinished={}",
                                        job.id(), unfinished.size()))
                                .then(enqueue(job.modelConfigId(), job.id()))
                                .then(jobRepository.find(job.id())).flatMap(this::view);
                    });
        });
    }

    /**
     * 取消任务并按未完成分集退回预扣积分，已完成产出保留。
     *
     * @param request 项目与任务标识
     * @return Mono&lt;Job&gt; 任务进度
     */
    public Mono<EpisodeBodiesDtos.Job> cancel(EpisodeBodiesDtos.JobRequest request) {
        return requireJob(request.projectId(), request.jobId()).flatMap(job -> {
            if (!Set.of("queued", "running").contains(job.status())) return view(job);
            return Mono.zip(repository.find(job.id()), repository.units(job.id()).collectList())
                    .flatMap(input -> {
                        boolean apply = MODE_APPLY.equals(mode(job));
                        List<WholeBookAdaptationRepository.Unit> bodies = bodies(input.getT2());
                        int done = (int) bodies.stream().filter(unit -> finished(unit, apply)).count();
                        int refund = (bodies.size() - done) * input.getT1().unitPrice();
                        return transactionalOperator.transactional(jobRepository
                                        .finish(job.id(), "canceled", "", done)
                                        .flatMap(finished -> finished && refund > 0
                                                ? creditService.refundOperation(job.userId(),
                                                        WholeBookAdaptationService.chargeId(job.id(), PHASE_BODIES),
                                                        OPERATION_NAME, refund)
                                                : Mono.<Void>empty()))
                                .then(jobRepository.find(job.id())).flatMap(this::view);
                    });
        });
    }

    /**
     * 为一次生成构建模型输入：本集事实、本集规划与本集相关的人物与地点引用。
     * <p>
     * 单集调用只带本集需要的内容：事实来自事件取舍结果，人物与地点按本集事实自带的人物名与地点名收敛。
     * 不带全书分集清单与全量引用列表——它们与集数、知识库规模线性相关，会直接撑爆 120,000 字符的上下文上限。
     * 分集标识、集号、场次编号与排序由服务端覆写，因此这里只提供上下文，不校验模型回填的身份字段。
     *
     * @param job Job 当前任务
     * @param snapshot ProjectSnapshot 正式项目快照
     * @param episodeId String 目标分集标识
     * @param factIds List&lt;String&gt; 本集事实范围
     * @param factIndex Map&lt;String, Item&gt; 任务内事实索引
     * @return Map&lt;String, Object&gt; 单元输入
     */
    public Map<String, Object> bodyInput(NovelAdaptationJobRepository.Job job, ScriptDtos.ProjectSnapshot snapshot,
                                         String episodeId, List<String> factIds,
                                         Map<String, StoryBibleRepository.Item> factIndex) {
        ScriptDtos.EpisodeDetail target = snapshot.episodeDetails().stream()
                .filter(detail -> detail.episode().id().equals(episodeId)).findFirst()
                .orElseThrow(() -> new BusinessException(ErrorCode.DATA_CONFLICT, "目标分集已不存在，请刷新后重试"));
        NovelAdaptationDtos.Settings settings = adaptationSettings(job);
        int minimumScenes = Math.max(2, settings.episodeDurationSeconds() / MAX_SCENE_SECONDS);
        int maximumScenes = Math.max(minimumScenes + 1, settings.episodeDurationSeconds() / MIN_SCENE_SECONDS);
        String instruction = "根据confirmedFacts中的已确认事实与targetEpisode的分集规划，为本集写出完整场次与正文。"
                + "改编形式=" + settings.format() + "；单集秒数=" + settings.episodeDurationSeconds()
                + "；节奏=" + settings.pacing() + "；改编程度=" + settings.adaptationLevel() + "。"
                // 只给总秒数时场次数完全随模型自由发挥，实测每集只有三到五场、单场近一分钟，
                // 因此把密度换成明确区间；末句约束空洞描写，避免模型为了凑场次把内容稀释。
                + "按每场 " + MIN_SCENE_SECONDS + "-" + MAX_SCENE_SECONDS + " 秒编排，本集应有 "
                + minimumScenes + "-" + maximumScenes + " 场；"
                + "每场是一个连续时空内的完整段落，必须有明确的场景目标与至少一次情节推进，不得用空洞描写充数。"
                + "characters和locations是正式剧本的引用列表，只列出本集事实涉及的人物与地点："
                + "场次characterIds与对白characterId只能使用characters中的id，"
                + "场次locationId只能使用locations中的id，没有对应正式地点时留空；"
                + "需要列表中不存在的人物或地点时，用动作或旁白描述，不得编造引用标识。"
                + "confirmedFacts中的id是故事知识库事实标识，不能作为人物或地点引用，也不能自行创建引用标识。"
                + "场次编号与排序由服务端覆写，不要自行编号；不得增删其他分集。"
                + "不得把推测当作原文事实；正文块origin填original表示来自原著事实，填adapted表示AI新增的情节或对白；"
                + "正文内容里只写剧本本身，不要写【改编创作】之类的标记。";
        List<JSONObject> facts = factModels(factIndex, factIds);
        Map<String, Object> context = new LinkedHashMap<>();
        context.put("overview", snapshot.project().overview());
        context.put("outline", snapshot.project().outlineSections());
        context.put("targetEpisode", target);
        context.put("characters", episodeCharacters(target, factParticipants(facts), snapshot.project().characters()));
        context.put("locations", episodeLocations(target, factLocations(facts), snapshot.project().locations()));
        context.put("confirmedFacts", facts);
        context.put("adaptationSettings", settings);
        Map<String, Object> input = new LinkedHashMap<>();
        input.put("requestType", "draft");
        input.put("actionType", "episodeDraft");
        input.put("targetType", "episode");
        input.put("targetId", episodeId);
        input.put("instruction", instruction);
        input.put("context", context);
        return input;
    }

    /**
     * 本集需要的人物引用：本集事实提到的人物，加上本集已有场次引用过的人物。
     * <p>
     * 收敛不到任何人时退回正式剧本全量人物：没有事实依据的集（事件取舍里没有指向本集的记录）推导不出范围，
     * 此时宁可上下文变大，也不能让模型无人物可引用。
     *
     * @param target EpisodeDetail 目标分集，已生成时其场次引用必须继续可选
     * @param participants Set&lt;String&gt; 本集事实自带的人物名
     * @param all List&lt;Character&gt; 正式剧本全量人物
     * @return List&lt;JSONObject&gt; 人物引用视图
     */
    private List<JSONObject> episodeCharacters(ScriptDtos.EpisodeDetail target, Set<String> participants,
                                               List<ScriptDtos.Character> all) {
        List<ScriptDtos.Character> kept = all.stream()
                .filter(character -> referencesName(participants, character.name())
                        || target.scenes().stream()
                                .anyMatch(scene -> scene.characterIds().contains(character.id())))
                .toList();
        return characterModels(kept.isEmpty() ? all : kept);
    }

    /**
     * 本集需要的地点引用：本集事实提到的地点，加上本集已有场次引用过的地点，收敛规则与人物一致。
     *
     * @param target EpisodeDetail 目标分集
     * @param locations Set&lt;String&gt; 本集事实自带的地点名
     * @param all List&lt;Location&gt; 正式剧本全量地点
     * @return List&lt;JSONObject&gt; 地点引用视图
     */
    private List<JSONObject> episodeLocations(ScriptDtos.EpisodeDetail target, Set<String> locations,
                                              List<ScriptDtos.Location> all) {
        List<ScriptDtos.Location> kept = all.stream()
                .filter(location -> referencesName(locations, location.name())
                        || target.scenes().stream().anyMatch(scene -> location.id().equals(scene.locationId())))
                .toList();
        return locationModels(kept.isEmpty() ? all : kept);
    }

    /**
     * 事实里的名字是否指向这个正式名称。
     * <p>
     * 双向包含用于召回带修饰的写法：事实写「黄昏之神英格纳瑞马洛」，正式人物是「英格纳瑞马洛」。
     * 多带的实体会被模型忽略，少带的却会让它没有可引用的标识，因此这里宁可放宽。
     *
     * @param names Set&lt;String&gt; 本集事实自带的名字
     * @param actual String 正式名称
     * @return boolean 是否命中
     */
    private boolean referencesName(Set<String> names, String actual) {
        if (!StringUtils.hasText(actual)) return false;
        return names.stream().anyMatch(name -> name.equals(actual)
                || (actual.length() >= 2 && name.contains(actual))
                || (name.length() >= 2 && actual.contains(name)));
    }

    /** 本集事实自带的人物名；只有事件事实带这个属性，其他类型是空对象。 */
    private Set<String> factParticipants(List<JSONObject> facts) {
        Set<String> names = new LinkedHashSet<>();
        for (JSONObject fact : facts) {
            JSONObject attributes = fact.getJSONObject("attributes");
            JSONArray participants = attributes == null ? null : attributes.getJSONArray("participants");
            if (participants == null) continue;
            participants.forEach(name -> names.add(String.valueOf(name)));
        }
        return names;
    }

    /** 本集事实自带的地点名；只有事件事实带这个属性，且并非每个事件都有。 */
    private Set<String> factLocations(List<JSONObject> facts) {
        Set<String> names = new LinkedHashSet<>();
        for (JSONObject fact : facts) {
            JSONObject attributes = fact.getJSONObject("attributes");
            String location = attributes == null ? null : attributes.getString("location");
            if (StringUtils.hasText(location)) names.add(location);
        }
        return names;
    }

    /** 人物引用视图：只给标识与名称，模型只负责从既有标识里选。 */
    private List<JSONObject> characterModels(List<ScriptDtos.Character> characters) {
        return characters.stream()
                .map(character -> JSONObject.of("id", character.id(), "name", character.name())).toList();
    }

    /** 地点引用视图：只给标识与名称，模型只负责从既有标识里选。 */
    private List<JSONObject> locationModels(List<ScriptDtos.Location> locations) {
        return locations.stream()
                .map(location -> JSONObject.of("id", location.id(), "name", location.name())).toList();
    }

    /**
     * 生成一集的待审草稿并保存，返回草稿标识。
     *
     * @param job Job 当前任务
     * @param revision long 生成时的当前项目修订号，立即写入模式下逐集递增，不能沿用整批基线
     * @param episodeId String 目标分集标识
     * @param input Map&lt;String, Object&gt; 已构建的模型输入
     * @return Mono&lt;String&gt; 草稿标识
     */
    public Mono<String> generateDraft(NovelAdaptationJobRepository.Job job, long revision, String episodeId,
                                      Map<String, Object> input) {
        return scriptAgentService.callWholeBookUnit(job.userId(), "episode-body:" + job.id() + ":" + episodeId,
                        job.modelValue(), input, ScriptDtos.GeneratedEpisodeDetailDraft.class)
                .flatMap(generated -> {
                    JSONObject data = JSON.parseObject(JSON.toJSONString(generated.draftData()));
                    if (data == null || data.getJSONArray("scenes") == null || data.getJSONArray("scenes").isEmpty()) {
                        return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID,
                                "模型没有返回任何场次，请重试或更换模型"));
                    }
                    return scriptService.getSnapshotForUser(job.userId(), job.projectId(), revision)
                            .flatMap(snapshot -> scriptAgentService
                                    .validateWholeBookDraft(data, "episode", episodeId, snapshot));
                })
                .flatMap(data -> scriptService.getSnapshotForUser(job.userId(), job.projectId(), revision)
                        .flatMap(snapshot -> scriptService.saveAiDraft(job.userId(), job.projectId(), revision,
                                        "novelAdaptationepisode", "episode", episodeId, "批量生成分集正文",
                                        job.modelValue(), 0,
                                        scriptService.targetSnapshot(snapshot, "episode", episodeId), data)
                                .flatMap(draft -> novelAdaptationRepository.saveDraft(draft.id(), job.projectId(),
                                                "episode", adaptationSettings(job), List.of())
                                        .then(novelAdaptationRepository.attachJob(draft.id(), job.id()))
                                        .thenReturn(draft.id()))));
    }

    /**
     * 把已生成的草稿写入正式剧本，按草稿目标分集合并场次与正文。
     *
     * @param job Job 当前任务
     * @param draftId String 草稿标识
     * @return Mono&lt;Void&gt; 写入完成信号
     */
    public Mono<Void> applyDraft(NovelAdaptationJobRepository.Job job, String draftId) {
        return scriptService.getProject(job.projectId()).flatMap(project -> scriptService
                .applyAdaptationDrafts(job.projectId(), project.revision(), List.of(draftId), false));
    }

    /**
     * 汇总取舍结果给出的分集事实范围。
     * <p>
     * 没有取舍记录的集不退回全书事实：单次调用容量只允许几十条事实，退回全书会直接超出上下文，
     * 因此这类集只依据分集规划与本集已有的正式引用生成，事实范围留空。
     *
     * @param assignments Map&lt;String, List&lt;String&gt;&gt; 分集到事实标识
     * @param known Set&lt;String&gt; 全书已确认事实标识
     * @param episodeId String 目标分集标识
     * @return List&lt;String&gt; 本集事实标识
     */
    public List<String> factScope(Map<String, List<String>> assignments, Set<String> known, String episodeId) {
        return EpisodeBodiesPlanner.limit(assignments.getOrDefault(episodeId, List.of()), known);
    }

    /** 组装任务进度视图，失败或取消时给出未完成分集。 */
    private Mono<EpisodeBodiesDtos.Job> view(NovelAdaptationJobRepository.Job job) {
        boolean apply = MODE_APPLY.equals(mode(job));
        return Mono.zip(repository.units(job.id()).collectList(),
                        repository.baseRevision(job.id()).defaultIfEmpty(0L))
                .map(input -> {
                    List<WholeBookAdaptationRepository.Unit> bodies = bodies(input.getT1());
                    int done = (int) bodies.stream().filter(unit -> finished(unit, apply)).count();
                    int unitPrice = job.estimatedCalls() <= 0 ? 0 : job.credits() / Math.max(1, job.estimatedCalls());
                    int refunded = Set.of("canceled", "failed").contains(job.status())
                            ? (bodies.size() - done) * unitPrice : 0;
                    List<String> remaining = bodies.stream().filter(unit -> !finished(unit, apply))
                            .map(unit -> unit.input().getString("episodeId")).filter(Objects::nonNull).toList();
                    return new EpisodeBodiesDtos.Job(job.id(), job.phase(), job.status(), mode(job), bodies.size(),
                            done, job.credits(), refunded, job.errorMessage(), input.getT2(), job.retryCount(),
                            Set.of("failed", "canceled").contains(job.status()) ? remaining : List.of());
                });
    }

    /** 当前任务的全部正文单元。 */
    private List<WholeBookAdaptationRepository.Unit> bodies(List<WholeBookAdaptationRepository.Unit> units) {
        return units.stream().filter(unit -> PHASE_BODIES.equals(unit.phase())).toList();
    }

    /** 单元是否已真正完成：只出草稿时生成即完成，立即写入时还要求已写回正式剧本。 */
    private boolean finished(WholeBookAdaptationRepository.Unit unit, boolean apply) {
        return unit.output() != null && (!apply || unit.completedAt() != null);
    }

    /** 任务生成模式。 */
    private String mode(NovelAdaptationJobRepository.Job job) {
        return text(job.settings().getString("mode"), MODE_APPLY);
    }

    /**
     * 读取目标分集、事实快照与模型价格，报价与执行共用同一份规划。
     *
     * @param userId Long 用户标识
     * @param projectId String 项目标识
     * @param expectedRevision long 期望项目修订
     * @param model String 文本模型值
     * @param mode String 生成模式
     * @param requested List&lt;String&gt; 用户选择的分集标识
     * @return Mono&lt;Prepared&gt; 输入快照与规划
     */
    private Mono<Prepared> prepare(Long userId, String projectId, long expectedRevision, String model,
                                   String mode, List<String> requested) {
        return scriptService.getSnapshotForUser(userId, projectId, expectedRevision).flatMap(snapshot -> {
            List<String> projectOrder = snapshot.project().episodes().stream()
                    .map(ScriptDtos.EpisodeSummary::id).toList();
            if (projectOrder.isEmpty()) {
                return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "请先完成分集规划，再批量生成分集正文"));
            }
            List<String> targets = EpisodeBodiesPlanner.resolveTargets(requested, projectOrder);
            if (targets.isEmpty()) {
                return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "请至少选择一集再批量生成正文"));
            }
            NovelAdaptationDtos.Settings adaptation = new NovelAdaptationDtos.Settings(
                    snapshot.project().overview().contentType(), projectOrder.size(),
                    snapshot.project().overview().targetDurationSeconds() <= 0 ? 180
                            : snapshot.project().overview().targetDurationSeconds(),
                    "balanced", "balanced");
            // 报价只锁定分集范围与模型价格：事实快照在任务落库时留空，执行阶段再按取舍结果读取本集事实，
            // 避免报价请求为整本书上千条事实付出读取代价。
            // 单价来自后台的分集正文定价，不再取模型自身的 creditCost：未配置的模型不给报价，
            // 否则会落到一个管理员看不到也管不了的兜底价格上。
            return Mono.zip(modelFactory.resolveTextModel(model), modelConfigId(model))
                    .flatMap(input -> pricingService.findCredits(input.getT2())
                            .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.PARAM_INVALID,
                                    "该文本模型尚未配置分集正文单价，请在后台「剧本创作定价 · 分集正文」中配置后重试")))
                            .map(unitPrice -> new Prepared(snapshot.project().revision(), input.getT1().modelValue(),
                                    input.getT2(), unitPrice, List.of(), targets, mode,
                                    JSON.parseObject(JSON.toJSONString(adaptation), NovelAdaptationDtos.Settings.class),
                                    fingerprint(snapshot.project().revision(), targets, model, mode))));
        });
    }

    /** 任务设置快照：沿用改编设置结构并附带生成模式。 */
    private JSONObject settings(String mode, Prepared prepared) {
        JSONObject settings = JSON.parseObject(JSON.toJSONString(prepared.settings()));
        settings.put("mode", mode);
        return settings;
    }

    /** 草稿表与模型指令使用的改编设置快照。 */
    private NovelAdaptationDtos.Settings adaptationSettings(NovelAdaptationJobRepository.Job job) {
        JSONObject settings = job.settings();
        int duration = settings.getIntValue("episodeDurationSeconds");
        return new NovelAdaptationDtos.Settings(text(settings.getString("format"), "comicDrama"),
                Math.max(1, settings.getIntValue("episodeCount")), duration <= 0 ? 180 : duration,
                text(settings.getString("pacing"), "balanced"),
                text(settings.getString("adaptationLevel"), "balanced"));
    }

    /** 按标识取事实模型，标识不在任务内时直接失败而不是静默生成缺依据的正文。 */
    private List<JSONObject> factModels(Map<String, StoryBibleRepository.Item> factIndex, List<String> factIds) {
        List<JSONObject> models = new ArrayList<>();
        for (String factId : factIds) {
            StoryBibleRepository.Item fact = factIndex.get(factId);
            if (fact == null) {
                throw new BusinessException(ErrorCode.DATA_CONFLICT, "任务引用的故事事实已变化，请重新发起");
            }
            models.add(WholeBookAdaptationPlanner.modelFact(fact));
        }
        return models;
    }

    /** 输入指纹，覆盖分集范围、项目修订、模型与模式。 */
    private String fingerprint(long revision, List<String> episodeIds, String model, String mode) {
        return Integer.toHexString(Objects.hash(revision, model, mode, episodeIds));
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

    /** 写入改编队列，失败时交由恢复扫描补发。 */
    private Mono<Void> enqueue(String modelConfigId, String jobId) {
        return queueProvider.getObject().enqueue(modelConfigId, jobId)
                .onErrorResume(error -> {
                    log.error("分集正文批量任务入队失败，等待恢复扫描补发: jobId={}", jobId, error);
                    return Mono.empty();
                });
    }

    /** 读取属于当前用户可访问项目的正文批量任务。 */
    private Mono<NovelAdaptationJobRepository.Job> requireJob(String projectId, String jobId) {
        return scriptService.getProject(projectId)
                .then(jobRepository.find(jobId))
                .filter(job -> projectId.equals(job.projectId()) && PHASE_BODIES.equals(job.phase()))
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "分集正文批量任务不存在")));
    }

    /** 文本兜底，只用于历史任务缺失设置时的退化展示。 */
    private String text(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value;
    }

    /** 一次启动的输入快照与规划。 */
    private record Prepared(long revision, String modelValue, String modelConfigId, int unitPrice,
                            List<StoryBibleRepository.Item> facts, List<String> episodeIds, String mode,
                            NovelAdaptationDtos.Settings settings, String fingerprint) {
        int credits() { return episodeIds.size() * unitPrice; }
        EpisodeBodiesDtos.Quote quote() {
            return new EpisodeBodiesDtos.Quote(revision, episodeIds.size(), episodeIds.size(), credits(),
                    fingerprint, episodeIds);
        }
    }
}
