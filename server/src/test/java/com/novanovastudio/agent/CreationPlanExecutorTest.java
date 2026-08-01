package com.novanovastudio.agent;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.novanovastudio.agent.dto.AgentChatRequest;
import com.novanovastudio.agent.dto.AgentToolResult.ToolResult;
import com.novanovastudio.agent.dto.CreationPlan;
import com.novanovastudio.agent.dto.CreationTask;
import com.novanovastudio.agent.dto.RecoveryTaskDecision;
import com.novanovastudio.ai.AiErrorDetails;
import com.novanovastudio.repository.AgentPlanRepository;
import com.novanovastudio.service.AiTaskService;
import com.novanovastudio.service.PromptOptimizationService;
import io.agentscope.core.model.Model;
import java.lang.reflect.Method;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

/**
 * 创作计划执行器的依赖图、画布路由和取消状态测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-23 00:00
 */
class CreationPlanExecutorTest {

    /** 计划仓储 */
    private AgentPlanRepository planRepository;
    /** 固定Agent工厂 */
    private AgentScopeAgentFactory agentFactory;
    /** 执行登记 */
    private AgentExecutionRegistry executionRegistry;
    /** 画布工具执行桥接 */
    private AgentTaskOrchestrator frontendToolExecutor;
    /** 被测执行器 */
    private CreationPlanExecutor executor;

    /**
     * 初始化计划执行测试依赖。
     */
    @BeforeEach
    void setUp() {
        planRepository = mock(AgentPlanRepository.class);
        agentFactory = mock(AgentScopeAgentFactory.class);
        executionRegistry = mock(AgentExecutionRegistry.class);
        frontendToolExecutor = mock(AgentTaskOrchestrator.class);
        when(planRepository.updatePlanStatus(anyString(), anyString(), anyString())).thenReturn(Mono.empty());
        when(planRepository.updateTask(anyString(), anyString(), anyString(), anyString(), anyString(), any(), anyString()))
                .thenReturn(Mono.empty());
        when(executionRegistry.isCancelRequested(anyString())).thenReturn(false);
        executor = new CreationPlanExecutor(
                agentFactory,
                mock(PromptOptimizationService.class),
                planRepository,
                mock(AgentEventEmitter.class),
                executionRegistry,
                mock(AiTaskService.class),
                frontendToolExecutor,
                List.of(),
                new CreationRecoveryPlanValidator(new CreationPlanValidator(new AgentToolRegistry())));
    }

    /**
     * 同一依赖层的无依赖任务必须并行执行。
     */
    @Test
    void shouldExecuteIndependentCanvasTasksInParallel() {
        AtomicInteger concurrent = new AtomicInteger();
        AtomicInteger maximumConcurrent = new AtomicInteger();
        when(frontendToolExecutor.executeFrontendTool(anyLong(), anyString(), anyString(), anyString(), anyMap()))
                .thenAnswer(invocation -> Mono.defer(() -> {
                    int current = concurrent.incrementAndGet();
                    maximumConcurrent.accumulateAndGet(current, Math::max);
                    return Mono.delay(Duration.ofMillis(20))
                            .thenReturn(new ToolResult(true, "执行成功", Map.of()))
                            .doFinally(signal -> concurrent.decrementAndGet());
                }));

        CreationPlan plan = plan(List.of(canvasTask("task-a", List.of()), canvasTask("task-b", List.of())));

        StepVerifier.create(executor.execute(1L, "session", plan, request(), mock(Model.class)))
                .assertNext(summary -> {
                    Assertions.assertEquals("success", summary.status());
                    Assertions.assertEquals(2, summary.tasks().size());
                    Assertions.assertEquals(2, maximumConcurrent.get());
                })
                .verifyComplete();
    }

