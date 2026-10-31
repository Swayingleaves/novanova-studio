package com.novanovastudio.service;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.dto.VideoCompositionDtos;
import com.novanovastudio.repository.VideoCompositionTaskRepository;
import com.novanovastudio.repository.ComicDramaRepository;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.task.VideoCompositionMediaProcessor;
import com.novanovastudio.task.StoryboardVideoExportProcessor;
import com.novanovastudio.task.VideoCompositionTaskCancellation;
import com.novanovastudio.task.VideoCompositionTaskDispatcher;
import com.novanovastudio.task.VideoCompositionTaskQueue;
import java.time.Duration;
import java.util.List;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.publisher.Sinks;
import reactor.test.scheduler.VirtualTimeScheduler;

/**
 * 视频合成任务服务测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-08-11 00:00
 */
class VideoCompositionTaskServiceTest {

    /** 任务仓储 */
    private VideoCompositionTaskRepository repository;

    /** 当前用户提供器 */
    private CurrentUserProvider currentUserProvider;

    /** 媒体持久化服务 */
    private PersistenceService persistenceService;

    /** 任务调度器 */
    private VideoCompositionTaskDispatcher taskDispatcher;

    /** 任务取消标记 */
    private VideoCompositionTaskCancellation cancellation;

    /** 待测试服务 */
    private VideoCompositionTaskService taskService;

    /** 服务配置 */
    private NovanovaProperties properties;

    /**
     * 初始化视频合成任务服务依赖。
     */
    @BeforeEach
    void setUp() {
        repository = mock(VideoCompositionTaskRepository.class);
        currentUserProvider = mock(CurrentUserProvider.class);
        persistenceService = mock(PersistenceService.class);
        when(persistenceService.requireStorageWritable(org.mockito.ArgumentMatchers.anyLong())).thenReturn(Mono.empty());
        taskDispatcher = mock(VideoCompositionTaskDispatcher.class);
        cancellation = mock(VideoCompositionTaskCancellation.class);
        properties = new NovanovaProperties();
        taskService = new VideoCompositionTaskService(com.novanovastudio.TeamTestSupport.taskScope(), repository, currentUserProvider, persistenceService, mock(VideoCompositionMediaProcessor.class), mock(StoryboardVideoExportProcessor.class), mock(ComicDramaRepository.class), mock(ScriptService.class), mock(ComicDramaService.class), taskDispatcher, mock(VideoCompositionTaskQueue.class), cancellation, properties);
    }

    /**
     * 数据库扫描跨越多个轮询周期时，恢复订阅仍应继续，并能在服务停止时取消。
     */
    @Test
    void shouldContinueRecoveryAfterSlowScan() {
        properties.getAi().getTask().setPollingIntervalSeconds(1);
        Sinks.Empty<Void> pendingScan = Sinks.empty();
        when(repository.listPendingTasks()).thenReturn(pendingScan.asMono().thenMany(Flux.empty()));
        when(repository.listRunningTasks()).thenReturn(Flux.empty());
        VirtualTimeScheduler scheduler = VirtualTimeScheduler.getOrSet();
        try {
            taskService.recoverUnfinishedTasks();
            scheduler.advanceTimeBy(Duration.ofSeconds(100));
            verify(repository, times(1)).listPendingTasks();

            Assertions.assertEquals(Sinks.EmitResult.OK, pendingScan.tryEmitEmpty());
            scheduler.advanceTimeBy(Duration.ofSeconds(1));
            verify(repository, times(2)).listPendingTasks();

            taskService.stopRecovery();
            scheduler.advanceTimeBy(Duration.ofSeconds(10));
            verify(repository, times(2)).listPendingTasks();
        } finally {
            taskService.stopRecovery();
            VirtualTimeScheduler.reset();
        }
    }

    /**
     * 同一个源视频不能在一次合成请求中重复出现。
     */
    @Test
    void shouldRejectDuplicateSourceStorageKeys() {
        Assertions.assertThrows(BusinessException.class, () -> taskService.createTask(
                new VideoCompositionDtos.CreateVideoCompositionRequest(List.of("video:one", "video:one"))
        ));

        verifyNoInteractions(repository, currentUserProvider, persistenceService, taskDispatcher, cancellation);
    }

    /**
     * 创建任务前应逐个校验当前用户拥有的源视频，并保持请求顺序。
     */
    @Test
    void shouldValidateOwnedVideosBeforeQueueingTask() {
        when(currentUserProvider.currentUserId()).thenReturn(Mono.just(12L));
        when(persistenceService.validateVideoMediaForUser(12L, "video:first")).thenReturn(Mono.empty());
        when(persistenceService.validateVideoMediaForUser(12L, "video:second")).thenReturn(Mono.empty());
        when(cancellation.clearCancellation(anyString())).thenReturn(Mono.empty());
        when(repository.createTask(any())).thenReturn(Mono.empty());
        when(taskDispatcher.enqueue(anyString())).thenReturn(Mono.empty());

        VideoCompositionDtos.VideoCompositionTaskResponse response = taskService.createTask(
                new VideoCompositionDtos.CreateVideoCompositionRequest(List.of("video:first", "video:second"))
        ).block();

        Assertions.assertNotNull(response);
        Assertions.assertEquals(List.of("video:first", "video:second"), response.sourceStorageKeys());
    }
}
