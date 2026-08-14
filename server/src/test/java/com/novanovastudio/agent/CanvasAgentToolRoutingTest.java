package com.novanovastudio.agent;

import com.novanovastudio.agent.dto.AgentEvent;
import com.novanovastudio.agent.dto.AgentTool;
import com.novanovastudio.agent.dto.AgentToolResult;
import com.novanovastudio.agent.dto.AgentToolResult.ToolResult;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import reactor.core.publisher.Mono;

/**
 * 画布Agent工具路由测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-14 23:50
 */
class CanvasAgentToolRoutingTest {

    /**
     * 验证所有画布生成工具都由前端执行。
     */
    @Test
    void shouldRouteCanvasGenerationToolsToFrontend() {
        AgentToolRegistry registry = new AgentToolRegistry();
        List<String> frontendToolNames = registry.allTools().stream()
                .filter(AgentTool::frontend)
                .map(AgentTool::name)
                .toList();

        Assertions.assertTrue(frontendToolNames.contains("canvas_generate_text"));
        Assertions.assertTrue(frontendToolNames.contains("canvas_generate_image"));
        Assertions.assertTrue(frontendToolNames.contains("canvas_generate_video"));
        Assertions.assertTrue(frontendToolNames.contains("canvas_run_generation"));
    }

    /**
     * 验证前端等待项先于事件发送注册，并完整保留结果数据。
     *
     * @throws Exception 反射调用失败时抛出
     */
    @Test
    void shouldRegisterPendingResultBeforeEmittingToolEvent() throws Exception {
        ImmediateResultEmitter emitter = new ImmediateResultEmitter();
        AgentExecutionRegistry executionRegistry = new AgentExecutionRegistry();
        executionRegistry.open(1L, "session-1");
        emitter.bindRequest("session-1", "request-1");
        AgentTaskOrchestrator orchestrator = new AgentTaskOrchestrator(
                null, null, null, null, emitter, null, null, List.of(), executionRegistry);
        emitter.setOrchestrator(orchestrator);

        ToolResult result = invokeWaitForFrontendResult(orchestrator).block();

        Assertions.assertNotNull(result);
        Assertions.assertTrue(result.ok());
        Assertions.assertEquals("画布节点生成完成，共 1 个", result.message());
        Assertions.assertEquals(List.of("image-node-1"), result.data().get("successfulNodeIds"));
        Assertions.assertEquals(List.of(), result.data().get("failures"));
    }

    /**
     * 生成型画布工具等待十二分钟，普通画布操作保持三十秒。
     *
     * @throws Exception 反射调用失败时抛出
     */
    @Test
    void shouldUseDedicatedCanvasGenerationTimeout() throws Exception {
        AgentTaskOrchestrator orchestrator = new AgentTaskOrchestrator(
                null, null, null, null, null, null, null, List.of(), new AgentExecutionRegistry());
        Method method = AgentTaskOrchestrator.class.getDeclaredMethod("frontendToolTimeout", String.class, Map.class);
        method.setAccessible(true);

        Duration generationTimeout = (Duration) method.invoke(orchestrator, "canvas_generate_image", Map.of());
        Duration autoGenerationFlowTimeout = (Duration) method.invoke(orchestrator,
                "canvas_create_generation_flow", Map.of("autoRun", true));
        Duration idleGenerationFlowTimeout = (Duration) method.invoke(orchestrator,
                "canvas_create_generation_flow", Map.of("autoRun", false));
        Duration operationTimeout = (Duration) method.invoke(orchestrator, "canvas_create_text_node", Map.of());

        Assertions.assertEquals(Duration.ofMinutes(12), generationTimeout);
        Assertions.assertEquals(Duration.ofMinutes(12), autoGenerationFlowTimeout);
        Assertions.assertEquals(Duration.ofSeconds(30), idleGenerationFlowTimeout);
        Assertions.assertEquals(Duration.ofSeconds(30), operationTimeout);
    }

    /**
     * 前端工具超时取消事件必须精确携带工具调用编号。
     */
    @Test
    void shouldCreateTargetedFrontendToolCancellationEvent() {
        AgentEvent event = AgentEvent.toolCancel("session-1", "task-1:recovery:1", "前端工具执行超时");

        Assertions.assertEquals("tool-cancel", event.type());
        Assertions.assertEquals("task-1:recovery:1", event.callId());
        Assertions.assertEquals("canceled", event.status());
    }