    /**
     * 有依赖的任务必须在前置任务成功后串行执行。
     */
    @Test
    void shouldExecuteDependentCanvasTasksInOrder() {
        List<String> executionOrder = new ArrayList<>();
        when(frontendToolExecutor.executeFrontendTool(anyLong(), anyString(), anyString(), anyString(), anyMap()))
                .thenAnswer(invocation -> {
                    executionOrder.add(invocation.getArgument(2, String.class));
                    return Mono.just(new ToolResult(true, "执行成功", Map.of()));
                });

        CreationPlan plan = plan(List.of(canvasTask("task-a", List.of()), canvasTask("task-b", List.of("task-a"))));

        StepVerifier.create(executor.execute(1L, "session", plan, request(), mock(Model.class)))
                .assertNext(summary -> Assertions.assertEquals(List.of("task-a", "task-b"), executionOrder))
                .verifyComplete();
    }

    /**
     * 前置任务失败时必须跳过依赖任务，但不影响计划汇总。
     */
    @Test
    void shouldSkipTaskWhenDependencyFails() {
        when(frontendToolExecutor.executeFrontendTool(anyLong(), anyString(), anyString(), anyString(), anyMap()))
                .thenReturn(Mono.just(new ToolResult(false, "执行失败", Map.of())));
        CreationPlan plan = plan(List.of(canvasTask("task-a", List.of()), canvasTask("task-b", List.of("task-a"))));

        StepVerifier.create(executor.execute(1L, "session", plan, request(), mock(Model.class)))
                .assertNext(summary -> {
                    Assertions.assertEquals("failed", summary.status());
                    Assertions.assertEquals("failed", summary.tasks().get(0).status());
                    Assertions.assertEquals("skipped", summary.tasks().get(1).status());
                })
                .verifyComplete();

        verify(frontendToolExecutor).executeFrontendTool(anyLong(), anyString(), anyString(), anyString(), anyMap());
    }

    /**
     * 工具返回canceled标记时不得错误写成failed。
     */
    @Test
    void shouldPreserveCanceledToolResult() {
        when(frontendToolExecutor.executeFrontendTool(anyLong(), anyString(), anyString(), anyString(), anyMap()))
                .thenReturn(Mono.just(new ToolResult(false, "已停止生成", Map.of("canceled", true))));

        StepVerifier.create(executor.execute(1L, "session", plan(List.of(canvasTask("task-a", List.of()))),
                        request(), mock(Model.class)))
                .assertNext(summary -> {
                    Assertions.assertEquals("canceled", summary.status());
                    Assertions.assertEquals("canceled", summary.tasks().getFirst().status());
                })
                .verifyComplete();
    }

    /**
     * 取消请求后到达的成功结果不得覆盖计划任务取消终态。
     */
    @Test
    void shouldIgnoreLateSuccessAfterCancellation() {
        when(executionRegistry.isCancelRequested("session")).thenReturn(false, true, true);
        when(frontendToolExecutor.executeFrontendTool(anyLong(), anyString(), anyString(), anyString(), anyMap()))
                .thenReturn(Mono.just(new ToolResult(true, "迟发成功", Map.of())));

        StepVerifier.create(executor.execute(1L, "session", plan(List.of(canvasTask("task-a", List.of()))),
                        request(), mock(Model.class)))
                .assertNext(summary -> {
                    Assertions.assertEquals("canceled", summary.status());
                    Assertions.assertEquals("canceled", summary.tasks().getFirst().status());
                })
                .verifyComplete();
    }

    /**
     * 同一依赖层的多个失败任务必须合并为一次恢复诊断调用。
     */
    @Test
    void shouldDiagnoseSameLayerFailuresOnce() {
        when(frontendToolExecutor.executeFrontendTool(anyLong(), anyString(), anyString(), anyString(), anyMap()))
                .thenReturn(Mono.just(new ToolResult(false, "执行失败", Map.of())));
        CreationPlan plan = plan(List.of(canvasTask("task-a", List.of()), canvasTask("task-b", List.of())));

        StepVerifier.create(executor.execute(1L, "session", plan, request(), mock(Model.class)))
                .assertNext(summary -> Assertions.assertEquals("failed", summary.status()))
                .verifyComplete();

        verify(agentFactory, times(1)).recoveryAgent(any(Model.class));
        verify(frontendToolExecutor, times(2))
                .executeFrontendTool(anyLong(), anyString(), anyString(), anyString(), anyMap());
    }

