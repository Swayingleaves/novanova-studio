package com.novanovastudio.service;

import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.agent.AgentTaskOrchestrator;
import com.novanovastudio.ai.AiProviderAdapter;
import com.novanovastudio.ai.AiProviderAdapterRegistry;
import com.novanovastudio.ai.AiErrorDetails;
import com.novanovastudio.ai.AiErrorSupport;
import com.novanovastudio.ai.AiTaskExecutionContext;
import com.novanovastudio.ai.AiTaskSources;
import com.novanovastudio.ai.AiTaskTypes;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.dto.AiTaskDtos;
import com.novanovastudio.dto.GenerationStyleDtos;
import com.novanovastudio.dto.PersistenceDtos;
import com.novanovastudio.entity.AiGenerationTask;
import com.novanovastudio.repository.AiTaskRepository;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.task.AiTaskEventPublisher;
import com.novanovastudio.task.AiTaskQueue;
import com.novanovastudio.task.ModelTaskExecutionDispatcher;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.stereotype.Service;
import org.springframework.transaction.reactive.TransactionalOperator;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

/**
 * @title        AiTaskService.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  响应式AI任务服务
 * @createTime   2026-06-24 18:55:00
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class AiTaskService {

    /** 图片任务类型 */
    private static final String TYPE_IMAGE = AiTaskTypes.IMAGE;

    /** 视频任务类型 */
    private static final String TYPE_VIDEO = AiTaskTypes.VIDEO;

    /** 文本任务类型 */
    private static final String TYPE_TEXT = AiTaskTypes.TEXT;

    /** 按次计费单位。 */
    private static final String CREDIT_UNIT_GENERATION = "generation";

    /** 按秒计费单位。 */
    private static final String CREDIT_UNIT_SECOND = "second";

    /** 等待状态 */
    private static final String STATUS_PENDING = "pending";

    /** 运行状态 */
    private static final String STATUS_RUNNING = "running";

    /** 成功状态 */
    private static final String STATUS_SUCCESS = "success";

    /** 失败状态 */
    private static final String STATUS_FAILED = "failed";

    /** 取消状态 */
    private static final String STATUS_CANCELED = "canceled";

    /** 任务事件类型 */
    private static final String EVENT_TASK = "task";

    /** 流式文本增量事件类型 */
    private static final String EVENT_TEXT_DELTA = "text-delta";

    /** 渠道与模型分隔符 */
    private static final String CHANNEL_MODEL_SEPARATOR = "::";

    /** 业务仓储 */
    private final AiTaskRepository repository;

    /** 当前用户提供器 */
    private final CurrentUserProvider currentUserProvider;

    /** 服务配置 */
    private final NovanovaProperties properties;

    /** 业务持久化服务 */
    private final PersistenceService persistenceService;

    /** 事件发布器 */
    private final AiTaskEventPublisher eventPublisher;

    /** AI任务队列 */
    private final AiTaskQueue taskQueue;

    /** 模型任务执行调度器 */
    private final ModelTaskExecutionDispatcher modelTaskExecutionDispatcher;

    /** AgentScope编排器 */
    private final AgentTaskOrchestrator orchestrator;

    /** AI渠道适配器注册表 */
    private final AiProviderAdapterRegistry adapterRegistry;

    /** 积分服务 */
    private final CreditService creditService;

    /** 响应式事务操作器 */
    private final TransactionalOperator transactionalOperator;

    /** 风格解析服务。 */
    @Autowired
    private GenerationStyleService generationStyleService;

    /** 风格提示词优化服务，懒加载以避免其对本服务的反向依赖形成初始化环。 */
    @Autowired
    @Lazy
    private PromptOptimizationService promptOptimizationService;

    /**
     * 服务启动时恢复未完成任务
     */
    @EventListener(ApplicationReadyEvent.class)
    public void recoverUnfinishedTasks() {
        // 队列化后pending任务不能标记失败，启动时恢复可继续执行的任务并重新入队。
        OffsetDateTime runningRecoverBefore = OffsetDateTime.now().minusSeconds(properties.getAi().getTask().getRunningRecoverSeconds());
        taskQueue.ensureConsumerGroup()
                .then(repository.recoverTimeoutRunningTasks(runningRecoverBefore))
                .thenMany(repository.listRecoverableTasks(runningRecoverBefore))
                // 按创建时间顺序恢复，避免同一模型的等待任务在并发订阅时乱序。
                .concatMap(this::dispatchRecoveredTask)
                .subscribeOn(Schedulers.boundedElastic())
                .subscribe(
                        ignored -> {
                        },
                        exception -> log.error("启动时恢复AI任务失败", exception)
                );
    }

    /**
     * 创建AI生成任务
     *
     * @param request CreateAiTaskRequest 创建任务请求
     * @return Mono<AiGenerationTaskResponse> 任务响应
     */
    public Mono<AiTaskDtos.AiGenerationTaskResponse> createTask(AiTaskDtos.CreateAiTaskRequest request) {
        return createTask(request, response -> Mono.empty());
    }

    /**
     * 创建AI生成任务，并在任务发布和入队前执行持久化处理。
     *
     * @param request CreateAiTaskRequest 创建任务请求
     * @param beforeEnqueue Function 入队前响应式处理器
     * @return Mono<AiGenerationTaskResponse> 任务响应
     */
    public Mono<AiTaskDtos.AiGenerationTaskResponse> createTask(
            AiTaskDtos.CreateAiTaskRequest request,
            Function<AiTaskDtos.AiGenerationTaskResponse, Mono<Void>> beforeEnqueue) {
        return currentUserProvider.currentUserId().flatMap(userId -> createTaskForUser(userId, request, beforeEnqueue));
    }

    /**
     * 为已完成鉴权的指定用户创建AI生成任务。
     * <p>仅供服务端Agent编排链路调用，避免后台订阅丢失WebFlux安全上下文。</p>
     *
     * @param userId Long 用户ID
     * @param request CreateAiTaskRequest 创建任务请求
     * @param beforeEnqueue Function 入队前响应式处理器
     * @return Mono<AiGenerationTaskResponse> 任务响应
     */
    public Mono<AiTaskDtos.AiGenerationTaskResponse> createTaskForUser(
            Long userId,
            AiTaskDtos.CreateAiTaskRequest request,
            Function<AiTaskDtos.AiGenerationTaskResponse, Mono<Void>> beforeEnqueue) {
        // 校验任务类型并解析可用模型渠道。
        return prepareStyledRequest(userId, request).flatMap(preparedRequest -> Mono.defer(() -> {
            validateTaskType(preparedRequest.taskType());
            validateGenerationSource(preparedRequest.taskType(), preparedRequest.generationSource());
            return resolveModel(preparedRequest.taskType(), preparedRequest.model()).flatMap(resolvedModel -> {
                String taskId = UUID.randomUUID().toString();
                int creditCost = calculateTaskCredits(preparedRequest, resolvedModel);
                log.info("创建AI生成任务: taskId={}, userId={}, taskType={}, generationSource={}, model={}, channel={}", taskId, userId, preparedRequest.taskType(), preparedRequest.generationSource(), preparedRequest.model(), resolvedModel.channel().name());
                AiGenerationTask task = new AiGenerationTask();
                task.setId(taskId);
                task.setUserId(userId);
                task.setTaskType(preparedRequest.taskType());
                task.setModel(resolvedModel.model());
                task.setProvider(resolvedModel.channel().name());
                task.setModelConfigId(resolvedModel.modelConfigId());
                task.setStatus(STATUS_PENDING);
                task.setProgress(0);
                task.setRequestData(toJson(preparedRequest));
                task.setResultData("{}");
                return repository.createTask(task)
                        .then(creditService.chargeTask(userId, taskId, creditCost, preparedRequest.taskType(), preparedRequest.generationSource()))
                        .as(transactionalOperator::transactional)
                        .then(getTaskResponse(taskId, userId))
                        .flatMap(response -> Mono.fromRunnable(() -> orchestrator.prepareTask(taskId, preparedRequest))
                                .subscribeOn(Schedulers.boundedElastic())
                                .then(beforeEnqueue.apply(response)
                                        .onErrorResume(exception -> finishTaskWithRefund(task, STATUS_FAILED, "任务创建失败: " + empty(exception.getMessage()), null)
                                                .then(Mono.error(exception))))
                                .then(Mono.defer(() -> eventPublisher.publish(userId, new AiTaskDtos.AiTaskEvent(EVENT_TASK, response))
                                        .then(dispatchTask(task, resolvedModel))
                                        .onErrorResume(exception -> finishTaskWithRefund(task, STATUS_FAILED, "任务入队失败: " + empty(exception.getMessage()), null)
                                                .flatMap(updated -> Boolean.TRUE.equals(updated)
                                                        ? getTaskResponse(taskId, userId)
                                                                .flatMap(failedTask -> eventPublisher.publish(userId, new AiTaskDtos.AiTaskEvent(EVENT_TASK, failedTask)))
                                                        : Mono.empty())
                                                .then(Mono.error(exception)))))
                                .thenReturn(response));
            });
        }));
    }

    /**
     * 解析任务风格并在入队前完成强制提示词优化。
     *
     * @param userId Long 当前用户ID
     * @param request CreateAiTaskRequest 原始任务请求
     * @return Mono<CreateAiTaskRequest> 已替换为优化提示词并携带快照的任务请求
     */
    private Mono<AiTaskDtos.CreateAiTaskRequest> prepareStyledRequest(Long userId, AiTaskDtos.CreateAiTaskRequest request) {
        List<Long> ids = request.generationStyleIds() == null ? List.of() : request.generationStyleIds();
        List<GenerationStyleDtos.GenerationStyleSnapshot> snapshots = request.generationStyleSnapshots() == null ? List.of() : request.generationStyleSnapshots();
        if (ids.isEmpty() && snapshots.isEmpty()) return Mono.just(request);
        if (!TYPE_IMAGE.equals(request.taskType()) && !TYPE_VIDEO.equals(request.taskType())) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "风格只支持图片或视频任务"));
        }
        return generationStyleService.resolveStyles(request.taskType(), ids, snapshots)
                .flatMap(styles -> promptOptimizationService.optimizeAndWait(userId, request.taskType(), request.prompt(), styles, response -> Mono.empty())
                        .map(optimizedPrompt -> new AiTaskDtos.CreateAiTaskRequest(
                                request.taskType(), optimizedPrompt, request.model(), request.parameters(), request.references(),
                                request.videoReferences(), request.generationSource(), null, styles)));
    }

    /**
     * 分派已持久化的AI任务。
     *
     * @param task AiGenerationTask 已持久化任务
     * @param resolvedModel ResolvedModel 已解析模型
     * @return Mono<Void> 入队结果
     */
    private Mono<Void> dispatchTask(AiGenerationTask task, ResolvedModel resolvedModel) {
        if (isModelQueueTask(task.getTaskType())) {
            return modelTaskExecutionDispatcher.enqueue(resolvedModel.modelConfigId(), task.getId());
        }
        return taskQueue.enqueue(task.getId());
    }

    /**
     * 分派服务启动时恢复的任务。
     *
     * @param task AiGenerationTask 待恢复任务
     * @return Mono<Void> 恢复入队结果
     */
    private Mono<Void> dispatchRecoveredTask(AiGenerationTask task) {
        if (!isModelQueueTask(task.getTaskType())) {
            return taskQueue.enqueue(task.getId());
        }
        if (!StringUtils.hasText(task.getModelConfigId())) {
            return failRecoveredTask(task, new BusinessException(ErrorCode.BUSINESS_ERROR, "任务缺少模型配置ID"));
        }
        return modelTaskExecutionDispatcher.enqueue(task.getModelConfigId(), task.getId())
                .onErrorResume(exception -> failRecoveredTask(task, exception));
    }

    /**
     * 将无法恢复的任务标记为失败并发布状态事件。
     *
     * @param task AiGenerationTask 无法恢复的任务
     * @param exception Throwable 恢复异常
     * @return Mono<Void> 失败处理结果
     */
    private Mono<Void> failRecoveredTask(AiGenerationTask task, Throwable exception) {
        String message = "任务恢复失败: " + empty(exception.getMessage());
        return finishTaskWithRefund(task, STATUS_FAILED, message, null)
                .flatMap(updated -> Boolean.TRUE.equals(updated)
                        ? getTaskResponse(task.getId(), task.getUserId())
                                .flatMap(response -> eventPublisher.publish(task.getUserId(), new AiTaskDtos.AiTaskEvent(EVENT_TASK, response)))
                        : Mono.empty())
                .then();
    }

    /**
     * 查询当前用户任务列表
     *
     * @param statuses List<String> 状态列表
     * @return Mono<List<AiGenerationTaskResponse>> 任务列表
     */
    public Mono<List<AiTaskDtos.AiGenerationTaskResponse>> listTasks(List<String> statuses) {
        return currentUserProvider.currentUserId().flatMap(userId -> listTasksForUser(userId, statuses));
    }

    /**
     * 查询指定用户任务列表。
     *
     * @param userId Long 用户ID
     * @param statuses List<String> 状态列表
     * @return Mono<List<AiGenerationTaskResponse>> 任务列表
     */
    public Mono<List<AiTaskDtos.AiGenerationTaskResponse>> listTasksForUser(Long userId, List<String> statuses) {
        return repository.listTasks(userId, statuses)
                .map(this::taskResponse)
                .collectList();
    }

    /**
     * 查询当前用户单个任务
     *
     * @param taskId String 任务ID
     * @return Mono<AiGenerationTaskResponse> 任务响应
     */
    public Mono<AiTaskDtos.AiGenerationTaskResponse> getTask(String taskId) {
        return currentUserProvider.currentUserId().flatMap(userId -> getTaskForUser(userId, taskId));
    }

    /**
     * 查询指定用户单个任务。
     *
     * @param userId Long 用户ID
     * @param taskId String 任务ID
     * @return Mono<AiGenerationTaskResponse> 任务响应
     */
    public Mono<AiTaskDtos.AiGenerationTaskResponse> getTaskForUser(Long userId, String taskId) {
        return repository.getTask(userId, taskId)
                .map(this::taskResponse)
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "任务不存在")));
    }

    /**
     * 取消AI生成任务
     *
     * @param taskId String 任务ID
     * @return Mono<AiGenerationTaskResponse> 任务响应
     */
    public Mono<AiTaskDtos.AiGenerationTaskResponse> cancelTask(String taskId) {
        return currentUserProvider.currentUserId().flatMap(userId -> cancelTaskForUser(userId, taskId));
    }

    /**
     * 取消指定用户的AI生成任务。
     *
     * @param userId Long 用户ID
     * @param taskId String 任务ID
     * @return Mono<AiGenerationTaskResponse> 任务响应
     */
    public Mono<AiTaskDtos.AiGenerationTaskResponse> cancelTaskForUser(Long userId, String taskId) {
        return repository.getTask(userId, taskId)
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "任务不存在")))
                .flatMap(task -> {
                    Mono<Void> update = isTerminal(task.getStatus()) ? Mono.empty() : eventPublisher.markCancelRequested(taskId)
                            .then(finishTaskWithRefund(task, STATUS_CANCELED, "任务已取消", null))
                            .then();
                    return update.then(getTaskResponse(taskId, userId))
                            .flatMap(response -> eventPublisher.publish(userId, new AiTaskDtos.AiTaskEvent(EVENT_TASK, response)).thenReturn(response));
                });
    }

    /**
     * 订阅当前用户AI任务事件
     *
     * @return Flux<ServerSentEvent<AiTaskEvent>> SSE事件流
     */
    public Flux<ServerSentEvent<AiTaskDtos.AiTaskEvent>> subscribe() {
        // 将当前用户绑定到事件发布器维护的响应式事件流。
        return currentUserProvider.currentUserId()
                .flatMapMany(eventPublisher::subscribe)
                .map(event -> ServerSentEvent.<AiTaskDtos.AiTaskEvent>builder()
                        .event(event.type())
                        .data(event)
                        .build());
    }

    /**
     * 查询服务端AI模型列表
     *
     * @return Mono<AiModelListResponse> 模型列表
     */
    public Mono<AiTaskDtos.AiModelListResponse> listModels() {
        // 模型目录仅向已登录用户开放，并且严禁返回渠道地址或密钥。
        return currentUserProvider.currentUserId().then(Mono.defer(() -> Mono.zip(
                        persistenceService.getPlatformAiChannels(), persistenceService.getPlatformModelConfigs())))
                .map(tuple -> {
                    List<AiTaskDtos.AiChannelConfig> channels = tuple.getT1();
                    List<AiTaskDtos.AiModelOption> models = tuple.getT2().stream()
                            .map(config -> channels.stream()
                                    .filter(channel -> config.channelId().equals(channel.id())
                                            && channel.models() != null
                                            && channel.models().contains(config.modelName())
                                            && StringUtils.hasText(channel.baseUrl())
                                            && StringUtils.hasText(channel.apiKey()))
                                    .findFirst()
                                    .map(channel -> new AiTaskDtos.AiModelOption(
                                            config.channelId() + CHANNEL_MODEL_SEPARATOR + config.modelName(),
                                            config.modelName(), config.modelType(), channel.name(), channel.apiFormat(), config.defaultModel(), config.creditCost(), config.creditUnit()))
                                    .orElse(null))
                            .filter(java.util.Objects::nonNull)
                            .toList();
                    List<AiTaskDtos.AiModelOption> availableModels = models.stream()
                            .filter(model -> models.stream().anyMatch(candidate -> model.capability().equals(candidate.capability())
                                    && Boolean.TRUE.equals(candidate.defaultModel())))
                            .toList();
                    return new AiTaskDtos.AiModelListResponse(availableModels,
                            modelValues(availableModels, TYPE_IMAGE), modelValues(availableModels, TYPE_VIDEO), modelValues(availableModels, TYPE_TEXT));
                });
    }

    /**
     * 执行队列任务
     *
     * @param taskId String 任务ID
     * @return Mono<Void> 执行结果
     */
    public Mono<Void> executeQueuedTask(String taskId) {
        // 每次执行前从数据库读取最新任务，避免处理已终止任务。
        return repository.getTaskById(taskId)
                .switchIfEmpty(Mono.fromRunnable(() -> log.info("跳过AI生成任务执行: taskId={}, reason={}", taskId, "任务不存在")).then(Mono.empty()))
                .flatMap(task -> {
                    if (isTerminal(task.getStatus())) {
                        log.info("跳过AI生成任务执行: taskId={}, reason={}", taskId, "任务已终止");
                        return Mono.empty();
                    }
                    log.info("开始执行AI生成任务: taskId={}, userId={}, taskType={}, model={}", taskId, task.getUserId(), task.getTaskType(), task.getModel());
                    return repository.markTaskRunningIfExecutable(taskId)
                            .flatMap(marked -> {
                                if (!Boolean.TRUE.equals(marked)) {
                                    log.info("跳过AI生成任务执行: taskId={}, reason={}", taskId, "任务状态不可执行");
                                    return Mono.empty();
                                }
                                return eventPublisher.isCancelRequested(taskId)
                                        .flatMap(cancelRequested -> {
                                            if (Boolean.TRUE.equals(cancelRequested)) {
                                                return updateTaskState(taskId, STATUS_CANCELED, 100, "任务已取消", null);
                                            }
                                            AiTaskDtos.CreateAiTaskRequest request = JSON.parseObject(task.getRequestData(), AiTaskDtos.CreateAiTaskRequest.class);
                                            return resolveTaskModel(task, request)
                                                    .flatMap(resolvedModel -> {
                                                        AiProviderAdapter adapter = adapterRegistry.resolve(resolvedModel.channel(), task.getTaskType());
                                                        AiTaskExecutionContext context = new AiTaskExecutionContext(
                                                                task,
                                                                resolvedModel.channel(),
                                                                resolvedModel.model(),
                                                                resolvedModel.thinkingEnabled(),
                                                                resolvedModel.reasoningEffort(),
                                                                resolvedModel.customBodyParameters(),
                                                                request,
                                                                () -> eventPublisher.isCancelRequested(taskId),
                                                                progress -> updateTaskState(taskId, STATUS_RUNNING, progress, "", null),
                                                                delta -> publishTextDelta(task, delta)
                                                        );
                                                        return adapter.execute(context);
                                                    })
                                                    .flatMap(result -> updateTaskState(taskId, STATUS_SUCCESS, 100, "", toJson(result)))
                                                    .doOnSuccess(ignored -> log.info("AI生成任务执行成功: taskId={}", taskId));
                                        });
                            });
                })
                .onErrorResume(exception -> eventPublisher.isCancelRequested(taskId).flatMap(cancelRequested -> {
                    if (Boolean.TRUE.equals(cancelRequested)) {
                        log.info("AI生成任务已取消: taskId={}", taskId);
                        return updateTaskState(taskId, STATUS_CANCELED, 100, "任务已取消", null);
                    }
                    log.error("AI生成任务执行失败: taskId={}", taskId, exception);
                    AiErrorDetails error = AiErrorSupport.fromThrowable(exception, "task", "execution");
                    return updateTaskState(taskId, STATUS_FAILED, 100, error.message(),
                            toJson(AiErrorSupport.errorData(error)));
                }));
    }

    /**
     * 更新任务状态并发布事件
     *
     * @param taskId String 任务ID
     * @param status String 状态
     * @param progress int 进度
     * @param errorMessage String 错误信息
     * @param resultData String 结果JSON
     * @return Mono<Void> 更新结果
     */
    private Mono<Void> updateTaskState(String taskId, String status, int progress, String errorMessage, String resultData) {
        // 更新前重新读取任务，避免任务被删除后继续发布事件。
        return repository.getTaskById(taskId)
                .flatMap(task -> {
                    Map<String, Object> values = new java.util.LinkedHashMap<>();
                    values.put("status", status);
                    values.put("progress", progress);
                    values.put("error_message", errorMessage == null ? "" : errorMessage);
                    if (STATUS_RUNNING.equals(status) && task.getStartedAt() == null) {
                        values.put("started_at", OffsetDateTime.now());
                    }
                    if (isTerminal(status)) {
                        values.put("completed_at", OffsetDateTime.now());
                    }
                    return repository.updateTaskIfNotTerminal(taskId, values, resultData)
                            .flatMap(updated -> Boolean.TRUE.equals(updated) && (STATUS_FAILED.equals(status) || STATUS_CANCELED.equals(status))
                                    ? creditService.refundTask(task.getUserId(), taskId, task.getTaskType()).thenReturn(true)
                                    : Mono.just(Boolean.TRUE.equals(updated)))
                            .as(transactionalOperator::transactional)
                            .flatMap(updated -> Boolean.TRUE.equals(updated)
                                    ? getTaskResponse(taskId, task.getUserId())
                                            .flatMap(response -> eventPublisher.publish(task.getUserId(), new AiTaskDtos.AiTaskEvent(EVENT_TASK, response)))
                                    : Mono.empty());
                })
                .then();
    }

    /**
     * 将任务更新为失败或取消并退还原始积分。
     *
     * @param task AiGenerationTask AI任务
     * @param status String 目标终态
     * @param errorMessage String 终态说明
     * @param resultData String 结果JSON
     * @return Mono<Boolean> 是否成功从未结束状态更新
     */
    private Mono<Boolean> finishTaskWithRefund(AiGenerationTask task, String status, String errorMessage, String resultData) {
        Map<String, Object> values = new java.util.LinkedHashMap<>();
        values.put("status", status);
        values.put("progress", 100);
        values.put("error_message", errorMessage == null ? "" : errorMessage);
        values.put("completed_at", OffsetDateTime.now());
        return repository.updateTaskIfNotTerminal(task.getId(), values, resultData)
                .flatMap(updated -> Boolean.TRUE.equals(updated)
                        ? creditService.refundTask(task.getUserId(), task.getId(), task.getTaskType()).thenReturn(true)
                        : Mono.just(false))
                .as(transactionalOperator::transactional);
    }

    /**
     * 推送流式文本增量事件
     *
     * @param task AiGenerationTask 当前任务实体
     * @param delta String 增量文本片段
     * @return Mono<Void> 推送结果
     */
    private Mono<Void> publishTextDelta(AiGenerationTask task, String delta) {
        // 携带精简任务快照用于前端关联taskId，delta字段携带增量文本片段。
        AiTaskDtos.AiGenerationTaskResponse snapshot = new AiTaskDtos.AiGenerationTaskResponse(
                task.getId(), task.getTaskType(), task.getModel(), task.getProvider(), task.getStatus(), task.getProgress(), null, null, "", "", "", "", "");
        return eventPublisher.publish(task.getUserId(), new AiTaskDtos.AiTaskEvent(EVENT_TEXT_DELTA, snapshot, delta));
    }

    /**
     * 查询任务响应
     *
     * @param taskId String 任务ID
     * @param userId Long 用户ID
     * @return Mono<AiGenerationTaskResponse> 任务响应
     */
    private Mono<AiTaskDtos.AiGenerationTaskResponse> getTaskResponse(String taskId, Long userId) {
        // 按任务ID和用户ID获取最新响应。
        return repository.getTask(userId, taskId)
                .map(this::taskResponse)
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "任务不存在")));
    }

    /**
     * 转换任务响应
     *
     * @param task AiGenerationTask 任务实体
     * @return AiGenerationTaskResponse 任务响应
     */
    private AiTaskDtos.AiGenerationTaskResponse taskResponse(AiGenerationTask task) {
        return new AiTaskDtos.AiGenerationTaskResponse(task.getId(), task.getTaskType(), task.getModel(), task.getProvider(), task.getStatus(), task.getProgress(), parseJson(task.getRequestData()), parseJson(task.getResultData()), empty(task.getErrorMessage()), formatTime(task.getStartedAt()), formatTime(task.getCompletedAt()), formatTime(task.getCreatedAt()), formatTime(task.getUpdatedAt()));
    }

    /**
     * 校验任务类型
     *
     * @param taskType String 任务类型
     */
    private void validateTaskType(String taskType) {
        // 当前统一任务系统支持文本、图片和视频三类任务。
        if (!List.of(TYPE_TEXT, TYPE_IMAGE, TYPE_VIDEO).contains(taskType)) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "任务类型必须是text、image或video");
        }
    }

    /**
     * 校验计费生成任务的来源。
     *
     * @param taskType String 任务类型
     * @param generationSource String 生成来源
     * @return void 无返回值
     */
    private void validateGenerationSource(String taskType, String generationSource) {
        if (!TYPE_TEXT.equals(taskType) && !AiTaskSources.isSupported(generationSource)) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "图片或视频生成任务必须提供有效来源");
        }
        if (AiTaskSources.STORYBOARD.equals(generationSource) && !List.of(TYPE_IMAGE, TYPE_VIDEO).contains(taskType)) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "分镜来源仅支持图片或视频生成任务");
        }
    }

    /**
     * 解析模型配置
     *
     * @param capability String 能力
     * @param selectedModel String 选择模型
     * @return ResolvedModel 解析结果
     */
    private Mono<ResolvedModel> resolveModel(String capability, String selectedModel) {
        // 所有用户都只能使用管理员在全站模型目录中启用的模型。
        return Mono.zip(persistenceService.getPlatformAiChannels(), persistenceService.getPlatformModelConfigs())
                .map(tuple -> {
                    List<PersistenceDtos.ModelConfig> allowedModels = tuple.getT2().stream()
                            .filter(config -> capability.equals(config.modelType()))
                            .toList();
                    PersistenceDtos.ModelConfig defaultConfig = allowedModels.stream()
                            .filter(config -> Boolean.TRUE.equals(config.defaultModel()))
                            .findFirst()
                            .orElse(null);
                    if (defaultConfig == null || !hasCompleteChannel(tuple.getT1(), defaultConfig)) {
                        throw new BusinessException(ErrorCode.BUSINESS_ERROR, "请联系管理员配置默认" + capabilityLabel(capability) + "模型");
                    }
                    PersistenceDtos.ModelConfig selectedConfig;
                    if (StringUtils.hasText(selectedModel)) {
                        selectedConfig = allowedModels.stream()
                                .filter(config -> selectedModel.equals(config.channelId() + "::" + config.modelName()) || selectedModel.equals(config.modelName()))
                                .findFirst()
                                .orElseThrow(() -> new BusinessException(ErrorCode.BUSINESS_ERROR, "所选模型未在管理员启用的模型中配置"));
                    } else {
                        selectedConfig = allowedModels.stream().filter(config -> Boolean.TRUE.equals(config.defaultModel()))
                                .findFirst()
                                .orElseThrow(() -> new BusinessException(ErrorCode.BUSINESS_ERROR, "请联系管理员配置默认" + capabilityLabel(capability) + "模型"));
                    }
                    ResolvedModel resolvedModel = resolveModel(capability, selectedConfig.channelId() + "::" + selectedConfig.modelName(), tuple.getT1());
                    return new ResolvedModel(resolvedModel.channel(), resolvedModel.model(), selectedConfig.id(), selectedConfig.creditCost(), selectedConfig.creditUnit(),
                            thinkingEnabled(selectedConfig.thinkingEnabled()), reasoningEffort(selectedConfig.reasoningEffort()), selectedConfig.customBodyParameters());
                });
    }

    /**
     * 按任务持久化的模型配置解析执行模型。
     * <p>
     * 图片和视频任务必须绑定创建时的模型配置，避免模型配置调整或删除后按同名模型错误改投。
     * 文本任务继续沿用全局队列的既有解析策略。</p>
     *
     * @param task AiGenerationTask 已持久化任务
     * @param request CreateAiTaskRequest 任务请求快照
     * @return Mono<ResolvedModel> 可执行模型
     */
    private Mono<ResolvedModel> resolveTaskModel(AiGenerationTask task, AiTaskDtos.CreateAiTaskRequest request) {
        if (!isModelQueueTask(task.getTaskType())) {
            return resolveModel(task.getTaskType(), firstNonEmpty(request.model(), task.getModel()));
        }
        if (!StringUtils.hasText(task.getModelConfigId())) {
            return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "任务缺少模型配置ID"));
        }
        return Mono.zip(persistenceService.getPlatformAiChannels(), persistenceService.getPlatformModelConfigs())
                .map(tuple -> {
                    PersistenceDtos.ModelConfig modelConfig = tuple.getT2().stream()
                            .filter(config -> task.getModelConfigId().equals(config.id()))
                            .findFirst()
                            .orElseThrow(() -> new BusinessException(ErrorCode.BUSINESS_ERROR, "任务使用的模型配置不存在"));
                    if (!task.getTaskType().equals(modelConfig.modelType())) {
                        throw new BusinessException(ErrorCode.BUSINESS_ERROR, "任务使用的模型配置类型不匹配");
                    }
                    if (!task.getModel().equals(modelConfig.modelName())) {
                        throw new BusinessException(ErrorCode.BUSINESS_ERROR, "任务使用的模型配置与任务模型不匹配");
                    }
                    ResolvedModel channelModel = resolveModel(task.getTaskType(), modelConfig.channelId() + CHANNEL_MODEL_SEPARATOR + modelConfig.modelName(), tuple.getT1());
                    return new ResolvedModel(channelModel.channel(), channelModel.model(), modelConfig.id(), modelConfig.creditCost(),
                            modelConfig.creditUnit(), thinkingEnabled(modelConfig.thinkingEnabled()), reasoningEffort(modelConfig.reasoningEffort()), modelConfig.customBodyParameters());
                });
    }

    /**
     * 查询指定模型已配置的细能力集合。
     * <p>
     * 从用户配置的 modelCapabilities 中按 model value 匹配，未配置或解析失败返回空集。
     *
     * @param userId Long 用户ID
     * @param model  String 模型值，支持 channelId::model 编码，可为 null
     * @return Mono<Set<String>> 模型细能力集合
     */
    public Mono<Set<String>> modelCapabilities(Long userId, String model) {
        if (!StringUtils.hasText(model)) return Mono.just(Set.of());
        return persistenceService.getPlatformModelConfigs()
                .map(configs -> configs.stream()
                        .filter(config -> model.equals(config.channelId() + "::" + config.modelName()) || model.equals(config.modelName()))
                        .findFirst()
                        .map(config -> Set.copyOf(config.capabilities()))
                        .orElse(Set.of()))
                .onErrorReturn(Set.of());
    }

    /**
     * 在用户渠道上下文中解析模型
     *
     * @param capability String 任务能力
     * @param selectedModel String 选择的模型值
     * @param userChannels List<AiChannelConfig> 用户渠道列表
     * @return ResolvedModel 解析结果
     */
    private ResolvedModel resolveModel(String capability, String selectedModel, List<AiTaskDtos.AiChannelConfig> userChannels) {
        // 外层已校验模型来自全站目录，这里只按渠道编码定位完整连接信息。
        ChannelModelSelection selection = decodeChannelModel(selectedModel);
        if (selection == null) {
            throw new BusinessException(ErrorCode.BUSINESS_ERROR, "所选模型不可用，请联系管理员检查模型配置");
        }
        return resolveUserChannelModel(selection.channelId(), selection.model(), capability, userChannels);
    }

    /**
     * 解析用户显式选择的渠道模型
     *
     * @param channelId String 渠道ID
     * @param model String 模型名称
     * @param capability String 任务能力
     * @param userChannels List<AiChannelConfig> 用户渠道列表
     * @return ResolvedModel 解析结果
     */
    private ResolvedModel resolveUserChannelModel(String channelId, String model, String capability, List<AiTaskDtos.AiChannelConfig> userChannels) {
        // 用户显式指定渠道时，不做静默兜底，避免任务跑到错误供应商。
        AiTaskDtos.AiChannelConfig channel = userChannels.stream()
                .filter(item -> channelId.equals(item.id()))
                .findFirst()
                .orElseThrow(() -> new BusinessException(ErrorCode.BUSINESS_ERROR, "未找到已选择的AI渠道: " + channelId));
        if (channel.models() == null || !channel.models().contains(model)) {
            throw new BusinessException(ErrorCode.BUSINESS_ERROR, "渠道" + channelDisplayName(channel) + "未配置模型: " + model);
        }
        validateChannelSupport(channel, capability);
        validateUserChannelAccess(channel);
        return new ResolvedModel(channel, model, "", 0, CREDIT_UNIT_GENERATION, true, "high", new JSONObject());
    }


    /**
     * 校验渠道调用格式
     *
     * @param channel AiChannelConfig 渠道配置
     */
    private void validateChannelSupport(AiTaskDtos.AiChannelConfig channel, String taskType) {
        // 通过适配器注册表校验渠道格式，避免在任务服务里写死供应商协议。
        adapterRegistry.resolve(channel, taskType);
    }

    /**
     * 校验用户渠道连接信息
     *
     * @param channel AiChannelConfig 渠道配置
     */
    private void validateUserChannelAccess(AiTaskDtos.AiChannelConfig channel) {
        // 平台渠道必须具备完整连接参数，避免延迟到真正发请求时才失败。
        if (!StringUtils.hasText(channel.baseUrl())) {
            throw new BusinessException(ErrorCode.BUSINESS_ERROR, "请联系管理员完整配置渠道" + channelDisplayName(channel));
        }
        if (!StringUtils.hasText(channel.apiKey())) {
            throw new BusinessException(ErrorCode.BUSINESS_ERROR, "请联系管理员完整配置渠道" + channelDisplayName(channel));
        }
    }

    /**
     * 汇总指定能力的模型值。
     *
     * @param models List<AiModelOption> 模型选项列表
     * @param capability String 模型能力
     * @return List<String> 模型值列表
     */
    private List<String> modelValues(List<AiTaskDtos.AiModelOption> models, String capability) {
        return models.stream().filter(model -> capability.equals(model.capability())).map(AiTaskDtos.AiModelOption::value).toList();
    }

    /**
     * 判断模型所属渠道是否具备完整连接信息。
     *
     * @param channels List<AiChannelConfig> 全站渠道列表
     * @param config ModelConfig 模型配置
     * @return boolean 渠道是否完整
     */
    private boolean hasCompleteChannel(List<AiTaskDtos.AiChannelConfig> channels, PersistenceDtos.ModelConfig config) {
        return channels.stream().anyMatch(channel -> config.channelId().equals(channel.id())
                && channel.models() != null
                && channel.models().contains(config.modelName())
                && StringUtils.hasText(channel.baseUrl())
                && StringUtils.hasText(channel.apiKey()));
    }

    /**
     * 判断任务是否应进入模型并发队列。
     *
     * @param taskType String 任务类型
     * @return boolean 是否为图片或视频任务
     */
    private boolean isModelQueueTask(String taskType) {
        return TYPE_IMAGE.equals(taskType) || TYPE_VIDEO.equals(taskType);
    }

    /**
     * 将内部能力名称转换为用户可见名称。
     *
     * @param capability String 内部能力名称
     * @return String 用户可见能力名称
     */
    private String capabilityLabel(String capability) {
        return switch (capability) {
            case TYPE_IMAGE -> "生图";
            case TYPE_VIDEO -> "生视频";
            default -> "文本";
        };
    }

    /**
     * 渠道展示名称
     *
     * @param channel AiChannelConfig 渠道配置
     * @return String 展示名称
     */
    private String channelDisplayName(AiTaskDtos.AiChannelConfig channel) {
        return firstNonEmpty(channel.name(), channel.id(), "未命名渠道");
    }

    /**
     * 解析渠道模型编码
     *
     * @param value String 模型值
     * @return ChannelModelSelection 渠道模型选择，无法解析时返回null
     */
    private ChannelModelSelection decodeChannelModel(String value) {
        // 前端模型值支持 channelId::model 编码，这里拆出显式渠道选择。
        int separatorIndex = value.indexOf(CHANNEL_MODEL_SEPARATOR);
        if (separatorIndex <= 0 || separatorIndex >= value.length() - CHANNEL_MODEL_SEPARATOR.length()) {
            return null;
        }
        return new ChannelModelSelection(value.substring(0, separatorIndex), value.substring(separatorIndex + CHANNEL_MODEL_SEPARATOR.length()));
    }


    /**
     * 判断任务状态是否终态
     *
     * @param status String 任务状态
     * @return boolean 是否终态
     */
    private boolean isTerminal(String status) {
        return STATUS_SUCCESS.equals(status) || STATUS_FAILED.equals(status) || STATUS_CANCELED.equals(status);
    }

    /**
     * 计算AI任务应扣积分。
     *
     * @param request CreateAiTaskRequest 创建任务请求
     * @param resolvedModel ResolvedModel 已解析模型
     * @return int 应扣积分
     */
    private int calculateTaskCredits(AiTaskDtos.CreateAiTaskRequest request, ResolvedModel resolvedModel) {
        if (TYPE_TEXT.equals(request.taskType())) {
            return 0;
        }
        Integer unitCost = resolvedModel.creditCost();
        if (unitCost == null || unitCost < 0) {
            throw new BusinessException(ErrorCode.SYSTEM_ERROR, "模型积分配置不合法");
        }
        String creditUnit = resolvedModel.creditUnit();
        if (!CREDIT_UNIT_GENERATION.equals(creditUnit) && !CREDIT_UNIT_SECOND.equals(creditUnit)) {
            throw new BusinessException(ErrorCode.SYSTEM_ERROR, "模型积分计费单位不合法");
        }
        if (CREDIT_UNIT_SECOND.equals(creditUnit) && !TYPE_VIDEO.equals(request.taskType())) {
            throw new BusinessException(ErrorCode.SYSTEM_ERROR, "只有视频模型可以按秒计费");
        }
        int count = TYPE_IMAGE.equals(request.taskType()) ? imageCount(request.parameters()) : 1;
        try {
            int total = Math.multiplyExact(unitCost, count);
            return CREDIT_UNIT_SECOND.equals(creditUnit)
                    ? Math.multiplyExact(total, videoSeconds(request.parameters()))
                    : total;
        } catch (ArithmeticException exception) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "本次生成积分计算超出范围");
        }
    }

    /**
     * 解析按秒计费视频的时长。
     *
     * @param parameters Map<String, Object> 任务参数
     * @return int 视频时长（秒）
     * @throws BusinessException 时长为空、为智能时长或不是正整数时抛出
     */
    private int videoSeconds(Map<String, Object> parameters) {
        Object rawSeconds = parameters == null ? null : parameters.get("seconds");
        if (rawSeconds == null) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "按秒计费视频必须指定正整数时长");
        }
        try {
            int seconds;
            if (rawSeconds instanceof Number number) {
                double numericSeconds = number.doubleValue();
                if (!Double.isFinite(numericSeconds) || numericSeconds != Math.rint(numericSeconds)
                        || numericSeconds > Integer.MAX_VALUE || numericSeconds < Integer.MIN_VALUE) {
                    throw new NumberFormatException("视频时长必须是整数");
                }
                seconds = (int) numericSeconds;
            } else {
                seconds = Integer.parseInt(rawSeconds.toString().trim());
            }
            if (seconds < 1) {
                throw new NumberFormatException("视频时长必须大于0");
            }
            return seconds;
        } catch (NumberFormatException exception) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "按秒计费视频必须指定正整数时长");
        }
    }

    /**
     * 解析图片生成数量。
     *
     * @param parameters Map<String, Object> 任务参数
     * @return int 图片生成数量
     */
    private int imageCount(Map<String, Object> parameters) {
        Object rawCount = parameters == null ? null : parameters.get("count");
        if (rawCount == null) {
            return 1;
        }
        try {
            int count;
            if (rawCount instanceof Number number) {
                double numericCount = number.doubleValue();
                if (!Double.isFinite(numericCount) || numericCount != Math.rint(numericCount)
                        || numericCount > Integer.MAX_VALUE || numericCount < Integer.MIN_VALUE) {
                    throw new NumberFormatException("图片数量必须是整数");
                }
                count = (int) numericCount;
            } else {
                count = Integer.parseInt(rawCount.toString().trim());
            }
            if (count < 1) {
                throw new NumberFormatException("图片数量必须大于0");
            }
            return count;
        } catch (NumberFormatException exception) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "图片数量必须是大于0的整数");
        }
    }

    /**
     * 解析JSON字符串
     *
     * @param value String JSON字符串
     * @return JSONObject JSON节点
     */
    private JSONObject parseJson(String value) {
        try {
            return JSON.parseObject(StringUtils.hasText(value) ? value : "{}");
        } catch (Exception exception) {
            return new JSONObject();
        }
    }

    /**
     * 序列化对象为JSON字符串
     *
     * @param value Object 待序列化对象
     * @return String JSON字符串
     */
    private String toJson(Object value) {
        try {
            return JSON.toJSONString(value);
        } catch (Exception exception) {
            throw new BusinessException(ErrorCode.SYSTEM_ERROR, "序列化JSON失败: " + exception.getMessage());
        }
    }

    /**
     * 转换对象为JSON对象
     *
     * @param value Object 任意对象
     * @return JSONObject JSON对象
     */
    private JSONObject jsonObject(Object value) {
        return JSON.parseObject(JSON.toJSONString(value));
    }

    /**
     * 格式化时间为ISO字符串
     *
     * @param value OffsetDateTime 时间
     * @return String 时间字符串
     */
    private String formatTime(OffsetDateTime value) {
        return value == null ? "" : value.format(DateTimeFormatter.ISO_OFFSET_DATE_TIME);
    }

    /**
     * 将空字符串规范化为空文本
     *
     * @param value String 原始值
     * @return String 非空文本
     */
    private String empty(String value) {
        return value == null ? "" : value;
    }

    /**
     * 取第一个非空字符串
     *
     * @param values String[] 候选字符串
     * @return String 第一个非空字符串
     */
    private String firstNonEmpty(String... values) {
        for (String value : values) {
            if (StringUtils.hasText(value)) {
                return value.trim();
            }
        }
        return "";
    }

    /**
     * 渠道模型编码解析结果
     *
     * @param channelId String 渠道ID
     * @param model String 模型名称
     */
    private record ChannelModelSelection(String channelId, String model) {
    }

    /**
     * 规范化思考模式开关。
     *
     * @param enabled Boolean 模型配置中的开关
     * @return boolean 缺省时开启思考模式
     */
    private boolean thinkingEnabled(Boolean enabled) {
        return enabled == null || Boolean.TRUE.equals(enabled);
    }

    /**
     * 规范化思考强度。
     *
     * @param effort String 模型配置中的强度
     * @return String high或max
     */
    private String reasoningEffort(String effort) {
        return "max".equals(effort) ? "max" : "high";
    }

    /**
     * 解析后的模型和渠道
     *
     * @param channel AiChannelConfig 渠道配置
     * @param model String 模型名称
     */
    private record ResolvedModel(AiTaskDtos.AiChannelConfig channel, String model, String modelConfigId, Integer creditCost, String creditUnit,
                                 boolean thinkingEnabled, String reasoningEffort, JSONObject customBodyParameters) {
    }
}