    /**
     * 请求ID不匹配的画布工具结果不得唤醒当前主Agent请求的等待器。
     *
     * @throws Exception 反射读取等待器失败时抛出
     */
    @Test
    void shouldRejectToolResultFromAnotherAgentRequest() throws Exception {
        AgentEventEmitter emitter = new AgentEventEmitter(
                new AgentActivityService(org.mockito.Mockito.mock(com.novanovastudio.repository.PersistenceRepository.class)));
        AgentExecutionRegistry executionRegistry = new AgentExecutionRegistry();
        executionRegistry.open(1L, "session-1");
        emitter.bindRequest("session-1", "request-current");
        AgentTaskOrchestrator orchestrator = new AgentTaskOrchestrator(
                null, null, null, null, emitter, null, null, List.of(), executionRegistry);

        reactor.core.Disposable subscription = invokeWaitForFrontendResult(orchestrator).subscribe();
        try {
            orchestrator.submitToolResult(1L, new AgentToolResult("session-1", "request-other", "call-1",
                    new AgentToolResult.ToolResult(true, "不应被接收", Map.of())));

            Assertions.assertTrue(hasPendingToolResult(orchestrator, "session-1", "call-1"));
        } finally {
            subscription.dispose();
        }
    }

    /**
     * 调用前端工具等待方法。
     *
     * @param orchestrator Agent任务编排器
     * @return Mono<ToolResult> 前端工具结果
     * @throws Exception 反射调用失败时抛出
     */
    @SuppressWarnings("unchecked")
    private Mono<ToolResult> invokeWaitForFrontendResult(AgentTaskOrchestrator orchestrator) throws Exception {
        Method method = AgentTaskOrchestrator.class.getDeclaredMethod(
                "waitForFrontendResult", Long.class, String.class, String.class, String.class, Map.class);
        method.setAccessible(true);
        return (Mono<ToolResult>) method.invoke(orchestrator, 1L, "session-1", "call-1",
                "canvas_generate_image", Map.of("prompt", "小猫在吃鱼", "size", "9:16"));
    }

    /**
     * 判断指定工具调用是否仍在等待前端回传。
     *
     * @param orchestrator Agent任务编排器
     * @param sessionId String 会话ID
     * @param callId String 工具调用ID
     * @return boolean 是否仍在等待
     * @throws Exception 反射读取等待器失败时抛出
     */
    @SuppressWarnings("unchecked")
    private boolean hasPendingToolResult(AgentTaskOrchestrator orchestrator, String sessionId, String callId) throws Exception {
        Field field = AgentTaskOrchestrator.class.getDeclaredField("pendingResults");
        field.setAccessible(true);
        Map<String, Map<String, ?>> pendingResults = (Map<String, Map<String, ?>>) field.get(orchestrator);
        Map<String, ?> sessionResults = pendingResults.get(sessionId);
        return sessionResults != null && sessionResults.containsKey(callId);
    }

    /**
     * 收到工具事件后立即回传结果的测试事件发射器。
     */
    private static final class ImmediateResultEmitter extends AgentEventEmitter {

        /** Agent任务编排器 */
        private AgentTaskOrchestrator orchestrator;

        /**
         * 创建立即回传结果的测试事件发射器。
         */
        private ImmediateResultEmitter() {
            super(new AgentActivityService(org.mockito.Mockito.mock(com.novanovastudio.repository.PersistenceRepository.class)));
        }

        /**
         * 绑定Agent任务编排器。
         *
         * @param orchestrator Agent任务编排器
         */
        private void setOrchestrator(AgentTaskOrchestrator orchestrator) {
            this.orchestrator = orchestrator;
        }

        /**
         * 收到前端工具事件时同步回传结果。
         *
         * @param userId Long 用户ID
         * @param event AgentEvent 工具事件
         */
        @Override
        public void emit(Long userId, AgentEvent event) {
            if (!"tool-execute".equals(event.type())) return;
            orchestrator.submitToolResult(userId, new AgentToolResult(
                    event.sessionId(),
                    "request-1",
                    event.callId(),
                    new AgentToolResult.ToolResult(true, "画布节点生成完成，共 1 个",
                            Map.of("successfulNodeIds", List.of("image-node-1"), "failures", List.of()))));
        }
    }
}