    /**
     * 已有画布节点的参数来源必须由服务端确定为用户硬约束。
     *
     * @throws Exception 反射调用失败时抛出
     */
    @Test
    @SuppressWarnings("unchecked")
    void shouldKeepExistingCanvasNodeArgumentsImmutable() throws Exception {
        CreationTask task = new CreationTask("task-a", "image", "generate", "原始提示词", List.of(),
                "canvas_run_generation", Map.of("nodeId", "image-1", "prompt", "原始提示词"));
        Method method = CreationPlanExecutor.class.getDeclaredMethod("argumentSources",
                CreationPlan.class, CreationTask.class, Map.class, Set.class);
        method.setAccessible(true);

        Map<String, String> sources = (Map<String, String>) method.invoke(executor, plan(List.of(task)), task,
                Map.of("nodeId", "image-1", "prompt", "原始提示词", "quality", "high"), Set.of());

        Assertions.assertEquals("用户硬约束", sources.get("prompt"));
        Assertions.assertEquals("用户硬约束", sources.get("quality"));
    }

    /**
     * 画布节点重试失败时必须在恢复审计中保留重试错误。
     *
     * @throws Exception 反射调用失败时抛出
     */
    @Test
    @SuppressWarnings("unchecked")
    void shouldAuditNestedCanvasRetryError() throws Exception {
        AiErrorDetails firstError = new AiErrorDetails("provider", "invalid_parameter", "submission", 400,
                "invalid_parameter", "invalid_request_error", "quality", "参数错误", false, true);
        AiErrorDetails retryError = new AiErrorDetails("provider", "prompt_policy_violation", "submission", 400,
                "content_policy_violation", "invalid_request_error", "prompt", "提示词错误", false, true);
        CreationPlanExecutor.TaskExecutionResult firstResult = new CreationPlanExecutor.TaskExecutionResult(
                "task-a", "failed", "参数错误", Map.of(), "KEEP", "原始提示词", Map.of(), firstError, 0);
        CreationPlanExecutor.TaskExecutionResult retryResult = new CreationPlanExecutor.TaskExecutionResult(
                "task-a", "failed", "提示词错误", Map.of("failures", List.of()), "KEEP", "新提示词", Map.of(), retryError, 1);
        RecoveryTaskDecision decision = new RecoveryTaskDecision("task-a", List.of("image-1"),
                "ADJUST_AND_RETRY", "新提示词", Map.of(), "调整后重试");
        Method method = CreationPlanExecutor.class.getDeclaredMethod("recoveryData", Map.class, Map.class,
                CreationPlanExecutor.TaskExecutionResult.class, CreationPlanExecutor.TaskExecutionResult.class,
                RecoveryTaskDecision.class);
        method.setAccessible(true);

        Map<String, Object> data = (Map<String, Object>) method.invoke(executor, firstResult.data(),
                retryResult.data(), firstResult, retryResult, decision);
        Map<String, Object> recovery = (Map<String, Object>) data.get("recovery");
        Map<String, Object> auditedRetryError = (Map<String, Object>) recovery.get("retryError");

        Assertions.assertEquals("prompt_policy_violation", auditedRetryError.get("category"));
    }

    /**
     * 画布重试成功必须保留首次成功节点，并替换参与重试节点的首次失败。
     *
     * @throws Exception 反射调用失败时抛出
     */
    @Test
    @SuppressWarnings("unchecked")
    void shouldMergeCanvasRetryWithInitialSuccess() throws Exception {
        AiErrorDetails firstError = new AiErrorDetails("provider", "prompt_policy_violation", "submission", 400,
                "content_policy_violation", "invalid_request_error", "prompt", "提示词错误", false, true);
        Map<String, Object> firstData = Map.of(
                "successfulNodeIds", List.of("image-1"),
                "failures", List.of(Map.of("nodeId", "image-2", "error", firstError.toMap())));
        Map<String, Object> retryData = Map.of(
                "successfulNodeIds", List.of("image-2"),
                "failures", List.of());
        CreationPlanExecutor.TaskExecutionResult firstResult = new CreationPlanExecutor.TaskExecutionResult(
                "task-a", "failed", "提示词错误", firstData, "KEEP", "原始提示词", Map.of(), firstError, 0);
        CreationPlanExecutor.TaskExecutionResult retryResult = new CreationPlanExecutor.TaskExecutionResult(
                "task-a", "success", "生成完成", retryData, "KEEP", "新提示词", Map.of(), null, 1);
        RecoveryTaskDecision decision = new RecoveryTaskDecision("task-a", List.of("image-2"),
                "ADJUST_AND_RETRY", "新提示词", Map.of(), "调整后重试");
        Method method = CreationPlanExecutor.class.getDeclaredMethod("recoveryData", Map.class, Map.class,
                CreationPlanExecutor.TaskExecutionResult.class, CreationPlanExecutor.TaskExecutionResult.class,
                RecoveryTaskDecision.class);
        method.setAccessible(true);

        Map<String, Object> data = (Map<String, Object>) method.invoke(executor, firstData, retryData,
                firstResult, retryResult, decision);

        Assertions.assertEquals(List.of("image-1", "image-2"), data.get("successfulNodeIds"));
        Assertions.assertEquals(List.of(), data.get("failures"));
    }

