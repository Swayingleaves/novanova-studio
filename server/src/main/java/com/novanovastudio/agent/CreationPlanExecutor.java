package com.novanovastudio.agent;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.agent.dto.AgentChatRequest;
import com.novanovastudio.agent.dto.AgentEvent;
import com.novanovastudio.agent.dto.CreationPlan;
import com.novanovastudio.agent.dto.CreationSettings;
import com.novanovastudio.agent.dto.CreationTask;
import com.novanovastudio.agent.dto.SpecialistAgentResult;
import com.novanovastudio.service.PromptOptimizationService;
import com.novanovastudio.service.AiTaskService;
import com.novanovastudio.repository.AgentPlanRepository;
import io.agentscope.core.ReActAgent;
import io.agentscope.core.agent.RuntimeContext;
import io.agentscope.core.model.Model;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
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
        return planRepository.updatePlanStatus(plan.planId(), "running", "")
                .then(executeLayer(userId, sessionId, plan, request, model, new ArrayList<>(plan.tasks()), completed))
                .map(results -> summarize(plan, results))
                .flatMap(summary -> planRepository.updatePlanStatus(plan.planId(), summary.status(),
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
                .flatMap(task -> dependenciesSucceeded(task, completed)
                        ? executeTask(userId, sessionId, plan, request, model, task, dependencyAttachments(task, completed))
                        : skipTask(userId, sessionId, plan.planId(), task), ready.size())
                .collectList()
                .flatMap(layerResults -> {
                    for (TaskExecutionResult result : layerResults) {
                        completed.put(result.taskId(), result);
                    }
                    List<CreationTask> next = remaining.stream().filter(task -> !completed.containsKey(task.taskId())).toList();
                    return executeLayer(userId, sessionId, plan, request, model, new ArrayList<>(next), completed);
                });
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
                        : callSpecialist(userId, sessionId, model, task, task.prompt())
                        .flatMap(decision -> preparePrompt(userId, sessionId, task.taskType(), task.prompt(), decision)
                                .flatMap(finalPrompt -> {
                                    emit(userId, AgentEvent.promptPrepared(sessionId, plan.planId(), task.taskId(), decision.promptStrategy()));
                                    return executePreparedTask(userId, sessionId, plan, request, task, decision,
                                            finalPrompt, dependencyAttachments);
                                }))))
                .onErrorResume(exception -> executionRegistry.isCancelRequested(sessionId)
                        ? canceledTask(userId, sessionId, plan.planId(), task)
                        : failedTask(userId, sessionId, plan.planId(), task, exception));
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
        return executeCanvasTool(userId, sessionId, plan, task, "KEEP", task.prompt(), task.toolArguments());
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
     * @param dependencyAttachments List<Attachment> 依赖任务生成的媒体
     * @return Mono<TaskExecutionResult> 任务结果
     */
    private Mono<TaskExecutionResult> executePreparedTask(Long userId, String sessionId, CreationPlan plan,
                                                           AgentChatRequest request, CreationTask task,
                                                           SpecialistAgentResult decision, String finalPrompt,
                                                           List<AgentChatRequest.Attachment> dependencyAttachments) {
        if (CreationEntrySource.CANVAS.equals(plan.entrySource())) {
            return executeCanvasTool(userId, sessionId, plan, task, decision.promptStrategy(),
                    finalPrompt, task.toolArguments());
        }
        return executeGeneration(userId, sessionId, plan, request, task, decision, finalPrompt, dependencyAttachments);
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
     * @return Mono<String> 最终提示词
     */
    private Mono<String> preparePrompt(Long userId, String sessionId, String taskType, String originalPrompt, SpecialistAgentResult decision) {
        if ("KEEP".equals(decision.promptStrategy())) {
            return Mono.just(originalPrompt);
        }
        AtomicReference<String> optimizationTaskId = new AtomicReference<>();
        return Mono.defer(() -> {
                    executionRegistry.beginTaskCreation(sessionId);
                    return promptOptimizationService.optimizeAndWait(userId, taskType, originalPrompt, response -> {
                        optimizationTaskId.set(response.id());
                        boolean canceled = executionRegistry.registerTask(sessionId,
                                new AgentExecutionRegistry.AgentTaskRegistration(response.id(), "", "", null));
                        return canceled ? aiTaskService.cancelTaskForUser(userId, response.id()).then() : Mono.empty();
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
     * @param dependencyAttachments List<Attachment> 依赖任务生成的媒体
     * @return Mono<TaskExecutionResult> 任务结果
     */
    private Mono<TaskExecutionResult> executeGeneration(Long userId, String sessionId, CreationPlan plan,
                                                        AgentChatRequest request, CreationTask task,
                                                        SpecialistAgentResult decision, String finalPrompt,
                                                        List<AgentChatRequest.Attachment> dependencyAttachments) {
        Map<String, Object> arguments = generationArguments(finalPrompt, plan.creationSettings(), plan.entrySource());
        String toolName = toolName(task);
        emit(userId, AgentEvent.toolExecute(sessionId, task.taskId(), toolName, arguments));
        AgentLoopProfile profile = resolveProfile(task.taskType());
        List<AgentChatRequest.Attachment> attachments = new ArrayList<>(request.attachments() == null ? List.of() : request.attachments());
        attachments.addAll(dependencyAttachments);
        return profile.executeTool(userId, toolName, arguments, request.message(), attachments,
                        eventEmitter, sessionId, task.taskId())
                .flatMap(result -> {
                    emit(userId, AgentEvent.toolResult(sessionId, task.taskId(), result.ok(), result.message(), result.data()));
                    String status = taskStatus(result);
                    emit(userId, AgentEvent.planTaskStatus(sessionId, plan.planId(), task.taskId(), status, result.message()));
                    return planRepository.updateTask(plan.planId(), task.taskId(), status, decision.promptStrategy(), finalPrompt,
                                    result.data(), "success".equals(status) ? "" : result.message())
                            .thenReturn(new TaskExecutionResult(task.taskId(), status, result.message(), result.data() == null ? Map.of() : result.data()));
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
     * @return Mono<TaskExecutionResult> 画布工具结果
     */
    private Mono<TaskExecutionResult> executeCanvasTool(Long userId, String sessionId, CreationPlan plan,
                                                         CreationTask task,
                                                         String promptStrategy, String finalPrompt,
                                                         Map<String, Object> rawArguments) {
        Map<String, Object> arguments = new LinkedHashMap<>(rawArguments == null ? Map.of() : rawArguments);
        if (!"canvas".equals(task.taskType())) {
            arguments.put("prompt", finalPrompt);
        }
        return frontendToolExecutor.executeFrontendTool(userId, sessionId, task.taskId(), task.toolName(), arguments)
                .flatMap(result -> {
                    emit(userId, AgentEvent.toolResult(sessionId, task.taskId(), result.ok(), result.message(), result.data()));
                    String status = taskStatus(result);
                    emit(userId, AgentEvent.planTaskStatus(sessionId, plan.planId(), task.taskId(), status, result.message()));
                    return planRepository.updateTask(plan.planId(), task.taskId(), status, promptStrategy, finalPrompt,
                                    result.data(), "success".equals(status) ? "" : result.message())
                            .thenReturn(new TaskExecutionResult(task.taskId(), status, result.message(),
                                    result.data() == null ? Map.of() : result.data()));
                });
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
        String message = exception instanceof com.novanovastudio.common.BusinessException
                && exception.getMessage() != null && !exception.getMessage().isBlank()
                ? exception.getMessage() : "子任务服务暂不可用，已停止该任务";
        log.error("Agent计划子任务执行失败: planId={}, taskId={}", planId, task.taskId(), exception);
        emit(userId, AgentEvent.planTaskStatus(sessionId, planId, task.taskId(), "failed", message));
        return planRepository.updateTask(planId, task.taskId(), "failed", "", "", null, message)
                .thenReturn(new TaskExecutionResult(task.taskId(), "failed", message, Map.of()));
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
     * @return Map<String, Object> 工具参数
     */
    private Map<String, Object> generationArguments(String finalPrompt, CreationSettings settings, String entrySource) {
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
     */
    public record TaskExecutionResult(String taskId, String status, String message, Map<String, Object> data) {
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
