package com.novanovastudio.agent;

import com.novanovastudio.agent.dto.AgentEvent;
import com.novanovastudio.agent.dto.AgentTool;
import com.novanovastudio.agent.dto.AgentToolResult;
import com.novanovastudio.agent.dto.AgentToolResult.ToolResult;
import java.lang.reflect.Method;
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
        AgentTaskOrchestrator orchestrator = new AgentTaskOrchestrator(
                null, null, null, null, emitter, null, null, List.of(), executionRegistry);
        emitter.setOrchestrator(orchestrator);

        ToolResult result = invokeWaitForFrontendResult(orchestrator).block();

        Assertions.assertNotNull(result);
        Assertions.assertTrue(result.ok());
        Assertions.assertEquals("图片生成节点已创建，生成任务已开始", result.message());
        Assertions.assertEquals("image-node-1", result.data().get("nodeId"));
        Assertions.assertEquals("running", result.data().get("status"));
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
     * 收到工具事件后立即回传结果的测试事件发射器。
     */
    private static final class ImmediateResultEmitter extends AgentEventEmitter {

        /** Agent任务编排器 */
        private AgentTaskOrchestrator orchestrator;

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
                    event.callId(),
                    new AgentToolResult.ToolResult(true, "图片生成节点已创建，生成任务已开始",
                            Map.of("nodeId", "image-node-1", "status", "running"))));
        }
    }
}