    /**
     * 批量节点错误的原样重试条件不一致时必须降级为未知错误。
     *
     * @throws Exception 反射调用失败时抛出
     */
    @Test
    void shouldRejectMixedCanvasRetryConditions() throws Exception {
        AiErrorDetails retryable = new AiErrorDetails("provider", "provider_unavailable", "submission", 503,
                null, null, null, "服务暂不可用", false, true);
        AiErrorDetails notRetryable = new AiErrorDetails("provider", "provider_unavailable", "submission", 400,
                null, null, null, "请求失败", false, true);
        Map<String, Object> data = Map.of("failures", List.of(
                Map.of("nodeId", "image-1", "error", retryable.toMap()),
                Map.of("nodeId", "image-2", "error", notRetryable.toMap())));
        Method method = CreationPlanExecutor.class.getDeclaredMethod("toolError",
                Map.class, String.class, String.class, String.class);
        method.setAccessible(true);

        AiErrorDetails result = (AiErrorDetails) method.invoke(executor, data,
                "画布节点生成失败", "canvas", "frontend_tool");

        Assertions.assertEquals("unknown", result.category());
        Assertions.assertFalse(result.safeToRetry());
    }

    /**
     * 已受理任务的轮询和下载错误只能停止，不能再次询问或创建任务。
     *
     * @throws Exception 反射调用失败时抛出
     */
    @Test
    @SuppressWarnings("unchecked")
    void shouldStopAcceptedPollingAndDownloadFailures() throws Exception {
        Method method = CreationPlanExecutor.class.getDeclaredMethod("allowedRecoveryActions",
                AiErrorDetails.class, Set.class, Map.class, boolean.class);
        method.setAccessible(true);
        for (String stage : List.of("polling", "download")) {
            AiErrorDetails error = new AiErrorDetails("provider", "prompt_policy_violation", stage, null,
                    "content_policy_violation", "invalid_request_error", "prompt", "内容审核未通过", true, false);

            List<String> actions = (List<String>) method.invoke(executor, error,
                    Set.of(), Map.of("prompt", "Agent生成"), true);

            Assertions.assertEquals(List.of("STOP"), actions);
        }
    }

    /**
     * 构造画布计划。
     *
     * @param tasks List<CreationTask> 任务列表
     * @return CreationPlan 画布计划
     */
    private CreationPlan plan(List<CreationTask> tasks) {
        return new CreationPlan("plan", "操作画布", CreationEntrySource.CANVAS,
                "执行画布操作", "", false, null, tasks);
    }

    /**
     * 构造普通画布工具任务。
     *
     * @param taskId String 任务ID
     * @param dependencies List<String> 依赖任务
     * @return CreationTask 画布任务
     */
    private CreationTask canvasTask(String taskId, List<String> dependencies) {
        return new CreationTask(taskId, "canvas", "tool", "创建文本节点", dependencies,
                "canvas_create_text_node", Map.of("text", taskId));
    }

    /**
     * 构造画布请求。
     *
     * @return AgentChatRequest 画布请求
     */
    private AgentChatRequest request() {
        return new AgentChatRequest(null, CreationEntrySource.CANVAS, "创建文本节点",
                Map.of(), List.of(), List.of(), List.of(), null);
    }
}
