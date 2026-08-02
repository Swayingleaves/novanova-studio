package com.novanovastudio.agent;

import static org.mockito.Mockito.mock;

import com.novanovastudio.agent.dto.AgentMessage;
import com.novanovastudio.agent.dto.AgentChatRequest;
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
     * 画布多轮补充尺寸时，主Agent省略生成命令前缀也必须恢复完整用户消息。
     */
    @Test
    void shouldRestoreCanvasPromptWhenGenerationCommandPrefixIsDropped() {
        CreationAgentOrchestrator orchestrator = orchestrator(
                mock(AgentSessionService.class), mock(AgentScopeModelFactory.class), mock(AgentPlanRepository.class));
        AgentSession session = canvasSession(List.of(new AgentMessage("user-1", "user", "生成图片：小马在奔跑", null)));

        CreationPlan result = orchestrator.withServerPlanId(canvasPlan("小马在奔跑"), session, "9:16");

        Assertions.assertEquals("生成图片：小马在奔跑", result.tasks().getFirst().prompt());
    }

    /**
     * 画布视频多轮补充尺寸时，同样必须恢复完整用户消息。
     */
    @Test
    void shouldRestoreCanvasVideoPromptWhenGenerationCommandPrefixIsDropped() {
        CreationAgentOrchestrator orchestrator = orchestrator(
                mock(AgentSessionService.class), mock(AgentScopeModelFactory.class), mock(AgentPlanRepository.class));
        AgentSession session = canvasSession(List.of(new AgentMessage("user-1", "user", "生成视频：小马在奔跑", null)));

        CreationPlan result = orchestrator.withServerPlanId(canvasVideoPlan("小马在奔跑"), session, "9:16");

        Assertions.assertEquals("生成视频：小马在奔跑", result.tasks().getFirst().prompt());
    }

    /**
     * 画布已经选择风格且输入修改风格时，应标记为风格重生成请求。
     */
    @Test
    void shouldRecognizeCanvasStyleFollowUpRequest() {
        CreationAgentOrchestrator orchestrator = orchestrator(
                mock(AgentSessionService.class), mock(AgentScopeModelFactory.class), mock(AgentPlanRepository.class));
        AgentChatRequest request = new AgentChatRequest(null, CreationEntrySource.CANVAS, "修改风格", Map.of(),
                List.of(), List.of(), List.of(), new CreationSettings("image-model", "16:9", "2K", "high", 1,
                null, null, null, null, Map.of("image", List.of(7L))));

        Assertions.assertTrue(orchestrator.isStyleFollowUpRequest(request));
    }

    /**
     * 通用风格命令应直接重生成当前选中的图片节点，并沿用历史原始提示词。
     */
    @Test
    void shouldBuildCanvasStyleFollowUpGenerationPlan() {
        CreationAgentOrchestrator orchestrator = orchestrator(
                mock(AgentSessionService.class), mock(AgentScopeModelFactory.class), mock(AgentPlanRepository.class));
        AgentSession session = canvasSession(List.of(new AgentMessage("user-1", "user", "生成图片：小马在奔跑", null)));
        AgentChatRequest request = new AgentChatRequest(null, CreationEntrySource.CANVAS, "修改风格",
                Map.of("selectedNodeIds", List.of("image-1"), "nodes", List.of(Map.of(
                        "id", "image-1", "kind", "image", "generation", Map.of("prompt", "生成图片：小马在奔跑")))),
                List.of(), List.of(), List.of(), new CreationSettings("image-model", "16:9", "2K", "high", 1,
                null, null, null, null, Map.of("image", List.of(7L))));

        CreationPlan plan = orchestrator.buildStyleFollowUpPlan(session, request);

        Assertions.assertNotNull(plan);
        Assertions.assertEquals("canvas_run_generation", plan.tasks().getFirst().toolName());
        Assertions.assertEquals("生成图片：小马在奔跑", plan.tasks().getFirst().prompt());
        Assertions.assertEquals("image-1", plan.tasks().getFirst().toolArguments().get("nodeId"));
    }

    /**
     * 没有风格选择或普通创作消息不能被误判为风格重生成请求。
     */
    @Test
    void shouldNotRecognizeCanvasNormalGenerationAsStyleFollowUp() {
        CreationAgentOrchestrator orchestrator = orchestrator(
                mock(AgentSessionService.class), mock(AgentScopeModelFactory.class), mock(AgentPlanRepository.class));
        AgentChatRequest request = new AgentChatRequest(null, CreationEntrySource.CANVAS, "生成图片：小马在奔跑", Map.of(),
                List.of(), List.of(), List.of(), new CreationSettings("image-model", "16:9", "2K", "high", 1,
                null, null));

        Assertions.assertFalse(orchestrator.isStyleFollowUpRequest(request));
    }

    /**
     * 画布提示词只允许恢复完整命令正文，近似改写仍必须被拒绝。
     */
    @Test
    void shouldRejectCanvasPromptThatIsNotTheCompleteCommandBody() {
        CreationAgentOrchestrator orchestrator = orchestrator(
                mock(AgentSessionService.class), mock(AgentScopeModelFactory.class), mock(AgentPlanRepository.class));
        AgentSession session = canvasSession(List.of(new AgentMessage("user-1", "user", "生成图片：小马在奔跑", null)));

        Assertions.assertThrows(BusinessException.class,
                () -> orchestrator.withServerPlanId(canvasPlan("小马奔跑"), session, "9:16"));
    }

    /**
     * 用户发送重试时，主Agent误将重试指令作为提示词也必须恢复为最近一次创作目标。
     */
    @Test
    void shouldRestoreLatestPromptWhenRetryMessageIsSelectedAsTaskPrompt() {
        CreationAgentOrchestrator orchestrator = orchestrator(
                mock(AgentSessionService.class), mock(AgentScopeModelFactory.class), mock(AgentPlanRepository.class));
        AgentSession session = session(List.of(
                new AgentMessage("user-1", "user", "生成一只小猫和小狗在沙滩上玩耍", null),
                new AgentMessage("assistant-1", "assistant", "生成失败", null)));

        CreationPlan result = orchestrator.withServerPlanId(plan("重试"), session, "重试");

        Assertions.assertEquals("生成一只小猫和小狗在沙滩上玩耍", result.tasks().getFirst().prompt());
    }

    /**
     * 用户切换模型后发送重试时，恢复历史风格但保留本次模型和页面设置。
     */
    @Test
    void shouldRestoreHistoricalStylesWithoutOverwritingCurrentSettings() {
        CreationAgentOrchestrator orchestrator = orchestrator(
                mock(AgentSessionService.class), mock(AgentScopeModelFactory.class), mock(AgentPlanRepository.class));
        CreationSettings current = new CreationSettings("new-image-model", "9:16", "2K", "medium", 1, null, null);
        CreationSettings historical = new CreationSettings("old-image-model", "1:1", "1K", "high", 1, null, null,
                List.of(7L), null);

        CreationSettings result = orchestrator.mergeRetrySettings(current, historical);

        Assertions.assertEquals("new-image-model", result.model());
        Assertions.assertEquals("9:16", result.size());
        Assertions.assertEquals(List.of(7L), result.generationStyleIds());
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
     * 构造画布创作会话。
     *
     * @param messages List<AgentMessage> 会话消息
     * @return AgentSession 画布会话
     */
    private AgentSession canvasSession(List<AgentMessage> messages) {
        return new AgentSession("session", 1L, "新对话", CreationEntrySource.CANVAS,
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

    /**
     * 构造画布图片候选计划。
     *
     * @param prompt String 主Agent选择的任务提示词
     * @return CreationPlan 画布图片计划
     */
    private CreationPlan canvasPlan(String prompt) {
        return new CreationPlan("model-plan", "生成图片", CreationEntrySource.CANVAS, "生成一张图片", "", false,
                new CreationSettings("image-model", "1:1", "2K", "high", 1, null, null),
                List.of(new CreationTask("task-1", "image", "generate", prompt, List.of(), "canvas_generate_image",
                        Map.of("prompt", prompt, "size", "9:16"))));
    }

    /**
     * 构造画布视频候选计划。
     *
     * @param prompt String 主Agent选择的任务提示词
     * @return CreationPlan 画布视频计划
     */
    private CreationPlan canvasVideoPlan(String prompt) {
        return new CreationPlan("model-plan", "生成视频", CreationEntrySource.CANVAS, "生成一个视频", "", false,
                new CreationSettings("video-model", "16:9", "1080P", "high", 1, "5", false),
                List.of(new CreationTask("task-1", "video", "generate", prompt, List.of(), "canvas_generate_video",
                        Map.of("prompt", prompt, "size", "16:9"))));
    }
}
