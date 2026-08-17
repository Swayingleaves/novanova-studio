package com.novanovastudio.service;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.dto.VideoCompositionDtos;
import com.novanovastudio.repository.VideoCompositionTaskRepository;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.task.VideoCompositionMediaProcessor;
import com.novanovastudio.task.VideoCompositionTaskCancellation;
import com.novanovastudio.task.VideoCompositionTaskDispatcher;
import com.novanovastudio.task.VideoCompositionTaskQueue;
import java.util.List;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import reactor.core.publisher.Mono;

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

    /**
     * 初始化视频合成任务服务依赖。
     */
    @BeforeEach
    void setUp() {
        repository = mock(VideoCompositionTaskRepository.class);
        currentUserProvider = mock(CurrentUserProvider.class);
        persistenceService = mock(PersistenceService.class);
        taskDispatcher = mock(VideoCompositionTaskDispatcher.class);
        cancellation = mock(VideoCompositionTaskCancellation.class);
        taskService = new VideoCompositionTaskService(
                repository,
                currentUserProvider,
                persistenceService,
                mock(VideoCompositionMediaProcessor.class),
                taskDispatcher,
                mock(VideoCompositionTaskQueue.class),
                cancellation,
                new NovanovaProperties()
        );
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
