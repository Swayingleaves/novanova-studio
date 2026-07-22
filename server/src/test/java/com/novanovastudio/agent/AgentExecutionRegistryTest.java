package com.novanovastudio.agent;

import com.alibaba.fastjson2.JSONObject;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

/**
 * Agent 会话执行登记测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-18 23:10
 */
class AgentExecutionRegistryTest {

    /**
     * 验证取消只能命中会话所属用户。
     */
    @Test
    void shouldRejectCancellationFromAnotherUser() {
        AgentExecutionRegistry registry = new AgentExecutionRegistry();
        registry.open(1000L, "session-1");

        AgentExecutionRegistry.AgentCancellation cancellation = registry.requestCancellation(1001L, "session-1");

        Assertions.assertFalse(cancellation.active());
        Assertions.assertFalse(registry.isCancelRequested("session-1"));
    }

    /**
     * 验证取消请求会返回已登记的任务快照并写入取消标记。
     */
    @Test
    void shouldReturnRegisteredTasksWhenCancellationRequested() {
        AgentExecutionRegistry registry = new AgentExecutionRegistry();
        registry.open(1000L, "session-1");
        registry.registerTask("session-1", new AgentExecutionRegistry.AgentTaskRegistration(
                "task-1", "image", "测试生成", new JSONObject()));

        AgentExecutionRegistry.AgentCancellation cancellation = registry.requestCancellation(1000L, "session-1");

        Assertions.assertTrue(cancellation.active());
        Assertions.assertTrue(registry.isCancelRequested("session-1"));
        Assertions.assertEquals("task-1", cancellation.tasks().getFirst().taskId());
    }
}
