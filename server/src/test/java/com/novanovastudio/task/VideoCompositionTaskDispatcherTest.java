package com.novanovastudio.task;

import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.service.VideoCompositionTaskService;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 视频合成任务调度器测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-08-11 00:00
 */
class VideoCompositionTaskDispatcherTest {

    /** 视频合成队列 */
    private VideoCompositionTaskQueue taskQueue;

    /** 视频合成任务服务 */
    private VideoCompositionTaskService taskService;

    /** 待测试调度器 */
    private VideoCompositionTaskDispatcher dispatcher;

    /**
     * 初始化调度器依赖。
     */
    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        taskQueue = mock(VideoCompositionTaskQueue.class);
        taskService = mock(VideoCompositionTaskService.class);
        ObjectProvider<VideoCompositionTaskService> taskServiceProvider = mock(ObjectProvider.class);
        when(taskServiceProvider.getObject()).thenReturn(taskService);
        when(taskQueue.updateConcurrency(anyInt())).thenReturn(Mono.empty());
        when(taskQueue.enqueue(anyString())).thenReturn(Mono.empty());
        when(taskQueue.claimAvailable()).thenReturn(Flux.empty());
        dispatcher = new VideoCompositionTaskDispatcher(taskQueue, taskServiceProvider, new NovanovaProperties());
        dispatcher.start();
    }

    /**
     * 任务入队前应写入当前全站合成并发数并立即尝试领取。
     */
    @Test
    void shouldConfigureQueueAndDispatchAfterEnqueue() {
        dispatcher.enqueue("task-1").block();

        verify(taskQueue).updateConcurrency(1);
        verify(taskQueue).enqueue("task-1");
        verify(taskQueue).claimAvailable();
    }

    /**
     * 任务执行结束后必须释放活动名额，并继续检查等待队列。
     *
     * @throws InterruptedException 等待异步释放名额时发生中断
     */
    @Test
    void shouldReleaseActiveSlotAfterTaskFinishes() throws InterruptedException {
        CountDownLatch released = new CountDownLatch(1);
        when(taskQueue.claimAvailable()).thenReturn(Flux.just("task-1"), Flux.empty());
        when(taskService.executeQueuedTask("task-1")).thenReturn(Mono.empty());
        when(taskQueue.releaseActiveTask("task-1")).thenReturn(Mono.fromRunnable(released::countDown));

        dispatcher.enqueue("task-1").block();

        Assertions.assertTrue(released.await(2, TimeUnit.SECONDS));
        verify(taskQueue).releaseActiveTask("task-1");
        verify(taskQueue).claimAvailable();
    }

    /**
     * 释放调度器虚拟线程资源。
     */
    @AfterEach
    void tearDown() {
        dispatcher.stop();
    }
}
