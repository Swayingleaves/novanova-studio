package com.novanovastudio.agent;

import com.alibaba.fastjson2.JSON;
import com.novanovastudio.agent.dto.AgentAction;
import com.novanovastudio.agent.dto.AgentChatRequest;
import com.novanovastudio.agent.dto.AgentEvent;
import com.novanovastudio.agent.dto.CreationPlan;
import com.novanovastudio.agent.dto.CreationSettings;
import com.novanovastudio.agent.dto.CreationTask;
import com.novanovastudio.agent.dto.AgentSession;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.logging.MappedDiagnosticContext;
import com.novanovastudio.service.AiTaskService;
import com.novanovastudio.repository.AgentPlanRepository;
import io.agentscope.core.ReActAgent;
import io.agentscope.core.agent.RuntimeContext;
import io.agentscope.core.model.Model;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Map;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.UUID;
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
import reactor.core.publisher.SignalType;

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
    /** Java固定注册的画布工具 */
    private final AgentToolRegistry toolRegistry;
    /** 由新版编排器管理的活跃会话 */
    private final Set<String> activeSessions = ConcurrentHashMap.newKeySet();
    /** 每个用户当前唯一的活跃主Agent会话 */
    private final Map<Long, String> activeUserSessions = new ConcurrentHashMap<>();
    /** 活跃会话对应的服务端计划ID */
    private final Map<String, String> activePlanIds = new ConcurrentHashMap<>();
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
     * 启动一次主Agent对话并立即返回会话ID。
     *
     * @param userId Long 用户ID
     * @param request AgentChatRequest 对话请求
     * @return Mono<String> 会话ID
     */
    public Mono<String> startChat(Long userId, AgentChatRequest request) {
        validateRequest(request);
        String existingSessionId = activeUserSessions.get(userId);
        if (existingSessionId != null && activeSessions.contains(existingSessionId)) {
            log.warn("用户已有活跃的主Agent计划，忽略重复请求: userId={}, activeSession={}", userId, existingSessionId);
            return Mono.just(existingSessionId);
        }
        // 先清理执行已结束但映射尚未完成同步的旧会话，避免吞掉用户的重试请求。
        if (existingSessionId != null) {
            activeUserSessions.remove(userId, existingSessionId);
        }
        return sessionService.getOrCreateSession(userId, request.sessionId(), request.entrySource())
                .flatMap(session -> {
                    if (!request.entrySource().equals(session.profile())) {
                        return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "会话入口来源与当前页面不一致"));
                    }
                    String concurrentSessionId = activeUserSessions.putIfAbsent(userId, session.id());
                    if (concurrentSessionId != null) {
                        return Mono.just(concurrentSessionId);
                    }
                    executionRegistry.open(userId, session.id());
                    activeSessions.add(session.id());
                    AtomicReference<String> planId = new AtomicReference<>();
                    Map<String, String> inheritedDiagnosticContext = MappedDiagnosticContext.currentValues();
                    Mono<Void> execution = resolveRetryRequest(userId, session, request)
                            .flatMap(effectiveRequest -> executeConversation(userId, session, effectiveRequest, planId))
                            .onErrorResume(exception -> handleExecutionError(userId, session.id(), planId.get(), exception))
                            .doFinally(signal -> finishExecution(planId.get(), signal, userId, session.id()))
                            .contextWrite(context -> MappedDiagnosticContext.put(
                                    MappedDiagnosticContext.put(
                                            MappedDiagnosticContext.putAll(context, inheritedDiagnosticContext),
                                            MappedDiagnosticContext.USER_ID, userId),
                                    MappedDiagnosticContext.SESSION_ID, session.id()));
                    Disposable subscription = execution.subscribe();
                    executionRegistry.attachSubscription(session.id(), subscription);
                    return Mono.just(session.id());
                });
    }

    /**
     * 判断会话是否由新版创作Agent管理。
     *
     * @param sessionId String 会话ID
     * @return boolean 是否活跃
     */
    public boolean isActive(String sessionId) {
        return activeSessions.contains(sessionId);
    }

    /**
     * 停止新版主Agent计划及其全部排队中和运行中的生成任务。
     *
     * @param userId Long 用户ID
     * @param sessionId String 会话ID
     * @return Mono<Void> 取消完成信号
     */
    public Mono<Void> cancelChat(Long userId, String sessionId) {
        AgentExecutionRegistry.AgentCancellation cancellation = executionRegistry.requestCancellation(userId, sessionId);
        if (!cancellation.active() || !activeSessions.contains(sessionId)) {
            return Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "当前会话没有正在执行的生成任务"));
        }
        String planId = activePlanIds.get(sessionId);
        Mono<Void> cancelPlan = StringUtils.hasText(planId) ? planRepository.cancelPlan(planId) : Mono.empty();
        return reactor.core.publisher.Flux.fromIterable(cancellation.tasks())
                .flatMap(task -> aiTaskService.cancelTaskForUser(userId, task.taskId())
                        .onErrorResume(exception -> {
                            log.error("取消主Agent关联任务失败: sessionId={}, taskId={}", sessionId, task.taskId(), exception);
                            return Mono.empty();
                        }))
                .then(cancelPlan)
                .doFinally(signal -> {
                    executionRegistry.disposeWhenReady(sessionId);
                    eventEmitter.emit(userId, AgentEvent.canceled(sessionId, "已停止生成"));
                    log.info("已停止主Agent创作计划: userId={}, sessionId={}, taskCount={}", userId, sessionId, cancellation.tasks().size());
                });
    }

    /**
     * 执行主Agent规划、计划执行和结果汇总。
     *
     * @param userId Long 用户ID
     * @param session AgentSession 会话
     * @param request AgentChatRequest 对话请求
     * @param planId AtomicReference<String> 当前计划编号引用
     * @return Mono<Void> 执行完成信号
     */
    private Mono<Void> executeConversation(Long userId, AgentSession session, AgentChatRequest request,
                                           AtomicReference<String> planId) {
        String userMessageId = UUID.randomUUID().toString();
        return sessionService.appendUserMessage(session.id(), userMessageId, request.message())
                .then(createAndExecutePlan(userId, session, request, planId));
    }

    /**
     * 调用主Agent创建计划并执行。
     *
     * @param userId Long 用户ID
     * @param session AgentSession 会话
     * @param request AgentChatRequest 原始请求
     * @param planId AtomicReference<String> 当前计划编号引用
     * @return Mono<Void> 执行完成信号
     */
    private Mono<Void> createAndExecutePlan(Long userId, AgentSession session, AgentChatRequest request,
                                            AtomicReference<String> planId) {
        return modelFactory.defaultTextModel()
                .flatMap(model -> Mono.justOrEmpty(buildStyleFollowUpPlan(session, request))
                        .switchIfEmpty(Mono.defer(() -> callMainAgent(userId, session, request, model)))
                        .map(candidate -> planValidator.validate(candidate, request.entrySource(), request.creationSettings()))
                        .flatMap(validated -> {
                            if (StringUtils.hasText(validated.clarificationQuestion())) {
                                AgentAction action = Boolean.TRUE.equals(validated.canvasGuidance())
                                        ? AgentAction.navigateToCanvas(request.message())
                                        : null;
                                return completeWithMessage(userId, session.id(), validated.clarificationQuestion(), action);
                            }
                            CreationPlan plan = withServerPlanId(validated, session, request.message());
                            planId.set(plan.planId());
                            activePlanIds.put(session.id(), plan.planId());
                            return planRepository.create(userId, session.id(), plan)
                                    .then(Mono.fromRunnable(() -> eventEmitter.emit(userId,
                                                    AgentEvent.planCreated(session.id(), plan.planId(), plan.summary(), plan.tasks().size()))))
                                    .then(planExecutor.execute(userId, session.id(), plan, request, model)
                                            .contextWrite(context -> MappedDiagnosticContext.put(
                                                    context, MappedDiagnosticContext.PLAN_ID, plan.planId())))
                                    .flatMap(summary -> completeWithMessage(userId, session.id(), summary.message()));
                        }));
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
                        prompt, List.of(), "canvas_run_generation", Map.of("nodeId", nodeId)));
            }
        }
        if (tasks.isEmpty()) return null;
        return new CreationPlan("", "按已选风格重新生成", CreationEntrySource.CANVAS,
                "按已选风格重新生成画布内容", "", false, request.creationSettings(), tasks);
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
                        mergeRetrySettings(request.creationSettings(), historicalSettings)))
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
                current.count(), current.seconds(), current.watermark(), styleIds, historical.generationStyleSnapshots(), styleIdsByType);
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
        ReActAgent agent = agentFactory.mainAgent(model);
        Map<String, Object> input = new java.util.LinkedHashMap<>();
        input.put("entrySource", request.entrySource());
        input.put("message", request.message());
        input.put("history", historyForAgent(request, session));
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
                false, plan.creationSettings(), tasks);
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
    }

    /**
     * 在订阅取消时标记计划取消，并清理执行登记。
     *
     * @param planId String 计划ID
     * @param signal SignalType Reactor终止信号
     * @param userId Long 用户ID
     * @param sessionId String 会话ID
     */
    private void finishExecution(String planId, SignalType signal, Long userId, String sessionId) {
        if (SignalType.CANCEL.equals(signal) && StringUtils.hasText(planId)) {
            planRepository.updatePlanStatus(planId, "canceled", "已停止生成")
                    .subscribe(null, exception -> log.error("更新取消计划状态失败: planId={}", planId, exception));
        }
        executionRegistry.complete(sessionId);
        activeSessions.remove(sessionId);
        activeUserSessions.remove(userId, sessionId);
        activePlanIds.remove(sessionId);
    }

    /**
     * 记录执行异常、关闭计划状态并推送用户可见错误。
     *
     * @param userId Long 用户ID
     * @param sessionId String 会话ID
     * @param planId String 计划ID
     * @param exception Throwable 执行异常
     * @return Mono<Void> 异常收尾信号
     */
    private Mono<Void> handleExecutionError(Long userId, String sessionId, String planId, Throwable exception) {
        log.error("主Agent对话执行失败: sessionId={}, planId={}", sessionId, planId, exception);
        String message = errorMessage(exception);
        eventEmitter.emit(userId, AgentEvent.error(sessionId, message));
        return StringUtils.hasText(planId)
                ? planRepository.updatePlanStatus(planId, "failed", message).onErrorResume(updateException -> {
                    log.error("更新失败计划状态异常: planId={}", planId, updateException);
                    return Mono.empty();
                })
                : Mono.empty();
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
