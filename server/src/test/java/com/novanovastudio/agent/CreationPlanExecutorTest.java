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
import com.novanovastudio.agent.dto.CreationSettings;
import com.novanovastudio.agent.dto.CreationTask;
import com.novanovastudio.agent.dto.RecoveryTaskDecision;
import com.novanovastudio.ai.AiErrorDetails;
import com.novanovastudio.dto.GenerationStyleDtos;
import com.novanovastudio.repository.AgentPlanRepository;
import com.novanovastudio.service.AiTaskService;
import com.novanovastudio.service.PersistenceService;
import com.novanovastudio.service.PromptOptimizationService;
import com.novanovastudio.service.SkillService;
import io.agentscope.core.model.Model;
import java.lang.reflect.Method;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
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
    /** 风格解析服务 */
    private PromptOptimizationService promptOptimizationService;
    /** 生成记录持久化服务 */
    private PersistenceService persistenceService;

    /**
     * 初始化计划执行测试依赖。
     */
    @BeforeEach
    void setUp() {
        planRepository = mock(AgentPlanRepository.class);
        agentFactory = mock(AgentScopeAgentFactory.class);
        executionRegistry = mock(AgentExecutionRegistry.class);
        frontendToolExecutor = mock(AgentTaskOrchestrator.class);
        promptOptimizationService = mock(PromptOptimizationService.class);
        persistenceService = mock(PersistenceService.class);
        when(persistenceService.saveOrUpdateGenerationRound(anyLong(), anyString(), anyString(), anyString(), any()))
                .thenReturn(Mono.empty());
        when(planRepository.updateCreationAgentPlanStatus(anyString(), anyString(), anyString())).thenReturn(Mono.empty());
        when(planRepository.updateTask(anyString(), anyString(), anyString(), anyString(), anyString(), any(), anyString()))
                .thenReturn(Mono.empty());
        when(executionRegistry.isCancelRequested(anyString())).thenReturn(false);
        executor = new CreationPlanExecutor(
                agentFactory,
                promptOptimizationService,
                planRepository,
                mock(AgentEventEmitter.class),
                executionRegistry,
                mock(AiTaskService.class),
                frontendToolExecutor,
                List.<AgentLoopProfile>of(),
                new CreationRecoveryPlanValidator(new CreationPlanValidator(new AgentToolRegistry())),
                mock(SkillService.class));
        executor.setPersistenceService(persistenceService);
    }

    /**
     * 视频工作流终态轮次必须保存视频任务提示词，不能保存图片确认按钮文案。
     *
     * @throws Exception 反射调用私有保存方法失败
     */
    @Test
    void shouldPersistWorkflowVideoPromptInsteadOfImageConfirmationText() throws Exception {
        CreationTask videoTask = new CreationTask("video", "video", "generate", "视频提示词", null,
                List.of(), "", Map.of(), "video");
        CreationPlan plan = new CreationPlan("workflow-plan", "首尾帧视频", CreationEntrySource.VIDEO_PAGE,
                "正在根据已确认图片生成视频", "", false, null, List.of(videoTask), List.of(), "first-last-frame");
        AgentChatRequest request = new AgentChatRequest(null, CreationEntrySource.VIDEO_PAGE,
                "用这些图片生成视频", Map.of(), List.of(), List.of(), List.of(), null, null);
        CreationPlanExecutor.TaskExecutionResult result = new CreationPlanExecutor.TaskExecutionResult(
                "video", "success", "生成成功", Map.of("workflowReferences", List.of(
                        Map.of("role", "first_frame", "url", "https://example.com/first-frame.png",
                                "storageKey", "workflow/first-frame.png", "mimeType", "image/png"),
                        Map.of("role", "last_frame", "url", "https://example.com/last-frame.png",
                                "storageKey", "workflow/last-frame.png", "mimeType", "image/png"))), "KEEP", "镜头从近景平稳拉远至地平线",
                Map.of("prompt", "镜头从近景平稳拉远至地平线"), null, 0);

        Method method = CreationPlanExecutor.class.getDeclaredMethod("saveWorkflowRound", Long.class, String.class,
                CreationPlan.class, AgentChatRequest.class, String.class, String.class, List.class);
        method.setAccessible(true);
        @SuppressWarnings("unchecked")
        Mono<Void> save = (Mono<Void>) method.invoke(executor, 1L, "session", plan, request,
                "success", "", List.of(result));
        save.block();

        ArgumentCaptor<com.alibaba.fastjson2.JSONObject> roundCaptor = ArgumentCaptor.forClass(com.alibaba.fastjson2.JSONObject.class);
        verify(persistenceService).saveOrUpdateGenerationRound(anyLong(), anyString(), anyString(), anyString(), roundCaptor.capture());
        com.alibaba.fastjson2.JSONObject round = roundCaptor.getValue();
        Assertions.assertEquals("镜头从近景平稳拉远至地平线", round.getString("prompt"));
        Assertions.assertEquals("镜头从近景平稳拉远至地平线", round.getString("generationPrompt"));
        com.alibaba.fastjson2.JSONArray references = round.getJSONArray("references");
        Assertions.assertEquals(2, references.size());
        Assertions.assertEquals("first_frame", references.getJSONObject(0).getString("role"));
        Assertions.assertEquals("https://example.com/first-frame.png", references.getJSONObject(0).getString("url"));
        Assertions.assertEquals("last_frame", references.getJSONObject(1).getString("role"));
        Assertions.assertEquals("https://example.com/last-frame.png", references.getJSONObject(1).getString("url"));
    }

    /**
     * 画布生成工具按实际图片类型解析唯一的当前选择风格。
     *
     * @throws Exception 反射调用失败时抛出
     */
    @Test
    @SuppressWarnings("unchecked")
    void shouldResolveSingleCanvasStyleForGenerationTools() throws Exception {
        GenerationStyleDtos.GenerationStyleSnapshot imageStyle =
                new GenerationStyleDtos.GenerationStyleSnapshot(1L, "电影感", "image", "电影感提示词");
        when(promptOptimizationService.resolveStyles("image", List.of(1L), List.of()))
                .thenReturn(Mono.just(List.of(imageStyle)));
        when(promptOptimizationService.resolveStyles("video", List.of(), List.of()))
                .thenReturn(Mono.just(List.of()));
        Method method = CreationPlanExecutor.class.getDeclaredMethod("resolveCanvasStyleSnapshots",
                com.novanovastudio.agent.dto.CreationSettings.class, CreationTask.class);
        method.setAccessible(true);
        com.novanovastudio.agent.dto.CreationSettings settings = new com.novanovastudio.agent.dto.CreationSettings(
                "model", null, null, null, null, null, null, null, null,
                Map.of("image", List.of(1L)));

        CreationTask imageTask = new CreationTask("image-task", "image", "generate", "生成图片", List.of(),
                "canvas_generate_image", Map.of("prompt", "城市夜景", "size", "16:9"));
        List<GenerationStyleDtos.GenerationStyleSnapshot> imageResult =
                ((Mono<List<GenerationStyleDtos.GenerationStyleSnapshot>>) method.invoke(executor, settings, imageTask)).block();
        Assertions.assertEquals(List.of(imageStyle), imageResult);

        CreationTask runTask = new CreationTask("run-task", "canvas", "tool", "重生成", List.of(),
                "canvas_run_generation", Map.of("nodeId", "image-1"));
        List<GenerationStyleDtos.GenerationStyleSnapshot> runResult =
                ((Mono<List<GenerationStyleDtos.GenerationStyleSnapshot>>) method.invoke(executor, settings, runTask)).block();
        Assertions.assertEquals(List.of(imageStyle), runResult);
    }

    /**
     * 画布视频工具必须使用页面选定的视频模型和计费参数，不能采用主Agent给出的值。
     *
     * @throws Exception 反射调用失败时抛出
     */
    @Test
    void shouldForceCanvasVideoModelAndBillingSettings() throws Exception {
        Method method = CreationPlanExecutor.class.getDeclaredMethod("applyCanvasVideoSettings",
                Map.class, CreationSettings.class, CreationTask.class);
        method.setAccessible(true);
        Map<String, Object> arguments = new LinkedHashMap<>(Map.of(
                "model", "agent-selected-model",
                "size", "1:1",
                "seconds", "2",
                "vquality", "480p",
                "videoGenerationMode", "reference-to-video"));
        CreationSettings settings = new CreationSettings("agent-model", "16:9", "1080p", "high", 1,
                "6", false, null, null, Map.of(), "image-to-video", "video-model");
        CreationTask task = new CreationTask("video-task", "canvas", "generate", "生成视频", List.of(),
                "canvas_generate_video", Map.of("prompt", "生成视频"));

        method.invoke(executor, arguments, settings, task);

        Assertions.assertEquals("video-model", arguments.get("model"));
        Assertions.assertEquals("16:9", arguments.get("size"));
        Assertions.assertEquals("6", arguments.get("seconds"));
        Assertions.assertEquals("1080p", arguments.get("vquality"));
        Assertions.assertEquals("image-to-video", arguments.get("videoGenerationMode"));
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
                "执行画布操作", "", false, null, tasks, List.of());
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
                Map.of(), List.of(), List.of(), List.of(), null, null);
    }
}
