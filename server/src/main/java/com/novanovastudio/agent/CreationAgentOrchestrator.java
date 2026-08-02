package com.novanovastudio.agent;

import com.alibaba.fastjson2.JSON;
import com.novanovastudio.agent.dto.AgentAction;
import com.novanovastudio.agent.dto.AgentChatRequest;
import com.novanovastudio.agent.dto.AgentEvent;
import com.novanovastudio.agent.dto.CreationPlan;
import com.novanovastudio.agent.dto.CreationSettings;
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
import java.util.Map;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
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
                .flatMap(model -> callMainAgent(userId, session, request, model)
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
