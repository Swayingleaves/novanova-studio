package com.novanovastudio.agent;

import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.entity.CreationAgentRequest;
import com.novanovastudio.repository.AgentPlanRepository;
import com.novanovastudio.repository.CreationAgentRequestRepository;
import com.novanovastudio.service.AiTaskService;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.springframework.beans.factory.ObjectProvider;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 统一主Agent请求分区调度器测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-08-13 00:00
 */
class CreationAgentRequestDispatcherTest {

    /** Redis主Agent请求队列。 */
    private CreationAgentRequestQueue requestQueue;

    /** 主Agent请求仓储。 */
    private CreationAgentRequestRepository requestRepository;

    /** 主Agent编排器。 */
    private CreationAgentOrchestrator orchestrator;

    /** 主Agent编排器提供器。 */
    private ObjectProvider<CreationAgentOrchestrator> orchestratorProvider;

    /** 创作计划仓储。 */
    private AgentPlanRepository planRepository;

    /** 底层AI任务服务。 */
    private AiTaskService aiTaskService;

    /** Agent事件发射器。 */
    private AgentEventEmitter eventEmitter;

    /** 待测试调度器。 */
    private CreationAgentRequestDispatcher dispatcher;

    /**
     * 初始化调度器依赖和虚拟线程执行器。
     */
    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        requestQueue = mock(CreationAgentRequestQueue.class);
        requestRepository = mock(CreationAgentRequestRepository.class);
        orchestrator = mock(CreationAgentOrchestrator.class);
        orchestratorProvider = mock(ObjectProvider.class);
        planRepository = mock(AgentPlanRepository.class);
        aiTaskService = mock(AiTaskService.class);
        eventEmitter = mock(AgentEventEmitter.class);
        when(orchestratorProvider.getObject()).thenReturn(orchestrator);
        when(orchestrator.stopClaimedExecution(anyString())).thenReturn(Mono.empty());
        when(requestQueue.enqueue(anyLong(), anyString(), anyString())).thenReturn(Mono.empty());
        when(requestQueue.claimAvailable(anyLong(), anyString())).thenReturn(Flux.empty());
        when(requestQueue.listExpiredActiveRequests()).thenReturn(Flux.empty());
        when(requestQueue.listActiveRequests()).thenReturn(Flux.empty());
        when(requestQueue.renewRecoveryClaim(org.mockito.ArgumentMatchers.any())).thenReturn(Mono.just(true));

