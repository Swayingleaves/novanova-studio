package com.novanovastudio.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.novanovastudio.ai.AiProviderAdapterRegistry;
import com.novanovastudio.ai.AiTaskExecutionContext;
import com.novanovastudio.ai.provider.CustomProviderAdapter;
import com.novanovastudio.agent.AgentTaskOrchestrator;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.entity.AiGenerationTask;
import com.novanovastudio.repository.AiTaskRepository;
import com.novanovastudio.repository.DramaRepository;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.storage.MediaAccessService;
import com.novanovastudio.task.AiTaskEventPublisher;
import com.novanovastudio.task.AiTaskQueue;
import com.novanovastudio.task.ModelTaskExecutionDispatcher;
import com.novanovastudio.task.ModelTaskQueue;
import com.novanovastudio.task.RedisTaskLock;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.reactive.TransactionalOperator;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 验证后端重启后未完成 AI 任务的断点续查与失联清理逻辑。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-24 23:08
 */
class AiTaskRestartRecoveryTest {

    private AiTaskRepository repository;
    private ModelTaskExecutionDispatcher modelDispatcher;
    private ModelTaskQueue modelTaskQueue;
    private RedisTaskLock taskLock;
    private AiTaskService service;

    @BeforeEach
    void setUp() {
        repository = mock(AiTaskRepository.class);
        modelDispatcher = mock(ModelTaskExecutionDispatcher.class);
        modelTaskQueue = mock(ModelTaskQueue.class);
        taskLock = mock(RedisTaskLock.class);
        TransactionalOperator transactionalOperator = mock(TransactionalOperator.class);
        when(transactionalOperator.transactional(any(Mono.class))).thenAnswer(invocation -> invocation.getArgument(0));
        service = new AiTaskService(
                mock(TeamTaskScopeService.class),
                repository,
                mock(CurrentUserProvider.class),
                new NovanovaProperties(),
                mock(PersistenceService.class),
                mock(DramaRepository.class),
                mock(StorageBillingService.class),
                mock(MediaAccessService.class),
                mock(AiTaskEventPublisher.class),
                mock(AiTaskQueue.class),
                modelDispatcher,
                mock(AgentTaskOrchestrator.class),
                mock(AiProviderAdapterRegistry.class),
                mock(CustomProviderAdapter.class),
                mock(CreditService.class),
                transactionalOperator
        );
        ReflectionTestUtils.setField(service, "taskLock", taskLock);
        ReflectionTestUtils.setField(service, "modelTaskQueue", modelTaskQueue);
        when(modelTaskQueue.releaseActiveTask(anyString(), anyString())).thenReturn(Mono.empty());
        when(modelDispatcher.enqueue(anyString(), anyString())).thenReturn(Mono.empty());
    }

    @Test
    void resumesPollingForUnlockedRunningTaskWithProviderTaskId() {
        AiGenerationTask task = runningVideoTask("task-1", "mc-1", true, "upstream-123");
        when(repository.listUnfinishedTasks()).thenReturn(Flux.just(task));
        when(taskLock.isLocked("task-1")).thenReturn(Mono.just(false));

        service.recoverUnfinishedTasksOnce(false).block();

        verify(modelTaskQueue).releaseActiveTask("mc-1", "task-1");
        verify(modelDispatcher).enqueue("mc-1", "task-1");
        verify(repository, never()).resetRunningTaskToPending(anyString());
    }

    @Test
    void resetsAndRequeuesUnlockedRunningTaskNotYetSentToProvider() {
        AiGenerationTask task = runningVideoTask("task-2", "mc-1", false, "");
        when(repository.listUnfinishedTasks()).thenReturn(Flux.just(task));
        when(taskLock.isLocked("task-2")).thenReturn(Mono.just(false));
        when(repository.resetRunningTaskToPending("task-2")).thenReturn(Mono.just(true));

        service.recoverUnfinishedTasksOnce(false).block();

        verify(modelTaskQueue).releaseActiveTask("mc-1", "task-2");
        verify(repository).resetRunningTaskToPending("task-2");
        verify(modelDispatcher).enqueue("mc-1", "task-2");
    }

    @Test
    void skipsLockedRunningTask() {
        AiGenerationTask task = runningVideoTask("task-3", "mc-1", true, "upstream-456");
        when(repository.listUnfinishedTasks()).thenReturn(Flux.just(task));
        when(taskLock.isLocked("task-3")).thenReturn(Mono.just(true));

        service.recoverUnfinishedTasksOnce(false).block();

        verify(modelTaskQueue, never()).releaseActiveTask(anyString(), anyString());
        verify(modelDispatcher, never()).enqueue(anyString(), anyString());
        verify(repository, never()).resetRunningTaskToPending(anyString());
    }

    @Test
    void failsUnlockedSentTaskWithoutProviderTaskId() {
        AiGenerationTask task = runningVideoTask("task-4", "mc-1", true, "");
        when(repository.listUnfinishedTasks()).thenReturn(Flux.just(task));
        when(taskLock.isLocked("task-4")).thenReturn(Mono.just(false));
        when(repository.updateTaskIfNotTerminal(eq("task-4"), any(), any())).thenReturn(Mono.just(false));

        service.recoverUnfinishedTasksOnce(false).block();

        verify(modelTaskQueue).releaseActiveTask("mc-1", "task-4");
        verify(modelDispatcher, never()).enqueue(anyString(), anyString());
        verify(repository).updateTaskIfNotTerminal(eq("task-4"), any(), any());
    }

    @Test
    void contextRecordsAndExposesProviderTaskId() {
        AiGenerationTask task = runningVideoTask("task-5", "mc-1", true, "");
        AtomicReference<String> saved = new AtomicReference<>();
        AiTaskExecutionContext context = new AiTaskExecutionContext(
                task, null, "seedance", false, null, null, null,
                () -> Mono.just(false), p -> Mono.empty(), d -> Mono.empty(),
                false, null, false, null,
                id -> Mono.fromRunnable(() -> saved.set(id)));

        assertEquals("", context.existingProviderTaskId());
        context.recordProviderTaskId("  prov-999  ").block();
        assertEquals("prov-999", saved.get());
        assertEquals("prov-999", context.existingProviderTaskId());
    }

    private static AiGenerationTask runningVideoTask(String id, String modelConfigId, boolean sent, String providerTaskId) {
        AiGenerationTask task = new AiGenerationTask();
        task.setId(id);
        task.setUserId(1L);
        task.setTaskType("video");
        task.setModelConfigId(modelConfigId);
        task.setStatus("running");
        task.setProgress(95);
        task.setProviderRequestSent(sent);
        task.setProviderTaskId(providerTaskId);
        return task;
    }
}
