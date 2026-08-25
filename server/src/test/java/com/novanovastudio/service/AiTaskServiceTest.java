package com.novanovastudio.service;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.novanovastudio.agent.AgentTaskOrchestrator;
import com.novanovastudio.ai.AiProviderAdapter;
import com.novanovastudio.ai.AiProviderAdapterRegistry;
import com.novanovastudio.ai.AiErrorDetails;
import com.novanovastudio.ai.AiProviderException;
import com.novanovastudio.ai.AiTaskTypes;
import com.novanovastudio.ai.AiTaskSources;
import com.novanovastudio.ai.VideoGenerationMode;
import com.novanovastudio.ai.provider.CustomProviderAdapter;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.dto.AiTaskDtos;
import com.novanovastudio.dto.PersistenceDtos;
import com.novanovastudio.dto.VideoBillingConfiguration;
import com.novanovastudio.entity.AiGenerationTask;
import com.novanovastudio.repository.AiTaskRepository;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.task.AiTaskEventPublisher;
import com.novanovastudio.task.AiTaskQueue;
import com.novanovastudio.task.ModelTaskExecutionDispatcher;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.transaction.reactive.TransactionalOperator;
import reactor.core.publisher.Mono;

/**
 * AI任务服务测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-10 00:00
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class AiTaskServiceTest {

    /** AI任务仓储 */
    @Mock
    private AiTaskRepository repository;

    /** 当前用户提供器 */
    @Mock
    private CurrentUserProvider currentUserProvider;

    /** 服务配置 */
    @Mock
    private NovanovaProperties properties;

    /** 业务持久化服务 */
    @Mock
    private PersistenceService persistenceService;

    /** 任务事件发布器 */
    @Mock
    private AiTaskEventPublisher eventPublisher;

    /** AI任务队列 */
    @Mock
    private AiTaskQueue taskQueue;

    /** 模型任务执行调度器 */
    @Mock
    private ModelTaskExecutionDispatcher modelTaskExecutionDispatcher;

    /** Agent任务编排器 */
    @Mock
    private AgentTaskOrchestrator orchestrator;

    /** 渠道适配器注册表 */
    @Mock
    private AiProviderAdapterRegistry adapterRegistry;

    /** 自定义模型供应商适配器 */
    @Mock
    private CustomProviderAdapter customProviderAdapter;

    /** 图片供应商适配器 */
    private AiProviderAdapter providerAdapter;

    /** 积分服务 */
    @Mock
    private CreditService creditService;

    /** 响应式事务操作器 */
    @Mock
    private TransactionalOperator transactionalOperator;

    /** 待测试服务 */
    private AiTaskService service;

    /** 响应式操作实际执行顺序 */
    private List<String> executionOrder;

    /**
     * 初始化测试依赖和响应式执行记录。
     */
    @BeforeEach
    void setUp() {
        executionOrder = new ArrayList<>();
        service = new AiTaskService(repository, currentUserProvider, properties, persistenceService,
                eventPublisher, taskQueue, modelTaskExecutionDispatcher, orchestrator, adapterRegistry, customProviderAdapter, creditService, transactionalOperator);

        AiTaskDtos.AiChannelConfig channel = new AiTaskDtos.AiChannelConfig(
                "channel-1", "图片渠道", "https://example.com", "key", "openai", List.of("model-1"));
        when(currentUserProvider.currentUserId()).thenReturn(Mono.just(7L));
        when(persistenceService.getPlatformAiChannels()).thenReturn(Mono.just(List.of(channel)));
        when(persistenceService.getPlatformModelConfigs()).thenReturn(Mono.just(List.of(
                new PersistenceDtos.ModelConfig("model-config-1", "channel-1", "model-1", AiTaskTypes.IMAGE, List.of(), true, 0, 0, true, "high"),
                new PersistenceDtos.ModelConfig("model-config-2", "channel-1", "model-1", AiTaskTypes.VIDEO,
                        List.of(VideoGenerationMode.TEXT_TO_VIDEO, VideoGenerationMode.IMAGE_TO_VIDEO, VideoGenerationMode.REFERENCE_TO_VIDEO), true, 0, 0, true, "high", "generation", 1,
                        new com.alibaba.fastjson2.JSONObject(), new VideoBillingConfiguration("generation", 3,
                        Map.of(VideoGenerationMode.TEXT_TO_VIDEO, Map.of("720p", 6),
                                VideoGenerationMode.IMAGE_TO_VIDEO, Map.of("720p", 8),
                                VideoGenerationMode.REFERENCE_TO_VIDEO, Map.of("720p", 10))), null, null, false, null),
                new PersistenceDtos.ModelConfig("model-config-3", "channel-1", "model-1", AiTaskTypes.TEXT, List.of(), true, 0, 0, true, "high")
        )));
        providerAdapter = mock(AiProviderAdapter.class);
        when(adapterRegistry.resolve(any(AiTaskDtos.AiChannelConfig.class), eq(AiTaskTypes.IMAGE)))
                .thenReturn(providerAdapter);
        when(adapterRegistry.resolve(any(AiTaskDtos.AiChannelConfig.class), eq(AiTaskTypes.VIDEO)))
                .thenReturn(providerAdapter);
        when(adapterRegistry.resolve(any(AiTaskDtos.AiChannelConfig.class), eq(AiTaskTypes.TEXT)))
                .thenReturn(providerAdapter);
        when(repository.createTask(any(AiGenerationTask.class))).thenReturn(Mono.defer(() -> {
            executionOrder.add("create");
            return Mono.empty();
        }));
        when(creditService.chargeTask(anyLong(), anyString(), org.mockito.ArgumentMatchers.anyInt(), anyString(), org.mockito.ArgumentMatchers.nullable(String.class))).thenReturn(Mono.empty());
        org.mockito.Mockito.lenient().when(creditService.refundTask(anyLong(), anyString(), anyString())).thenReturn(Mono.empty());
        when(transactionalOperator.transactional(org.mockito.ArgumentMatchers.<Mono<Object>>any())).thenAnswer(invocation -> invocation.getArgument(0));
        org.mockito.Mockito.lenient().when(repository.updateTaskIfNotTerminal(anyString(), any(), org.mockito.ArgumentMatchers.nullable(String.class))).thenReturn(Mono.just(true));
        when(repository.getTask(eq(7L), anyString())).thenAnswer(invocation -> Mono.defer(() -> {
            executionOrder.add("read");
            return Mono.just(task(invocation.getArgument(1)));
        }));
        org.mockito.Mockito.lenient().when(eventPublisher.publish(anyLong(), any(AiTaskDtos.AiTaskEvent.class))).thenReturn(Mono.defer(() -> {
            executionOrder.add("publish");
            return Mono.empty();
        }));
        org.mockito.Mockito.lenient().when(taskQueue.enqueue(anyString())).thenReturn(Mono.defer(() -> {
            executionOrder.add("enqueue");
            return Mono.empty();
        }));
        org.mockito.Mockito.lenient().when(modelTaskExecutionDispatcher.enqueue(anyString(), anyString())).thenReturn(Mono.defer(() -> {
            executionOrder.add("modelEnqueue");
            return Mono.empty();
        }));
    }

    /**
     * 图片任务入库并读取响应后，应先完成入队前处理，再发布事件和写入模型队列。
     */
    @Test
    void shouldRunBeforeEnqueueAfterTaskResponseAndBeforePublishAndEnqueue() {
        AiTaskDtos.AiGenerationTaskResponse response = service.createTask(request(), taskResponse -> Mono.fromRunnable(() -> {
            executionOrder.add("beforeEnqueue");
            Assertions.assertNotNull(taskResponse.id());
            Assertions.assertFalse(taskResponse.id().isBlank());
        })).block();

        Assertions.assertNotNull(response);
        Assertions.assertEquals(List.of("create", "read", "beforeEnqueue", "publish", "modelEnqueue"), executionOrder);
        verify(modelTaskExecutionDispatcher).enqueue(eq("model-config-1"), anyString());
    }

    /** 视频任务应按对应模型配置进入模型队列。 */
    @Test
    void shouldEnqueueVideoTaskToModelQueue() {
        AiTaskDtos.CreateAiTaskRequest request = new AiTaskDtos.CreateAiTaskRequest(
                AiTaskTypes.VIDEO, "生成视频", "channel-1::model-1", java.util.Map.of("seconds", 5, "resolution", "720p"), List.of(), List.of(), AiTaskSources.VIDEO_PAGE);

        AiTaskDtos.AiGenerationTaskResponse response = service.createTask(request).block();

        Assertions.assertNotNull(response);
        Assertions.assertTrue(executionOrder.contains("modelEnqueue"));
        verify(modelTaskExecutionDispatcher).enqueue(eq("model-config-2"), anyString());
    }

    /**
     * 文本任务应继续使用全局AI任务队列。
     */
    @Test
    void shouldEnqueueTextTaskToGlobalQueue() {
        AiTaskDtos.CreateAiTaskRequest request = new AiTaskDtos.CreateAiTaskRequest(
                AiTaskTypes.TEXT, "生成文本", "channel-1::model-1", java.util.Map.of(), List.of(), List.of(), null);

        AiTaskDtos.AiGenerationTaskResponse response = service.createTask(request).block();

        Assertions.assertNotNull(response);
        Assertions.assertTrue(executionOrder.contains("enqueue"));
        Assertions.assertFalse(executionOrder.contains("modelEnqueue"));
    }

    /**
     * 入队前处理失败时，应保留已创建任务行但不得发布事件或写入队列。
     */
    @Test
    void shouldNotPublishOrEnqueueWhenBeforeEnqueueFails() {
        IllegalStateException exception = Assertions.assertThrows(IllegalStateException.class,
                () -> service.createTask(request(), taskResponse -> Mono.defer(() -> {
                    executionOrder.add("beforeEnqueue");
                    return Mono.error(new IllegalStateException("pending保存失败"));
                })).block());

        Assertions.assertEquals("pending保存失败", exception.getMessage());
        Assertions.assertEquals(List.of("create", "read", "beforeEnqueue"), executionOrder);
    }

    /**
     * 供应商结构化失败进入任务终态时必须退回该任务积分。
     */
    @Test
    void shouldRefundCreditsWhenProviderTaskFails() {
        when(repository.getTaskById("task-1")).thenReturn(Mono.just(task("task-1")));
        when(repository.markTaskRunningIfExecutable("task-1")).thenReturn(Mono.just(true));
        when(eventPublisher.isCancelRequested("task-1")).thenReturn(Mono.just(false));
        when(providerAdapter.execute(any())).thenReturn(Mono.error(new AiProviderException(
                new AiErrorDetails("provider", "prompt_policy_violation", "submission", 400,
                        "content_policy_violation", "invalid_request_error", "prompt", "提示词不符合内容策略",
                        false, true))));

        service.executeQueuedTask("task-1").block();

        verify(creditService).refundTask(7L, "task-1", AiTaskTypes.IMAGE);
    }

    /** 已持久化模型配置缺失时，图片任务不得按同名模型改投。 */
    @Test
    void shouldFailAndRefundWhenQueuedModelConfigIsMissing() {
        AiGenerationTask queuedTask = task("task-1");
        queuedTask.setModelConfigId("deleted-model-config");
        when(repository.getTaskById("task-1")).thenReturn(Mono.just(queuedTask));
        when(repository.markTaskRunningIfExecutable("task-1")).thenReturn(Mono.just(true));
        when(eventPublisher.isCancelRequested("task-1")).thenReturn(Mono.just(false));

        service.executeQueuedTask("task-1").block();

        verify(creditService).refundTask(7L, "task-1", AiTaskTypes.IMAGE);
        verify(providerAdapter, never()).execute(any());
    }

    /**
     * 分镜来源不能创建文本任务。
     */
    @Test
    void shouldRejectStoryboardSourceForTextTask() {
        AiTaskDtos.CreateAiTaskRequest request = new AiTaskDtos.CreateAiTaskRequest(
                AiTaskTypes.TEXT, "文本任务", "channel-1::model-1", java.util.Map.of(), List.of(), List.of(), AiTaskSources.STORYBOARD);

        Assertions.assertThrows(BusinessException.class, () -> service.createTask(request).block());
    }

    /**
     * 分镜来源应允许创建视频任务。
     */
    @Test
    void shouldAllowStoryboardSourceForVideoTask() {
        AiTaskDtos.CreateAiTaskRequest request = new AiTaskDtos.CreateAiTaskRequest(
                AiTaskTypes.VIDEO, "生成分镜视频", "channel-1::model-1", java.util.Map.of("seconds", 5, "resolution", "720p"), List.of(), List.of(), AiTaskSources.STORYBOARD);

        AiTaskDtos.AiGenerationTaskResponse response = service.createTask(request).block();

        Assertions.assertNotNull(response);
    }

    /**
     * 非图片媒体不能通过图片参考列表进入视频任务，失败时不得创建任务或扣积分。
     */
    @Test
    void shouldRejectNonImageMimeTypeBeforeCreatingVideoTask() {
        AiTaskDtos.CreateAiTaskRequest request = new AiTaskDtos.CreateAiTaskRequest(
                AiTaskTypes.VIDEO, "生成视频", "channel-1::model-1", Map.of("seconds", 5, "resolution", "720p"),
                List.of(new AiTaskDtos.AiTaskMediaReference("reference-1", "说明文件", "application/pdf", "files/reference-1", "https://example.com/reference-1")),
                List.of(), AiTaskSources.VIDEO_PAGE, null, null, VideoGenerationMode.IMAGE_TO_VIDEO);

        BusinessException exception = Assertions.assertThrows(BusinessException.class, () -> service.createTask(request).block());

        Assertions.assertTrue(exception.getMessage().contains("图片参考列表只能包含图片素材"));
        verify(repository, never()).createTask(any(AiGenerationTask.class));
        verify(creditService, never()).chargeTask(anyLong(), anyString(), org.mockito.ArgumentMatchers.anyInt(), anyString(), org.mockito.ArgumentMatchers.nullable(String.class));
        verify(modelTaskExecutionDispatcher, never()).enqueue(anyString(), anyString());
    }

    /** storageKey 查询不到媒体时，视频任务不得创建、扣费或入队。 */
    @Test
    void shouldRejectMissingVideoReferenceStorageKeyBeforeSideEffects() {
        when(persistenceService.getMediaInfoForUser(7L, "image:missing")).thenReturn(Mono.empty());
        AiTaskDtos.CreateAiTaskRequest request = videoRequest(VideoGenerationMode.IMAGE_TO_VIDEO,
                List.of(new AiTaskDtos.AiTaskMediaReference("missing", "图片", "image/png", " image:missing ", "https://example.com/missing.png")), List.of());

        BusinessException exception = Assertions.assertThrows(BusinessException.class, () -> service.createTask(request).block());

        Assertions.assertTrue(exception.getMessage().contains("不存在或不属于当前用户"));
        verify(repository, never()).createTask(any(AiGenerationTask.class));
        verify(creditService, never()).chargeTask(anyLong(), anyString(), org.mockito.ArgumentMatchers.anyInt(), anyString(), org.mockito.ArgumentMatchers.nullable(String.class));
        verify(modelTaskExecutionDispatcher, never()).enqueue(anyString(), anyString());
    }

    /** 媒体查询抛出资源不存在时，仍需统一返回素材归属错误且不产生副作用。 */
    @Test
    void shouldRejectVideoReferenceOwnedByAnotherUserBeforeSideEffects() {
        when(persistenceService.getMediaInfoForUser(7L, "image:other"))
                .thenReturn(Mono.error(new BusinessException(com.novanovastudio.common.ErrorCode.RESOURCE_NOT_FOUND, "媒体不存在")));
        AiTaskDtos.CreateAiTaskRequest request = videoRequest(VideoGenerationMode.IMAGE_TO_VIDEO,
                List.of(new AiTaskDtos.AiTaskMediaReference("other", "图片", "image/png", "image:other", "https://example.com/other.png")), List.of());

        BusinessException exception = Assertions.assertThrows(BusinessException.class, () -> service.createTask(request).block());

        Assertions.assertTrue(exception.getMessage().contains("不存在或不属于当前用户"));
        verify(repository, never()).createTask(any(AiGenerationTask.class));
        verify(creditService, never()).chargeTask(anyLong(), anyString(), org.mockito.ArgumentMatchers.anyInt(), anyString(), org.mockito.ArgumentMatchers.nullable(String.class));
        verify(modelTaskExecutionDispatcher, never()).enqueue(anyString(), anyString());
    }

    /** 数据库媒体类型与请求声明不一致时，视频任务必须失败。 */
    @Test
    void shouldRejectVideoReferenceWhenStoredMimeTypeDoesNotMatchDeclaration() {
        when(persistenceService.getMediaInfoForUser(7L, "image:stored"))
                .thenReturn(Mono.just(uploadedMedia("image:stored", "https://example.com/stored.png", "video/mp4")));
        AiTaskDtos.CreateAiTaskRequest request = videoRequest(VideoGenerationMode.IMAGE_TO_VIDEO,
                List.of(new AiTaskDtos.AiTaskMediaReference("stored", "图片", "image/png", "image:stored", "https://example.com/stored.png")), List.of());

        BusinessException exception = Assertions.assertThrows(BusinessException.class, () -> service.createTask(request).block());

        Assertions.assertTrue(exception.getMessage().contains("素材类型与声明不一致"));
        verify(repository, never()).createTask(any(AiGenerationTask.class));
        verify(creditService, never()).chargeTask(anyLong(), anyString(), org.mockito.ArgumentMatchers.anyInt(), anyString(), org.mockito.ArgumentMatchers.nullable(String.class));
        verify(modelTaskExecutionDispatcher, never()).enqueue(anyString(), anyString());
    }

    /** 参考素材没有地址或地址协议非法时，视频任务必须失败。 */
    @Test
    void shouldRejectVideoReferenceWithoutAccessibleHttpUrl() {
        when(persistenceService.getMediaInfoForUser(7L, "image:no-url"))
                .thenReturn(Mono.just(uploadedMedia("image:no-url", "javascript:alert(1)", "image/png")));
        AiTaskDtos.CreateAiTaskRequest request = videoRequest(VideoGenerationMode.IMAGE_TO_VIDEO,
                List.of(new AiTaskDtos.AiTaskMediaReference("no-url", "图片", "image/png", "image:no-url", "https://example.com/no-url.png")), List.of());

        BusinessException exception = Assertions.assertThrows(BusinessException.class, () -> service.createTask(request).block());

        Assertions.assertTrue(exception.getMessage().contains("没有可访问的http或https地址"));
        verify(repository, never()).createTask(any(AiGenerationTask.class));
        verify(creditService, never()).chargeTask(anyLong(), anyString(), org.mockito.ArgumentMatchers.anyInt(), anyString(), org.mockito.ArgumentMatchers.nullable(String.class));
        verify(modelTaskExecutionDispatcher, never()).enqueue(anyString(), anyString());
    }

    /** 构造带图片或视频参考的视频请求。 */
    private AiTaskDtos.CreateAiTaskRequest videoRequest(String mode,
                                                        List<AiTaskDtos.AiTaskMediaReference> references,
                                                        List<AiTaskDtos.AiTaskMediaReference> videoReferences) {
        return new AiTaskDtos.CreateAiTaskRequest(AiTaskTypes.VIDEO, "生成视频", "channel-1::model-1",
                Map.of("seconds", 5, "resolution", "720p"), references, videoReferences,
                AiTaskSources.VIDEO_PAGE, null, null, mode);
    }

    /** 构造素材查询响应。 */
    private PersistenceDtos.UploadedMediaResponse uploadedMedia(String storageKey, String url, String mimeType) {
        return new PersistenceDtos.UploadedMediaResponse(storageKey, url, 12L, mimeType, null, null, null, null);
    }

    /**
     * 构建图片生成任务请求。
     *
     * @return CreateAiTaskRequest 图片任务请求
     */
    private AiTaskDtos.CreateAiTaskRequest request() {
        return new AiTaskDtos.CreateAiTaskRequest(AiTaskTypes.IMAGE, "生成图片", "channel-1::model-1",
                java.util.Map.of("size", "1:1"), List.of(), List.of(), AiTaskSources.IMAGE_PAGE);
    }

    /**
     * 构建仓储查询返回的任务实体。
     *
     * @param taskId String 任务ID
     * @return AiGenerationTask 任务实体
     */
    private AiGenerationTask task(String taskId) {
        AiGenerationTask task = new AiGenerationTask();
        task.setId(taskId);
        task.setUserId(7L);
        task.setTaskType(AiTaskTypes.IMAGE);
        task.setModel("model-1");
        task.setProvider("图片渠道");
        task.setModelConfigId("model-config-1");
        task.setStatus("pending");
        task.setProgress(0);
        task.setRequestData("{}");
        task.setResultData("{}");
        return task;
    }
}