        dispatcher = new CreationAgentRequestDispatcher(requestQueue, requestRepository, orchestratorProvider,
                planRepository, aiTaskService, eventEmitter, new NovanovaProperties());
        dispatcher.start();
    }

    /**
     * 释放调度器线程资源。
     */
    @AfterEach
    void tearDown() {
        dispatcher.stop();
    }

    /**
     * 服务恢复时，等待中的同分区请求必须按照创建顺序重新入队。
     */
    @Test
    void shouldRestoreQueuedRequestsInCreationOrder() {
        CreationAgentRequest first = request("request-1", "queued", "");
        CreationAgentRequest second = request("request-2", "queued", "");
        when(requestRepository.listRunningRequests()).thenReturn(Flux.empty());
        when(requestRepository.listQueuedRequests()).thenReturn(Flux.just(first, second));

        dispatcher.recoverRequests().block();

        InOrder order = inOrder(requestQueue);
        order.verify(requestQueue).enqueue(1L, CreationEntrySource.IMAGE_PAGE, "request-1");
        order.verify(requestQueue).enqueue(1L, CreationEntrySource.IMAGE_PAGE, "request-2");
        verify(eventEmitter).emit(eq(1L), org.mockito.ArgumentMatchers.argThat(event ->
                "queue-status".equals(event.type()) && "request-1".equals(event.requestId())));
        verify(eventEmitter).emit(eq(1L), org.mockito.ArgumentMatchers.argThat(event ->
                "queue-status".equals(event.type()) && "request-2".equals(event.requestId())));
    }

    /**
     * 已取消但仍持有有效活动租约的请求，在服务恢复时必须立即释放名额并补位。
     *
     * @throws InterruptedException 等待异步调度完成时发生中断
     */
    @Test
    void shouldReleaseCanceledRequestWithActiveLeaseAndDispatchNext() throws InterruptedException {
        CreationAgentRequest canceled = request("request-canceled", "canceled", "");
        CreationAgentRequestQueue.ActiveRequest activeRequest = new CreationAgentRequestQueue.ActiveRequest(1L,
                CreationEntrySource.IMAGE_PAGE, "request-canceled");
        CountDownLatch dispatched = new CountDownLatch(1);
        when(requestQueue.listActiveRequests()).thenReturn(Flux.just(activeRequest));
        when(requestRepository.findById("request-canceled")).thenReturn(Mono.just(canceled));
        when(requestRepository.taskIds(canceled)).thenReturn(List.of());
        when(requestQueue.claimCanceledActiveRecovery(1L, CreationEntrySource.IMAGE_PAGE, "request-canceled"))
                .thenReturn(Mono.just(new CreationAgentRequestQueue.RecoveryClaim(1L,
                        CreationEntrySource.IMAGE_PAGE, "request-canceled", "recovery-token")));
        when(requestQueue.markCancelRequested("request-canceled")).thenReturn(Mono.empty());
        when(requestQueue.releaseRecoveredActiveRequest(org.mockito.ArgumentMatchers.any())).thenReturn(Mono.empty());
        when(requestRepository.listRunningRequests()).thenReturn(Flux.empty());
        when(requestRepository.listQueuedRequests()).thenReturn(Flux.empty());
        when(requestQueue.claimAvailable(1L, CreationEntrySource.IMAGE_PAGE))
                .thenReturn(Flux.just("request-next"), Flux.empty());
        when(requestQueue.isCancelRequested("request-next")).thenReturn(Mono.just(false));
        when(orchestrator.executeClaimedRequest("request-next")).thenReturn(Mono.fromRunnable(dispatched::countDown));

        dispatcher.recoverRequests().block();

        Assertions.assertTrue(dispatched.await(2, TimeUnit.SECONDS));
        verify(requestQueue).releaseRecoveredActiveRequest(org.mockito.ArgumentMatchers.any());
        verify(orchestrator).executeClaimedRequest("request-next");
    }

    /**
     * 其他实例已领取失租请求的恢复权时，本实例不得重复中断请求、取消任务或释放分区名额。
     */
    @Test
    void shouldNotRecoverRunningRequestWhenAnotherInstanceOwnsRecoveryClaim() {
        CreationAgentRequest running = request("request-running", "running", "plan-1");
        when(requestRepository.listRunningRequests()).thenReturn(Flux.just(running));
        when(requestRepository.listQueuedRequests()).thenReturn(Flux.empty());
        when(requestQueue.hasActiveRequest(1L, CreationEntrySource.IMAGE_PAGE, "request-running"))
                .thenReturn(Mono.just(false));
        when(requestQueue.claimMissingLeaseRecovery(1L, CreationEntrySource.IMAGE_PAGE, "request-running"))
                .thenReturn(Mono.empty());

        dispatcher.recoverRequests().block();

        verify(requestRepository, never()).interruptRunningIfRunning(anyString(), anyString());
        verify(requestQueue, never()).releaseActiveRequest(anyLong(), anyString(), anyString());
        verifyNoInteractions(planRepository, aiTaskService);
    }

    /**
     * 重启后没有活动租约的运行请求必须中断、失败计划并取消已创建任务，不能重新执行。
     */
    @Test
    void shouldInterruptExpiredRunningRequestWithoutReplayingIt() {
        CreationAgentRequest running = request("request-running", "running", "plan-1");
        running.setTaskIds("[\"task-1\"]");
        CreationAgentRequest interrupted = request("request-running", "interrupted", "plan-1");
        interrupted.setTaskIds("[\"task-1\"]");
        when(requestRepository.listRunningRequests()).thenReturn(Flux.just(running));
        when(requestRepository.listQueuedRequests()).thenReturn(Flux.empty());
        when(requestQueue.hasActiveRequest(1L, CreationEntrySource.IMAGE_PAGE, "request-running"))
                .thenReturn(Mono.just(false));
        when(requestQueue.claimMissingLeaseRecovery(1L, CreationEntrySource.IMAGE_PAGE, "request-running"))
                .thenReturn(Mono.just(new CreationAgentRequestQueue.RecoveryClaim(1L,
                        CreationEntrySource.IMAGE_PAGE, "request-running", "recovery-token")));
        when(requestRepository.interruptRunningIfRunning("request-running", "服务重启导致请求已中断"))
                .thenReturn(Mono.just(true));
        when(requestQueue.markCancelRequested("request-running")).thenReturn(Mono.empty());
        when(requestQueue.releaseActiveRequest(1L, CreationEntrySource.IMAGE_PAGE, "request-running")).thenReturn(Mono.empty());
        when(requestQueue.releaseRecoveredActiveRequest(org.mockito.ArgumentMatchers.any())).thenReturn(Mono.empty());
        when(requestRepository.findById("request-running")).thenReturn(Mono.just(running), Mono.just(interrupted));
        when(requestRepository.taskIds(interrupted)).thenReturn(List.of("task-1"));
        when(planRepository.markInterruptedPlanFailed("plan-1", "服务重启导致请求已中断"))
                .thenReturn(Mono.empty());
        when(aiTaskService.cancelTaskForUser(1L, "task-1")).thenReturn(Mono.empty());

        dispatcher.recoverRequests().block();

        verify(requestRepository).interruptRunningIfRunning("request-running", "服务重启导致请求已中断");
        verify(requestQueue).markCancelRequested("request-running");
        verify(requestQueue).releaseRecoveredActiveRequest(org.mockito.ArgumentMatchers.any());
        verify(planRepository).markInterruptedPlanFailed("plan-1", "服务重启导致请求已中断");
        verify(aiTaskService).cancelTaskForUser(1L, "task-1");
        verify(requestQueue, never()).enqueue(1L, CreationEntrySource.IMAGE_PAGE, "request-running");
    }

    /**
     * 数据库中的运行请求失去Redis活动租约后，中断收尾必须立即补位同分区的下一项。
     *
     * @throws InterruptedException 等待异步调度完成时发生中断
     */
    @Test
    void shouldDispatchNextRequestAfterInterruptingRunningRequestWithoutActiveLease() throws InterruptedException {
        CreationAgentRequest running = request("request-running", "running", "plan-1");
        running.setTaskIds("[\"task-1\"]");
        CreationAgentRequest interrupted = request("request-running", "interrupted", "plan-1");
        interrupted.setTaskIds("[\"task-1\"]");
        CountDownLatch dispatched = new CountDownLatch(1);
        when(requestRepository.listRunningRequests()).thenReturn(Flux.just(running));
        when(requestRepository.listQueuedRequests()).thenReturn(Flux.empty());
        when(requestQueue.hasActiveRequest(1L, CreationEntrySource.IMAGE_PAGE, "request-running"))
                .thenReturn(Mono.just(false));
        when(requestQueue.claimMissingLeaseRecovery(1L, CreationEntrySource.IMAGE_PAGE, "request-running"))
                .thenReturn(Mono.just(new CreationAgentRequestQueue.RecoveryClaim(1L,
                        CreationEntrySource.IMAGE_PAGE, "request-running", "recovery-token")));
        when(requestRepository.interruptRunningIfRunning("request-running", "服务重启导致请求已中断"))
                .thenReturn(Mono.just(true));
        when(requestQueue.markCancelRequested("request-running")).thenReturn(Mono.empty());
        when(requestRepository.findById("request-running")).thenReturn(Mono.just(running), Mono.just(interrupted));
        when(requestRepository.taskIds(interrupted)).thenReturn(List.of("task-1"));
        when(aiTaskService.cancelTaskForUser(1L, "task-1")).thenReturn(Mono.empty());
        when(planRepository.markInterruptedPlanFailed("plan-1", "服务重启导致请求已中断"))
                .thenReturn(Mono.empty());
        when(requestQueue.releaseRecoveredActiveRequest(org.mockito.ArgumentMatchers.any()))
                .thenReturn(Mono.empty());
        when(requestQueue.claimAvailable(1L, CreationEntrySource.IMAGE_PAGE))
                .thenReturn(Flux.just("request-next"), Flux.empty());
        when(requestQueue.isCancelRequested("request-next")).thenReturn(Mono.just(false));
        when(orchestrator.executeClaimedRequest("request-next")).thenReturn(Mono.fromRunnable(dispatched::countDown));

        dispatcher.recoverRequests().block();

        Assertions.assertTrue(dispatched.await(2, TimeUnit.SECONDS));
        InOrder order = inOrder(requestQueue);
        order.verify(requestQueue).releaseRecoveredActiveRequest(org.mockito.ArgumentMatchers.any());
        order.verify(requestQueue).claimAvailable(1L, CreationEntrySource.IMAGE_PAGE);
        verify(orchestrator).executeClaimedRequest("request-next");
    }

    /**
     * 终态请求遗留的失效租约必须只释放名额并补位，不能再次取消计划或任务。
     */
    @Test
    void shouldReleaseExpiredLeaseForTerminalRequestAndDispatchNext() {
        CreationAgentRequest completed = request("request-completed", "success", "plan-1");
        CreationAgentRequestQueue.ExpiredActiveRequest expired =
                new CreationAgentRequestQueue.ExpiredActiveRequest(1L, CreationEntrySource.IMAGE_PAGE, "request-completed");
        when(requestQueue.listExpiredActiveRequests()).thenReturn(Flux.just(expired));
        when(requestRepository.findById("request-completed")).thenReturn(Mono.just(completed));
        when(requestRepository.listRunningRequests()).thenReturn(Flux.empty());
        when(requestRepository.listQueuedRequests()).thenReturn(Flux.empty());
        when(requestQueue.releaseActiveRequest(1L, CreationEntrySource.IMAGE_PAGE, "request-completed"))
                .thenReturn(Mono.empty());
        when(requestQueue.releaseRecoveredActiveRequest(org.mockito.ArgumentMatchers.any())).thenReturn(Mono.empty());

        dispatcher.recoverRequests().block();

        verify(requestQueue).releaseRecoveredActiveRequest(org.mockito.ArgumentMatchers.any());
        verify(requestQueue, times(1)).claimAvailable(1L, CreationEntrySource.IMAGE_PAGE);
        verifyNoInteractions(planRepository, aiTaskService);
    }

    /**
     * 失租的运行请求必须先中断、取消关联任务并释放租约，之后才领取同分区下一项。
     */
    @Test
    void shouldInterruptExpiredLeaseBeforeDispatchingNextRequest() {
        CreationAgentRequest running = request("request-running", "running", "plan-1");
        running.setTaskIds("[\"task-1\"]");
        CreationAgentRequest interrupted = request("request-running", "interrupted", "plan-1");
        interrupted.setTaskIds("[\"task-1\"]");
        CreationAgentRequestQueue.ExpiredActiveRequest expired =
                new CreationAgentRequestQueue.ExpiredActiveRequest(1L, CreationEntrySource.IMAGE_PAGE, "request-running");
        when(requestQueue.listExpiredActiveRequests()).thenReturn(Flux.just(expired));
        when(requestRepository.findById("request-running")).thenReturn(Mono.just(running), Mono.just(interrupted));
        when(requestRepository.listRunningRequests()).thenReturn(Flux.empty());
        when(requestRepository.listQueuedRequests()).thenReturn(Flux.empty());
        when(requestRepository.interruptRunningIfRunning("request-running", "主Agent请求活动租约已失效，已中断"))
                .thenReturn(Mono.just(true));
        when(requestQueue.markCancelRequested("request-running")).thenReturn(Mono.empty());
        when(requestRepository.taskIds(interrupted)).thenReturn(List.of("task-1"));
        when(aiTaskService.cancelTaskForUser(1L, "task-1")).thenReturn(Mono.empty());
        when(planRepository.markInterruptedPlanFailed("plan-1", "主Agent请求活动租约已失效，已中断"))
                .thenReturn(Mono.empty());
        when(requestQueue.releaseActiveRequest(1L, CreationEntrySource.IMAGE_PAGE, "request-running"))
                .thenReturn(Mono.empty());
        when(requestQueue.releaseRecoveredActiveRequest(org.mockito.ArgumentMatchers.any())).thenReturn(Mono.empty());

        dispatcher.recoverRequests().block();

        InOrder order = inOrder(requestRepository, requestQueue, aiTaskService, planRepository);
        order.verify(requestRepository).interruptRunningIfRunning("request-running", "主Agent请求活动租约已失效，已中断");
        order.verify(requestQueue).markCancelRequested("request-running");
        order.verify(aiTaskService).cancelTaskForUser(1L, "task-1");
        order.verify(planRepository).markInterruptedPlanFailed("plan-1", "主Agent请求活动租约已失效，已中断");
        order.verify(requestQueue).releaseRecoveredActiveRequest(org.mockito.ArgumentMatchers.any());
        order.verify(requestQueue).claimAvailable(1L, CreationEntrySource.IMAGE_PAGE);
    }

    /**
     * 已经写入中断状态的请求重启收尾时必须保留原始中断说明，不能被后续扫描说明覆盖。
     */
    @Test
    void shouldKeepPersistedInterruptedReasonDuringRecoveryCleanup() {
        CreationAgentRequest interrupted = request("request-interrupted", "interrupted", "plan-1");
        interrupted.setTaskIds("[\"task-1\"]");
        interrupted.setErrorMessage("首次恢复时记录的中断原因");
        CreationAgentRequestQueue.ExpiredActiveRequest expired =
                new CreationAgentRequestQueue.ExpiredActiveRequest(1L, CreationEntrySource.IMAGE_PAGE, "request-interrupted");
        when(requestQueue.listExpiredActiveRequests()).thenReturn(Flux.just(expired));
        when(requestRepository.findById("request-interrupted")).thenReturn(Mono.just(interrupted));
        when(requestRepository.interruptRunningIfRunning("request-interrupted", "主Agent请求活动租约已失效，已中断"))
                .thenReturn(Mono.just(false));
        when(requestQueue.markCancelRequested("request-interrupted")).thenReturn(Mono.empty());
        when(requestRepository.taskIds(interrupted)).thenReturn(List.of("task-1"));
        when(aiTaskService.cancelTaskForUser(1L, "task-1")).thenReturn(Mono.empty());
        when(planRepository.markInterruptedPlanFailed("plan-1", "首次恢复时记录的中断原因"))
                .thenReturn(Mono.empty());
        when(requestQueue.releaseRecoveredActiveRequest(org.mockito.ArgumentMatchers.any())).thenReturn(Mono.empty());
        when(requestRepository.listRunningRequests()).thenReturn(Flux.empty());
        when(requestRepository.listQueuedRequests()).thenReturn(Flux.empty());

        dispatcher.recoverRequests().block();

        verify(planRepository).markInterruptedPlanFailed("plan-1", "首次恢复时记录的中断原因");
        verify(eventEmitter).emit(eq(1L), org.mockito.ArgumentMatchers.argThat(event ->
                "error".equals(event.type()) && "首次恢复时记录的中断原因".equals(event.errorMessage())));
    }

    /**
     * Redis已领取但数据库仍为queued的请求必须回到队头，不得被后续请求越过。
     */
    @Test
    void shouldRequeueExpiredClaimThatWasNotMarkedRunning() {
        CreationAgentRequest queued = request("request-queued", "queued", "");
        CreationAgentRequestQueue.ExpiredActiveRequest expired =
                new CreationAgentRequestQueue.ExpiredActiveRequest(1L, CreationEntrySource.IMAGE_PAGE, "request-queued");
        when(requestQueue.listExpiredActiveRequests()).thenReturn(Flux.just(expired));
        when(requestRepository.findById("request-queued")).thenReturn(Mono.just(queued));
        when(requestRepository.listRunningRequests()).thenReturn(Flux.empty());
        when(requestRepository.listQueuedRequests()).thenReturn(Flux.empty());
        when(requestQueue.requeueExpiredClaim(1L, CreationEntrySource.IMAGE_PAGE, "request-queued"))
                .thenReturn(Mono.empty());
        when(requestQueue.requeueRecoveredClaim(org.mockito.ArgumentMatchers.any())).thenReturn(Mono.empty());

        dispatcher.recoverRequests().block();

        verify(requestQueue).requeueRecoveredClaim(org.mockito.ArgumentMatchers.any());
        verify(requestQueue, never()).releaseActiveRequest(1L, CreationEntrySource.IMAGE_PAGE, "request-queued");
        verifyNoInteractions(planRepository, aiTaskService);
    }

    /**
     * 仍有活动租约的运行请求属于其他存活实例，恢复扫描不得中断它。
     */
    @Test
    void shouldKeepRunningRequestWithActiveLease() {
        CreationAgentRequest running = request("request-running", "running", "plan-1");
        when(requestRepository.listRunningRequests()).thenReturn(Flux.just(running));
        when(requestRepository.listQueuedRequests()).thenReturn(Flux.empty());
        when(requestQueue.hasActiveRequest(1L, CreationEntrySource.IMAGE_PAGE, "request-running"))
                .thenReturn(Mono.just(true));

        dispatcher.recoverRequests().block();

        verify(requestRepository, never()).interruptRunningIfRunning(anyString(), anyString());
        verifyNoInteractions(planRepository, aiTaskService);
    }

    /**
     * 已领取请求结束后必须释放分区名额并领取同分区下一项。
     *
     * @throws InterruptedException 等待异步调度完成时发生中断
     */
    @Test
    void shouldReleaseSlotAndDispatchNextRequestInOrder() throws InterruptedException {
        CountDownLatch released = new CountDownLatch(2);
        when(requestQueue.claimAvailable(1L, CreationEntrySource.IMAGE_PAGE))
                .thenReturn(Flux.just("request-1"), Flux.just("request-2"), Flux.empty());
        when(requestQueue.isCancelRequested(anyString())).thenReturn(Mono.just(false));
        when(requestQueue.releaseActiveRequest(eq(1L), eq(CreationEntrySource.IMAGE_PAGE), anyString()))
                .thenAnswer(ignored -> Mono.fromRunnable(released::countDown));
        when(orchestrator.executeClaimedRequest(anyString())).thenReturn(Mono.empty());

        dispatcher.enqueue(request("request-1", "queued", "")).block();

        Assertions.assertTrue(released.await(2, TimeUnit.SECONDS));
        InOrder order = inOrder(orchestrator);
        order.verify(orchestrator).executeClaimedRequest("request-1");
        order.verify(orchestrator).executeClaimedRequest("request-2");
        verify(requestQueue).releaseActiveRequest(1L, CreationEntrySource.IMAGE_PAGE, "request-1");
        verify(requestQueue).releaseActiveRequest(1L, CreationEntrySource.IMAGE_PAGE, "request-2");
    }

    /**
     * 构造用于调度测试的请求记录。
     *
     * @param requestId String 请求ID
     * @param status String 请求状态
     * @param planId String 关联计划ID
     * @return CreationAgentRequest 请求记录
     */
    private CreationAgentRequest request(String requestId, String status, String planId) {
        CreationAgentRequest request = new CreationAgentRequest();
        request.setId(requestId);
        request.setUserId(1L);
        request.setSessionId("session-1");
        request.setEntrySource(CreationEntrySource.IMAGE_PAGE);
        request.setStatus(status);
        request.setPlanId(planId);
        request.setTaskIds("[]");
        return request;
    }
}
