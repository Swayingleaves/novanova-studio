package com.novanovastudio.service;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.agent.AgentScopeAgentFactory;
import com.novanovastudio.agent.AgentScopeModelFactory;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.dto.ScriptDtos;
import com.novanovastudio.dto.NovelAdaptationDtos;
import com.novanovastudio.repository.NovelAdaptationRepository;
import com.novanovastudio.security.CurrentUserProvider;
import io.agentscope.core.ReActAgent;
import io.agentscope.core.agent.RuntimeContext;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validator;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Function;
import java.util.regex.Pattern;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.reactive.TransactionalOperator;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Mono;

/**
 * 剧本专用Agent编排、草稿持久化、专业分析与独立积分计费服务。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-09-20 15:00
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ScriptAgentService {

    /** 整项目AI调用允许的最大上下文字符数。 */
    private static final int MAXIMUM_CONTEXT_CHARACTERS = 120_000;

    /** 文本优化动作集合。 */
    private static final Set<String> TEXT_ACTIONS = Set.of(
            "polish", "expand", "condense", "rewrite", "colloquialize", "dialogue", "conflict",
            "suspense", "twist", "motivation", "emotion", "climax", "rhythm", "style");

    /** 分析总结中禁止出现的单一百分比评分。 */
    private static final Pattern PERCENTAGE_SCORE = Pattern.compile("(?<!\\d)\\d{1,3}(?:\\.\\d+)?\\s*%");

    /** 当前用户提供器。 */
    private final CurrentUserProvider currentUserProvider;

    /** 文本模型解析工厂。 */
    private final AgentScopeModelFactory modelFactory;

    /** AgentScope Agent工厂。 */
    private final AgentScopeAgentFactory agentFactory;

    /** 服务端配置。 */
    private final NovanovaProperties properties;

    /** 积分服务。 */
    private final CreditService creditService;

    /** 剧本领域服务。 */
    private final ScriptService scriptService;

    /** Agent结构化返回校验器。 */
    private final Validator validator;

    /** 小说改编草稿来源仓储。 */
    private final NovelAdaptationRepository novelAdaptationRepository;

    /** 改编草稿与来源快照的原子写入事务。 */
    private final TransactionalOperator transactionalOperator;

    /**
     * 为已预扣的全书生成单元复用剧本Agent和强类型结构化输出。
     * @param userId Long 发起用户
     * @param operationId String 持久化单元身份
     * @param modelValue String 文本模型
     * @param input Map<String,Object> 已校验容量的单元输入
     * @param resultType Class<T> 结构化结果类型
     * @param <T> 结果类型
     * @return Mono<T> 模型结果，保存及计费由工作流负责
     */
    public <T> Mono<T> callWholeBookUnit(Long userId, String operationId, String modelValue,
                                         Map<String, Object> input, Class<T> resultType) {
        validateContextSize(input, "episode");
        return modelFactory.resolveTextModel(modelValue)
                .flatMap(model -> callAgent(userId, operationId, model, input, resultType));
    }

    /**
     * 工作流保存前复用正式草稿结构及引用校验。
     * @param data JSONObject 生成数据
     * @param targetType String 目标类型
     * @param targetId String 可选目标
     * @param snapshot ProjectSnapshot 校验基线
     * @return Mono<JSONObject> 已校验数据
     */
    public Mono<JSONObject> validateWholeBookDraft(JSONObject data, String targetType, String targetId,
                                                   ScriptDtos.ProjectSnapshot snapshot) {
        return validateGeneratedDraft(new ScriptDtos.GeneratedDraft(data), targetType, targetType, targetId, snapshot);
    }

    /**
     * 复用剧本Agent结构化草稿扩展点，按选定事实生成改编草稿并保存来源快照。
     *
     * @param request 用户确认的改编阶段与设置
     * @param snapshot 当前正式剧本快照
     * @param facts 已确认事实及证据
     * @return 待人工审阅的剧本AI草稿
     */
    public Mono<ScriptDtos.AiDraft> generateAdaptationDraft(NovelAdaptationDtos.GenerateRequest request,
                                                              ScriptDtos.ProjectSnapshot snapshot,
                                                              List<NovelAdaptationDtos.Fact> facts) {
        return generateAdaptationDraft(request, snapshot, facts, false);
    }

    /**
     * 沿用结构化生成扩展点，流水线已预扣时不再按单次重复扣费。
     * @param request GenerateRequest 当前生成请求
     * @param snapshot ProjectSnapshot 正式项目快照
     * @param facts List&lt;Fact&gt; 本批事实
     * @param prepaid boolean 是否由一键任务整体预扣
     * @return Mono&lt;AiDraft&gt; 已持久化草稿
     */
    public Mono<ScriptDtos.AiDraft> generateAdaptationDraft(NovelAdaptationDtos.GenerateRequest request,
                                                          ScriptDtos.ProjectSnapshot snapshot,
                                                          List<NovelAdaptationDtos.Fact> facts, boolean prepaid) {
        return generateAdaptationDraft(request, snapshot, facts, prepaid, null);
    }

    /**
     * 保存模型产物时将草稿与任务归属一起提交，保证续跑检查点不会因进程退出丢失。
     * @param request GenerateRequest 当前生成请求
     * @param snapshot ProjectSnapshot 正式项目快照
     * @param facts List&lt;Fact&gt; 本批事实
     * @param prepaid boolean 是否由一键任务预扣
     * @param jobId String 所属任务标识，单次生成时为空
     * @return Mono&lt;AiDraft&gt; 已保存并关联任务的草稿
     */
    public Mono<ScriptDtos.AiDraft> generateAdaptationDraft(NovelAdaptationDtos.GenerateRequest request,
                                                          ScriptDtos.ProjectSnapshot snapshot,
                                                          List<NovelAdaptationDtos.Fact> facts, boolean prepaid, String jobId) {
        // 概览、人物与关系、世界观与地点、故事大纲四个阶段的目标类型与阶段同名，其余阶段沿用原有动作类型。
        String targetType = switch (request.stage()) {
            case "overview", "characters", "world", "outline" -> request.stage();
            case "episodes" -> "episodes";
            case "episode" -> "episode";
            default -> throw new BusinessException(ErrorCode.PARAM_INVALID, "不支持的改编阶段");
        };
        String actionType = switch (request.stage()) {
            case "episodes" -> "episodePlan";
            case "episode" -> "episodeDraft";
            default -> request.stage();
        };
        String targetId = "episode".equals(targetType) ? request.episodeId() : null;
        JSONObject sourceData = scriptService.targetSnapshot(snapshot, targetType, targetId);
        Map<String, Object> context = adaptationContext(request, snapshot, facts);
        validateContextSize(context, targetType);
        String instruction = "根据confirmedFacts中的已确认事实改编。形式=" + request.settings().format()
                + "；目标集数=" + request.settings().episodeCount()
                + "；单集秒数=" + request.settings().episodeDurationSeconds()
                + "；节奏=" + request.settings().pacing()
                + "；改编程度=" + request.settings().adaptationLevel()
                + "。不得把推测当作原文事实；正文块origin填original表示来自原著事实，填adapted表示AI新增的情节或对白；"
                + "正文内容里只写剧本本身，不要写【改编创作】之类的标记。"
                + "只生成当前阶段的结构化草稿，不改动当前项目中非目标内容。"
                + ("episode".equals(targetType)
                        ? "characters和locations是正式剧本的引用列表。场次characterIds和对白characterId只能使用characters中的id；"
                        + "场次locationId只能使用locations中的id，没有对应正式地点时留空。"
                        + "confirmedFacts中的id是故事知识库事实标识，不能作为人物或地点引用，也不能自行创建这些引用标识。" : "")
                // 全量入库时证据条数即重要性信号：次要条目只保留可核实的最少信息，避免模型为路人角色编造完整人设。
                + (Set.of("characters", "world").contains(targetType)
                        ? "证据少于3条的次要条目只填写名称、身份与简介，其余设定字段留空，不得编造。" : "");
        ScriptDtos.GenerateDraftRequest draftRequest = new ScriptDtos.GenerateDraftRequest(request.projectId(),
                request.expectedRevision(), actionType, targetType, targetId, instruction, request.model());
        return currentUserProvider.currentUserId().flatMap(userId -> modelFactory.resolveTextModel(request.model())
                .flatMap(model -> executeChargedOperation(userId, prepaid ? 0 : model.creditCost(), "小说改编草稿生成", operationId ->
                        callDraftAgent(userId, operationId, model, draftRequest, context)
                                .flatMap(generated -> validateGeneratedDraft(generated, actionType, targetType, targetId, snapshot))
                                .flatMap(data -> {
                                    Mono<ScriptDtos.AiDraft> save = scriptService.saveAiDraft(userId,
                                                    request.projectId(), request.expectedRevision(),
                                                    "novelAdaptation" + request.stage(), targetType, targetId,
                                                    instruction, model.modelValue(), prepaid ? 0 : model.creditCost(), sourceData, data)
                                            .flatMap(draft -> novelAdaptationRepository.saveDraft(draft.id(),
                                                    request.projectId(), request.stage(), request.settings(), facts)
                                                    .then(jobId == null ? Mono.<Void>empty() : novelAdaptationRepository.attachJob(draft.id(), jobId))
                                                    .thenReturn(draft));
                                    return novelAdaptationRepository.requireCurrentFacts(request.projectId(), facts)
                                            .then(transactionalOperator.transactional(save));
                                }))));
    }

    /**
     * 构建改编上下文，单集正文同时提供正式引用列表与事实设定，避免混淆两类标识。
     *
     * @param request GenerateRequest 当前改编阶段与目标分集
     * @param snapshot ProjectSnapshot 正式剧本完整快照
     * @param facts List&lt;Fact&gt; 本批故事事实及证据
     * @return Map&lt;String, Object&gt; 发送给模型的改编上下文
     */
    private Map<String, Object> adaptationContext(NovelAdaptationDtos.GenerateRequest request,
                                                  ScriptDtos.ProjectSnapshot snapshot,
                                                  List<NovelAdaptationDtos.Fact> facts) {
        Map<String, Object> context = new LinkedHashMap<>();
        context.put("overview", snapshot.project().overview());
        context.put("outline", snapshot.project().outlineSections());
        context.put("episodes", snapshot.project().episodes());
        if ("episode".equals(request.stage())) {
            context.put("targetEpisode", snapshot.episodeDetails().stream()
                    .filter(episode -> episode.episode().id().equals(request.episodeId())).findFirst().orElseThrow());
            // 事实标识与正式条目标识独立，只提供全量标识和名称，详细设定仍由本批事实提供。
            context.put("characters", snapshot.project().characters().stream()
                    .map(character -> JSONObject.of("id", character.id(), "name", character.name())).toList());
            context.put("locations", snapshot.project().locations().stream()
                    .map(location -> JSONObject.of("id", location.id(), "name", location.name())).toList());
        }
        context.put("confirmedFacts", facts);
        context.put("adaptationSettings", request.settings());
        return context;
    }

    /**
     * 按用户明确确认的费用，对正式剧本与已确认事实执行深入一致性检查。
     *
     * @param request 模型、事实与项目修订号
     * @param snapshot 正式剧本快照
     * @param facts 已确认事实快照
     * @return 已保存的分析报告
     */
    public Mono<ScriptDtos.AnalysisReport> analyzeAdaptationConsistency(NovelAdaptationDtos.AnalyzeRequest request,
                                                                          ScriptDtos.ProjectSnapshot snapshot,
                                                                          List<NovelAdaptationDtos.Fact> facts) {
        Map<String, Object> context = new LinkedHashMap<>();
        context.put("script", snapshot);
        context.put("confirmedFacts", facts);
        validateContextSize(context, "project");
        return currentUserProvider.currentUserId().flatMap(userId -> modelFactory.resolveTextModel(request.model())
                .flatMap(model -> executeChargedOperation(userId, model.creditCost(), "小说改编深入一致性检查", operationId -> {
                    Map<String, Object> input = new LinkedHashMap<>();
                    input.put("requestType", "analysis");
                    input.put("scopeType", "project");
                    input.put("instruction", "对照confirmedFacts检查人物设定、关系、时间、地点及剧情因果。"
                            + "仅指出可定位且有依据的潜在冲突；改编创作不是自动错误，供用户人工判断。");
                    input.put("context", context);
                    return callAgent(userId, operationId, model, input, ScriptDtos.GeneratedAnalysis.class)
                            .map(generated -> validateAnalysis(generated, snapshot, "project", null))
                            .flatMap(generated -> novelAdaptationRepository.requireCurrentFacts(request.projectId(), facts)
                                    .then(scriptService.saveAnalysisReport(userId, request.projectId(), "project", null,
                                            model.modelValue(), model.creditCost(), request.expectedRevision(), generated)));
                })));
    }

    /**
     * 生成待用户确认的结构化剧本草稿。
     *
     * @param request GenerateDraftRequest 剧本AI动作请求
     * @return Mono&lt;AiDraft&gt; 已持久化的待确认草稿
     */
    public Mono<ScriptDtos.AiDraft> generateDraft(ScriptDtos.GenerateDraftRequest request) {
        validateDraftRequest(request);
        return currentUserProvider.currentUserId().flatMap(userId -> scriptService
                .getSnapshotForUser(userId, request.projectId(), request.expectedRevision())
                .flatMap(snapshot -> {
                    validatePrerequisite(request.actionType(), snapshot);
                    JSONObject sourceData = scriptService.targetSnapshot(snapshot, request.targetType(), request.targetId());
                    Object context = buildContext(snapshot, request.targetType(), request.targetId());
                    validateContextSize(context, request.targetType());
                    return modelFactory.resolveTextModel(request.model()).flatMap(model -> executeChargedOperation(
                            userId, model.creditCost(), "剧本AI草稿生成", operationId -> callDraftAgent(
                                    userId, operationId, model, request, context)
                                    .flatMap(generated -> validateGeneratedDraft(generated, request.actionType(),
                                            request.targetType(), request.targetId(), snapshot))
                                    .flatMap(draftData -> scriptService.saveAiDraft(userId, request.projectId(),
                                            request.expectedRevision(), request.actionType(), request.targetType(), request.targetId(),
                                            request.instruction(), model.modelValue(), model.creditCost(), sourceData, draftData))));
                }));
    }

    /**
     * 对全项目或单集执行专业分析并持久化问题报告。
     *
     * @param request AnalyzeScriptRequest 分析请求
     * @return Mono&lt;AnalysisReport&gt; 已持久化的分析报告
     */
    public Mono<ScriptDtos.AnalysisReport> analyzeScript(ScriptDtos.AnalyzeScriptRequest request) {
        validateAnalysisRequest(request);
        return currentUserProvider.currentUserId().flatMap(userId -> scriptService
                .getSnapshotForUser(userId, request.projectId(), request.expectedRevision())
                .flatMap(snapshot -> {
                    if (snapshot.episodeDetails().isEmpty()) {
                        return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "请先完成至少一个分集，再执行专业分析"));
                    }
                    Object context = buildAnalysisContext(snapshot, request.scopeType(), request.scopeId());
                    validateContextSize(context, request.scopeType());
                    return modelFactory.resolveTextModel(request.model()).flatMap(model -> executeChargedOperation(
                            userId, model.creditCost(), "剧本专业分析", operationId -> callAnalysisAgent(
                                    userId, operationId, model, request, context)
                                    .map(generated -> validateAnalysis(generated, snapshot, request.scopeType(), request.scopeId()))
                                    .flatMap(generated -> scriptService.saveAnalysisReport(userId, request.projectId(),
                                            request.scopeType(), request.scopeId(), model.modelValue(), model.creditCost(),
                                            request.expectedRevision(), generated))));
                }));
    }

    /**
     * 应用用户确认并编辑后的AI草稿。
     *
     * @param request ApplyAiDraftRequest 草稿应用请求
     * @return Mono&lt;MutationResult&gt; 应用后的项目修订信息
     */
    public Mono<ScriptDtos.MutationResult> applyAiDraft(ScriptDtos.ApplyAiDraftRequest request) {
        return scriptService.applyAiDraft(request);
    }

    /**
     * 执行一次需要扣费的同步Agent操作，失败时全额退款。
     *
     * @param userId Long 当前用户ID
     * @param credits int 本次扣除积分
     * @param operationName String 业务操作名称
     * @param operation Function&lt;String, Mono&lt;T&gt;&gt; 实际Agent调用
     * @param <T> 业务结果类型
     * @return Mono&lt;T&gt; Agent业务结果
     */
    private <T> Mono<T> executeChargedOperation(Long userId, int credits, String operationName,
                                                  Function<String, Mono<T>> operation) {
        String operationId = UUID.randomUUID().toString();
        AtomicBoolean charged = new AtomicBoolean(false);
        return creditService.chargeOperation(userId, operationId, credits, operationName)
                .then(Mono.defer(() -> {
                    charged.set(credits > 0);
                    log.info("开始执行剧本Agent操作: operationId={}, userId={}, operationName={}, credits={}",
                            operationId, userId, operationName, credits);
                    return operation.apply(operationId);
                }))
                .doOnSuccess(ignored -> log.info("剧本Agent操作完成: operationId={}, userId={}, operationName={}",
                        operationId, userId, operationName))
                .onErrorResume(exception -> {
                    if (!charged.get()) return Mono.error(exception);
                    log.error("剧本Agent操作失败，准备全额退款: operationId={}, userId={}, operationName={}",
                            operationId, userId, operationName, exception);
                    return creditService.refundOperation(userId, operationId, operationName)
                            .doOnSuccess(ignored -> log.info("剧本Agent操作退款完成: operationId={}, userId={}", operationId, userId))
                            .then(Mono.error(exception));
                });
    }

    /**
     * 调用剧本Agent生成结构化草稿。
     *
     * @param userId Long 当前用户ID
     * @param operationId String 稳定操作标识
     * @param model TextModelSelection 已解析文本模型
     * @param request GenerateDraftRequest AI动作请求
     * @param context Object 服务端读取的正式剧本上下文
     * @return Mono&lt;GeneratedDraft&gt; Agent结构化结果
     */
    private Mono<ScriptDtos.GeneratedDraft> callDraftAgent(Long userId, String operationId,
                                                            AgentScopeModelFactory.TextModelSelection model,
                                                            ScriptDtos.GenerateDraftRequest request, Object context) {
        Map<String, Object> input = new LinkedHashMap<>();
        input.put("requestType", "draft");
        input.put("actionType", request.actionType());
        input.put("targetType", request.targetType());
        input.put("targetId", request.targetId());
        input.put("instruction", request.instruction());
        input.put("context", context);
        if ("storyDirections".equals(request.actionType())) {
            // 候选方向使用强类型返回，让AgentScope把内部必填字段写入结构化输出模式。
            return callAgent(userId, operationId, model, input, ScriptDtos.GeneratedStoryDirectionDraft.class)
                    .map(generated -> new ScriptDtos.GeneratedDraft(
                            JSON.parseObject(JSON.toJSONString(generated.draftData()))));
        }
        // 草稿目标可能包含对象或对象数组，统一使用目标对应的强类型契约，避免兼容模型将嵌套对象输出成字符串。
        return switch (request.targetType()) {
            case "overview" -> callAgent(userId, operationId, model, input, ScriptDtos.GeneratedOverviewDraft.class)
                    .map(generated -> generatedDraft(generated.draftData()));
            case "outline" -> callAgent(userId, operationId, model, input, ScriptDtos.GeneratedOutlineDraft.class)
                    .map(generated -> generatedDraft(generated.draftData()));
            case "characters" -> callAgent(userId, operationId, model, input, ScriptDtos.GeneratedCharacterDraft.class)
                    .map(generated -> generatedDraft(generated.draftData()));
            case "world" -> callAgent(userId, operationId, model, input, ScriptDtos.GeneratedWorldDraft.class)
                    .map(generated -> generatedDraft(generated.draftData()));
            case "episodes" -> callAgent(userId, operationId, model, input, ScriptDtos.GeneratedEpisodePlanDraft.class)
                    .map(generated -> generatedDraft(generated.draftData()));
            case "episode" -> callAgent(userId, operationId, model, input, ScriptDtos.GeneratedEpisodeDetailDraft.class)
                    .map(generated -> generatedDraft(generated.draftData()));
            case "scene" -> callAgent(userId, operationId, model, input, ScriptDtos.GeneratedSceneDraft.class)
                    .map(generated -> generatedDraft(generated.draftData()));
            case "block" -> callAgent(userId, operationId, model, input, ScriptDtos.GeneratedScriptBlockDraft.class)
                    .map(generated -> generatedDraft(generated.draftData()));
            default -> Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "不支持的剧本草稿目标类型"));
        };
    }

    /**
     * 将强类型Agent草稿还原为统一的草稿JSON。
     *
     * @param draftData Object 强类型草稿数据
     * @return GeneratedDraft 统一草稿结果
     */
    private ScriptDtos.GeneratedDraft generatedDraft(Object draftData) {
        return new ScriptDtos.GeneratedDraft(JSON.parseObject(JSON.toJSONString(draftData)));
    }

    /**
     * 调用剧本Agent生成专业分析报告。
     *
     * @param userId Long 当前用户ID
     * @param operationId String 稳定操作标识
     * @param model TextModelSelection 已解析文本模型
     * @param request AnalyzeScriptRequest 分析请求
     * @param context Object 服务端读取的正式剧本上下文
     * @return Mono&lt;GeneratedAnalysis&gt; Agent结构化分析
     */
    private Mono<ScriptDtos.GeneratedAnalysis> callAnalysisAgent(Long userId, String operationId,
                                                                  AgentScopeModelFactory.TextModelSelection model,
                                                                  ScriptDtos.AnalyzeScriptRequest request, Object context) {
        Map<String, Object> input = new LinkedHashMap<>();
        input.put("requestType", "analysis");
        input.put("scopeType", request.scopeType());
        input.put("scopeId", request.scopeId());
        input.put("instruction", request.instruction());
        input.put("context", context);
        return callAgent(userId, operationId, model, input, ScriptDtos.GeneratedAnalysis.class);
    }

    /**
     * 使用固定剧本Agent执行结构化调用。
     *
     * @param userId Long 当前用户ID
     * @param operationId String 稳定操作标识
     * @param model TextModelSelection 已解析文本模型
     * @param input Map&lt;String, Object&gt; Agent输入
     * @param resultType Class&lt;T&gt; 结构化返回类型
     * @param <T> 结构化结果类型
     * @return Mono&lt;T&gt; 结构化结果
     */
    private <T> Mono<T> callAgent(Long userId, String operationId, AgentScopeModelFactory.TextModelSelection model,
                                  Map<String, Object> input, Class<T> resultType) {
        return Mono.defer(() -> {
                    ReActAgent agent = agentFactory.scriptAgent(model.agentModel());
                    return agent.call(JSON.toJSONString(input), resultType, RuntimeContext.builder()
                                    .sessionId("script:" + operationId).userId(String.valueOf(userId)).build())
                            .timeout(Duration.ofSeconds(properties.getAi().getScriptAgent().getTimeoutSeconds()))
                            .map(message -> message.getStructuredData(resultType))
                            .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR,
                                    "剧本Agent未返回结构化结果")))
                            .doFinally(signal -> agent.close());
                })
                .onErrorMap(exception -> exception instanceof BusinessException
                        ? exception
                        : new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR,
                        "剧本Agent调用失败：" + errorMessage(exception)));
    }

    /**
     * 校验草稿动作、目标类型和必需目标标识。
     *
     * @param request GenerateDraftRequest 草稿生成请求
     * @return void 无返回值
     */
    private void validateDraftRequest(ScriptDtos.GenerateDraftRequest request) {
        Map<String, String> fixedTargets = Map.of(
                "storyDirections", "overview", "outline", "outline", "characters", "characters",
                "world", "world", "episodePlan", "episodes", "episodeDraft", "episode");
        String expectedTarget = fixedTargets.get(request.actionType());
        if (expectedTarget != null && !expectedTarget.equals(request.targetType())) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "AI动作与目标类型不匹配");
        }
        if (expectedTarget == null && (!TEXT_ACTIONS.contains(request.actionType())
                || !Set.of("episode", "scene", "block").contains(request.targetType()))) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "不支持的剧本AI动作或目标类型");
        }
        if (Set.of("episode", "scene", "block").contains(request.targetType())
                && !StringUtils.hasText(request.targetId())) {
            throw new BusinessException(ErrorCode.PARAM_MISSING, "当前AI动作必须指定目标内容");
        }
    }

    /**
     * 校验AI动作的创作阶段前置条件。
     *
     * @param actionType String AI动作类型
     * @param snapshot ProjectSnapshot 当前项目快照
     * @return void 无返回值
     */
    private void validatePrerequisite(String actionType, ScriptDtos.ProjectSnapshot snapshot) {
        ScriptDtos.ProjectOverview overview = snapshot.project().overview();
        if ("storyDirections".equals(actionType) && !StringUtils.hasText(overview.logline())
                && !StringUtils.hasText(overview.synopsis())) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "请先在故事概览中填写一句话创意或故事简介，再生成候选故事方向");
        }
        if ("outline".equals(actionType) && !StringUtils.hasText(overview.logline())
                && !StringUtils.hasText(overview.synopsis())) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "请先补充一句话创意或故事简介，再生成故事大纲");
        }
        if (Set.of("characters", "world", "episodePlan", "episodeDraft").contains(actionType)
                && (snapshot.project().outlineSections().isEmpty()
                || snapshot.project().outlineSections().stream()
                .anyMatch(section -> !StringUtils.hasText(section.content())))) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "请先完成故事大纲，再继续当前AI动作");
        }
    }

    /**
     * 校验分析范围与单集标识。
     *
     * @param request AnalyzeScriptRequest 分析请求
     * @return void 无返回值
     */
    private void validateAnalysisRequest(ScriptDtos.AnalyzeScriptRequest request) {
        if (!Set.of("project", "episode").contains(request.scopeType())) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "分析范围仅支持全项目或单集");
        }
        if ("episode".equals(request.scopeType()) && !StringUtils.hasText(request.scopeId())) {
            throw new BusinessException(ErrorCode.PARAM_MISSING, "单集分析必须指定分集");
        }
    }

    /**
     * 构建草稿生成上下文；局部动作只携带必要设定与目标单集。
     *
     * @param snapshot ProjectSnapshot 完整项目快照
     * @param targetType String 目标类型
     * @param targetId String 目标标识
     * @return Object Agent上下文
     */
    private Object buildContext(ScriptDtos.ProjectSnapshot snapshot, String targetType, String targetId) {
        if (Set.of("overview", "outline", "characters", "world", "episodes").contains(targetType)) return snapshot;
        ScriptDtos.EpisodeDetail episode = findTargetEpisode(snapshot, targetType, targetId);
        Map<String, Object> context = new LinkedHashMap<>();
        context.put("project", snapshot.project());
        context.put("episode", episode);
        context.put("target", scriptService.targetSnapshot(snapshot, targetType, targetId));
        return context;
    }

    /**
     * 构建全项目或单集分析上下文。
     *
     * @param snapshot ProjectSnapshot 完整项目快照
     * @param scopeType String 分析范围
     * @param scopeId String 分集标识
     * @return Object Agent分析上下文
     */
    private Object buildAnalysisContext(ScriptDtos.ProjectSnapshot snapshot, String scopeType, String scopeId) {
        if ("project".equals(scopeType)) return snapshot;
        ScriptDtos.EpisodeDetail episode = snapshot.episodeDetails().stream()
                .filter(item -> item.episode().id().equals(scopeId)).findFirst()
                .orElseThrow(() -> new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "分析目标分集不存在"));
        return Map.of("project", snapshot.project(), "episode", episode);
    }

    /**
     * 查找局部目标所在分集。
     *
     * @param snapshot ProjectSnapshot 完整项目快照
     * @param targetType String 目标类型
     * @param targetId String 目标标识
     * @return EpisodeDetail 目标所在分集
     */
    private ScriptDtos.EpisodeDetail findTargetEpisode(ScriptDtos.ProjectSnapshot snapshot, String targetType, String targetId) {
        return snapshot.episodeDetails().stream().filter(episode -> switch (targetType) {
            case "episode" -> episode.episode().id().equals(targetId);
            case "scene" -> episode.scenes().stream().anyMatch(scene -> scene.id().equals(targetId));
            case "block" -> episode.scenes().stream().anyMatch(scene -> scene.blocks().stream()
                    .anyMatch(block -> block.id().equals(targetId)));
            default -> false;
        }).findFirst().orElseThrow(() -> new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "AI目标内容不存在"));
    }

    /**
     * 校验上下文长度，禁止整项目调用静默截断。
     *
     * @param context Object Agent上下文
     * @param scopeType String 目标或分析范围
     * @return void 无返回值
     */
    private void validateContextSize(Object context, String scopeType) {
        int length = JSON.toJSONString(context).length();
        if (length <= MAXIMUM_CONTEXT_CHARACTERS) return;
        String suggestion = Set.of("episode", "scene", "block").contains(scopeType)
                ? "请缩小目标正文内容后重试" : "请改为选择单集执行AI操作";
        throw new BusinessException(ErrorCode.PARAM_INVALID,
                "当前剧本上下文已超过120,000字符，系统不会静默截断，" + suggestion);
    }

    /**
     * 校验Agent草稿结构与目标标识。
     *
     * @param generated GeneratedDraft Agent返回草稿
     * @param actionType String AI动作类型
     * @param targetType String 目标类型
     * @param targetId String 目标标识
     * @param snapshot ProjectSnapshot 当前正式项目快照
     * @return Mono&lt;JSONObject&gt; 已通过基础结构校验的草稿数据
     */
    private Mono<JSONObject> validateGeneratedDraft(ScriptDtos.GeneratedDraft generated, String actionType,
                                                      String targetType, String targetId,
                                                      ScriptDtos.ProjectSnapshot snapshot) {
        if (generated == null || generated.draftData() == null || generated.draftData().isEmpty()) {
            return Mono.error(new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "剧本Agent未生成有效草稿"));
        }
        JSONObject draft = generated.draftData();
        try {
            switch (targetType) {
                case "overview" -> validateOverviewDraft(draft, actionType);
                case "outline" -> validateOutlineDraft(ScriptStructuredDraftParser.parseOutlineDraft(draft), snapshot);
                case "characters" -> validateCharacterDraft(ScriptStructuredDraftParser.parseCharacterDraft(draft));
                case "world" -> validateWorldDraft(ScriptStructuredDraftParser.parseWorldDraft(draft));
                case "episodes" -> validateEpisodePlanDraft(ScriptStructuredDraftParser.parseEpisodePlanDraft(draft));
                case "episode" -> validateEpisodeDetail(ScriptStructuredDraftParser.parseEpisodeDetail(draft), targetId, snapshot);
                case "scene" -> validateScene(ScriptStructuredDraftParser.parseScene(draft), targetId, snapshot);
                case "block" -> validateBlock(ScriptStructuredDraftParser.parseScriptBlock(draft), targetId, snapshot);
                default -> throw invalidAgentResult("剧本Agent返回了不支持的目标类型");
            }
        } catch (RuntimeException exception) {
            if (exception instanceof BusinessException businessException) {
                log.warn("剧本Agent草稿结构校验失败: actionType={}, targetType={}, targetId={}, structure={}, reason={}",
                        actionType, targetType, targetId, describeDraftStructure(draft), businessException.getMessage());
                return Mono.error(businessException);
            }
            if (exception instanceof ScriptStructuredDraftParser.DraftStructureException structureException) {
                log.warn("剧本Agent草稿字段结构不合法: actionType={}, targetType={}, targetId={}, structure={}, reason={}",
                        actionType, targetType, targetId, describeDraftStructure(draft), structureException.getMessage());
                return Mono.error(invalidAgentResult("剧本Agent返回结构不合法：" + structureException.getMessage()));
            }
            log.warn("剧本Agent草稿结构解析失败: actionType={}, targetType={}, targetId={}, structure={}, exceptionType={}",
                    actionType, targetType, targetId, describeDraftStructure(draft), exception.getClass().getSimpleName());
            return Mono.error(invalidAgentResult("剧本Agent返回的草稿结构无法解析"));
        }
        return Mono.just(draft);
    }

    /**
     * 校验故事方向或故事概览草稿。
     *
     * @param draft Agent返回的JSON草稿
     * @param actionType AI动作类型
     * @return void 无返回值
     */
    private void validateOverviewDraft(JSONObject draft, String actionType) {
        if ("storyDirections".equals(actionType)) {
            ScriptDtos.StoryDirectionDraft directions = validateBean(
                    ScriptStructuredDraftParser.parseStoryDirectionDraft(draft));
            requireAgentResult(directions.selectedIndex() < directions.candidates().size(), "剧本Agent返回了无效的候选方向索引");
            return;
        }
        validateBean(draft.toJavaObject(ScriptDtos.ProjectOverview.class));
    }

    /**
     * 校验大纲草稿结构、排序和引用。
     *
     * @param draft 大纲草稿
     * @param snapshot 当前项目快照
     * @return void 无返回值
     */
    private void validateOutlineDraft(ScriptDtos.OutlineDraft draft, ScriptDtos.ProjectSnapshot snapshot) {
        requireAgentResult(draft != null && draft.sections() != null && draft.events() != null, "剧本Agent返回的大纲结构不完整");
        draft.sections().forEach(this::validateBean);
        draft.events().forEach(this::validateBean);
        validateContinuousOrder(draft.sections().stream().map(ScriptDtos.OutlineSection::sortOrder).toList(), "大纲结构段");
        validateContinuousOrder(draft.events().stream().map(ScriptDtos.StoryEvent::sortOrder).toList(), "故事事件");
        Set<String> sectionIds = Set.copyOf(draft.sections().stream().map(ScriptDtos.OutlineSection::id).toList());
        requireAgentResult(sectionIds.size() == draft.sections().size(), "剧本Agent返回了重复的大纲结构段标识");
        requireAgentResult(Set.copyOf(draft.events().stream().map(ScriptDtos.StoryEvent::id).toList()).size()
                == draft.events().size(), "剧本Agent返回了重复的故事事件标识");
        Set<String> episodeIds = snapshot.project().episodes().stream().map(ScriptDtos.EpisodeSummary::id)
                .collect(java.util.stream.Collectors.toSet());
        Map<String, String> sceneParentIds = snapshot.episodeDetails().stream().flatMap(episode -> episode.scenes().stream()
                        .map(scene -> Map.entry(scene.id(), episode.episode().id())))
                .collect(java.util.stream.Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue));
        draft.events().forEach(event -> {
            requireAgentResult(!StringUtils.hasText(event.outlineSectionId())
                    || sectionIds.contains(event.outlineSectionId()), "剧本Agent返回了不存在的大纲结构段引用");
            requireAgentResult(!StringUtils.hasText(event.episodeId()) || episodeIds.contains(event.episodeId()),
                    "剧本Agent返回了不存在的分集引用");
            String parentEpisodeId = StringUtils.hasText(event.sceneId()) ? sceneParentIds.get(event.sceneId()) : null;
            requireAgentResult(!StringUtils.hasText(event.sceneId()) || parentEpisodeId != null
                    && (!StringUtils.hasText(event.episodeId()) || parentEpisodeId.equals(event.episodeId())),
                    "剧本Agent返回了不存在或不属于对应分集的场次引用");
        });
    }

    /**
     * 校验人物草稿结构、排序和关系引用。
     *
     * @param draft 人物草稿
     * @return void 无返回值
     */
    private void validateCharacterDraft(ScriptDtos.CharacterDraft draft) {
        requireAgentResult(draft != null && draft.characters() != null && draft.relations() != null, "剧本Agent返回的人物结构不完整");
        draft.characters().forEach(this::validateBean);
        draft.relations().forEach(this::validateBean);
        validateContinuousOrder(draft.characters().stream().map(ScriptDtos.Character::sortOrder).toList(), "人物");
        validateContinuousOrder(draft.relations().stream().map(ScriptDtos.CharacterRelation::sortOrder).toList(), "人物关系");
        Set<String> characterIds = Set.copyOf(draft.characters().stream().map(ScriptDtos.Character::id).toList());
        requireAgentResult(characterIds.size() == draft.characters().size(), "剧本Agent返回了重复的人物标识");
        requireAgentResult(Set.copyOf(draft.relations().stream().map(ScriptDtos.CharacterRelation::id).toList()).size()
                == draft.relations().size(), "剧本Agent返回了重复的人物关系标识");
        draft.relations().forEach(relation -> requireAgentResult(characterIds.contains(relation.sourceCharacterId())
                && characterIds.contains(relation.targetCharacterId())
                && !relation.sourceCharacterId().equals(relation.targetCharacterId()), "剧本Agent返回了无效的人物关系引用"));
    }

    /**
     * 校验世界观草稿结构、排序和稳定标识。
     *
     * @param draft 世界观草稿
     * @return void 无返回值
     */
    private void validateWorldDraft(ScriptDtos.WorldDraft draft) {
        requireAgentResult(draft != null && draft.worldSetting() != null && draft.worldItems() != null
                && draft.locations() != null, "剧本Agent返回的世界观结构不完整");
        validateBean(draft.worldSetting());
        draft.worldItems().forEach(this::validateBean);
        draft.locations().forEach(this::validateBean);
        validateContinuousOrder(draft.worldItems().stream().map(ScriptDtos.WorldItem::sortOrder).toList(), "世界观条目");
        validateContinuousOrder(draft.locations().stream().map(ScriptDtos.Location::sortOrder).toList(), "地点");
        requireAgentResult(Set.copyOf(draft.worldItems().stream().map(ScriptDtos.WorldItem::id).toList()).size()
                == draft.worldItems().size(), "剧本Agent返回了重复的世界观条目标识");
        requireAgentResult(Set.copyOf(draft.locations().stream().map(ScriptDtos.Location::id).toList()).size()
                == draft.locations().size(), "剧本Agent返回了重复的地点标识");
    }

    /**
     * 校验分集规划草稿数量、排序和集号。
     *
     * @param draft 分集规划草稿
     * @return void 无返回值
     */
    private void validateEpisodePlanDraft(ScriptDtos.EpisodePlanDraft draft) {
        requireAgentResult(draft != null && draft.episodes() != null && !draft.episodes().isEmpty()
                && draft.episodes().size() <= 1000, "剧本Agent返回的分集规划数量不合法");
        draft.episodes().forEach(this::validateBean);
        validateContinuousOrder(draft.episodes().stream().map(ScriptDtos.EpisodeSummary::sortOrder).toList(), "分集");
        Set<String> ids = Set.copyOf(draft.episodes().stream().map(ScriptDtos.EpisodeSummary::id).toList());
        requireAgentResult(ids.size() == draft.episodes().size(), "剧本Agent返回了重复的分集标识");
        draft.episodes().forEach(episode -> requireAgentResult(episode.episodeNumber() == episode.sortOrder() + 1,
                "剧本Agent返回的集号不连续"));
    }

    /**
     * 校验整集草稿及正式设定引用。
     *
     * @param detail 单集完整草稿
     * @param targetId 目标分集标识
     * @param snapshot 当前项目快照
     * @return void 无返回值
     */
    private void validateEpisodeDetail(ScriptDtos.EpisodeDetail detail, String targetId,
                                       ScriptDtos.ProjectSnapshot snapshot) {
        validateBean(detail);
        requireAgentResult(detail.episode().id().equals(targetId), "剧本Agent改变了目标分集标识");
        validateContinuousOrder(detail.scenes().stream().map(ScriptDtos.Scene::sortOrder).toList(), "场次");
        requireAgentResult(Set.copyOf(detail.scenes().stream().map(ScriptDtos.Scene::id).toList()).size()
                == detail.scenes().size(), "剧本Agent返回了重复的场次标识");
        detail.scenes().forEach(scene -> {
            requireAgentResult(scene.sceneNumber() == scene.sortOrder() + 1, "剧本Agent返回的场次编号不连续");
            validateSceneReferences(scene, snapshot);
        });
    }

    /**
     * 校验单场草稿及正式设定引用。
     *
     * @param scene 单场草稿
     * @param targetId 目标场次标识
     * @param snapshot 当前项目快照
     * @return void 无返回值
     */
    private void validateScene(ScriptDtos.Scene scene, String targetId, ScriptDtos.ProjectSnapshot snapshot) {
        validateBean(scene);
        requireAgentResult(scene.id().equals(targetId), "剧本Agent改变了目标场次标识");
        validateSceneReferences(scene, snapshot);
    }

    /**
     * 校验单个正文块草稿及人物引用。
     *
     * @param block 正文块草稿
     * @param targetId 目标正文块标识
     * @param snapshot 当前项目快照
     * @return void 无返回值
     */
    private void validateBlock(ScriptDtos.ScriptBlock block, String targetId, ScriptDtos.ProjectSnapshot snapshot) {
        validateBean(block);
        requireAgentResult(block.id().equals(targetId), "剧本Agent改变了目标正文块标识");
        Set<String> characterIds = snapshot.project().characters().stream().map(ScriptDtos.Character::id).collect(java.util.stream.Collectors.toSet());
        requireAgentResult(!"dialogue".equals(block.blockType()) && !StringUtils.hasText(block.characterId())
                || "dialogue".equals(block.blockType()) && characterIds.contains(block.characterId()),
                "剧本Agent返回了无效的正文人物引用");
    }

    /**
     * 校验场次排序、稳定标识和人物地点引用。
     *
     * @param scene 场次草稿
     * @param snapshot 当前项目快照
     * @return void 无返回值
     */
    private void validateSceneReferences(ScriptDtos.Scene scene, ScriptDtos.ProjectSnapshot snapshot) {
        Set<String> characterIds = snapshot.project().characters().stream().map(ScriptDtos.Character::id).collect(java.util.stream.Collectors.toSet());
        Set<String> locationIds = snapshot.project().locations().stream().map(ScriptDtos.Location::id).collect(java.util.stream.Collectors.toSet());
        requireAgentResult(!StringUtils.hasText(scene.locationId()) || locationIds.contains(scene.locationId()), "剧本Agent返回了无效的地点引用");
        List<String> unknownCharacterIds = scene.characterIds().stream().filter(id -> !characterIds.contains(id)).toList();
        requireAgentResult(unknownCharacterIds.isEmpty(), "剧本Agent返回了无效的出场人物引用：场次=" + scene.id()
                + "，人物标识=" + unknownCharacterIds);
        requireAgentResult(Set.copyOf(scene.characterIds()).size() == scene.characterIds().size(), "剧本Agent返回了重复的出场人物引用");
        validateContinuousOrder(scene.blocks().stream().map(ScriptDtos.ScriptBlock::sortOrder).toList(), "正文块");
        Set<String> blockIds = Set.copyOf(scene.blocks().stream().map(ScriptDtos.ScriptBlock::id).toList());
        requireAgentResult(blockIds.size() == scene.blocks().size(), "剧本Agent返回了重复的正文块标识");
        scene.blocks().forEach(block -> {
            validateBlock(block, block.id(), snapshot);
            requireAgentResult(!"dialogue".equals(block.blockType()) || scene.characterIds().contains(block.characterId()),
                    "剧本Agent返回的对白人物未出现在当前场次");
        });
    }

    /**
     * 使用Bean Validation校验Agent返回对象。
     *
     * @param value 待校验结构
     * @param <T> 结构类型
     * @return 已通过校验的原结构
     */
    private <T> T validateBean(T value) {
        requireAgentResult(value != null, "剧本Agent返回了空结构");
        Set<ConstraintViolation<T>> violations = validator.validate(value);
        if (!violations.isEmpty()) {
            ConstraintViolation<T> violation = violations.stream()
                    .sorted((left, right) -> left.getPropertyPath().toString()
                            .compareTo(right.getPropertyPath().toString()))
                    .findFirst()
                    .orElseThrow();
            String propertyPath = violation.getPropertyPath().toString();
            String propertyPrefix = StringUtils.hasText(propertyPath) ? propertyPath + "：" : "";
            throw invalidAgentResult("剧本Agent返回结构不合法：" + propertyPrefix + violation.getMessage());
        }
        return value;
    }

    /**
     * 描述草稿JSON结构，不记录任何正式剧本或模型生成正文。
     *
     * @param draft JSONObject Agent返回的草稿对象
     * @return String 顶层字段及候选数组字段摘要
     */
    private String describeDraftStructure(JSONObject draft) {
        StringBuilder description = new StringBuilder("draftKeys=").append(draft.keySet());
        Object candidates = draft.get("candidates");
        if (candidates instanceof List<?> candidateList) {
            description.append(", candidateCount=").append(candidateList.size());
            if (!candidateList.isEmpty() && candidateList.getFirst() instanceof Map<?, ?> firstCandidate) {
                description.append(", firstCandidateKeys=").append(firstCandidate.keySet());
            }
        }
        return description.toString();
    }

    /**
     * 校验排序从零开始连续且不重复。
     *
     * @param orders 排序值列表
     * @param subject 业务对象名称
     * @return void 无返回值
     */
    private void validateContinuousOrder(List<Integer> orders, String subject) {
        List<Integer> sorted = orders.stream().sorted().toList();
        for (int index = 0; index < sorted.size(); index++) {
            requireAgentResult(sorted.get(index) == index, "剧本Agent返回的" + subject + "排序不连续");
        }
    }

    /**
     * 校验Agent结构化结果条件。
     *
     * @param condition 必须满足的条件
     * @param message 校验失败提示
     * @return void 无返回值
     */
    private void requireAgentResult(boolean condition, String message) {
        if (!condition) throw invalidAgentResult(message);
    }

    /**
     * 创建可触发退款的Agent结构校验异常。
     *
     * @param message 异常提示
     * @return 第三方调用错误
     */
    private BusinessException invalidAgentResult(String message) {
        return new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, message);
    }

    /**
     * 校验分析总结、问题定位与范围归属。
     *
     * @param generated GeneratedAnalysis Agent返回分析
     * @param snapshot ProjectSnapshot 当前项目快照
     * @param scopeType String 分析范围
     * @param scopeId String 单集范围标识
     * @return GeneratedAnalysis 已校验分析
     */
    private ScriptDtos.GeneratedAnalysis validateAnalysis(ScriptDtos.GeneratedAnalysis generated,
                                                           ScriptDtos.ProjectSnapshot snapshot,
                                                           String scopeType, String scopeId) {
        validateBean(generated);
        if (PERCENTAGE_SCORE.matcher(generated.summary()).find()) {
            throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "剧本分析不得使用单一百分比评分");
        }
        Map<String, ScriptDtos.EpisodeDetail> episodes = new LinkedHashMap<>();
        snapshot.episodeDetails().forEach(episode -> episodes.put(episode.episode().id(), episode));
        for (ScriptDtos.GeneratedAnalysisIssue issue : generated.issues()) {
            if (issue == null) throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "剧本分析包含空问题");
            boolean hasEpisodeId = StringUtils.hasText(issue.episodeId());
            boolean hasDetailAnchor = StringUtils.hasText(issue.sceneId()) || StringUtils.hasText(issue.blockId());
            if ("episode".equals(scopeType) && !hasEpisodeId) {
                throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "单集分析问题必须定位到当前分集");
            }
            if (!hasEpisodeId) {
                if (hasDetailAnchor) {
                    throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "未定位分集的项目级问题不能填写场次或正文块");
                }
                continue;
            }
            ScriptDtos.EpisodeDetail episode = episodes.get(issue.episodeId());
            if (episode == null || "episode".equals(scopeType) && !issue.episodeId().equals(scopeId)) {
                throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "分析问题定位到了范围外的分集");
            }
            validateIssueAnchor(issue, episode);
        }
        return generated;
    }

    /**
     * 校验分析问题的场次与正文块锚点。
     *
     * @param issue GeneratedAnalysisIssue 分析问题
     * @param episode EpisodeDetail 问题所属分集
     * @return void 无返回值
     */
    private void validateIssueAnchor(ScriptDtos.GeneratedAnalysisIssue issue, ScriptDtos.EpisodeDetail episode) {
        ScriptDtos.Scene targetScene = episode.scenes().stream()
                .filter(scene -> scene.id().equals(issue.sceneId())).findFirst().orElse(null);
        if (StringUtils.hasText(issue.sceneId()) && targetScene == null) {
            throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "分析问题定位到了不存在的场次");
        }
        if (StringUtils.hasText(issue.blockId())) {
            if (targetScene == null || targetScene.blocks().stream().noneMatch(block -> block.id().equals(issue.blockId()))) {
                throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "分析问题的正文块不属于所填写的场次");
            }
        }
    }

    /**
     * 读取异常的可展示消息。
     *
     * @param exception Throwable 原始异常
     * @return String 非空异常消息
     */
    private String errorMessage(Throwable exception) {
        return StringUtils.hasText(exception.getMessage()) ? exception.getMessage() : exception.getClass().getSimpleName();
    }
}
