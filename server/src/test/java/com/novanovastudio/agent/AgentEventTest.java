package com.novanovastudio.agent;

import com.alibaba.fastjson2.JSON;
import com.novanovastudio.agent.dto.AgentAction;
import com.novanovastudio.agent.dto.AgentEvent;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

/**
 * Agent计划SSE事件字段映射测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-23 00:00
 */
class AgentEventTest {

    /**
     * 计划创建事件必须携带计划摘要和任务数量。
     */
    @Test
    void shouldBuildPlanCreatedEvent() {
        AgentEvent event = AgentEvent.planCreated("session", "plan", "生成两张图片", 2);

        Assertions.assertEquals("plan-created", event.type());
        Assertions.assertEquals("plan", event.resultData().get("planId"));
        Assertions.assertEquals(2, event.resultData().get("taskCount"));
    }

    /**
     * 任务状态和提示词策略事件必须保留任务关联字段。
     */
    @Test
    void shouldBuildTaskStageEvents() {
        AgentEvent taskStatus = AgentEvent.planTaskStatus("session", "plan", "task", "running", "正在执行");
        AgentEvent promptPrepared = AgentEvent.promptPrepared("session", "plan", "task", "OPTIMIZE");

        Assertions.assertEquals("running", taskStatus.status());
        Assertions.assertEquals("task", taskStatus.resultData().get("taskId"));
        Assertions.assertEquals("OPTIMIZE", promptPrepared.resultData().get("strategy"));
    }

    /**
     * 画布引导动作必须随任务完成事件序列化，普通完成事件不携带动作。
     */
    @Test
    void shouldBuildTaskCompleteAction() {
        AgentAction action = AgentAction.navigateToCanvas("生成三个分镜");
        AgentEvent guidance = AgentEvent.taskComplete("session", "message", "请前往画布", action);
        AgentEvent ordinary = AgentEvent.taskComplete("session", "message", "已完成");

        Assertions.assertEquals("navigate", guidance.action().type());
        Assertions.assertEquals("生成三个分镜", guidance.action().initialPrompt());
        Assertions.assertTrue(JSON.toJSONString(guidance).contains("\"action\""));
        Assertions.assertNull(ordinary.action());
    }
}
