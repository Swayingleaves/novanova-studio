package com.novanovastudio.service;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.novanovastudio.agent.AgentTaskOrchestrator;
import com.novanovastudio.ai.AiProviderAdapter;
import com.novanovastudio.ai.AiProviderAdapterRegistry;
import com.novanovastudio.ai.AiTaskTypes;
import com.novanovastudio.ai.AiTaskSources;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.dto.AiTaskDtos;
import com.novanovastudio.dto.PersistenceDtos;
import com.novanovastudio.entity.AiGenerationTask;
import com.novanovastudio.repository.AiTaskRepository;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.task.AiTaskEventPublisher;
import com.novanovastudio.task.AiTaskQueue;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
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

    /** Agent任务编排器 */
    @Mock
    private AgentTaskOrchestrator orchestrator;

    /** 渠道适配器注册表 */
    @Mock
    private AiProviderAdapterRegistry adapterRegistry;

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
                eventPublisher, taskQueue, orchestrator, adapterRegistry, creditService, transactionalOperator);

        AiTaskDtos.AiChannelConfig channel = new AiTaskDtos.AiChannelConfig(
                "channel-1", "图片渠道", "https://example.com", "key", "openai", List.of("model-1"));
        when(currentUserProvider.currentUserId()).thenReturn(Mono.just(7L));
        when(persistenceService.getPlatformAiChannels()).thenReturn(Mono.just(List.of(channel)));
        when(persistenceService.getPlatformModelConfigs()).thenReturn(Mono.just(List.of(
                new PersistenceDtos.ModelConfig("model-config-1", "channel-1", "model-1", AiTaskTypes.IMAGE, List.of(), true, 0, 0, true, "high")
        )));
        when(adapterRegistry.resolve(any(AiTaskDtos.AiChannelConfig.class), eq(AiTaskTypes.IMAGE)))
                .thenReturn(mock(AiProviderAdapter.class));
        when(repository.createTask(any(AiGenerationTask.class))).thenReturn(Mono.defer(() -> {
            executionOrder.add("create");
            return Mono.empty();
        }));
        when(creditService.chargeTask(anyLong(), anyString(), org.mockito.ArgumentMatchers.anyInt(), anyString(), anyString())).thenReturn(Mono.empty());
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
    }

    /**
     * 任务入库并读取响应后，应先完成入队前处理，再发布事件和写入队列。
     */
    @Test
    void shouldRunBeforeEnqueueAfterTaskResponseAndBeforePublishAndEnqueue() {
        AiTaskDtos.AiGenerationTaskResponse response = service.createTask(request(), taskResponse -> Mono.fromRunnable(() -> {
            executionOrder.add("beforeEnqueue");
            Assertions.assertNotNull(taskResponse.id());
            Assertions.assertFalse(taskResponse.id().isBlank());
        })).block();

        Assertions.assertNotNull(response);
        Assertions.assertEquals(List.of("create", "read", "beforeEnqueue", "publish", "enqueue"), executionOrder);
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
        task.setStatus("pending");
        task.setProgress(0);
        task.setRequestData("{}");
        task.setResultData("{}");
        return task;
    }
}
