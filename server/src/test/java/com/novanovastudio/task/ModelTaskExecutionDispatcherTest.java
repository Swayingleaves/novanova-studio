package com.novanovastudio.task;

import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.repository.PersistenceRepository;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * @title        ModelTaskExecutionDispatcherTest.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  模型任务调度器测试
 * @createTime   2026-08-10 00:00:00
 */
class ModelTaskExecutionDispatcherTest {

    /** 模型任务队列 */
    private ModelTaskQueue modelTaskQueue;

    /** AI任务执行器 */
    private AiTaskExecutionRunner taskExecutionRunner;

    /** 持久化仓储 */
    private PersistenceRepository persistenceRepository;

    /** 服务配置 */
    private NovanovaProperties properties;

    /** 待测试调度器 */
    private ModelTaskExecutionDispatcher dispatcher;

    /** 初始化测试依赖。 */
    @BeforeEach
    void setUp() {
        modelTaskQueue = mock(ModelTaskQueue.class);
        taskExecutionRunner = mock(AiTaskExecutionRunner.class);
        persistenceRepository = mock(PersistenceRepository.class);
        properties = new NovanovaProperties();
        dispatcher = new ModelTaskExecutionDispatcher(modelTaskQueue, taskExecutionRunner, persistenceRepository, properties);
        when(modelTaskQueue.initializeRequestConcurrency(anyString(), anyInt())).thenReturn(Mono.empty());
        when(modelTaskQueue.updateRequestConcurrency(anyString(), anyInt())).thenReturn(Mono.empty());
        when(modelTaskQueue.enqueue(anyString(), anyString())).thenReturn(Mono.empty());
        when(modelTaskQueue.claimAvailable(anyString())).thenReturn(Flux.empty());
    }

    /** 释放调度器线程资源。 */
    @AfterEach
    void tearDown() {
        dispatcher.stop();
    }

    /** 入队时应使用当前数据库并发数初始化模型队列。 */
    @Test
    void shouldInitializeCurrentConcurrencyBeforeEnqueue() {
        when(persistenceRepository.getPlatformModelRequestConcurrency("model-1")).thenReturn(Mono.just(3));

        dispatcher.enqueue("model-1", "task-1").block();

        verify(modelTaskQueue).initializeRequestConcurrency("model-1", 3);
        verify(modelTaskQueue).enqueue("model-1", "task-1");
        verify(modelTaskQueue).claimAvailable("model-1");
    }

    /** 修改并发数后应先更新Redis配置再立即补位。 */
    @Test
    void shouldRefreshConcurrencyAndFillWaitingTasks() {
        when(persistenceRepository.getPlatformModelRequestConcurrency("model-1")).thenReturn(Mono.just(3));

        dispatcher.refresh("model-1").block();

        verify(modelTaskQueue).updateRequestConcurrency("model-1", 3);
        verify(modelTaskQueue).claimAvailable("model-1");
    }

    /** 配置缺失或小于1时不得写入队列。 */
    @Test
    void shouldRejectMissingOrInvalidConcurrency() {
        when(persistenceRepository.getPlatformModelRequestConcurrency("model-1")).thenReturn(Mono.just(0));

        Assertions.assertThrows(IllegalStateException.class, () -> dispatcher.refresh("model-1").block());

        verifyNoInteractions(modelTaskQueue);
    }

    /** 执行成功或失败后都应释放模型名额并继续检查等待队列。 */
    @Test
    void shouldReleaseConcurrencyAfterTaskExecutionEnds() throws InterruptedException {
        CountDownLatch released = new CountDownLatch(1);
        when(persistenceRepository.getPlatformModelRequestConcurrency("model-1")).thenReturn(Mono.just(1));
        when(modelTaskQueue.claimAvailable("model-1")).thenReturn(Flux.just("task-1"), Flux.empty());
        when(taskExecutionRunner.execute("model-model-1", "task-1")).thenReturn(Mono.error(new IllegalStateException("执行失败")));
        when(modelTaskQueue.releaseActiveTask("model-1", "task-1")).thenReturn(Mono.fromRunnable(released::countDown));
        dispatcher.start();

        dispatcher.enqueue("model-1", "task-1").block();

        Assertions.assertTrue(released.await(2, TimeUnit.SECONDS));
        verify(modelTaskQueue).releaseActiveTask("model-1", "task-1");
        verify(modelTaskQueue).claimAvailable("model-1");
    }

    /** 执行器同步抛出异常时也应释放模型名额。 */
    @Test
    void shouldReleaseConcurrencyWhenRunnerThrowsSynchronously() throws InterruptedException {
        CountDownLatch released = new CountDownLatch(1);
        when(persistenceRepository.getPlatformModelRequestConcurrency("model-1")).thenReturn(Mono.just(1));
        when(modelTaskQueue.claimAvailable("model-1")).thenReturn(Flux.just("task-1"), Flux.empty());
        when(taskExecutionRunner.execute("model-model-1", "task-1")).thenThrow(new IllegalStateException("同步执行失败"));
        when(modelTaskQueue.releaseActiveTask("model-1", "task-1")).thenReturn(Mono.fromRunnable(released::countDown));
        dispatcher.start();

        dispatcher.enqueue("model-1", "task-1").block();

        Assertions.assertTrue(released.await(2, TimeUnit.SECONDS));
        verify(modelTaskQueue).releaseActiveTask("model-1", "task-1");
    }
}
