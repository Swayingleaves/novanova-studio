package com.novanovastudio.agent;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.novanovastudio.agent.dto.AgentChatRequest;
import com.novanovastudio.agent.dto.AgentToolResult.ToolResult;
import com.novanovastudio.agent.dto.CreationPlan;
import com.novanovastudio.agent.dto.CreationTask;
import com.novanovastudio.repository.AgentPlanRepository;
import com.novanovastudio.service.AiTaskService;
import com.novanovastudio.service.PromptOptimizationService;
import io.agentscope.core.model.Model;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
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
        executionRegistry = mock(AgentExecutionRegistry.class);
        frontendToolExecutor = mock(AgentTaskOrchestrator.class);
        when(planRepository.updatePlanStatus(anyString(), anyString(), anyString())).thenReturn(Mono.empty());
        when(planRepository.updateTask(anyString(), anyString(), anyString(), anyString(), anyString(), any(), anyString()))
                .thenReturn(Mono.empty());
        when(executionRegistry.isCancelRequested(anyString())).thenReturn(false);
        executor = new CreationPlanExecutor(
                mock(AgentScopeAgentFactory.class),
                mock(PromptOptimizationService.class),
                planRepository,
                mock(AgentEventEmitter.class),
                executionRegistry,
                mock(AiTaskService.class),
                frontendToolExecutor,
                List.of());
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
     * 构造画布计划。
     *
     * @param tasks List<CreationTask> 任务列表
     * @return CreationPlan 画布计划
     */
    private CreationPlan plan(List<CreationTask> tasks) {
        return new CreationPlan("plan", "操作画布", CreationEntrySource.CANVAS,
                "执行画布操作", "", null, tasks);
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
