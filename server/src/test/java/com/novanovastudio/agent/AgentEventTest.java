package com.novanovastudio.agent;

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
}
