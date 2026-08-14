package com.novanovastudio.agent;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.ai.AiErrorDetails;
import com.novanovastudio.ai.AiErrorSupport;
import com.novanovastudio.ai.AiProviderException;
import com.novanovastudio.agent.dto.AgentChatRequest;
import com.novanovastudio.agent.dto.AgentEvent;
import com.novanovastudio.agent.dto.CreationPlan;
import com.novanovastudio.agent.dto.CreationRecoveryPlan;
import com.novanovastudio.agent.dto.CreationSettings;
import com.novanovastudio.agent.dto.CreationTask;
import com.novanovastudio.agent.dto.RecoveryNodeFailure;
import com.novanovastudio.agent.dto.RecoveryTaskContext;
import com.novanovastudio.agent.dto.RecoveryTaskDecision;
import com.novanovastudio.agent.dto.SpecialistAgentResult;
import com.novanovastudio.dto.GenerationStyleDtos;
import com.novanovastudio.logging.MappedDiagnosticContext;
import com.novanovastudio.service.PromptOptimizationService;
import com.novanovastudio.service.AiTaskService;
import com.novanovastudio.repository.AgentPlanRepository;
import io.agentscope.core.ReActAgent;
import io.agentscope.core.agent.RuntimeContext;
import io.agentscope.core.model.Model;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.atomic.AtomicReference;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 按任务依赖图执行固定图片和视频子Agent，并复用现有生成任务链路。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-23 00:00
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class CreationPlanExecutor {

    /** 重试时必须复用失败节点的画布生成工具 */
    private static final Set<String> CANVAS_GENERATION_TOOLS = Set.of(
            "canvas_generate_text", "canvas_generate_image", "canvas_generate_video",
            "canvas_create_generation_flow", "canvas_run_generation");

    /** 固定Agent工厂 */
    private final AgentScopeAgentFactory agentFactory;
    /** 提示词优化服务 */
    private final PromptOptimizationService promptOptimizationService;
    /** 计划持久化仓储 */
    private final AgentPlanRepository planRepository;
    /** Agent事件发射器 */
    private final AgentEventEmitter eventEmitter;
    /** Agent会话执行登记 */
    private final AgentExecutionRegistry executionRegistry;
    /** AI任务服务 */
    private final AiTaskService aiTaskService;
    /** 现有画布前端工具执行桥接 */
    private final AgentTaskOrchestrator frontendToolExecutor;
    /** 可复用的现有Profile */
    private final List<AgentLoopProfile> profiles;
    /** 主Agent恢复计划校验器 */
    private final CreationRecoveryPlanValidator recoveryPlanValidator;

    /**
     * 执行完整创作计划。
     *
     * @param userId Long 用户ID
     * @param sessionId String 会话ID
     * @param plan CreationPlan 创作计划
     * @param request AgentChatRequest 原始请求
     * @param model Model 本次计划共享的默认文本模型
     * @return Mono<PlanExecutionSummary> 计划汇总
     */
    public Mono<PlanExecutionSummary> execute(Long userId, String sessionId, CreationPlan plan,
                                              AgentChatRequest request, Model model) {
        Map<String, TaskExecutionResult> completed = new LinkedHashMap<>();
        return planRepository.updateCreationAgentPlanStatus(plan.planId(), "running", "")
                .then(executeLayer(userId, sessionId, plan, request, model, new ArrayList<>(plan.tasks()), completed))
                .map(results -> summarize(plan, results))
                .flatMap(summary -> planRepository.updateCreationAgentPlanStatus(plan.planId(), summary.status(),
                        "success".equals(summary.status()) ? "" : summary.message()).thenReturn(summary));
    }

    /**
     * 执行当前依赖已满足的一层任务，同层任务并行执行。
     *
     * @param userId Long 用户ID
     * @param sessionId String 会话ID
     * @param plan CreationPlan 创作计划
     * @param request AgentChatRequest 原始请求
     * @param model Model 默认文本模型
     * @param remaining List<CreationTask> 未执行任务
     * @param completed Map<String, TaskExecutionResult> 已完成任务
     * @return Mono<List<TaskExecutionResult>> 全部任务结果
     */
    private Mono<List<TaskExecutionResult>> executeLayer(Long userId, String sessionId, CreationPlan plan,
                                                         AgentChatRequest request, Model model,
                                                         List<CreationTask> remaining,
                                                         Map<String, TaskExecutionResult> completed) {
        if (remaining.isEmpty()) {
            return Mono.just(List.copyOf(completed.values()));
        }
        List<CreationTask> ready = remaining.stream()
                .filter(task -> dependencies(task).stream().allMatch(completed::containsKey))
                .toList();
        if (ready.isEmpty()) {
            return Mono.error(new IllegalStateException("创作计划依赖图无法继续执行"));
        }
        return Flux.fromIterable(ready)
                .flatMap(task -> (dependenciesSucceeded(task, completed)
                        ? executeTask(userId, sessionId, plan, request, model, task, dependencyAttachments(task, completed))
                        : skipTask(userId, sessionId, plan.planId(), task))
                        .contextWrite(context -> MappedDiagnosticContext.put(
                                context, MappedDiagnosticContext.PLAN_TASK_ID, task.taskId())), ready.size())
                .collectList()
                .flatMap(layerResults -> recoverLayer(userId, sessionId, plan, request, model,
                        ready, completed, layerResults))
                .flatMap(layerResults -> {
                    for (TaskExecutionResult result : layerResults) {
                        completed.put(result.taskId(), result);
                    }
                    List<CreationTask> next = remaining.stream().filter(task -> !completed.containsKey(task.taskId())).toList();
                    return executeLayer(userId, sessionId, plan, request, model, new ArrayList<>(next), completed);
                });
    }

    /**
     * 将同一依赖层的全部失败任务集中交给主Agent诊断并执行一次受约束恢复。
     *
     * @param userId Long 用户ID
     * @param sessionId String 会话ID
     * @param plan CreationPlan 原计划
     * @param request AgentChatRequest 原始请求
     * @param model Model 默认文本模型
     * @param ready List<CreationTask> 当前依赖层任务
     * @param completed Map<String, TaskExecutionResult> 前置任务结果
     * @param layerResults List<TaskExecutionResult> 当前层首次执行结果
     * @return Mono<List<TaskExecutionResult>> 合并恢复结果后的当前层结果
     */
    private Mono<List<TaskExecutionResult>> recoverLayer(Long userId, String sessionId, CreationPlan plan,
                                                         AgentChatRequest request, Model model,
                                                         List<CreationTask> ready,
                                                         Map<String, TaskExecutionResult> completed,
                                                         List<TaskExecutionResult> layerResults) {
        if (executionRegistry.isCancelRequested(sessionId)) return Mono.just(layerResults);
        List<RecoveryTaskContext> contexts = layerResults.stream()
                .filter(result -> "failed".equals(result.status()) && result.recoveryAttempt() == 0)
                .map(result -> recoveryContext(plan, ready, result))
                .toList();
        if (contexts.isEmpty()) return Mono.just(layerResults);

        contexts.forEach(context -> emit(userId, AgentEvent.planTaskStatus(sessionId, plan.planId(),
                context.taskId(), "diagnosing", "主Agent正在诊断失败原因")));
        return callRecoveryAgent(userId, sessionId, plan, request, model, contexts)
                .map(candidate -> recoveryPlanValidator.validate(candidate, plan, contexts))
                .flatMap(recoveryPlan -> applyRecoveryPlan(userId, sessionId, plan, request, ready,
                        completed, layerResults, recoveryPlan))
                .onErrorResume(exception -> {
                    log.error("主Agent恢复诊断失败，保留首次执行结果: planId={}", plan.planId(), exception);
                    layerResults.stream().filter(result -> "failed".equals(result.status())).forEach(result ->
                            emit(userId, AgentEvent.planTaskStatus(sessionId, plan.planId(), result.taskId(),
                                    "failed", result.message())));
                    return Mono.just(layerResults);
                });
    }

    /**
     * 调用主Agent恢复模式生成结构化恢复计划。
     *
     * @param userId Long 用户ID
     * @param sessionId String 会话ID
     * @param plan CreationPlan 原计划
     * @param request AgentChatRequest 原始请求
     * @param model Model 默认文本模型
     * @param contexts List<RecoveryTaskContext> 当前层失败上下文
     * @return Mono<CreationRecoveryPlan> 候选恢复计划
     */
    private Mono<CreationRecoveryPlan> callRecoveryAgent(Long userId, String sessionId, CreationPlan plan,
                                                         AgentChatRequest request, Model model,
                                                         List<RecoveryTaskContext> contexts) {
        Map<String, Object> input = new LinkedHashMap<>();
        input.put("originalMessage", request.message());
        input.put("entrySource", plan.entrySource());
        input.put("immutableCreationSettings", plan.creationSettings());
        input.put("immutableAttachments", attachmentConstraints(request.attachments()));
        input.put("originalPlan", plan);
        input.put("failures", contexts);
        return Mono.defer(() -> {
            ReActAgent agent = agentFactory.recoveryAgent(model);
            return agent.call(JSON.toJSONString(input), CreationRecoveryPlan.class, RuntimeContext.builder()
                            .sessionId(sessionId + ":recovery:" + plan.planId())
                            .userId(String.valueOf(userId))
                            .put(AgentThinkingEventMiddleware.ThinkingEventContext.class,
                                    new AgentThinkingEventMiddleware.ThinkingEventContext(userId, sessionId))
                            .build())
                    .timeout(Duration.ofSeconds(60))
                    .map(message -> message.getStructuredData(CreationRecoveryPlan.class))
                    .doFinally(signal -> agent.close());
        });
    }

    /**
     * 生成不包含URL和存储键的附件约束摘要。
     *
     * @param attachments List<Attachment> 用户附件
     * @return List<Map<String, Object>> 安全附件摘要
     */
    private List<Map<String, Object>> attachmentConstraints(List<AgentChatRequest.Attachment> attachments) {
        if (attachments == null || attachments.isEmpty()) return List.of();
        return attachments.stream().map(attachment -> Map.<String, Object>of(
                "name", StringUtils.hasText(attachment.name()) ? attachment.name() : "未命名附件",
                "type", StringUtils.hasText(attachment.type()) ? attachment.type() : "未知类型",
                "stored", StringUtils.hasText(attachment.storageKey()))).toList();
    }

    /**
     * 按校验后的恢复计划处理当前层任务。
     *
     * @param userId Long 用户ID
     * @param sessionId String 会话ID
     * @param plan CreationPlan 原计划
     * @param request AgentChatRequest 原始请求
     * @param ready List<CreationTask> 当前层任务
     * @param completed Map<String, TaskExecutionResult> 前置任务结果
     * @param layerResults List<TaskExecutionResult> 首次执行结果
     * @param recoveryPlan CreationRecoveryPlan 已校验恢复计划
     * @return Mono<List<TaskExecutionResult>> 恢复后的当前层结果
     */
    private Mono<List<TaskExecutionResult>> applyRecoveryPlan(Long userId, String sessionId, CreationPlan plan,
                                                              AgentChatRequest request, List<CreationTask> ready,
                                                              Map<String, TaskExecutionResult> completed,
                                                              List<TaskExecutionResult> layerResults,
                                                              CreationRecoveryPlan recoveryPlan) {
        Map<String, CreationTask> taskById = new LinkedHashMap<>();
        ready.forEach(task -> taskById.put(task.taskId(), task));
        Map<String, RecoveryTaskDecision> decisionByTaskId = new LinkedHashMap<>();
        recoveryPlan.decisions().forEach(decision -> decisionByTaskId.put(decision.taskId(), decision));
        // 仅对将要重试的任务展示诊断状态；STOP/ASK_USER 决策直接发失败终态，
        // 避免 diagnosing 与 failed 事件乱序到达前端，导致活动状态从终态回退为执行中。
        recoveryPlan.decisions().stream()
                .filter(decision -> !"ASK_USER".equals(decision.action()) && !"STOP".equals(decision.action()))
                .forEach(decision -> emit(userId, AgentEvent.planTaskStatus(
                        sessionId, plan.planId(), decision.taskId(), "diagnosing", recoveryPlan.message())));
        return Flux.fromIterable(layerResults)
                .flatMapSequential(result -> {
                    RecoveryTaskDecision decision = decisionByTaskId.get(result.taskId());
                    if (decision == null) return Mono.just(result);
                    if ("ASK_USER".equals(decision.action()) || "STOP".equals(decision.action())) {
                        return finishRecoveryWithoutRetry(userId, sessionId, plan, result, decision);
                    }
                    CreationTask task = taskById.get(result.taskId());
                    return retryTask(userId, sessionId, plan, request, task,
                            dependencyAttachments(task, completed), result, decision);
                })
                .collectList();
    }

    /**
     * 保存主Agent询问用户或停止执行的恢复结论。
     *
     * @param userId Long 用户ID
     * @param sessionId String 会话ID
     * @param plan CreationPlan 原计划
     * @param result TaskExecutionResult 首次失败结果
     * @param decision RecoveryTaskDecision 恢复决策
     * @return Mono<TaskExecutionResult> 带恢复审计的失败结果
     */
    private Mono<TaskExecutionResult> finishRecoveryWithoutRetry(Long userId, String sessionId, CreationPlan plan,
                                                                 TaskExecutionResult result,
                                                                 RecoveryTaskDecision decision) {
        Map<String, Object> data = recoveryData(result.data(), Map.of(), result, null, decision);
        emit(userId, AgentEvent.planTaskStatus(sessionId, plan.planId(), result.taskId(), "failed", decision.reason()));
        return planRepository.updateTask(plan.planId(), result.taskId(), "failed", result.promptStrategy(),
                        result.actualPrompt(), data, decision.reason())
                .thenReturn(new TaskExecutionResult(result.taskId(), "failed", decision.reason(), data,
                        result.promptStrategy(), result.actualPrompt(), result.toolArguments(), result.error(), 1));
    }

    /**
     * 使用主Agent校验后的提示词或参数执行一次重试。
     *
     * @param userId Long 用户ID
     * @param sessionId String 会话ID
     * @param plan CreationPlan 原计划
     * @param request AgentChatRequest 原始请求
     * @param task CreationTask 原计划任务
     * @param dependencyAttachments List<Attachment> 前置任务媒体
     * @param firstResult TaskExecutionResult 首次失败结果
     * @param decision RecoveryTaskDecision 恢复决策
     * @return Mono<TaskExecutionResult> 重试终态结果
     */
    private Mono<TaskExecutionResult> retryTask(Long userId, String sessionId, CreationPlan plan,
                                                AgentChatRequest request, CreationTask task,
                                                List<AgentChatRequest.Attachment> dependencyAttachments,
                                                TaskExecutionResult firstResult,
                                                RecoveryTaskDecision decision) {
        if (executionRegistry.isCancelRequested(sessionId)) {
            return canceledTask(userId, sessionId, plan.planId(), task);
        }
        String prompt = StringUtils.hasText(decision.adjustedPrompt())
                ? decision.adjustedPrompt() : firstResult.actualPrompt();
        Map<String, Object> arguments = new LinkedHashMap<>(firstResult.toolArguments());
        arguments.putAll(decision.adjustedToolArguments() == null ? Map.of() : decision.adjustedToolArguments());
        if (!"canvas".equals(task.taskType()) || StringUtils.hasText(decision.adjustedPrompt())) {
            arguments.put("prompt", prompt);
        }
        if (!decision.nodeIds().isEmpty()) arguments.put("recoveryNodeIds", decision.nodeIds());
        String preparingStatus = "ADJUST_AND_RETRY".equals(decision.action()) ? "adjusting" : "retrying";
        emit(userId, AgentEvent.planTaskStatus(sessionId, plan.planId(), task.taskId(), preparingStatus, decision.reason()));
        emit(userId, AgentEvent.planTaskStatus(sessionId, plan.planId(), task.taskId(), "retrying", "正在执行唯一一次恢复重试"));

        Mono<TaskExecutionResult> execution;
        if (CreationEntrySource.CANVAS.equals(plan.entrySource())) {
            execution = executeCanvasTool(userId, sessionId, plan, task, firstResult.promptStrategy(), prompt, arguments, 1);
        } else {
            List<AgentChatRequest.Attachment> attachments = new ArrayList<>(
                    request.attachments() == null ? List.of() : request.attachments());
            attachments.addAll(dependencyAttachments);
            execution = executeGenerationTool(userId, sessionId, plan, request, task,
                    firstResult.promptStrategy(), prompt, arguments, attachments, 1);
        }
        return planRepository.updateTask(plan.planId(), task.taskId(), "running", firstResult.promptStrategy(),
                        prompt, firstResult.data(), "")
                .then(execution)
                .onErrorResume(exception -> executionRegistry.isCancelRequested(sessionId)
                        ? canceledTask(userId, sessionId, plan.planId(), task)
                        : failedRetryTask(userId, sessionId, plan, task,
                                firstResult.promptStrategy(), prompt, arguments, exception))
                .flatMap(retryResult -> persistRecoveryAudit(plan, firstResult, retryResult, decision));
    }

    /**
     * 将重试过程中的异常转换为最终失败结果。
     *
     * @param userId Long 用户ID
     * @param sessionId String 会话ID
     * @param plan CreationPlan 原计划
     * @param task CreationTask 原任务
     * @param promptStrategy String 提示词策略
     * @param prompt String 重试提示词
     * @param arguments Map<String, Object> 重试参数
     * @param exception Throwable 重试异常
     * @return Mono<TaskExecutionResult> 重试失败结果
     */
    private Mono<TaskExecutionResult> failedRetryTask(Long userId, String sessionId, CreationPlan plan,
                                                      CreationTask task, String promptStrategy, String prompt,
                                                      Map<String, Object> arguments, Throwable exception) {
        AiErrorDetails error = AiErrorSupport.fromThrowable(exception, "agent", "agent");
        Map<String, Object> data = AiErrorSupport.errorData(error);
        log.error("Agent恢复重试失败: planId={}, taskId={}", plan.planId(), task.taskId(), exception);
        emit(userId, AgentEvent.planTaskStatus(sessionId, plan.planId(), task.taskId(), "failed", error.message()));
        return Mono.just(new TaskExecutionResult(task.taskId(), "failed", error.message(), data,
                promptStrategy, prompt, new LinkedHashMap<>(arguments), error, 1));
    }

    /**
     * 保存恢复重试审计信息并返回最终结果。
     *
     * @param plan CreationPlan 原计划
     * @param firstResult TaskExecutionResult 首次失败结果
     * @param retryResult TaskExecutionResult 重试结果
     * @param decision RecoveryTaskDecision 恢复决策
     * @return Mono<TaskExecutionResult> 带恢复审计的最终结果
     */
    private Mono<TaskExecutionResult> persistRecoveryAudit(CreationPlan plan, TaskExecutionResult firstResult,
                                                           TaskExecutionResult retryResult,
                                                           RecoveryTaskDecision decision) {
        Map<String, Object> data = recoveryData(firstResult.data(), retryResult.data(), firstResult, retryResult,
                decision);
        TaskExecutionResult audited = new TaskExecutionResult(retryResult.taskId(), retryResult.status(),
                retryResult.message(), data, retryResult.promptStrategy(), retryResult.actualPrompt(),
                retryResult.toolArguments(), retryResult.error(), 1);
        return planRepository.updateTask(plan.planId(), audited.taskId(), audited.status(), audited.promptStrategy(),
                        audited.actualPrompt(), audited.data(), "success".equals(audited.status()) ? "" : audited.message())
                .thenReturn(audited);
    }

    /**
     * 合并最终工具结果与一次恢复审计信息。
     *
     * @param firstData Map<String, Object> 首次结果数据
     * @param retryData Map<String, Object> 重试结果数据
     * @param firstResult TaskExecutionResult 首次失败结果
     * @param retryResult TaskExecutionResult 重试结果，未重试时为null
     * @param decision RecoveryTaskDecision 恢复决策
     * @return Map<String, Object> 最终结果数据
     */
    private Map<String, Object> recoveryData(Map<String, Object> firstData, Map<String, Object> retryData,
                                             TaskExecutionResult firstResult, TaskExecutionResult retryResult,
                                             RecoveryTaskDecision decision) {
        Map<String, Object> data = new LinkedHashMap<>(retryData == null || retryData.isEmpty()
                ? firstData == null ? Map.of() : firstData : retryData);
        mergeCanvasRecoveryData(data, firstData, retryData, decision.nodeIds());
        Map<String, Object> recovery = new LinkedHashMap<>();
        recovery.put("recoveryAttempt", 1);
        recovery.put("action", decision.action());
        recovery.put("reason", decision.reason());
        List<String> adjustedFields = new ArrayList<>();
        if (StringUtils.hasText(decision.adjustedPrompt())) adjustedFields.add("prompt");
        if (decision.adjustedToolArguments() != null) adjustedFields.addAll(decision.adjustedToolArguments().keySet());
        recovery.put("adjustedFields", adjustedFields);
        if (firstResult.error() != null) recovery.put("originalError", firstResult.error().toMap());
        AiErrorDetails retryError = retryResult == null ? null : retryResult.error();
        if (retryError == null) {
            retryError = AiErrorSupport.fromData(retryData == null ? null : retryData.get("error"));
        }
        if (retryError != null) recovery.put("retryError", retryError.toMap());
        String originalTaskId = stringValue(firstResult.data().get("taskId"));
        String retryTaskId = stringValue(retryData == null ? null : retryData.get("taskId"));
        if (StringUtils.hasText(originalTaskId)) recovery.put("originalTaskId", originalTaskId);
        if (StringUtils.hasText(retryTaskId)) recovery.put("retryTaskId", retryTaskId);
        if (decision.nodeIds() != null && !decision.nodeIds().isEmpty()) recovery.put("nodeIds", decision.nodeIds());
        data.put("recovery", recovery);
        return data;
    }

    /**
     * 合并画布首次成功节点与重试节点终态，避免覆盖未参与重试的结果。
     *
     * @param target Map<String, Object> 最终结果容器
     * @param firstData Map<String, Object> 首次工具结果
     * @param retryData Map<String, Object> 重试工具结果
     * @param retriedNodeIds List<String> 本次重试节点编号
     */
    private void mergeCanvasRecoveryData(Map<String, Object> target, Map<String, Object> firstData,
                                         Map<String, Object> retryData, List<String> retriedNodeIds) {
        if ((firstData == null || !firstData.containsKey("failures"))
                && (retryData == null || !retryData.containsKey("failures"))) return;
        Set<String> successfulNodeIds = new java.util.LinkedHashSet<>(
                stringList(firstData == null ? null : firstData.get("successfulNodeIds")));
        successfulNodeIds.addAll(stringList(retryData == null ? null : retryData.get("successfulNodeIds")));
        target.put("successfulNodeIds", List.copyOf(successfulNodeIds));

        boolean hasRetryNodeOutcome = retryData != null
                && (retryData.containsKey("successfulNodeIds") || retryData.containsKey("failures"));
        Set<String> retryTargets = hasRetryNodeOutcome
                ? new HashSet<>(retriedNodeIds == null ? List.of() : retriedNodeIds) : Set.of();
        List<Object> failures = new ArrayList<>();
        Object firstFailuresValue = firstData == null ? null : firstData.get("failures");
        if (firstFailuresValue instanceof List<?> firstFailures) {
            for (Object failureValue : firstFailures) {
                JSONObject failure = JSON.parseObject(JSON.toJSONString(failureValue));
                if (failure != null && !retryTargets.contains(failure.getString("nodeId"))) failures.add(failureValue);
            }
        }
        Object retryFailuresValue = retryData == null ? null : retryData.get("failures");
        if (retryFailuresValue instanceof List<?> retryFailures) failures.addAll(retryFailures);
        target.put("failures", List.copyOf(failures));
    }

    /**
     * 将首次失败结果转换为主Agent恢复上下文。
     *
     * @param plan CreationPlan 原计划
     * @param ready List<CreationTask> 当前层任务
     * @param result TaskExecutionResult 首次失败结果
     * @return RecoveryTaskContext 恢复上下文
     */
    private RecoveryTaskContext recoveryContext(CreationPlan plan, List<CreationTask> ready,
                                                TaskExecutionResult result) {
        CreationTask task = ready.stream().filter(candidate -> candidate.taskId().equals(result.taskId()))
                .findFirst().orElseThrow();
        List<RecoveryNodeFailure> nodeFailures = nodeFailures(result.data());
        List<String> failedNodeIds = nodeFailures.stream().map(RecoveryNodeFailure::nodeId).toList();
        List<String> successfulNodeIds = stringList(result.data().get("successfulNodeIds"));
        Set<String> agentGeneratedArguments = agentGeneratedArguments(plan, task);
        Map<String, String> argumentSources = argumentSources(plan, task, result.toolArguments(),
                agentGeneratedArguments);
        return new RecoveryTaskContext(task.taskId(), task.taskType(), task.action(), task.toolName(),
                result.actualPrompt(), result.toolArguments(), argumentSources, agentGeneratedArguments,
                failedNodeIds, successfulNodeIds, nodeFailures, result.error(),
                allowedRecoveryActions(result.error(), agentGeneratedArguments, argumentSources,
                        !CANVAS_GENERATION_TOOLS.contains(task.toolName()) || !failedNodeIds.isEmpty()),
                result.recoveryAttempt());
    }

    /**
     * 标记实际工具参数的来源，供主Agent识别不可变用户约束。
     *
     * @param plan CreationPlan 原计划
     * @param task CreationTask 当前任务
     * @param arguments Map<String, Object> 实际工具参数
     * @param agentGeneratedArguments Set<String> Agent生成参数
     * @return Map<String, String> 参数来源
     */
    private Map<String, String> argumentSources(CreationPlan plan, CreationTask task, Map<String, Object> arguments,
                                                Set<String> agentGeneratedArguments) {
        Map<String, String> sources = new LinkedHashMap<>();
        boolean existingCanvasNode = CreationEntrySource.CANVAS.equals(plan.entrySource())
                && "canvas_run_generation".equals(task.toolName());
        for (String name : arguments.keySet()) {
            if (existingCanvasNode) {
                sources.put(name, "用户硬约束");
            } else if ("prompt".equals(name) || agentGeneratedArguments.contains(name)) {
                sources.put(name, "Agent生成");
            } else if (!CreationEntrySource.CANVAS.equals(plan.entrySource())) {
                sources.put(name, "用户硬约束");
            } else {
                sources.put(name, "系统默认");
            }
        }
        return Map.copyOf(sources);
    }

    /**
     * 根据结构化错误和参数权限计算主Agent候选动作。
     *
     * @param error AiErrorDetails 结构化错误
     * @param agentGeneratedArguments Set<String> Agent生成参数
     * @param argumentSources Map<String, String> 参数来源
     * @param retryTargetAvailable boolean 是否存在可安全复用的重试目标
     * @return List<String> 允许动作
     */
    private List<String> allowedRecoveryActions(AiErrorDetails error, Set<String> agentGeneratedArguments,
                                                Map<String, String> argumentSources, boolean retryTargetAvailable) {
        if (error == null) return List.of("STOP");
        if (Set.of("polling", "download").contains(error.stage())) return List.of("STOP");
        List<String> actions = new ArrayList<>();
        if (retryTargetAvailable && Boolean.TRUE.equals(error.safeToRetry())) {
            boolean promptError = "prompt_policy_violation".equals(error.category())
                    || ("invalid_parameter".equals(error.category()) && "prompt".equals(error.parameter()));
            promptError = promptError && !"用户硬约束".equals(argumentSources.get("prompt"));
            boolean adjustableParameter = "invalid_parameter".equals(error.category())
                    && StringUtils.hasText(error.parameter()) && agentGeneratedArguments.contains(error.parameter());
            if (promptError || adjustableParameter) actions.add("ADJUST_AND_RETRY");
            if (canRetryUnchanged(error)) actions.add("RETRY_UNCHANGED");
        }
        if (Set.of("prompt_policy_violation", "invalid_parameter", "unsupported_capability", "authentication",
                "permission", "quota", "configuration", "rate_limited", "provider_unavailable")
                .contains(error.category())) actions.add("ASK_USER");
        actions.add("STOP");
        return List.copyOf(actions);
    }

    /**
     * 判断供应商错误是否明确满足原样重试条件。
     *
     * @param error AiErrorDetails 结构化错误
     * @return boolean 是否为提交阶段明确未受理的429或5xx错误
     */
    private boolean canRetryUnchanged(AiErrorDetails error) {
        if (error == null || !"submission".equals(error.stage())
                || !Boolean.FALSE.equals(error.requestAccepted()) || error.httpStatus() == null) {
            return false;
        }
        return ("rate_limited".equals(error.category()) && error.httpStatus() == 429)
                || ("provider_unavailable".equals(error.category()) && error.httpStatus() >= 500);
    }

    /**
     * 计算当前任务允许主Agent自动调整的参数名。
     *
     * @param plan CreationPlan 原计划
     * @param task CreationTask 当前任务
     * @return Set<String> Agent生成参数名
     */
    private Set<String> agentGeneratedArguments(CreationPlan plan, CreationTask task) {
        if (!CreationEntrySource.CANVAS.equals(plan.entrySource())
                || !("canvas_generate_image".equals(task.toolName())
                || "canvas_generate_video".equals(task.toolName())
                || "canvas_create_generation_flow".equals(task.toolName()))) {
            return Set.of();
        }
        Set<String> adjustable = Set.of("size", "quality", "imageResolution", "seconds", "vquality");
        Set<String> result = new HashSet<>(task.toolArguments() == null ? Set.of() : task.toolArguments().keySet());
        result.retainAll(adjustable);
        return Set.copyOf(result);
    }

    /**
     * 从画布工具结果中读取失败节点编号。
     *
     * @param data Map<String, Object> 工具结果
     * @return List<RecoveryNodeFailure> 逐节点失败详情
     */
    private List<RecoveryNodeFailure> nodeFailures(Map<String, Object> data) {
        Object failuresValue = data == null ? null : data.get("failures");
        if (!(failuresValue instanceof List<?> failures)) return List.of();
        List<RecoveryNodeFailure> result = new ArrayList<>();
        for (Object failureValue : failures) {
            JSONObject failure = JSON.parseObject(JSON.toJSONString(failureValue));
            if (failure != null && StringUtils.hasText(failure.getString("nodeId"))) {
                AiErrorDetails error = AiErrorSupport.fromData(failure.get("error"));
                if (error == null) {
                    error = new AiErrorDetails("canvas", "unknown", "frontend_tool", null, null, null,
                            null, "画布节点生成失败", true, false);
                }
                result.add(new RecoveryNodeFailure(failure.getString("nodeId"), error));
            }
        }
        return List.copyOf(result);
    }

    /**
     * 将未知列表值转换为字符串列表。
     *
     * @param value Object 原始值
     * @return List<String> 字符串列表
     */
    private List<String> stringList(Object value) {
        if (!(value instanceof List<?> values)) return List.of();
        return values.stream().map(String::valueOf).filter(StringUtils::hasText).toList();
    }

    /**
     * 将未知值转换为字符串。
     *
     * @param value Object 原始值
     * @return String 字符串
     */
    private String stringValue(Object value) {
        return value == null ? "" : String.valueOf(value);
    }

    /**
     * 执行单个子Agent任务。
     *
     * @param userId Long 用户ID
     * @param sessionId String 会话ID
     * @param plan CreationPlan 创作计划
     * @param request AgentChatRequest 原始请求
     * @param model Model 默认文本模型
     * @param task CreationTask 计划任务
     * @param dependencyAttachments List<Attachment> 依赖任务生成的媒体
     * @return Mono<TaskExecutionResult> 子任务结果
     */
    private Mono<TaskExecutionResult> executeTask(Long userId, String sessionId, CreationPlan plan,
                                                  AgentChatRequest request, Model model, CreationTask task,
                                                  List<AgentChatRequest.Attachment> dependencyAttachments) {
        if (executionRegistry.isCancelRequested(sessionId)) {
            return canceledTask(userId, sessionId, plan.planId(), task);
        }
        emit(userId, AgentEvent.planTaskStatus(sessionId, plan.planId(), task.taskId(), "running", "子Agent正在准备任务"));
        return planRepository.updateTask(plan.planId(), task.taskId(), "running", "", "", null, "")
                .then(Mono.defer(() -> "canvas".equals(task.taskType())
                        ? executeCanvasTask(userId, sessionId, plan, task)
                        : promptOptimizationService.resolveStyles(task.taskType(),
                                plan.creationSettings() == null ? List.of() : plan.creationSettings().generationStyleIds(),
                                plan.creationSettings() == null ? List.of() : plan.creationSettings().generationStyleSnapshots())
                        .onErrorMap(this::agentExecutionFailure)
                        .flatMap(styles -> callSpecialist(userId, sessionId, model, task, task.prompt())
                                .onErrorMap(this::agentExecutionFailure)
                                .flatMap(decision -> preparePrompt(userId, sessionId, task.taskType(), task.prompt(), decision, styles)
                                        .onErrorMap(this::agentExecutionFailure)
                                        .flatMap(finalPrompt -> {
                                            emit(userId, AgentEvent.promptPrepared(sessionId, plan.planId(), task.taskId(), styles.isEmpty() ? decision.promptStrategy() : "OPTIMIZE"));
                                            return executePreparedTask(userId, sessionId, plan, request, task, decision,
                                                    finalPrompt, styles, dependencyAttachments);
                                        })))))
                .onErrorResume(exception -> executionRegistry.isCancelRequested(sessionId)
                        ? canceledTask(userId, sessionId, plan.planId(), task)
                        : failedTask(userId, sessionId, plan.planId(), task, exception));
    }

    /**
     * 将子Agent、风格解析和提示词优化阶段的异常标记为Agent内部错误。
     * <p>
     * 该阶段尚未提交生成任务，不能直接复用生成工具参数进行自动恢复。
     *
     * @param exception Throwable 原始异常
     * @return Throwable 携带安全结构化详情的异常
     */
    private Throwable agentExecutionFailure(Throwable exception) {
        AiErrorDetails original = AiErrorSupport.fromThrowable(exception, "agent", "agent");
        return new AiProviderException(new AiErrorDetails("agent", original.category(), "agent",
                original.httpStatus(), original.code(), original.type(), original.parameter(), original.message(),
                true, false));
    }

    /**
     * 将普通画布工具转发前端执行。
     *
     * @param userId Long 用户ID
     * @param sessionId String 会话ID
     * @param plan CreationPlan 创作计划
     * @param task CreationTask 画布任务
     * @return Mono<TaskExecutionResult> 画布任务结果
     */
    private Mono<TaskExecutionResult> executeCanvasTask(Long userId, String sessionId, CreationPlan plan,
                                                         CreationTask task) {
        return executeCanvasTool(userId, sessionId, plan, task, "KEEP", task.prompt(), task.toolArguments(), 0);
    }

    /**
     * 按入口来源执行后端生成工具或画布前端生成工具。
     *
     * @param userId Long 用户ID
     * @param sessionId String 会话ID
     * @param plan CreationPlan 创作计划
     * @param request AgentChatRequest 原始请求
     * @param task CreationTask 计划任务
     * @param decision SpecialistAgentResult 子Agent提示词决策
     * @param finalPrompt String 最终提示词
     * @param styles List<GenerationStyleSnapshot> 已解析的风格快照
     * @param dependencyAttachments List<Attachment> 依赖任务生成的媒体
     * @return Mono<TaskExecutionResult> 任务结果
     */
    private Mono<TaskExecutionResult> executePreparedTask(Long userId, String sessionId, CreationPlan plan,
                                                           AgentChatRequest request, CreationTask task,
                                                           SpecialistAgentResult decision, String finalPrompt,
                                                           List<GenerationStyleDtos.GenerationStyleSnapshot> styles,
                                                           List<AgentChatRequest.Attachment> dependencyAttachments) {
        if (CreationEntrySource.CANVAS.equals(plan.entrySource())) {
            return executeCanvasTool(userId, sessionId, plan, task, decision.promptStrategy(),
                    finalPrompt, task.toolArguments(), 0);
        }
        return executeGeneration(userId, sessionId, plan, request, task, decision, finalPrompt, styles, dependencyAttachments);
    }

    /**
     * 调用固定图片或视频子Agent选择提示词策略。
     *
     * @param userId Long 用户ID
     * @param sessionId String 会话ID
     * @param model Model 默认文本模型
     * @param task CreationTask 计划任务
     * @param originalPrompt String 用户原文
     * @return Mono<SpecialistAgentResult> 子Agent结构化结果
     */
    private Mono<SpecialistAgentResult> callSpecialist(Long userId, String sessionId, Model model,
                                                       CreationTask task, String originalPrompt) {
        ReActAgent agent = "image".equals(task.taskType()) ? agentFactory.imageAgent(model) : agentFactory.videoAgent(model);
        String input = JSON.toJSONString(Map.of(
                "taskId", task.taskId(),
                "taskType", task.taskType(),
                "action", task.action(),
                "originalPrompt", originalPrompt));
        return agent.call(input, SpecialistAgentResult.class, RuntimeContext.builder()
                        .sessionId(sessionId + ":" + task.taskId()).userId(String.valueOf(userId)).build())
                .timeout(Duration.ofSeconds(60))
                .map(message -> validateSpecialistResult(task, message.getStructuredData(SpecialistAgentResult.class)))
                .doFinally(signal -> agent.close());
    }

    /**
     * 按子Agent策略准备最终提示词。
     *
     * @param userId Long 用户ID
     * @param sessionId String 会话ID
     * @param taskType String 任务类型
     * @param originalPrompt String 用户原文
     * @param decision SpecialistAgentResult 子Agent决策
     * @param styles List<GenerationStyleSnapshot> 已解析的风格快照
     * @return Mono<String> 最终提示词
     */
    private Mono<String> preparePrompt(Long userId, String sessionId, String taskType, String originalPrompt,
                                       SpecialistAgentResult decision,
                                       List<GenerationStyleDtos.GenerationStyleSnapshot> styles) {
        if (styles.isEmpty() && "KEEP".equals(decision.promptStrategy())) {
            return Mono.just(originalPrompt);
        }
        AtomicReference<String> optimizationTaskId = new AtomicReference<>();
        return Mono.defer(() -> {
                    executionRegistry.beginTaskCreation(sessionId);
                    return promptOptimizationService.optimizeAndWait(userId, taskType, originalPrompt, styles, response -> {
                        optimizationTaskId.set(response.id());
                        return executionRegistry.registerTaskAndPersist(sessionId,
                                        new AgentExecutionRegistry.AgentTaskRegistration(response.id(), "", "", null))
                                .flatMap(canceled -> canceled ? aiTaskService.cancelTaskForUser(userId, response.id()).then() : Mono.empty());
                    });
                })
                .doFinally(signal -> {
                    if (optimizationTaskId.get() != null) {
                        executionRegistry.removeTask(sessionId, optimizationTaskId.get());
                    }
                    executionRegistry.completeTaskCreation(sessionId);
                });
    }

    /**
     * 调用现有图片或视频Profile创建生成任务并等待终态。
     *
     * @param userId Long 用户ID
     * @param sessionId String 会话ID
     * @param plan CreationPlan 创作计划
     * @param request AgentChatRequest 原始请求
     * @param task CreationTask 计划任务
     * @param decision SpecialistAgentResult 子Agent决策
     * @param finalPrompt String 最终提示词
     * @param styles List<GenerationStyleSnapshot> 已解析的风格快照
     * @param dependencyAttachments List<Attachment> 依赖任务生成的媒体
     * @return Mono<TaskExecutionResult> 任务结果
     */
    private Mono<TaskExecutionResult> executeGeneration(Long userId, String sessionId, CreationPlan plan,
                                                        AgentChatRequest request, CreationTask task,
                                                        SpecialistAgentResult decision, String finalPrompt,
                                                        List<GenerationStyleDtos.GenerationStyleSnapshot> styles,
                                                        List<AgentChatRequest.Attachment> dependencyAttachments) {
        Map<String, Object> arguments = generationArguments(finalPrompt, plan.creationSettings(), plan.entrySource(), styles);
        List<AgentChatRequest.Attachment> attachments = new ArrayList<>(request.attachments() == null ? List.of() : request.attachments());
        attachments.addAll(dependencyAttachments);
        String promptStrategy = styles == null || styles.isEmpty() ? decision.promptStrategy() : "OPTIMIZE";
        return executeGenerationTool(userId, sessionId, plan, request, task, promptStrategy,
                finalPrompt, arguments, attachments, 0);
    }

    /**
     * 使用确定的参数调用现有图片或视频Profile并保存终态。
     *
     * @param userId Long 用户ID
     * @param sessionId String 会话ID
     * @param plan CreationPlan 创作计划
     * @param request AgentChatRequest 原始请求
     * @param task CreationTask 计划任务
     * @param promptStrategy String 提示词策略
     * @param actualPrompt String 实际提示词
     * @param arguments Map<String, Object> 实际生成参数
     * @param attachments List<Attachment> 全部媒体附件
     * @param recoveryAttempt int 恢复次数
     * @return Mono<TaskExecutionResult> 任务结果
     */
    private Mono<TaskExecutionResult> executeGenerationTool(Long userId, String sessionId, CreationPlan plan,
                                                            AgentChatRequest request, CreationTask task,
                                                            String promptStrategy, String actualPrompt,
                                                            Map<String, Object> arguments,
                                                            List<AgentChatRequest.Attachment> attachments,
                                                            int recoveryAttempt) {
        String toolName = toolName(task);
        emit(userId, AgentEvent.toolExecute(sessionId, task.taskId(), toolName, arguments));
        AgentLoopProfile profile = resolveProfile(task.taskType());
        return profile.executeTool(userId, toolName, arguments, request.message(), attachments,
                        eventEmitter, sessionId, task.taskId())
                .flatMap(result -> {
                    if (executionRegistry.isCancelRequested(sessionId)) {
                        return canceledTask(userId, sessionId, plan.planId(), task);
                    }
                    emit(userId, AgentEvent.toolResult(sessionId, task.taskId(), result.ok(), result.message(), result.data()));
                    String status = taskStatus(result);
                    emit(userId, AgentEvent.planTaskStatus(sessionId, plan.planId(), task.taskId(), status, result.message()));
                    Map<String, Object> data = result.data() == null ? Map.of() : result.data();
                    AiErrorDetails error = "failed".equals(status)
                            ? result.error() != null ? result.error() : toolError(data, result.message(), "task", "execution")
                            : null;
                    return planRepository.updateTask(plan.planId(), task.taskId(), status, promptStrategy, actualPrompt,
                                    result.data(), "success".equals(status) ? "" : result.message())
                            .then(eventEmitter.persistRoundActivities(userId, sessionId, task.taskId(), status))
                            .thenReturn(new TaskExecutionResult(task.taskId(), status, result.message(), data,
                                    promptStrategy, actualPrompt, new LinkedHashMap<>(arguments), error, recoveryAttempt));
                });
    }

    /**
     * 执行Java注册的画布前端工具并保存结构化结果。
     *
     * @param userId Long 用户ID
     * @param sessionId String 会话ID
     * @param plan CreationPlan 创作计划
     * @param task CreationTask 计划任务
     * @param promptStrategy String 提示词策略
     * @param finalPrompt String 最终提示词
     * @param rawArguments Map<String, Object> 主Agent提供且已通过Schema校验的参数
     * @param recoveryAttempt int 恢复次数
     * @return Mono<TaskExecutionResult> 画布工具结果
     */
    private Mono<TaskExecutionResult> executeCanvasTool(Long userId, String sessionId, CreationPlan plan,
                                                         CreationTask task,
                                                         String promptStrategy, String finalPrompt,
                                                         Map<String, Object> rawArguments,
                                                         int recoveryAttempt) {
        Map<String, Object> arguments = new LinkedHashMap<>(rawArguments == null ? Map.of() : rawArguments);
        if (!"canvas".equals(task.taskType())) {
            arguments.put("prompt", finalPrompt);
        }
        String toolCallId = recoveryAttempt == 0 ? task.taskId() : task.taskId() + ":recovery:" + recoveryAttempt;
        return resolveCanvasStyleSnapshots(plan.creationSettings(), task)
                .map(styles -> {
                    if (!styles.isEmpty()) arguments.put("generationStyleSnapshots", styles);
                    return arguments;
                })
                .flatMap(preparedArguments -> frontendToolExecutor.executeFrontendTool(userId, sessionId, toolCallId, task.toolName(), preparedArguments))
                .flatMap(result -> {
                    if (executionRegistry.isCancelRequested(sessionId)) {
                        return canceledTask(userId, sessionId, plan.planId(), task);
                    }
                    emit(userId, AgentEvent.toolResult(sessionId, toolCallId, result.ok(), result.message(), result.data()));
                    String status = taskStatus(result);
                    emit(userId, AgentEvent.planTaskStatus(sessionId, plan.planId(), task.taskId(), status, result.message()));
                    Map<String, Object> data = result.data() == null ? Map.of() : result.data();
                    Map<String, Object> actualArguments = actualToolArguments(arguments, data);
                    String submittedPrompt = StringUtils.hasText(stringValue(actualArguments.get("prompt")))
                            ? stringValue(actualArguments.get("prompt")) : finalPrompt;
                    AiErrorDetails error = "failed".equals(status)
                            ? result.error() != null ? result.error() : toolError(data, result.message(), "canvas", "frontend_tool")
                            : null;
                    return planRepository.updateTask(plan.planId(), task.taskId(), status, promptStrategy, submittedPrompt,
                                    result.data(), "success".equals(status) ? "" : result.message())
                            .thenReturn(new TaskExecutionResult(task.taskId(), status, result.message(), data,
                                    promptStrategy, submittedPrompt, actualArguments, error, recoveryAttempt));
                });
    }

    /**
     * 按画布工具实际生成类型解析风格，避免画布任务类型canvas丢失图片/视频分组。
     *
     * @param settings CreationSettings 页面风格设置
     * @param task CreationTask 画布任务
     * @return Mono<List<GenerationStyleSnapshot>> 当前任务对应的风格快照
     */
    private Mono<List<GenerationStyleDtos.GenerationStyleSnapshot>> resolveCanvasStyleSnapshots(CreationSettings settings, CreationTask task) {
        String generationType = canvasGenerationType(task);
        if (settings == null) return Mono.just(List.of());
        if (generationType != null) return resolveCanvasStyleGroup(settings, generationType);
        if (!"canvas_run_generation".equals(task == null ? null : task.toolName())
                || settings.generationStyleIdsByType() == null) return Mono.just(List.of());
        return Mono.zip(resolveCanvasStyleGroup(settings, "image"), resolveCanvasStyleGroup(settings, "video"))
                .map(tuple -> {
                    List<GenerationStyleDtos.GenerationStyleSnapshot> styles = new ArrayList<>();
                    styles.addAll(tuple.getT1());
                    styles.addAll(tuple.getT2());
                    return List.copyOf(styles);
                });
    }

    /**
     * 解析某一生成类型的风格ID或历史快照。
     *
     * @param settings CreationSettings 页面风格设置
     * @param generationType String 图片或视频
     * @return Mono<List<GenerationStyleSnapshot>> 风格快照
     */
    private Mono<List<GenerationStyleDtos.GenerationStyleSnapshot>> resolveCanvasStyleGroup(CreationSettings settings, String generationType) {
        List<Long> ids = settings.generationStyleIdsByType() == null
                ? settings.generationStyleIds() : settings.generationStyleIdsByType().getOrDefault(generationType, List.of());
        List<GenerationStyleDtos.GenerationStyleSnapshot> snapshots = settings.generationStyleSnapshots() == null
                ? List.of() : settings.generationStyleSnapshots().stream()
                .filter(snapshot -> snapshot != null && generationType.equals(snapshot.generationType()))
                .toList();
        return promptOptimizationService.resolveStyles(generationType, ids, snapshots);
    }

    /**
     * 读取画布生成工具对应的图片或视频类型。
     *
     * @param task CreationTask 画布任务
     * @return String 图片、视频或null
     */
    private String canvasGenerationType(CreationTask task) {
        if (task == null) return null;
        if ("image".equals(task.taskType()) || "video".equals(task.taskType())) return task.taskType();
        if (task.toolArguments() == null) return null;
        Object mode = task.toolArguments().get("mode");
        return "image".equals(mode) || "video".equals(mode) ? String.valueOf(mode) : null;
    }

    /**
     * 合并服务端工具参数与前端真实执行参数。
     *
     * @param arguments Map<String, Object> 服务端工具参数
     * @param data Map<String, Object> 前端终态数据
     * @return Map<String, Object> 实际执行参数
     */
    private Map<String, Object> actualToolArguments(Map<String, Object> arguments, Map<String, Object> data) {
        Map<String, Object> actualArguments = new LinkedHashMap<>(arguments == null ? Map.of() : arguments);
        Object actualValue = data == null ? null : data.get("actualToolArguments");
        if (actualValue instanceof Map<?, ?> values) {
            values.forEach((name, value) -> {
                if (name != null && value != null) actualArguments.put(String.valueOf(name), value);
            });
        }
        return actualArguments;
    }

    /**
     * 从工具结果读取结构化错误，缺失时生成不可自动重试的明确未知错误。
     *
     * @param data Map<String, Object> 工具结果数据
     * @param message String 工具错误说明
     * @param source String 错误来源
     * @param stage String 错误阶段
     * @return AiErrorDetails 结构化错误详情
     */
    private AiErrorDetails toolError(Map<String, Object> data, String message, String source, String stage) {
        AiErrorDetails error = AiErrorSupport.fromData(data == null ? null : data.get("error"));
        if (error != null) return error;
        List<RecoveryNodeFailure> failures = nodeFailures(data);
        if (!failures.isEmpty()) {
            AiErrorDetails first = failures.getFirst().error();
            boolean consistent = failures.stream().map(RecoveryNodeFailure::error).allMatch(candidate ->
                    Objects.equals(first.category(), candidate.category())
                            && Objects.equals(first.stage(), candidate.stage())
                            && Objects.equals(first.parameter(), candidate.parameter())
                            && Objects.equals(first.requestAccepted(), candidate.requestAccepted())
                            && Objects.equals(first.safeToRetry(), candidate.safeToRetry())
                            && canRetryUnchanged(first) == canRetryUnchanged(candidate));
            if (consistent) return first;
            return new AiErrorDetails(source, "unknown", stage, null, null, null, null,
                    "批量节点返回不同错误，无法安全自动调整", true, false);
        }
        return new AiErrorDetails(source, "unknown", stage, null, null, null, null,
                StringUtils.hasText(message) ? message : "工具执行失败", true, false);
    }

    /**
     * 将生成工具结果映射为计划任务状态，显式保留取消终态。
     *
     * @param result AgentToolResult.ToolResult 工具结果
     * @return String success、failed或canceled
     */
    private String taskStatus(com.novanovastudio.agent.dto.AgentToolResult.ToolResult result) {
        boolean canceled = result.data() != null && Boolean.TRUE.equals(result.data().get("canceled"));
        return canceled ? "canceled" : result.ok() ? "success" : "failed";
    }

    /**
     * 将子任务异常转为结构化失败，避免取消其他无依赖分支。
     *
     * @param userId Long 用户ID
     * @param sessionId String 会话ID
     * @param planId String 计划ID
     * @param task CreationTask 计划任务
     * @param exception Throwable 异常
     * @return Mono<TaskExecutionResult> 失败结果
     */
    private Mono<TaskExecutionResult> failedTask(Long userId, String sessionId, String planId,
                                                 CreationTask task, Throwable exception) {
        AiErrorDetails error = AiErrorSupport.fromThrowable(exception, "agent", "agent");
        String message = error.message();
        Map<String, Object> data = AiErrorSupport.errorData(error);
        log.error("Agent计划子任务执行失败: planId={}, taskId={}", planId, task.taskId(), exception);
        emit(userId, AgentEvent.planTaskStatus(sessionId, planId, task.taskId(), "failed", message));
        return planRepository.updateTask(planId, task.taskId(), "failed", "", task.prompt(), data, message)
                .thenReturn(new TaskExecutionResult(task.taskId(), "failed", message, data,
                        "", task.prompt(), task.toolArguments() == null ? Map.of() : new LinkedHashMap<>(task.toolArguments()),
                        error, 0));
    }

    /**
     * 跳过依赖失败的任务。
     *
     * @param userId Long 用户ID
     * @param sessionId String 会话ID
     * @param planId String 计划ID
     * @param task CreationTask 计划任务
     * @return Mono<TaskExecutionResult> 跳过结果
     */
    private Mono<TaskExecutionResult> skipTask(Long userId, String sessionId, String planId, CreationTask task) {
        String message = "前置任务失败，当前任务未执行";
        emit(userId, AgentEvent.planTaskStatus(sessionId, planId, task.taskId(), "skipped", message));
        return planRepository.updateTask(planId, task.taskId(), "skipped", "", "", null, message)
                .thenReturn(new TaskExecutionResult(task.taskId(), "skipped", message, Map.of()));
    }

    /**
     * 标记尚未开始的任务已取消。
     *
     * @param userId Long 用户ID
     * @param sessionId String 会话ID
     * @param planId String 计划ID
     * @param task CreationTask 计划任务
     * @return Mono<TaskExecutionResult> 取消结果
     */
    private Mono<TaskExecutionResult> canceledTask(Long userId, String sessionId, String planId, CreationTask task) {
        emit(userId, AgentEvent.planTaskStatus(sessionId, planId, task.taskId(), "canceled", "已停止生成"));
        return planRepository.updateTask(planId, task.taskId(), "canceled", "", "", null, "已停止生成")
                .thenReturn(new TaskExecutionResult(task.taskId(), "canceled", "已停止生成", Map.of()));
    }

    /**
     * 校验固定子Agent结构化输出。
     *
     * @param task CreationTask 计划任务
     * @param result SpecialistAgentResult 子Agent结果
     * @return SpecialistAgentResult 合法结果
     */
    private SpecialistAgentResult validateSpecialistResult(CreationTask task, SpecialistAgentResult result) {
        if (result == null || !task.taskId().equals(result.taskId())
                || !("KEEP".equals(result.promptStrategy()) || "OPTIMIZE".equals(result.promptStrategy()))) {
            throw new IllegalStateException("子Agent返回格式无效");
        }
        return result;
    }

    /**
     * 构造受页面硬约束控制的生成工具参数。
     *
     * @param finalPrompt String 最终提示词
     * @param settings CreationSettings 页面设置
     * @param entrySource String 入口来源
     * @param styles List<GenerationStyleSnapshot> 已解析的风格快照
     * @return Map<String, Object> 工具参数
     */
    private Map<String, Object> generationArguments(String finalPrompt, CreationSettings settings, String entrySource,
                                                    List<GenerationStyleDtos.GenerationStyleSnapshot> styles) {
        Map<String, Object> arguments = new LinkedHashMap<>();
        arguments.put("prompt", finalPrompt);
        arguments.put("model", settings.model());
        arguments.put("size", settings.size());
        arguments.put("resolution", settings.resolution());
        arguments.put("quality", settings.quality());
        arguments.put("entrySource", entrySource);
        if (settings.count() != null) arguments.put("count", settings.count());
        if (settings.seconds() != null) arguments.put("seconds", settings.seconds());
        if (settings.watermark() != null) arguments.put("watermark", settings.watermark());
        if (styles != null && !styles.isEmpty()) arguments.put("generationStyleSnapshots", styles);
        return arguments;
    }

    /**
     * 按任务类型和动作选择Java固定允许的生成工具。
     *
     * @param task CreationTask 计划任务
     * @return String 工具名称
     */
    private String toolName(CreationTask task) {
        return ("edit".equals(task.action()) ? "edit_" : "generate_") + task.taskType();
    }

    /**
     * 解析现有图片或视频Profile。
     *
     * @param taskType String 任务类型
     * @return AgentLoopProfile 对应Profile
     */
    private AgentLoopProfile resolveProfile(String taskType) {
        String profileName = "image".equals(taskType) ? "generation" : "video";
        return profiles.stream().filter(profile -> profileName.equals(profile.name())).findFirst()
                .orElseThrow(() -> new IllegalStateException("未注册固定生成子Agent执行Profile: " + taskType));
    }

    /**
     * 判断任务的全部依赖是否成功。
     *
     * @param task CreationTask 计划任务
     * @param completed Map<String, TaskExecutionResult> 已完成任务
     * @return boolean 是否可以执行
     */
    private boolean dependenciesSucceeded(CreationTask task, Map<String, TaskExecutionResult> completed) {
        return dependencies(task).stream().allMatch(dependency -> "success".equals(completed.get(dependency).status()));
    }

    /**
     * 获取非空依赖列表。
     *
     * @param task CreationTask 计划任务
     * @return List<String> 依赖列表
     */
    private List<String> dependencies(CreationTask task) {
        return task.dependsOn() == null ? List.of() : task.dependsOn();
    }

    /**
     * 将成功依赖任务的媒体结果转换为下游任务参考素材。
     *
     * @param task CreationTask 当前任务
     * @param completed Map<String, TaskExecutionResult> 已完成任务
     * @return List<Attachment> 依赖媒体附件
     */
    private List<AgentChatRequest.Attachment> dependencyAttachments(CreationTask task,
                                                                    Map<String, TaskExecutionResult> completed) {
        List<AgentChatRequest.Attachment> attachments = new ArrayList<>();
        for (String dependency : dependencies(task)) {
            TaskExecutionResult result = completed.get(dependency);
            Object itemsValue = result == null ? null : result.data().get("items");
            if (!(itemsValue instanceof List<?> items)) {
                continue;
            }
            for (Object itemValue : items) {
                JSONObject item = JSON.parseObject(JSON.toJSONString(itemValue));
                if (item == null) continue;
                String url = item.getString("url");
                String storageKey = item.getString("storageKey");
                if (storageKey == null || storageKey.isBlank()) storageKey = item.getString("key");
                String mimeType = item.getString("mimeType");
                if (url != null && !url.isBlank() && storageKey != null && !storageKey.isBlank()) {
                    attachments.add(new AgentChatRequest.Attachment(url, mimeType == null ? "" : mimeType, "依赖任务结果", storageKey));
                }
            }
        }
        return attachments;
    }

    /**
     * 汇总全部任务结果。
     *
     * @param plan CreationPlan 创作计划
     * @param results List<TaskExecutionResult> 子任务结果
     * @return PlanExecutionSummary 计划汇总
     */
    private PlanExecutionSummary summarize(CreationPlan plan, List<TaskExecutionResult> results) {
        long successCount = results.stream().filter(result -> "success".equals(result.status())).count();
        long canceledCount = results.stream().filter(result -> "canceled".equals(result.status())).count();
        String status = canceledCount == results.size() ? "canceled"
                : successCount == results.size() ? "success"
                : successCount > 0 ? "partial_failed" : "failed";
        String prefix = CreationEntrySource.CANVAS.equals(plan.entrySource()) ? "画布计划已执行" : "生成计划已完成";
        String message = prefix + "：成功 " + successCount + " 个，未成功 " + (results.size() - successCount) + " 个。";
        String failureDetails = results.stream()
                .filter(result -> !"success".equals(result.status()) && StringUtils.hasText(result.message()))
                .map(TaskExecutionResult::message).distinct().limit(3).reduce((left, right) -> left + "；" + right).orElse("");
        if (StringUtils.hasText(failureDetails)) message += " " + failureDetails;
        return new PlanExecutionSummary(plan.planId(), status, message, results);
    }

    /**
     * 推送Agent事件。
     *
     * @param userId Long 用户ID
     * @param event AgentEvent 事件
     */
    private void emit(Long userId, AgentEvent event) {
        eventEmitter.emit(userId, event);
    }

    /**
     * 单个计划任务的确定性执行结果。
     *
     * @param taskId String 任务ID
     * @param status String 状态
     * @param message String 结果说明
     * @param data Map<String, Object> 结构化结果
     * @param promptStrategy String 提示词策略
     * @param actualPrompt String 实际提交提示词
     * @param toolArguments Map<String, Object> 实际工具参数
     * @param error AiErrorDetails 结构化错误
     * @param recoveryAttempt int 已执行恢复次数
     */
    public record TaskExecutionResult(
            String taskId,
            String status,
            String message,
            Map<String, Object> data,
            String promptStrategy,
            String actualPrompt,
            Map<String, Object> toolArguments,
            AiErrorDetails error,
            int recoveryAttempt
    ) {

        /**
         * 规范化任务执行结果中的可空集合与文本。
         */
        public TaskExecutionResult {
            data = data == null ? Map.of() : data;
            promptStrategy = promptStrategy == null ? "" : promptStrategy;
            actualPrompt = actualPrompt == null ? "" : actualPrompt;
            toolArguments = toolArguments == null ? Map.of() : toolArguments;
        }

        /**
         * 创建无需恢复上下文的简单任务结果。
         *
         * @param taskId String 任务ID
         * @param status String 状态
         * @param message String 结果说明
         * @param data Map<String, Object> 结构化结果
         */
        public TaskExecutionResult(String taskId, String status, String message, Map<String, Object> data) {
            this(taskId, status, message, data, "", "", Map.of(), null, 0);
        }
    }

    /**
     * 整个计划的执行汇总。
     *
     * @param planId String 计划ID
     * @param status String 计划状态
     * @param message String 汇总说明
     * @param tasks List<TaskExecutionResult> 子任务结果
     */
    public record PlanExecutionSummary(String planId, String status, String message, List<TaskExecutionResult> tasks) {
    }
}
