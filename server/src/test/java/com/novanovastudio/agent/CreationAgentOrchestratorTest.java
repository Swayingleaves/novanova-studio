package com.novanovastudio.agent;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.alibaba.fastjson2.JSON;
import com.novanovastudio.agent.dto.AgentMessage;
import com.novanovastudio.agent.dto.AgentChatRequest;
import com.novanovastudio.agent.dto.AgentSession;
import com.novanovastudio.agent.dto.CreationPlan;
import com.novanovastudio.agent.dto.CreationSettings;
import com.novanovastudio.agent.dto.CreationTask;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.entity.CreationAgentRequest;
import com.novanovastudio.repository.AgentPlanRepository;
import com.novanovastudio.repository.CreationAgentRequestRepository;
import com.novanovastudio.service.AiTaskService;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import reactor.core.publisher.Mono;

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
     * 主Agent选择当前消息引用时，服务端必须回填完整原文而非采用模型改写内容。
     */
    @Test
    void shouldResolveCurrentPromptFromSourcePromptId() {
        CreationAgentOrchestrator orchestrator = orchestrator(
                mock(AgentSessionService.class), mock(AgentScopeModelFactory.class), mock(AgentPlanRepository.class));
        String originalPrompt = "Cloudfalre在今年七月份发布了Monetizaiton Gateway";

        CreationPlan result = orchestrator.resolveTaskPromptSources(planWithSourcePromptId("Cloudflare Monetization Gateway", "current"),
                session(List.of()), originalPrompt);

        Assertions.assertEquals(originalPrompt, result.tasks().getFirst().prompt());
    }

    /**
     * 主Agent选择历史消息引用时，服务端必须保留该消息的完整原文。
     */
    @Test
    void shouldResolveHistoricalPromptFromSourcePromptId() {
        CreationAgentOrchestrator orchestrator = orchestrator(
                mock(AgentSessionService.class), mock(AgentScopeModelFactory.class), mock(AgentPlanRepository.class));
        AgentSession session = session(List.of(new AgentMessage("user-1", "user", "生成一只小猫", null)));

        CreationPlan result = orchestrator.resolveTaskPromptSources(planWithSourcePromptId("一只短毛猫", "history-0"),
                session, "尺寸 9:16");

        Assertions.assertEquals("生成一只小猫", result.tasks().getFirst().prompt());
    }

    /**
     * 主Agent引用不存在的用户原文时必须拒绝计划，不能采用模型改写文本。
     */
    @Test
    void shouldRejectUnknownSourcePromptId() {
        CreationAgentOrchestrator orchestrator = orchestrator(
                mock(AgentSessionService.class), mock(AgentScopeModelFactory.class), mock(AgentPlanRepository.class));

        Assertions.assertThrows(BusinessException.class,
                () -> orchestrator.resolveTaskPromptSources(planWithSourcePromptId("模型改写内容", "history-99"),
                        session(List.of()), "生成一只小猫"));
    }

    /**
     * 主Agent未提供用户原文引用时必须拒绝计划，避免旧字段回退绕过来源约束。
     */
    @Test
    void shouldRejectMissingSourcePromptId() {
        CreationAgentOrchestrator orchestrator = orchestrator(
                mock(AgentSessionService.class), mock(AgentScopeModelFactory.class), mock(AgentPlanRepository.class));

        Assertions.assertThrows(BusinessException.class,
                () -> orchestrator.resolveTaskPromptSources(plan("模型改写内容"), session(List.of()), "生成一只小猫"));
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
        Assertions.assertEquals("image", plan.tasks().getFirst().toolArguments().get("mode"));
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
     * 同一用户同一入口连续提交时，每次都必须创建独立请求并进入队列，不能复用或忽略旧请求。
     */
    @Test
    void shouldPersistAndQueueEverySameEntryRequest() {
        AgentSessionService sessionService = mock(AgentSessionService.class);
        CreationAgentRequestRepository requestRepository = mock(CreationAgentRequestRepository.class);
        CreationAgentRequestDispatcher requestDispatcher = mock(CreationAgentRequestDispatcher.class);
        AgentEventEmitter eventEmitter = mock(AgentEventEmitter.class);
        AgentSession agentSession = session(List.of());
        when(sessionService.getOrCreateSession(1L, null, CreationEntrySource.IMAGE_PAGE)).thenReturn(Mono.just(agentSession));
        when(requestRepository.create(any(CreationAgentRequest.class))).thenReturn(Mono.empty());
        when(requestDispatcher.enqueue(any(CreationAgentRequest.class))).thenReturn(Mono.empty());
        when(requestRepository.findStatusById(anyString())).thenReturn(Mono.just("queued"));
        CreationAgentOrchestrator orchestrator = queuedOrchestrator(sessionService, eventEmitter,
                mock(AgentPlanRepository.class), mock(AiTaskService.class), requestRepository, requestDispatcher,
                mock(CreationAgentRequestQueue.class));

        var first = orchestrator.startChat(1L, chatRequest("第一条图片请求")).block();
        var second = orchestrator.startChat(1L, chatRequest("第二条图片请求")).block();

        Assertions.assertNotNull(first);
        Assertions.assertNotNull(second);
        Assertions.assertEquals("session", first.sessionId());
        Assertions.assertEquals("session", second.sessionId());
        Assertions.assertEquals("queued", first.status());
        Assertions.assertEquals("queued", second.status());
        Assertions.assertNotEquals(first.requestId(), second.requestId());

        ArgumentCaptor<CreationAgentRequest> requestCaptor = ArgumentCaptor.forClass(CreationAgentRequest.class);
        verify(requestRepository, times(2)).create(requestCaptor.capture());
        verify(requestDispatcher, times(2)).enqueue(any(CreationAgentRequest.class));
        List<CreationAgentRequest> requests = requestCaptor.getAllValues();
        Assertions.assertEquals(first.requestId(), requests.getFirst().getId());
        Assertions.assertEquals(second.requestId(), requests.get(1).getId());
        Assertions.assertEquals("第一条图片请求", JSON.parseObject(requests.getFirst().getRequestData(), AgentChatRequest.class).message());
        Assertions.assertEquals("第二条图片请求", JSON.parseObject(requests.get(1).getRequestData(), AgentChatRequest.class).message());
        Assertions.assertEquals("session", JSON.parseObject(requests.getFirst().getRequestData(), AgentChatRequest.class).sessionId());
    }

    /**
     * 取消排队请求只能移除目标请求，不能影响同分区正在运行或其他入口的请求。
     */
    @Test
    void shouldCancelOnlyTargetQueuedRequest() {
        CreationAgentRequestRepository requestRepository = mock(CreationAgentRequestRepository.class);
        CreationAgentRequestDispatcher requestDispatcher = mock(CreationAgentRequestDispatcher.class);
        CreationAgentRequestQueue requestQueue = mock(CreationAgentRequestQueue.class);
        AgentPlanRepository planRepository = mock(AgentPlanRepository.class);
        AiTaskService aiTaskService = mock(AiTaskService.class);
        CreationAgentRequest queued = queuedRequest("request-b", "queued", "");
        when(requestRepository.findByIdForUser(1L, "request-b")).thenReturn(Mono.just(queued));
        when(requestRepository.cancelQueuedIfQueued(1L, "request-b", "已停止生成")).thenReturn(Mono.just(true));
        when(requestQueue.removeQueuedRequest(1L, CreationEntrySource.IMAGE_PAGE, "request-b")).thenReturn(Mono.empty());
        when(requestQueue.releaseActiveRequest(1L, CreationEntrySource.IMAGE_PAGE, "request-b")).thenReturn(Mono.empty());
        when(requestDispatcher.dispatchAvailable(1L, CreationEntrySource.IMAGE_PAGE)).thenReturn(Mono.empty());
        CreationAgentOrchestrator orchestrator = queuedOrchestrator(mock(AgentSessionService.class), mock(AgentEventEmitter.class),
                planRepository, aiTaskService, requestRepository, requestDispatcher, requestQueue);

        orchestrator.cancelChat(1L, "request-b").block();

        verify(requestRepository).cancelQueuedIfQueued(1L, "request-b", "已停止生成");
        verify(requestQueue).removeQueuedRequest(1L, CreationEntrySource.IMAGE_PAGE, "request-b");
        verify(requestQueue).releaseActiveRequest(1L, CreationEntrySource.IMAGE_PAGE, "request-b");
        verify(requestDispatcher).dispatchAvailable(1L, CreationEntrySource.IMAGE_PAGE);
        verify(requestRepository, never()).cancelRunningIfRunning(anyLong(), anyString(), anyString());
        verify(requestQueue, never()).markCancelRequested(anyString());
        verify(planRepository, never()).cancelPlan(anyString());
        verify(aiTaskService, never()).cancelTaskForUser(anyLong(), anyString());
    }

    /**
     * 取消运行请求必须写入跨实例取消标记，并取消已创建计划和底层任务。
     */
    @Test
    void shouldMarkAndCancelRunningRequestResources() {
        CreationAgentRequestRepository requestRepository = mock(CreationAgentRequestRepository.class);
        CreationAgentRequestDispatcher requestDispatcher = mock(CreationAgentRequestDispatcher.class);
        CreationAgentRequestQueue requestQueue = mock(CreationAgentRequestQueue.class);
        AgentPlanRepository planRepository = mock(AgentPlanRepository.class);
        AiTaskService aiTaskService = mock(AiTaskService.class);
        CreationAgentRequest running = queuedRequest("request-running", "running", "plan-1");
        running.setTaskIds("[\"task-1\"]");
        when(requestRepository.findByIdForUser(1L, "request-running")).thenReturn(Mono.just(running));
        when(requestRepository.cancelRunningIfRunning(1L, "request-running", "已停止生成")).thenReturn(Mono.just(true));
        when(requestQueue.markCancelRequested("request-running")).thenReturn(Mono.empty());
        when(requestRepository.taskIds(running)).thenReturn(List.of("task-1"));
        when(planRepository.cancelPlan("plan-1")).thenReturn(Mono.empty());
        when(aiTaskService.cancelTaskForUser(1L, "task-1")).thenReturn(Mono.empty());
        CreationAgentOrchestrator orchestrator = queuedOrchestrator(mock(AgentSessionService.class), mock(AgentEventEmitter.class),
                planRepository, aiTaskService, requestRepository, requestDispatcher, requestQueue);

        orchestrator.cancelChat(1L, "request-running").block();

        verify(requestRepository).cancelRunningIfRunning(1L, "request-running", "已停止生成");
        verify(requestQueue).markCancelRequested("request-running");
        verify(planRepository).cancelPlan("plan-1");
        verify(aiTaskService).cancelTaskForUser(1L, "task-1");
        verify(requestQueue, never()).removeQueuedRequest(anyLong(), anyString(), anyString());
        verify(requestDispatcher, never()).dispatchAvailable(anyLong(), anyString());
    }

    /**
     * 请求已领取但尚未建立执行上下文时，停止操作必须取消领取订阅，避免分区名额一直被占用。
     */
    @Test
    void shouldStopClaimedSubscriptionBeforeExecutionContextIsReady() {
        CreationAgentRequestRepository requestRepository = mock(CreationAgentRequestRepository.class);
        when(requestRepository.findById("request-running")).thenReturn(Mono.never());
        CreationAgentOrchestrator orchestrator = queuedOrchestrator(mock(AgentSessionService.class), mock(AgentEventEmitter.class),
                mock(AgentPlanRepository.class), mock(AiTaskService.class), requestRepository,
                mock(CreationAgentRequestDispatcher.class), mock(CreationAgentRequestQueue.class));

        reactor.core.Disposable subscription = orchestrator.executeClaimedRequest("request-running").subscribe();
        orchestrator.stopClaimedExecution("request-running").block();

        Assertions.assertTrue(subscription.isDisposed());
    }

    /**
     * 旧实例收到中断取消标记后，必须保持关联计划失败，不能覆盖为已取消。
     */
    @Test
    void shouldKeepInterruptedRequestPlanFailedWhenOldInstanceStops() {
        AgentPlanRepository planRepository = mock(AgentPlanRepository.class);
        CreationAgentRequest interrupted = queuedRequest("request-interrupted", "interrupted", "plan-1");
        interrupted.setErrorMessage("服务重启导致请求已中断");
        when(planRepository.markInterruptedPlanFailed("plan-1", "服务重启导致请求已中断"))
                .thenReturn(Mono.empty());
        CreationAgentOrchestrator orchestrator = queuedOrchestrator(mock(AgentSessionService.class), mock(AgentEventEmitter.class),
                planRepository, mock(AiTaskService.class), mock(CreationAgentRequestRepository.class),
                mock(CreationAgentRequestDispatcher.class), mock(CreationAgentRequestQueue.class));

        orchestrator.completePlanForTerminalRequest(interrupted, "plan-1", "已停止生成").block();

        verify(planRepository).markInterruptedPlanFailed("plan-1", "服务重启导致请求已中断");
        verify(planRepository, never()).cancelPlan("plan-1");
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
                new AgentToolRegistry(),
                mock(CreationAgentRequestRepository.class),
                mock(CreationAgentRequestDispatcher.class),
                mock(CreationAgentRequestQueue.class));
    }

    /**
     * 构造用于主Agent请求队列测试的编排器。
     *
     * @param sessionService Agent会话服务
     * @param eventEmitter Agent事件发射器
     * @param planRepository 创作计划仓储
     * @param aiTaskService 底层AI任务服务
     * @param requestRepository 主Agent请求仓储
     * @param requestDispatcher 主Agent请求调度器
     * @param requestQueue 主Agent请求Redis队列
     * @return CreationAgentOrchestrator 主Agent编排器
     */
    private CreationAgentOrchestrator queuedOrchestrator(AgentSessionService sessionService,
                                                          AgentEventEmitter eventEmitter,
                                                          AgentPlanRepository planRepository,
                                                          AiTaskService aiTaskService,
                                                          CreationAgentRequestRepository requestRepository,
                                                          CreationAgentRequestDispatcher requestDispatcher,
                                                          CreationAgentRequestQueue requestQueue) {
        return new CreationAgentOrchestrator(
                sessionService,
                eventEmitter,
                mock(AgentExecutionRegistry.class),
                mock(AgentScopeModelFactory.class),
                mock(AgentScopeAgentFactory.class),
                mock(CreationPlanValidator.class),
                mock(CreationPlanExecutor.class),
                planRepository,
                aiTaskService,
                new AgentToolRegistry(),
                requestRepository,
                requestDispatcher,
                requestQueue);
    }

    /**
     * 构造图片入口主Agent聊天请求。
     *
     * @param message String 用户消息
     * @return AgentChatRequest 聊天请求
     */
    private AgentChatRequest chatRequest(String message) {
        return new AgentChatRequest(null, CreationEntrySource.IMAGE_PAGE, message, Map.of(), List.of(), List.of(), List.of(), null);
    }

    /**
     * 构造主Agent请求记录。
     *
     * @param requestId String 请求ID
     * @param status String 请求状态
     * @param planId String 创作计划ID
     * @return CreationAgentRequest 请求记录
     */
    private CreationAgentRequest queuedRequest(String requestId, String status, String planId) {
        CreationAgentRequest request = new CreationAgentRequest();
        request.setId(requestId);
        request.setUserId(1L);
        request.setSessionId("session");
        request.setEntrySource(CreationEntrySource.IMAGE_PAGE);
        request.setStatus(status);
        request.setPlanId(planId);
        request.setTaskIds("[]");
        return request;
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
     * 构造携带用户原文引用的主Agent候选计划。
     *
     * @param prompt String 模型返回的临时提示词
     * @param sourcePromptId String 服务端用户原文引用
     * @return CreationPlan 候选计划
     */
    private CreationPlan planWithSourcePromptId(String prompt, String sourcePromptId) {
        return new CreationPlan("model-plan", "生成图片", CreationEntrySource.IMAGE_PAGE, "生成一张图片", "", false,
                new CreationSettings("image-model", "1:1", "2K", "high", 1, null, null),
                List.of(new CreationTask("task-1", "image", "generate", prompt, sourcePromptId, List.of(), null, Map.of())));
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
