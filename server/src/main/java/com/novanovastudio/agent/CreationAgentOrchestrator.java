package com.novanovastudio.agent;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.agent.dto.*;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.logging.MappedDiagnosticContext;
import com.novanovastudio.service.AiTaskService;
import com.novanovastudio.service.PersistenceService;
import com.novanovastudio.service.SkillService;
import com.novanovastudio.repository.AgentPlanRepository;
import com.novanovastudio.repository.CreationAgentRequestRepository;
import com.novanovastudio.entity.CreationAgentRequest;
import io.agentscope.core.ReActAgent;
import io.agentscope.core.agent.RuntimeContext;
import io.agentscope.core.model.Model;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Map;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import reactor.core.Disposable;
import reactor.core.publisher.Mono;
import reactor.core.publisher.Sinks;

/**
 * 图片、视频和画布入口的配置驱动主Agent编排器。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-23 00:00
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class CreationAgentOrchestrator {

    /** Agent会话服务 */
    private final AgentSessionService sessionService;
    /** Agent事件发射器 */
    private final AgentEventEmitter eventEmitter;
    /** Agent执行登记 */
    private final AgentExecutionRegistry executionRegistry;
    /** AgentScope模型工厂 */
    private final AgentScopeModelFactory modelFactory;
    /** 固定Agent工厂 */
    private final AgentScopeAgentFactory agentFactory;
    /** 计划校验器 */
    private final CreationPlanValidator planValidator;
    /** 计划执行器 */
    private final CreationPlanExecutor planExecutor;
    /** 计划仓储 */
    private final AgentPlanRepository planRepository;
    /** AI任务服务 */
    private final AiTaskService aiTaskService;
    /** 技能服务 */
    private final SkillService skillService;
    /** 持久化服务（对话生成记录） */
    private final PersistenceService persistenceService;
    /** Java固定注册的画布工具 */
    private final AgentToolRegistry toolRegistry;
    /** 主Agent请求持久化仓储 */
    private final CreationAgentRequestRepository requestRepository;
    /** 主Agent请求分区调度器 */
    private final CreationAgentRequestDispatcher requestDispatcher;
    /** 主Agent请求Redis队列 */
    private final CreationAgentRequestQueue requestQueue;
    /** 本实例正在执行的请求上下文 */
    private final Map<String, ActiveRequestExecution> activeRequests = new ConcurrentHashMap<>();
    /** 已领取请求的可取消订阅，用于及时中断前端工具等待 */
    private final Map<String, Disposable> claimedRequestSubscriptions = new ConcurrentHashMap<>();
    /** 画布图片命令的原始用户提示词格式 */
    private static final Pattern CANVAS_IMAGE_COMMAND_PATTERN = Pattern.compile(
            "^(?:生成|创建|绘制|制作)\\s*(?:一张|一幅|一个)?\\s*(?:图片|图像)\\s*[：:]\\s*(.+)$",
            Pattern.DOTALL);
    /** 画布视频命令的原始用户提示词格式 */
    private static final Pattern CANVAS_VIDEO_COMMAND_PATTERN = Pattern.compile(
            "^(?:生成|创建|绘制|制作)\\s*(?:一个|一段)?\\s*视频\\s*[：:]\\s*(.+)$",
            Pattern.DOTALL);

    /**
     * 判断请求是否应进入统一主Agent。
     *
     * @param entrySource String 入口来源
     * @return boolean 是否支持
     */
    public boolean supports(String entrySource) {
        return CreationEntrySource.supported(entrySource);
    }

    /**
     * 创建并排队一次主Agent对话，立即返回本次请求标识。
     *
     * @param userId Long 用户ID
     * @param request AgentChatRequest 对话请求
     * @return Mono<CreationAgentChatResponse> 会话、请求和状态
     */
    public Mono<CreationAgentChatResponse> startChat(Long userId, AgentChatRequest request) {
        validateRequest(request);
        return sessionService.getOrCreateSession(userId, request.sessionId(), request.entrySource())
                .flatMap(session -> {
                    if (!request.entrySource().equals(session.profile())) {
                        return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "会话入口来源与当前页面不一致"));
                    }
                    AgentChatRequest snapshot = requestWithSessionId(request, session.id());
                    CreationAgentRequest queuedRequest = new CreationAgentRequest();
                    queuedRequest.setId(UUID.randomUUID().toString());
                    queuedRequest.setUserId(userId);
                    queuedRequest.setSessionId(session.id());
                    queuedRequest.setEntrySource(snapshot.entrySource());
                    queuedRequest.setRequestData(JSON.toJSONString(snapshot));
                    queuedRequest.setStatus("queued");
                    queuedRequest.setCreatedAt(OffsetDateTime.now());
                    return ensureGenerationLogForRequest(userId, session.id(), snapshot)
                            .then(requestRepository.create(queuedRequest))
                            .then(Mono.fromRunnable(() -> eventEmitter.emit(userId,
                                    AgentEvent.queueStatus(session.id(), queuedRequest.getId(), "queued", "排队中"))))
                            .then(requestDispatcher.enqueue(queuedRequest))
                            .then(requestRepository.findStatusById(queuedRequest.getId())
                                    .defaultIfEmpty("queued")
                                    .map(status -> new CreationAgentChatResponse(session.id(), queuedRequest.getId(), status)));
                });
    }

    /**
     * 图片/视频入口发起对话时幂等创建对话生成记录，保证刷新后左侧会话列表可见。
     * <p>
     * 仅当会话尚无生成记录时初始化空记录；失败不阻断对话主流程。
     *
     * @param userId Long 用户ID
     * @param sessionId String Agent 会话ID
     * @param request AgentChatRequest 对话请求
     * @return Mono<Void> 完成信号
     */
    private Mono<Void> ensureGenerationLogForRequest(Long userId, String sessionId, AgentChatRequest request) {
        String logType = "videoPage".equals(request.entrySource()) ? "video" : "image";
        if (!"imagePage".equals(request.entrySource()) && !"videoPage".equals(request.entrySource())) {
            return Mono.empty();
        }
        String message = request.message() == null ? "" : request.message().trim();
        String title = StringUtils.hasText(message)
                ? (message.length() > 30 ? message.substring(0, 30) : message) : "新对话";
        return persistenceService.ensureGenerationLog(userId, sessionId, logType, title)
                .onErrorResume(exception -> {
                    log.warn("创建对话生成记录失败: sessionId={}, 原因={}", sessionId, exception.getMessage());
                    return Mono.empty();
                });
    }

    /**
     * 将技能引导/澄清问答轮次写入生成记录，保证历史会话能看到完整对话过程。
     * <p>
     * 生成轮次由任务执行链路（AbstractTaskProfile）保存，这里只保存纯对话（无生成任务）轮次；
     * 仅在图片/视频入口生效，失败不阻断对话主流程。
     *
     * @param userId Long 用户ID
     * @param session AgentSession 会话
     * @param request AgentChatRequest 对话请求
     * @param reply String 助手澄清回复
     * @param choices List<AgentChoice> 该轮提供给用户的选项（历史记录只读展示，可为空）
     * @return Mono<Void> 完成信号
     */
    private Mono<Void> saveClarificationRound(Long userId, AgentSession session, AgentChatRequest request, String reply,
                                              List<AgentChoice> choices) {
        String logType = "videoPage".equals(request.entrySource()) ? "video" : "image";
        if (!"imagePage".equals(request.entrySource()) && !"videoPage".equals(request.entrySource())) {
            return Mono.empty();
        }
        String message = request.message() == null ? "" : request.message().trim();
        if (!StringUtils.hasText(message) && !StringUtils.hasText(reply)) {
            return Mono.empty();
        }
        return resolveSkillSnapshot(request)
                .flatMap(skill -> {
                    JSONObject round = new JSONObject();
                    round.put("id", UUID.randomUUID().toString());
                    round.put("prompt", message);
                    round.put("assistantText", reply == null ? "" : reply);
                    round.put("config", new JSONObject());
                    // 图片/视频入口的轮次结构不同：图片用 results 数组，视频用 result 单数对象
                    if ("video".equals(logType)) {
                        round.put("result", new JSONObject());
                    } else {
                        round.put("results", List.of());
                    }
                    round.put("references", List.of());
                    round.put("videoReferences", List.of());
                    if (!skill.isEmpty()) {
                        round.put("skill", skill);
                    }
                    if (choices != null && !choices.isEmpty()) {
                        round.put("choices", JSON.toJSON(choices));
                    }
                    round.put("createdAt", System.currentTimeMillis());
                    String title = StringUtils.hasText(message)
                            ? (message.length() > 30 ? message.substring(0, 30) : message) : "新对话";
                    Mono<Void> save = persistenceService.saveOrUpdateGenerationRound(userId, session.id(), logType, title, round);
                    return Mono.defer(() -> save == null ? Mono.empty() : save)
                            .onErrorResume(exception -> {
                                log.warn("保存澄清问答轮次失败: sessionId={}, 原因={}", session.id(), exception.getMessage());
                                return Mono.empty();
                            });
                });
    }

    /**
     * 加载请求所选技能的快照（id/name/targetType），供对话轮次落库时展示。
     *
     * @param request AgentChatRequest 原始请求
     * @return Mono<Map<String, Object>> 技能快照或空Map
     */
    private Mono<Map<String, Object>> resolveSkillSnapshot(AgentChatRequest request) {
        if (request == null || !StringUtils.hasText(request.skillId())) {
            return Mono.just(Map.of());
        }
        Long skillId;
        try {
            skillId = Long.valueOf(request.skillId());
        } catch (NumberFormatException exception) {
            return Mono.just(Map.of());
        }
        return skillService.findEnabledSkill(skillId)
                .map(skill -> Map.<String, Object>of(
                        "id", skill.getId(),
                        "name", skill.getName(),
                        "targetType", skill.getTargetType()))
                .onErrorResume(exception -> {
                    log.warn("加载技能快照失败: skillId={}, 原因={}", request.skillId(), exception.getMessage());
                    return Mono.just(Map.of());
                });
    }

    /**
     * 判断会话是否存在本实例正在执行的主Agent请求。
     *
     * @param sessionId String 会话ID
     * @return boolean 是否活跃
     */
    public boolean isActive(String sessionId) {
        return activeRequests.values().stream().anyMatch(active -> active.sessionId().equals(sessionId));
    }

    /**
     * 按请求ID精确停止主Agent请求及其关联的生成任务。
     *
     * @param userId Long 用户ID
     * @param requestId String 主Agent请求ID
     * @return Mono<Void> 取消完成信号
     */
    public Mono<Void> cancelChat(Long userId, String requestId) {
        return requestRepository.findByIdForUser(userId, requestId)
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "主Agent请求不存在")))
                .flatMap(request -> cancelRequest(userId, request));
    }

    /**
     * 执行已由分区调度器领取的主Agent请求。
     *
     * @param requestId String 主Agent请求ID
     * @return Mono<Void> 请求执行完成信号
     */
    public Mono<Void> executeClaimedRequest(String requestId) {
        AtomicBoolean cleaned = new AtomicBoolean();
        Sinks.Empty<Void> stopSignal = Sinks.empty();
        Runnable cleanup = () -> {
            if (cleaned.compareAndSet(false, true)) {
                claimedRequestSubscriptions.remove(requestId);
                clearClaimedRequestExecution(requestId);
            }
        };
        Mono<Void> execution = requestRepository.findById(requestId)
                .flatMap(request -> requestRepository.markRunningIfQueued(requestId)
                        .filter(Boolean::booleanValue)
                        .flatMap(ignored -> executeRunningRequest(request)));
        // 通过完成信号终止外层订阅，确保调用方拿到的Disposable也同步进入已释放状态。
        return Mono.firstWithSignal(execution, stopSignal.asMono())
                .doOnSubscribe(subscription -> claimedRequestSubscriptions.put(requestId, new Disposable() {
                    private final AtomicBoolean disposed = new AtomicBoolean();

                    @Override
                    public void dispose() {
                        if (disposed.compareAndSet(false, true)) {
                            stopSignal.tryEmitEmpty();
                        }
                    }

                    @Override
                    public boolean isDisposed() {
                        return disposed.get();
                    }
                }))
                .doOnSuccess(ignored -> cleanup.run())
                .doOnError(exception -> cleanup.run())
                .doFinally(signal -> cleanup.run());
    }

    /**
     * 终止当前实例已领取的运行请求，不会影响其他请求。
     *
     * @param requestId String 主Agent请求ID
     * @return Mono<Void> 停止执行完成信号
     */
    public Mono<Void> stopClaimedExecution(String requestId) {
        ActiveRequestExecution active = activeRequests.get(requestId);
        if (active == null) {
            // 请求已被调度器领取但尚未建立执行上下文时，也必须终止订阅，触发调度器释放名额并补位。
            return Mono.<Void>fromRunnable(() -> {
                Disposable subscription = claimedRequestSubscriptions.get(requestId);
                if (subscription != null) {
                    subscription.dispose();
                }
            });
        }
        if (!active.cancellationHandled().compareAndSet(false, true)) {
            return Mono.empty();
        }
        AgentExecutionRegistry.AgentCancellation cancellation = executionRegistry.requestCancellation(active.userId(), active.sessionId());
        String planId = active.planId().get();
        return reactor.core.publisher.Flux.fromIterable(cancellation.tasks())
                .flatMap(task -> aiTaskService.cancelTaskForUser(active.userId(), task.taskId())
                        .onErrorResume(exception -> {
                            log.error("取消主Agent关联任务失败: requestId={}, taskId={}", requestId, task.taskId(), exception);
                            return Mono.empty();
                        }))
                .then(requestRepository.findById(requestId)
                        .flatMap(request -> completePlanForTerminalRequest(request, planId, "已停止生成")))
                .doFinally(signal -> executionRegistry.disposeWhenReady(active.sessionId()));
    }

    /**
     * 中断已失去活动租约的本实例请求，防止旧执行线程继续创建任务。
     *
     * @param requestId String 主Agent请求ID
     * @param message String 中断说明
     * @return Mono<Void> 中断收尾完成信号
     */
    public Mono<Void> interruptClaimedExecution(String requestId, String message) {
        return requestRepository.interruptRunningIfRunning(requestId, message)
                .flatMap(interrupted -> Boolean.TRUE.equals(interrupted)
                        ? requestQueue.markCancelRequested(requestId)
                                .then(requestRepository.findById(requestId))
                                .flatMap(request -> interruptPersistedRequest(request, message))
                        : Mono.empty());
    }

    /**
     * 执行主Agent规划、计划执行和结果汇总。
     *
     * @param userId Long 用户ID
     * @param session AgentSession 会话
     * @param request AgentChatRequest 对话请求
     * @param active ActiveRequestExecution 当前请求执行上下文
     * @return Mono<Void> 执行完成信号
     */
    private Mono<Void> executeConversation(Long userId, AgentSession session, AgentChatRequest request,
                                           ActiveRequestExecution active) {
        String userMessageId = UUID.randomUUID().toString();
        return isRequestCancellationRequested(active)
                .flatMap(canceled -> Boolean.TRUE.equals(canceled)
                        ? Mono.empty()
                        : sessionService.appendUserMessage(session.id(), userMessageId, request.message())
                                .then(isRequestCancellationRequested(active))
                                .flatMap(canceledAfterAppend -> Boolean.TRUE.equals(canceledAfterAppend)
                                        ? Mono.empty()
                                        : createAndExecutePlan(userId, session, request, active)));
    }

    /**
     * 调用主Agent创建计划并执行。
     *
     * @param userId Long 用户ID
     * @param session AgentSession 会话
     * @param request AgentChatRequest 原始请求
     * @param active ActiveRequestExecution 当前请求执行上下文
     * @return Mono<Void> 执行完成信号
     */
    private Mono<Void> createAndExecutePlan(Long userId, AgentSession session, AgentChatRequest request,
                                            ActiveRequestExecution active) {
        return isRequestCancellationRequested(active)
                .flatMap(canceled -> Boolean.TRUE.equals(canceled) ? Mono.empty() : modelFactory.defaultTextModel()
                .flatMap(model -> Mono.justOrEmpty(buildStyleFollowUpPlan(session, request))
                        .map(candidate -> planValidator.validate(candidate, request.entrySource(), request.creationSettings()))
                        .switchIfEmpty(Mono.defer(() -> callMainAgent(userId, session, request, model)
                                .map(candidate -> planValidator.validate(candidate, request.entrySource(), request.creationSettings()))
                                .map(candidate -> resolveTaskPromptSources(candidate, session, request.message()))))
                        .flatMap(validated -> isRequestCancellationRequested(active).flatMap(canceledAfterPlanning -> {
                            if (Boolean.TRUE.equals(canceledAfterPlanning)) {
                                return Mono.empty();
                            }
                            if (StringUtils.hasText(validated.clarificationQuestion())) {
                                AgentAction action;
                                if (validated.choices() != null && !validated.choices().isEmpty()) {
                                    action = AgentAction.choice(validated.choices());
                                } else if (Boolean.TRUE.equals(validated.canvasGuidance())) {
                                    action = AgentAction.navigateToCanvas(request.message());
                                } else {
                                    action = null;
                                }
                                String clarification = validated.clarificationQuestion();
                                return saveClarificationRound(userId, session, request, clarification, validated.choices())
                                        .then(completeWithMessage(userId, session.id(), clarification, action));
                            }
                            CreationPlan plan = composeFollowUpPrompts(withServerPlanId(validated, session, request.message()),
                                    session, request.message());
                            active.planId().set(plan.planId());
                            return planRepository.create(userId, session.id(), plan)
                                    .then(requestRepository.updatePlanId(active.requestId(), plan.planId()))
                                    .then(isRequestCancellationRequested(active))
                                    .flatMap(canceledAfterPlanCreation -> Boolean.TRUE.equals(canceledAfterPlanCreation)
                                            ? requestRepository.findById(active.requestId())
                                                    .flatMap(current -> completePlanForTerminalRequest(current, plan.planId(), "已停止生成"))
                                            : Mono.fromRunnable(() -> eventEmitter.emit(userId,
                                                            AgentEvent.planCreated(session.id(), plan.planId(), plan.summary(), plan.tasks().size())))
                                                    .then(planExecutor.execute(userId, session.id(), plan, request, model)
                                                            .contextWrite(context -> MappedDiagnosticContext.put(
                                                                    context, MappedDiagnosticContext.PLAN_ID, plan.planId())))
                                                    .flatMap(summary -> {
                                                        active.setCompletion(summary.status(), summary.message());
                                                        return completeWithMessage(userId, session.id(), summary.message());
                                                    }));
                        }))));
    }

    /**
     * 构造通用风格重生成计划。
     * <p>
     * 仅处理明确的“修改风格”类命令，并且要求画布中存在对应的图片或视频生成节点；
     * 其他带有具体创作意图的消息继续交给主Agent规划。
     *
     * @param session AgentSession 当前会话
     * @param request AgentChatRequest 当前对话请求
     * @return CreationPlan 可直接执行的风格重生成计划；无法确定目标时返回null
     */
    CreationPlan buildStyleFollowUpPlan(AgentSession session, AgentChatRequest request) {
        if (!isGenericStyleFollowUpRequest(request)) return null;
        Map<String, Object> snapshot = request.canvasSnapshot() == null ? Map.of() : request.canvasSnapshot();
        List<Map<String, Object>> nodes = snapshotNodes(snapshot.get("nodes"));
        Set<String> selectedNodeIds = new LinkedHashSet<>(stringList(snapshot.get("selectedNodeIds")));
        List<CreationTask> tasks = new ArrayList<>();
        for (String generationType : selectedGenerationTypes(request)) {
            String prompt = latestCanvasPrompt(session, generationType);
            if (!StringUtils.hasText(prompt)) continue;
            List<Map<String, Object>> targets = styleFollowUpTargets(nodes, selectedNodeIds, generationType);
            for (Map<String, Object> target : targets) {
                String nodeId = stringValue(target.get("id"));
                if (!StringUtils.hasText(nodeId) || tasks.size() >= 8) break;
                tasks.add(new CreationTask("style-follow-up-" + generationType + "-" + tasks.size(), "canvas", "tool",
                        prompt, List.of(), "canvas_run_generation", Map.of("nodeId", nodeId, "mode", generationType)));
            }
        }
        if (tasks.isEmpty()) return null;
        return new CreationPlan("", "按已选风格重新生成", CreationEntrySource.CANVAS,
                "按已选风格重新生成画布内容", "", false, request.creationSettings(), tasks, List.of());
    }

    /** 判断是否为不含额外创作要求的通用风格命令。 */
    private boolean isGenericStyleFollowUpRequest(AgentChatRequest request) {
        if (!isStyleFollowUpRequest(request)) return false;
        String normalized = request.message().replaceAll("[\\s，。！？!?,、:：]+", "");
        return Set.of("修改风格", "换风格", "应用风格", "使用风格", "使用当前风格", "使用这个风格",
                "按当前风格生成", "按当前风格重生成", "按已选风格生成", "按已选风格重生成",
                "重新生成风格").contains(normalized);
    }

    /** 读取当前风格选择对应的图片或视频类型，保持图片和视频组的选择顺序。 */
    private List<String> selectedGenerationTypes(AgentChatRequest request) {
        CreationSettings settings = request.creationSettings();
        if (settings == null) return List.of();
        Map<String, List<Long>> idsByType = settings.generationStyleIdsByType();
        if (idsByType != null) {
            return List.of("image", "video").stream()
                    .filter(type -> idsByType.get(type) != null && !idsByType.get(type).isEmpty())
                    .toList();
        }
        if (settings.generationStyleIds() == null || settings.generationStyleIds().isEmpty()) return List.of();
        if (CreationEntrySource.IMAGE_PAGE.equals(request.entrySource())) return List.of("image");
        if (CreationEntrySource.VIDEO_PAGE.equals(request.entrySource())) return List.of("video");
        return List.of();
    }

    /** 读取画布快照中的节点对象。 */
    private List<Map<String, Object>> snapshotNodes(Object value) {
        if (!(value instanceof List<?> values)) return List.of();
        return values.stream().map(this::objectMap).filter(node -> !node.isEmpty()).toList();
    }

    /** 选择当前选中节点，否则选择对应类型最近的一个生成节点。 */
    private List<Map<String, Object>> styleFollowUpTargets(List<Map<String, Object>> nodes,
                                                            Set<String> selectedNodeIds,
                                                            String generationType) {
        List<Map<String, Object>> selected = nodes.stream()
                .filter(node -> generationType.equals(stringValue(node.get("kind")))
                        && selectedNodeIds.contains(stringValue(node.get("id")))
                        && hasGenerationPrompt(node))
                .toList();
        if (!selected.isEmpty()) return selected;
        for (int index = nodes.size() - 1; index >= 0; index--) {
            Map<String, Object> node = nodes.get(index);
            if (generationType.equals(stringValue(node.get("kind"))) && hasGenerationPrompt(node)) {
                return List.of(node);
            }
        }
        return List.of();
    }

    /** 判断节点是否存在可重用的生成提示词。 */
    private boolean hasGenerationPrompt(Map<String, Object> node) {
        return objectMap(node.get("generation")).entrySet().stream()
                .anyMatch(entry -> "prompt".equals(entry.getKey()) && StringUtils.hasText(stringValue(entry.getValue())));
    }

    /** 获取历史中最近一条对应类型的原始图片或视频命令。 */
    private String latestCanvasPrompt(AgentSession session, String generationType) {
        Pattern commandPattern = "image".equals(generationType) ? CANVAS_IMAGE_COMMAND_PATTERN : CANVAS_VIDEO_COMMAND_PATTERN;
        for (int index = session.messages().size() - 1; index >= 0; index--) {
            var message = session.messages().get(index);
            if (!"user".equals(message.role()) || !StringUtils.hasText(message.text())) continue;
            if (commandPattern.matcher(message.text().trim()).matches()) return message.text();
        }
        return "";
    }

    /** 将快照中的任意对象转换为字符串键Map。 */
    private Map<String, Object> objectMap(Object value) {
        if (!(value instanceof Map<?, ?> source)) return Map.of();
        Map<String, Object> result = new LinkedHashMap<>();
        source.forEach((key, item) -> {
            if (key != null) result.put(String.valueOf(key), item);
        });
        return result;
    }

    /** 将快照中的字符串数组转换为去重后的有序列表。 */
    private List<String> stringList(Object value) {
        if (!(value instanceof List<?> values)) return List.of();
        return values.stream().map(this::stringValue).filter(StringUtils::hasText).distinct().toList();
    }

    /** 将任意快照值转换为字符串。 */
    private String stringValue(Object value) {
        return value == null ? "" : String.valueOf(value);
    }

    /**
     * 为聊天重试请求恢复最近创作计划中的历史风格，同时保留本次请求的页面设置。
     *
     * @param userId Long 用户ID
     * @param session AgentSession 当前Agent会话
     * @param request AgentChatRequest 当前对话请求
     * @return Mono<AgentChatRequest> 合并历史风格后的请求
     */
    private Mono<AgentChatRequest> resolveRetryRequest(Long userId, AgentSession session, AgentChatRequest request) {
        if (!isRetryMessage(request.message()) || hasGenerationStyles(request.creationSettings())) {
            return Mono.just(request);
        }
        return planRepository.findLatestCreationSettings(userId, session.id())
                .map(historicalSettings -> new AgentChatRequest(
                        request.sessionId(), request.entrySource(), request.message(), request.canvasSnapshot(),
                        request.references(), request.attachments(), request.history(),
                        mergeRetrySettings(request.creationSettings(), historicalSettings), request.skillId()))
                .defaultIfEmpty(request);
    }

    /**
     * 合并重试所需的历史风格字段，当前请求的其他页面设置保持不变。
     *
     * @param current CreationSettings 当前请求生成设置
     * @param historical CreationSettings 最近失败计划生成设置
     * @return CreationSettings 合并后的生成设置
     */
    CreationSettings mergeRetrySettings(CreationSettings current, CreationSettings historical) {
        if (current == null || historical == null || !hasGenerationStyles(historical)) {
            return current;
        }
        List<Long> styleIds = historical.generationStyleSnapshots() != null
                && !historical.generationStyleSnapshots().isEmpty() ? null : historical.generationStyleIds();
        java.util.Map<String, List<Long>> styleIdsByType = historical.generationStyleSnapshots() != null
                && !historical.generationStyleSnapshots().isEmpty() ? null : historical.generationStyleIdsByType();
        return new CreationSettings(current.model(), current.size(), current.resolution(), current.quality(),
                current.count(), current.seconds(), current.watermark(), styleIds, historical.generationStyleSnapshots(),
                styleIdsByType, current.videoGenerationMode(), current.videoModel());
    }

    /**
     * 判断生成设置是否携带风格ID或风格快照。
     *
     * @param settings CreationSettings 生成设置
     * @return boolean 是否携带风格
     */
    private boolean hasGenerationStyles(CreationSettings settings) {
        return settings != null
                && ((settings.generationStyleIds() != null && !settings.generationStyleIds().isEmpty())
                || (settings.generationStyleSnapshots() != null && !settings.generationStyleSnapshots().isEmpty())
                || (settings.generationStyleIdsByType() != null && settings.generationStyleIdsByType().values().stream()
                .anyMatch(ids -> ids != null && !ids.isEmpty())));
    }

    /**
     * 调用AgentScope主Agent获取结构化计划。
     *
     * @param userId Long 用户ID
     * @param session AgentSession 当前会话
     * @param request AgentChatRequest 原始请求
     * @param model Model 默认文本模型
     * @return Mono<CreationPlan> 候选计划
     */
    private Mono<CreationPlan> callMainAgent(Long userId, AgentSession session, AgentChatRequest request, Model model) {
        return Mono.defer(() -> {
            ReActAgent agent;
            Map<String, Object> input = new java.util.LinkedHashMap<>();
            input.put("entrySource", request.entrySource());
            input.put("message", request.message());
            input.put("history", historyForAgent(request, session));
            input.put("promptCandidates", promptSources(session, request.message()));
            input.put("creationSettings", request.creationSettings());
            input.put("generationStyleSelection", generationStyleSelection(request));
            input.put("styleFollowUp", isStyleFollowUpRequest(request));
            input.put("retryRequested", isRetryMessage(request.message()));
            if (isRetryMessage(request.message())) {
                input.put("retryPrompt", latestRetryPrompt(session));
            }
            input.put("attachmentCount", request.attachments() == null ? 0 : request.attachments().size());
            input.put("canvasSnapshot", CreationEntrySource.CANVAS.equals(request.entrySource()) ? request.canvasSnapshot() : Map.of());
            input.put("canvasTools", CreationEntrySource.CANVAS.equals(request.entrySource())
                    ? toolRegistry.allTools().stream().filter(com.novanovastudio.agent.dto.AgentTool::frontend).toList()
                    : List.of());
            if (StringUtils.hasText(request.skillId())) {
                Long skillId;
                try {
                    skillId = Long.valueOf(request.skillId());
                } catch (NumberFormatException exception) {
                    return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "技能ID不合法"));
                }
                return skillService.findEnabledSkill(skillId)
                        .map(skill -> {
                            input.put("skillId", request.skillId());
                            input.put("skill", Map.of(
                                    "name", skill.getName(),
                                    "targetType", skill.getTargetType(),
                                    "instructions", skill.getSystemPrompt()));
                            return agentFactory.mainAgent(model, skill.getSystemPrompt());
                        })
                        .flatMap(skillAgent -> callMainAgentWith(skillAgent, userId, session, input));
            }
            agent = agentFactory.mainAgent(model);
            return callMainAgentWith(agent, userId, session, input);
        });
    }

    /**
     * 使用指定主Agent实例调用模型并解析计划。
     *
     * @param agent ReActAgent 主Agent实例
     * @param userId Long 用户ID
     * @param session AgentSession 当前会话
     * @param input Map<String, Object> 模型输入
     * @return Mono<CreationPlan> 候选计划
     */
    private Mono<CreationPlan> callMainAgentWith(ReActAgent agent, Long userId, AgentSession session, Map<String, Object> input) {
        return agent.call(JSON.toJSONString(input), CreationPlan.class, RuntimeContext.builder()
                        .sessionId(session.id() + ":main")
                        .userId(String.valueOf(userId))
                        .put(AgentThinkingEventMiddleware.ThinkingEventContext.class,
                                new AgentThinkingEventMiddleware.ThinkingEventContext(userId, session.id()))
                        .build())
                .timeout(Duration.ofSeconds(60))
                .map(message -> message.getStructuredData(CreationPlan.class))
                .doFinally(signal -> agent.close());
    }

    /**
     * 构造主Agent可选择的服务端用户原文引用。
     * <p>
     * 当前消息始终使用固定引用，历史消息仅保留与主Agent上下文相同窗口内的用户消息，
     * 避免模型复制或改写长提示词后再参与执行。
     *
     * @param session AgentSession 当前会话
     * @param currentMessage String 当前用户消息
     * @return Map<String, String> 原文引用到用户消息的映射
     */
    private Map<String, String> promptSources(AgentSession session, String currentMessage) {
        Map<String, String> sources = new LinkedHashMap<>();
        sources.put("current", currentMessage);
        List<com.novanovastudio.agent.dto.AgentMessage> messages = session.messages();
        for (int index = Math.max(0, messages.size() - 20); index < messages.size(); index++) {
            com.novanovastudio.agent.dto.AgentMessage message = messages.get(index);
            if ("user".equals(message.role()) && StringUtils.hasText(message.text())) {
                sources.put("history-" + index, message.text());
            }
        }
        return sources;
    }

    /**
     * 将主Agent选择的用户原文引用解析为可信提示词。
     * <p>
     * 主Agent任务必须提供有效引用；引用缺失或不存在时直接拒绝，
     * 不使用模型返回的改写文本作为替代提示词。
     *
     * @param plan CreationPlan 已完成页面能力校验的计划
     * @param session AgentSession 当前会话
     * @param currentMessage String 当前用户消息
     * @return CreationPlan 已回填用户原始提示词的计划
     * @throws BusinessException 引用不存在时抛出
     */
    CreationPlan resolveTaskPromptSources(CreationPlan plan, AgentSession session, String currentMessage) {
        if (plan == null || plan.tasks() == null || plan.tasks().isEmpty()) {
            return plan;
        }
        Map<String, String> sources = promptSources(session, currentMessage);
        List<CreationTask> tasks = plan.tasks().stream().map(task -> {
            if (task == null || !StringUtils.hasText(task.sourcePromptId())) {
                throw new BusinessException(ErrorCode.PARAM_INVALID, "主Agent任务缺少用户原始提示词引用");
            }
            String prompt = sources.get(task.sourcePromptId());
            if (!StringUtils.hasText(prompt)) {
                throw new BusinessException(ErrorCode.PARAM_INVALID, "主Agent任务引用的用户原始提示词不存在");
            }
            return new CreationTask(task.taskId(), task.taskType(), task.action(), prompt, task.dependsOn(),
                    task.toolName(), task.toolArguments());
        }).toList();
        return new CreationPlan(plan.planId(), plan.intent(), plan.entrySource(), plan.summary(),
                plan.clarificationQuestion(), plan.canvasGuidance(), plan.creationSettings(), tasks,
                plan.choices());
    }

    /**
     * 判断当前画布请求是否是在已选风格基础上的风格重生成操作。
     * <p>
     * 风格ID由服务端校验和解析，主Agent只需要知道用户已经选择了风格以及请求属于风格操作，
     * 不应再次要求用户输入风格名称或自行拼接风格提示词。
     *
     * @param request AgentChatRequest 当前对话请求
     * @return boolean 是否为已选风格的画布重生成请求
     */
    boolean isStyleFollowUpRequest(AgentChatRequest request) {
        if (request == null || !CreationEntrySource.CANVAS.equals(request.entrySource())
                || !hasGenerationStyles(request.creationSettings()) || !StringUtils.hasText(request.message())) {
            return false;
        }
        String normalized = request.message().replaceAll("[\\s，。！？!?,、:：]+", "");
        if (!normalized.contains("风格")) return false;
        return List.of("修改", "改成", "改为", "换", "应用", "使用", "重生成", "重新生成")
                .stream().anyMatch(normalized::contains);
    }

    /**
     * 构造供主Agent理解的风格选择摘要，不包含风格提示词和未校验的名称。
     *
     * @param request AgentChatRequest 当前对话请求
     * @return Map<String, Object> 已选择风格的类型和数量
     */
    private Map<String, Object> generationStyleSelection(AgentChatRequest request) {
        Map<String, Object> selection = new LinkedHashMap<>();
        if (request == null || request.creationSettings() == null) return selection;
        CreationSettings settings = request.creationSettings();
        Map<String, List<Long>> idsByType = settings.generationStyleIdsByType();
        if (idsByType != null) {
            idsByType.forEach((type, ids) -> {
                if (ids != null && !ids.isEmpty()) selection.put(type, Map.of("selected", true, "count", ids.size()));
            });
            return selection;
        }
        if (settings.generationStyleIds() != null && !settings.generationStyleIds().isEmpty()) {
            String generationType = CreationEntrySource.IMAGE_PAGE.equals(request.entrySource()) ? "image"
                    : CreationEntrySource.VIDEO_PAGE.equals(request.entrySource()) ? "video" : "unknown";
            selection.put(generationType, Map.of("selected", true, "count", settings.generationStyleIds().size()));
        }
        return selection;
    }

    /**
     * 读取最近二十条自然语言会话历史，避免工具元数据进入主Agent上下文。
     *
     * @param session AgentSession 当前会话
     * @return List<Map<String, String>> 最近会话历史
     */
    private List<Map<String, String>> recentHistory(AgentSession session) {
        List<Map<String, String>> history = session.messages().stream()
                .filter(message -> "user".equals(message.role()) || "assistant".equals(message.role()))
                .map(message -> Map.of("role", message.role(), "text", message.text() == null ? "" : message.text()))
                .toList();
        return history.subList(Math.max(0, history.size() - 20), history.size());
    }

    /**
     * 选择主Agent使用的对话历史。
     * <p>
     * 画布前端会将风格分组格式化到请求历史中，优先使用该历史可以保留已选择的图片和视频风格；
     * 其他入口或旧客户端未提交历史时继续使用服务端会话记录。
     *
     * @param request AgentChatRequest 当前对话请求
     * @param session AgentSession 服务端会话
     * @return List<Map<String, String>> 最近对话历史
     */
    private List<Map<String, String>> historyForAgent(AgentChatRequest request, AgentSession session) {
        if (request != null && CreationEntrySource.CANVAS.equals(request.entrySource())
                && request.history() != null && !request.history().isEmpty()) {
            List<Map<String, String>> history = request.history().stream()
                    .filter(message -> message != null
                            && ("user".equals(message.role()) || "assistant".equals(message.role())))
                    .map(message -> Map.of("role", message.role(), "text", message.text() == null ? "" : message.text()))
                    .toList();
            return history.subList(Math.max(0, history.size() - 20), history.size());
        }
        return recentHistory(session);
    }

    /**
     * 保存助手终态消息并推送task-complete事件。
     *
     * @param userId Long 用户ID
     * @param sessionId String 会话ID
     * @param text String 用户可见消息
     * @return Mono<Void> 完成信号
     */
    private Mono<Void> completeWithMessage(Long userId, String sessionId, String text) {
        return completeWithMessage(userId, sessionId, text, null);
    }

    /**
     * 保存助手终态消息并推送task-complete事件，可选携带结构化交互动作。
     *
     * @param userId Long 用户ID
     * @param sessionId String 会话ID
     * @param text String 用户可见消息
     * @param action AgentAction 前端交互动作，可为空
     * @return Mono<Void> 完成信号
     */
    private Mono<Void> completeWithMessage(Long userId, String sessionId, String text, AgentAction action) {
        String messageId = UUID.randomUUID().toString();
        return sessionService.appendAssistantMessage(sessionId, messageId, text)
                .doOnSuccess(ignored -> eventEmitter.emit(userId, AgentEvent.taskComplete(sessionId, messageId, text, action)));
    }

    /**
     * 将本轮修改指令合并到引用历史原文的图片或视频任务提示词。
     * <p>
     * 图片页和视频页的后续消息常是“改为男性”“换成夜景”等修改或补充指令，主Agent按规则引用历史原文，
     * 该指令本身不会进入任务提示词；服务端在此把本轮指令合并到最终提示词，避免修改要求丢失。
     * 编辑任务直接使用本轮指令作为提示词（服务端自动挂载最近一张历史图片作参考图），长原文合并反而会稀释指令；
     * 生成任务的修改指令前置到提示词开头并强调优先级，避免被长原文末尾淹没而被生成模型忽略。
     * 纯重试指令不参与合并；画布工具任务沿用画布自身语义，不在此处理。
     *
     * @param plan CreationPlan 已回填用户原文并校验的计划
     * @param session AgentSession 当前会话
     * @param currentMessage String 当前用户消息
     * @return CreationPlan 合并本轮指令后的计划
     */
    CreationPlan composeFollowUpPrompts(CreationPlan plan, AgentSession session, String currentMessage) {
        if (plan == null || plan.tasks() == null || plan.tasks().isEmpty()
                || !StringUtils.hasText(currentMessage) || isRetryMessage(currentMessage)) {
            return plan;
        }
        Set<String> historyPrompts = new LinkedHashSet<>();
        session.messages().forEach(message -> {
            if ("user".equals(message.role()) && StringUtils.hasText(message.text())
                    && !currentMessage.equals(message.text())) {
                historyPrompts.add(message.text());
            }
        });
        if (historyPrompts.isEmpty()) {
            return plan;
        }
        List<CreationTask> tasks = plan.tasks().stream().map(task -> {
            if (task == null || StringUtils.hasText(task.toolName())) {
                return task;
            }
            // 编辑任务以本轮指令为提示词，参考图由服务端自动注入，且当前指令本身是用户逐字原文。
            if ("edit".equals(task.action())) {
                return new CreationTask(task.taskId(), task.taskType(), task.action(),
                        currentMessage, task.sourcePromptId(), task.dependsOn(),
                        task.toolName(), task.toolArguments());
            }
            if (!historyPrompts.contains(task.prompt())) {
                return task;
            }
            // 修改指令放在提示词最前面并强调优先级，避免被长原文末尾淹没而被生成模型忽略。
            String mergedPrompt = "请优先应用以下修改要求，修改要求与原文冲突时以修改要求为准：\n"
                    + currentMessage + "\n\n原文：\n" + task.prompt();
            return new CreationTask(task.taskId(), task.taskType(), task.action(),
                    mergedPrompt, task.sourcePromptId(), task.dependsOn(),
                    task.toolName(), task.toolArguments());
        }).toList();
        return new CreationPlan(plan.planId(), plan.intent(), plan.entrySource(), plan.summary(),
                plan.clarificationQuestion(), plan.canvasGuidance(), plan.creationSettings(), tasks,
                plan.choices());
    }

    /**
     * 使用服务端生成的计划编号替换模型输出编号。
     *
     * @param plan CreationPlan 已校验计划
     * @param session AgentSession 当前会话
     * @param currentMessage String 当前用户消息
     * @return CreationPlan 带可信计划编号的计划
     * @throws BusinessException 任务提示词不是用户逐字输入时抛出
     */
    CreationPlan withServerPlanId(CreationPlan plan, AgentSession session, String currentMessage) {
        Set<String> userPrompts = new java.util.HashSet<>();
        userPrompts.add(currentMessage);
        session.messages().stream()
                .filter(message -> "user".equals(message.role()) && StringUtils.hasText(message.text()))
                .map(com.novanovastudio.agent.dto.AgentMessage::text)
                .forEach(userPrompts::add);
        java.util.List<com.novanovastudio.agent.dto.CreationTask> tasks = plan.tasks().stream()
                .map(task -> {
                    String taskPrompt = isRetryMessage(currentMessage) && isRetryMessage(task.prompt())
                            ? latestRetryPrompt(session) : task.prompt();
                    if (!userPrompts.contains(taskPrompt)) {
                        taskPrompt = resolveCanvasHistoricalPrompt(plan, task, taskPrompt, userPrompts);
                    }
                    if (!StringUtils.hasText(taskPrompt) || !userPrompts.contains(taskPrompt)) {
                        throw new BusinessException(ErrorCode.PARAM_INVALID, "主Agent任务提示词必须逐字来自用户消息");
                    }
                    return new com.novanovastudio.agent.dto.CreationTask(
                            task.taskId(), task.taskType(), task.action(), taskPrompt, task.dependsOn(),
                            task.toolName(), task.toolArguments());
                })
                .toList();
        return new CreationPlan(UUID.randomUUID().toString(), plan.intent(), plan.entrySource(), plan.summary(), "",
                false, plan.creationSettings(), tasks, List.of());
    }

    /**
     * 恢复画布多轮补参时被主Agent去掉命令前缀的原始提示词。
     * <p>
     * 只接受历史用户消息中明确的图片或视频命令，并且要求主Agent返回值等于命令分隔符后的完整正文，
     * 不接受任意子串、相似文本或模型自行改写的内容。
     *
     * @param plan CreationPlan 已校验计划
     * @param task CreationTask 当前任务
     * @param taskPrompt String 主Agent返回的任务提示词
     * @param userPrompts Set<String> 当前会话中的用户原始消息
     * @return String 恢复后的用户原始消息；无法恢复时返回主Agent原值
     */
    private String resolveCanvasHistoricalPrompt(CreationPlan plan,
                                                  com.novanovastudio.agent.dto.CreationTask task,
                                                  String taskPrompt,
                                                  Set<String> userPrompts) {
        if (!CreationEntrySource.CANVAS.equals(plan.entrySource()) || !StringUtils.hasText(taskPrompt)) {
            return taskPrompt;
        }
        Pattern commandPattern = switch (task.taskType()) {
            case "image" -> CANVAS_IMAGE_COMMAND_PATTERN;
            case "video" -> CANVAS_VIDEO_COMMAND_PATTERN;
            default -> null;
        };
        if (commandPattern == null) return taskPrompt;
        for (String userPrompt : userPrompts) {
            if (!StringUtils.hasText(userPrompt)) continue;
            Matcher matcher = commandPattern.matcher(userPrompt.trim());
            if (matcher.matches() && taskPrompt.equals(matcher.group(1).trim())) {
                return userPrompt;
            }
        }
        return taskPrompt;
    }

    /**
     * 判断用户消息是否为明确的重新生成指令。
     *
     * @param message String 用户消息
     * @return boolean 是否为重试指令
     */
    private boolean isRetryMessage(String message) {
        if (!StringUtils.hasText(message)) {
            return false;
        }
        String normalized = message.trim().replaceAll("[。！!？?，,、\\s]+$", "");
        return Set.of("重试", "再试一次", "重新生成", "再生成一次").contains(normalized);
    }

    /**
     * 获取重试时最近一条非重试用户创作消息。
     *
     * @param session AgentSession 当前会话
     * @return String 最近一次创作提示词；不存在时返回空字符串
     */
    private String latestRetryPrompt(AgentSession session) {
        for (int index = session.messages().size() - 1; index >= 0; index--) {
            com.novanovastudio.agent.dto.AgentMessage message = session.messages().get(index);
            if ("user".equals(message.role()) && StringUtils.hasText(message.text()) && !isRetryMessage(message.text())) {
                return message.text();
            }
        }
        return "";
    }

    /**
     * 校验对话请求基础字段。
     *
     * @param request AgentChatRequest 请求
     * @throws BusinessException 请求不合法时抛出
     */
    private void validateRequest(AgentChatRequest request) {
        if (request == null || !supports(request.entrySource())) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "Agent入口来源不合法");
        }
        if (!StringUtils.hasText(request.message())) {
            throw new BusinessException(ErrorCode.PARAM_MISSING, "用户消息不能为空");
        }
        if (StringUtils.hasText(request.skillId())
                && !"imagePage".equals(request.entrySource()) && !"videoPage".equals(request.entrySource())) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "技能仅支持图片或视频生成页面");
        }
    }

    /**
     * 执行已条件切换为running的主Agent请求。
     *
     * @param queuedRequest CreationAgentRequest 已领取请求
     * @return Mono<Void> 请求执行完成信号
     */
    private Mono<Void> executeRunningRequest(CreationAgentRequest queuedRequest) {
        return requestRepository.findById(queuedRequest.getId())
                .filter(current -> "running".equals(current.getStatus()))
                .flatMap(current -> requestQueue.isCancelRequested(current.getId())
                        .flatMap(cancelRequested -> Boolean.TRUE.equals(cancelRequested)
                                ? finishClaimedRequest(current, "canceled", "已停止生成", null)
                                : executeRunningRequestSnapshot(current)));
    }

    /**
     * 校验已领取请求快照后加载最新会话并执行既有计划链路。
     *
     * @param queuedRequest CreationAgentRequest 当前运行请求
     * @return Mono<Void> 请求执行完成信号
     */
    private Mono<Void> executeRunningRequestSnapshot(CreationAgentRequest queuedRequest) {
        AgentChatRequest request;
        try {
            request = JSON.parseObject(queuedRequest.getRequestData(), AgentChatRequest.class);
        } catch (Exception exception) {
            return finishClaimedRequest(queuedRequest, "failed", "主Agent请求数据无效", exception);
        }
        if (request == null || !queuedRequest.getSessionId().equals(request.sessionId())
                || !queuedRequest.getEntrySource().equals(request.entrySource())) {
            return finishClaimedRequest(queuedRequest, "failed", "主Agent请求数据与持久化记录不一致", null);
        }
        return sessionService.getOrCreateSession(queuedRequest.getUserId(), queuedRequest.getSessionId(), queuedRequest.getEntrySource())
                .flatMap(session -> {
                    if (!queuedRequest.getEntrySource().equals(session.profile())) {
                        return finishClaimedRequest(queuedRequest, "failed", "会话入口来源与请求不一致", null);
                    }
                    ActiveRequestExecution active = new ActiveRequestExecution(queuedRequest.getId(), queuedRequest.getUserId(),
                            session.id(), new AtomicReference<>(), new AtomicReference<>("success"), new AtomicReference<>(""),
                            new AtomicBoolean());
                    executionRegistry.open(queuedRequest.getUserId(), session.id(), registration -> requestRepository
                            .appendTaskId(queuedRequest.getId(), registration.taskId())
                            .then(requestQueue.isCancelRequested(queuedRequest.getId()))
                            .doOnNext(cancelRequested -> {
                                if (Boolean.TRUE.equals(cancelRequested)) {
                                    executionRegistry.requestCancellation(queuedRequest.getUserId(), session.id());
                                }
                            })
                            .then());
                    Disposable subscription = claimedRequestSubscriptions.get(queuedRequest.getId());
                    if (subscription != null) {
                        executionRegistry.attachSubscription(session.id(), subscription);
                    }
                    activeRequests.put(queuedRequest.getId(), active);
                    eventEmitter.bindRequest(session.id(), queuedRequest.getId());
                    return isRequestCancellationRequested(active)
                            .flatMap(canceled -> Boolean.TRUE.equals(canceled)
                                    ? finishClaimedRequest(queuedRequest, "canceled", "已停止生成", null)
                                    : Mono.fromRunnable(() -> eventEmitter.emit(queuedRequest.getUserId(), AgentEvent.queueStatus(
                                                    session.id(), queuedRequest.getId(), "running", "生成中")))
                                            .then(resolveRetryRequest(queuedRequest.getUserId(), session, request))
                                            .flatMap(effectiveRequest -> executeConversation(queuedRequest.getUserId(), session,
                                                    effectiveRequest, active))
                                            .then(isRequestCancellationRequested(active))
                                            .then(finishClaimedRequest(queuedRequest, active.requestStatus(),
                                                    active.completionMessage().get(), null)))
                            .onErrorResume(exception -> finishClaimedRequest(queuedRequest, "failed", errorMessage(exception), exception));
                });
    }

    /**
     * 查询Redis取消标记，并同步到当前实例的会话执行登记。
     *
     * @param active ActiveRequestExecution 当前请求执行上下文
     * @return Mono<Boolean> 是否已请求取消
     */
    private Mono<Boolean> isRequestCancellationRequested(ActiveRequestExecution active) {
        return requestQueue.isCancelRequested(active.requestId())
                .doOnNext(canceled -> {
                    if (Boolean.TRUE.equals(canceled)) {
                        executionRegistry.requestCancellation(active.userId(), active.sessionId());
                    }
                });
    }

    /**
     * 按当前持久化状态精确取消排队或运行中的请求。
     *
     * @param userId Long 用户ID
     * @param request CreationAgentRequest 请求实体
     * @return Mono<Void> 取消完成信号
     */
    private Mono<Void> cancelRequest(Long userId, CreationAgentRequest request) {
        return switch (request.getStatus()) {
            case "queued" -> cancelQueuedRequest(userId, request);
            case "running" -> cancelRunningRequest(userId, request);
            // 请求已进入终态，无需再取消；幂等返回成功，避免前端因竞态停在「生成中」无法解锁。
            default -> Mono.empty();
        };
    }

    /**
     * 取消仍在Redis等待队列中的请求；若领取竞态已发生则转入运行取消。
     *
     * @param userId Long 用户ID
     * @param request CreationAgentRequest 请求实体
     * @return Mono<Void> 取消完成信号
     */
    private Mono<Void> cancelQueuedRequest(Long userId, CreationAgentRequest request) {
        return requestRepository.cancelQueuedIfQueued(userId, request.getId(), "已停止生成")
                .flatMap(canceled -> {
                    if (Boolean.TRUE.equals(canceled)) {
                        return requestQueue.removeQueuedRequest(userId, request.getEntrySource(), request.getId())
                                // Redis 已领取但数据库尚未切为 running 时，取消会先成功写入数据库。
                                // 此时释放该租约，后续请求无需等待领取线程回收。
                                .then(requestQueue.releaseActiveRequest(userId, request.getEntrySource(), request.getId()))
                                .then(Mono.fromRunnable(() -> eventEmitter.emit(userId, AgentEvent.canceled(request.getSessionId(),
                                        "已停止排队").withRequestId(request.getId()))))
                                .then(requestDispatcher.dispatchAvailable(userId, request.getEntrySource()));
                    }
                    return requestRepository.findByIdForUser(userId, request.getId())
                            .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "主Agent请求不存在")))
                            .flatMap(current -> "running".equals(current.getStatus())
                                    ? cancelRunningRequest(userId, current)
                                    : Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "主Agent请求已结束")));
                });
    }

    /**
     * 取消已运行请求，并向领取实例写入Redis取消标记。
     *
     * @param userId Long 用户ID
     * @param request CreationAgentRequest 请求实体
     * @return Mono<Void> 取消完成信号
     */
    private Mono<Void> cancelRunningRequest(Long userId, CreationAgentRequest request) {
        return requestRepository.cancelRunningIfRunning(userId, request.getId(), "已停止生成")
                .filter(Boolean::booleanValue)
                .switchIfEmpty(Mono.empty())
                .then(requestQueue.markCancelRequested(request.getId()))
                .then(stopClaimedExecution(request.getId()))
                .then(requestRepository.findByIdForUser(userId, request.getId()))
                .flatMap(this::cancelPersistedRequestTasks)
                .doOnSuccess(ignored -> eventEmitter.emit(userId, AgentEvent.canceled(request.getSessionId(),
                        "已停止生成").withRequestId(request.getId())));
    }

    /**
     * 取消已持久化到请求记录中的底层任务和关联计划。
     *
     * @param request CreationAgentRequest 请求实体
     * @return Mono<Void> 取消完成信号
     */
    private Mono<Void> cancelPersistedRequestTasks(CreationAgentRequest request) {
        Mono<Void> cancelPlan = StringUtils.hasText(request.getPlanId())
                ? planRepository.cancelPlan(request.getPlanId())
                : Mono.empty();
        return reactor.core.publisher.Flux.fromIterable(requestRepository.taskIds(request))
                .concatMap(taskId -> aiTaskService.cancelTaskForUser(request.getUserId(), taskId)
                        .onErrorResume(exception -> {
                            log.error("取消已持久化主Agent任务失败: requestId={}, taskId={}", request.getId(), taskId, exception);
                            return Mono.empty();
                        }))
                .then(cancelPlan);
    }

    /**
     * 取消中断请求已登记的任务，并将已创建计划标记为失败。
     *
     * @param request CreationAgentRequest 已中断请求
     * @param message String 中断说明
     * @return Mono<Void> 收尾完成信号
     */
    private Mono<Void> interruptPersistedRequest(CreationAgentRequest request, String message) {
        ActiveRequestExecution active = activeRequests.get(request.getId());
        AgentExecutionRegistry.AgentCancellation cancellation = active == null
                ? AgentExecutionRegistry.AgentCancellation.inactive()
                : executionRegistry.requestCancellation(active.userId(), active.sessionId());
        Set<String> taskIds = new LinkedHashSet<>(requestRepository.taskIds(request));
        cancellation.tasks().forEach(task -> taskIds.add(task.taskId()));
        String planId = StringUtils.hasText(request.getPlanId()) ? request.getPlanId()
                : active == null ? "" : active.planId().get();
        return reactor.core.publisher.Flux.fromIterable(taskIds)
                .concatMap(taskId -> aiTaskService.cancelTaskForUser(request.getUserId(), taskId)
                        .onErrorResume(exception -> {
                            log.error("中断主Agent请求时取消底层任务失败: requestId={}, taskId={}", request.getId(), taskId, exception);
                            return Mono.empty();
                        }))
                .then(completePlanForTerminalRequest(request, planId, message))
                .then(Mono.<Void>fromRunnable(() -> eventEmitter.emit(request.getUserId(),
                        AgentEvent.error(request.getSessionId(), message).withRequestId(request.getId()))))
                .doFinally(signal -> {
                    if (active != null) {
                        executionRegistry.disposeWhenReady(active.sessionId());
                    }
                });
    }

    /**
     * 完成已领取请求并清理本实例执行资源。
     *
     * @param request CreationAgentRequest 请求实体
     * @param status String success、failed或canceled
     * @param message String 终态说明
     * @param exception Throwable 原始异常，可为空
     * @return Mono<Void> 收尾完成信号
     */
    private Mono<Void> finishClaimedRequest(CreationAgentRequest request, String status, String message, Throwable exception) {
        ActiveRequestExecution active = activeRequests.get(request.getId());
        String planId = active == null ? request.getPlanId() : active.planId().get();
        boolean cancellationRequested = active != null && executionRegistry.isCancelRequested(active.sessionId());
        String requestedStatus = cancellationRequested ? "canceled" : status;
        String requestedMessage = cancellationRequested ? "已停止生成" : message;
        return requestRepository.finishRunning(request.getId(), requestedStatus, requestedMessage)
                .flatMap(updated -> {
                    if (!Boolean.TRUE.equals(updated)) {
                        return requestRepository.findById(request.getId())
                                .defaultIfEmpty(request)
                                .flatMap(current -> completePlanForTerminalRequest(current, planId, requestedMessage));
                    }
                    return completePlanForStatus(requestedStatus, planId, requestedMessage, request.getId())
                            .then(Mono.fromRunnable(() -> {
                        if (exception != null && !"canceled".equals(requestedStatus)) {
                            log.error("主Agent对话执行失败: requestId={}, sessionId={}, planId={}",
                                    request.getId(), request.getSessionId(), planId, exception);
                        }
                        if ("failed".equals(requestedStatus)) {
                            eventEmitter.emit(request.getUserId(), AgentEvent.error(request.getSessionId(), requestedMessage)
                                    .withRequestId(request.getId()));
                        } else if ("canceled".equals(requestedStatus)) {
                            eventEmitter.emit(request.getUserId(), AgentEvent.canceled(request.getSessionId(), requestedMessage)
                                    .withRequestId(request.getId()));
                        }
                    }));
                });
    }

    /**
     * 根据主Agent请求的持久化终态收敛关联计划，防止旧实例将中断请求错误覆盖为取消。
     *
     * @param request CreationAgentRequest 当前持久化请求
     * @param fallbackPlanId String 本实例已知但尚未回写的计划ID
     * @param fallbackMessage String 请求记录没有说明时使用的终态说明
     * @return Mono<Void> 计划状态收敛完成信号
     */
    Mono<Void> completePlanForTerminalRequest(CreationAgentRequest request, String fallbackPlanId, String fallbackMessage) {
        if (request == null) {
            return Mono.empty();
        }
        String planId = StringUtils.hasText(request.getPlanId()) ? request.getPlanId() : fallbackPlanId;
        String message = StringUtils.hasText(request.getErrorMessage()) ? request.getErrorMessage() : fallbackMessage;
        return completePlanForStatus(request.getStatus(), planId, message, request.getId());
    }

    /**
     * 按请求终态更新关联计划。
     *
     * @param requestStatus String 主Agent请求状态
     * @param planId String 关联计划ID
     * @param message String 终态说明
     * @param requestId String 主Agent请求ID
     * @return Mono<Void> 计划状态更新完成信号
     */
    private Mono<Void> completePlanForStatus(String requestStatus, String planId, String message, String requestId) {
        if (!StringUtils.hasText(planId)) {
            return Mono.empty();
        }
        Mono<Void> completion = switch (requestStatus) {
            case "canceled" -> planRepository.cancelPlan(planId);
            case "failed" -> planRepository.updatePlanStatus(planId, "failed", message);
            case "interrupted" -> planRepository.markInterruptedPlanFailed(planId, message);
            default -> Mono.empty();
        };
        return completion.onErrorResume(exception -> {
            log.error("收敛主Agent请求关联计划失败: requestId={}, planId={}, requestStatus={}",
                    requestId, planId, requestStatus, exception);
            return Mono.empty();
        });
    }

    /**
     * 清理被取消订阅遗留的本实例执行登记。
     *
     * @param requestId String 主Agent请求ID
     */
    private void clearClaimedRequestExecution(String requestId) {
        ActiveRequestExecution active = activeRequests.remove(requestId);
        if (active != null) {
            executionRegistry.complete(active.sessionId());
            eventEmitter.unbindRequest(active.sessionId(), requestId);
        }
    }

    /**
     * 将请求复制为明确携带服务端会话ID的完整快照。
     *
     * @param request AgentChatRequest 原始请求
     * @param sessionId String 服务端会话ID
     * @return AgentChatRequest 完整请求快照
     */
    private AgentChatRequest requestWithSessionId(AgentChatRequest request, String sessionId) {
        return new AgentChatRequest(sessionId, request.entrySource(), request.message(), request.canvasSnapshot(),
                request.references(), request.attachments(), request.history(), request.creationSettings(),
                request.skillId());
    }

    /**
     * 本实例正在执行的主Agent请求上下文。
     *
     * @param requestId String 主Agent请求ID
     * @param userId Long 用户ID
     * @param sessionId String Agent会话ID
     * @param planId AtomicReference<String> 当前创作计划ID
     * @param completionStatus AtomicReference<String> 请求最终状态
     * @param completionMessage AtomicReference<String> 请求最终说明
     */
    private record ActiveRequestExecution(String requestId, Long userId, String sessionId,
                                          AtomicReference<String> planId,
                                          AtomicReference<String> completionStatus,
                                          AtomicReference<String> completionMessage,
                                          AtomicBoolean cancellationHandled) {

        /**
         * 保存计划执行汇总对应的主Agent请求终态。
         *
         * @param planStatus String 计划执行状态
         * @param message String 计划执行说明
         */
        private void setCompletion(String planStatus, String message) {
            completionStatus.set("canceled".equals(planStatus) ? "canceled"
                    : "success".equals(planStatus) ? "success" : "failed");
            completionMessage.set("success".equals(planStatus) ? "" : (message == null ? "" : message));
        }

        /**
         * 获取可持久化的主Agent请求终态。
         *
         * @return String success、failed或canceled
         */
        private String requestStatus() {
            return completionStatus.get();
        }
    }

    /**
     * 提取适合SSE返回的异常消息。
     *
     * @param exception Throwable 异常
     * @return String 异常消息
     */
    private String errorMessage(Throwable exception) {
        return exception instanceof BusinessException && StringUtils.hasText(exception.getMessage())
                ? exception.getMessage()
                : "Agent服务暂不可用，已停止生成";
    }
}
