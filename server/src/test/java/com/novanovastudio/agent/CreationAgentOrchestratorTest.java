package com.novanovastudio.agent;

import static org.mockito.Mockito.mock;

import com.novanovastudio.agent.dto.AgentMessage;
import com.novanovastudio.agent.dto.AgentSession;
import com.novanovastudio.agent.dto.CreationPlan;
import com.novanovastudio.agent.dto.CreationSettings;
import com.novanovastudio.agent.dto.CreationTask;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.repository.AgentPlanRepository;
import com.novanovastudio.service.AiTaskService;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

/**
 * 统一主Agent入口路由和提示词约束测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-23 00:00
 */
class CreationAgentOrchestratorTest {

    /**
     * 图片、视频和画布入口必须全部由统一主Agent支持。
     */
    @Test
    void shouldSupportAllCreationEntrySources() {
        CreationAgentOrchestrator orchestrator = orchestrator(
                mock(AgentSessionService.class), mock(AgentScopeModelFactory.class), mock(AgentPlanRepository.class));

        Assertions.assertTrue(orchestrator.supports(CreationEntrySource.IMAGE_PAGE));
        Assertions.assertTrue(orchestrator.supports(CreationEntrySource.VIDEO_PAGE));
        Assertions.assertTrue(orchestrator.supports(CreationEntrySource.CANVAS));
        Assertions.assertFalse(orchestrator.supports("unknown"));
    }

    /**
     * 历史中的用户原始创作提示词可以被主Agent任务继续使用。
     */
    @Test
    void shouldAcceptPromptFromHistoricalUserMessage() {
        CreationAgentOrchestrator orchestrator = orchestrator(
                mock(AgentSessionService.class), mock(AgentScopeModelFactory.class), mock(AgentPlanRepository.class));
        AgentSession session = session(List.of(
                new AgentMessage("user-1", "user", "生成一只小猫和小狗在玩耍", null),
                new AgentMessage("assistant-1", "assistant", "请补充尺寸", null)));

        CreationPlan result = orchestrator.withServerPlanId(plan("生成一只小猫和小狗在玩耍"), session, "使用胶片风格");

        Assertions.assertEquals("生成一只小猫和小狗在玩耍", result.tasks().getFirst().prompt());
        Assertions.assertNotEquals("model-plan", result.planId());
    }

    /**
     * 主Agent不得将用户原文改写后作为任务提示词。
     */
    @Test
    void shouldRejectRewrittenPromptFromMainAgent() {
        CreationAgentOrchestrator orchestrator = orchestrator(
                mock(AgentSessionService.class), mock(AgentScopeModelFactory.class), mock(AgentPlanRepository.class));
        AgentSession session = session(List.of(new AgentMessage("user-1", "user", "生成一只小猫", null)));

        Assertions.assertThrows(BusinessException.class,
                () -> orchestrator.withServerPlanId(plan("一只橘色短毛猫在阳光下奔跑"), session, "生成一只小猫"));
    }

    /**
     * 多轮补充页面参数时，当前补参消息不得覆盖最初的创作提示词。
     */
    @Test
    void shouldKeepOriginalPromptWhenCurrentMessageOnlyAddsParameters() {
        CreationAgentOrchestrator orchestrator = orchestrator(
                mock(AgentSessionService.class), mock(AgentScopeModelFactory.class), mock(AgentPlanRepository.class));
        AgentSession session = session(List.of(new AgentMessage("user-1", "user", "生成一只小猫", null)));

        CreationPlan result = orchestrator.withServerPlanId(plan("生成一只小猫"), session, "尺寸 9:16，清晰度 2K");

        Assertions.assertEquals("生成一只小猫", result.tasks().getFirst().prompt());
    }

    /**
     * 构造主Agent编排器。
     *
     * @param sessionService AgentSessionService 会话服务
     * @param modelFactory AgentScopeModelFactory 模型工厂
     * @param planRepository AgentPlanRepository 计划仓储
     * @return CreationAgentOrchestrator 主Agent编排器
     */
    private CreationAgentOrchestrator orchestrator(AgentSessionService sessionService,
                                                    AgentScopeModelFactory modelFactory,
                                                    AgentPlanRepository planRepository) {
        return new CreationAgentOrchestrator(
                sessionService,
                mock(AgentEventEmitter.class),
                mock(AgentExecutionRegistry.class),
                modelFactory,
                mock(AgentScopeAgentFactory.class),
                mock(CreationPlanValidator.class),
                mock(CreationPlanExecutor.class),
                planRepository,
                mock(AiTaskService.class),
                new AgentToolRegistry());
    }

    /**
     * 构造包含指定历史消息的图片创作会话。
     *
     * @param messages List<AgentMessage> 会话消息
     * @return AgentSession 图片创作会话
     */
    private AgentSession session(List<AgentMessage> messages) {
        return new AgentSession("session", 1L, "新对话", CreationEntrySource.IMAGE_PAGE,
                messages, OffsetDateTime.now(), OffsetDateTime.now());
    }

    /**
     * 构造主Agent候选计划。
     *
     * @param prompt String 主Agent选择的任务提示词
     * @return CreationPlan 候选计划
     */
    private CreationPlan plan(String prompt) {
        return new CreationPlan("model-plan", "生成图片", CreationEntrySource.IMAGE_PAGE, "生成一张图片", "", false,
                new CreationSettings("image-model", "1:1", "2K", "high", 1, null, null),
                List.of(new CreationTask("task-1", "image", "generate", prompt, List.of(), null, Map.of())));
    }
}
