package com.novanovastudio.service;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.PersistenceDtos;
import com.novanovastudio.dto.VideoCompositionDtos;
import com.novanovastudio.entity.VideoCompositionTask;
import com.novanovastudio.repository.VideoCompositionTaskRepository;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.task.VideoCompositionMediaProcessor;
import com.novanovastudio.task.VideoCompositionTaskCancellation;
import com.novanovastudio.task.VideoCompositionTaskDispatcher;
import com.novanovastudio.task.VideoCompositionTaskQueue;
import jakarta.annotation.PreDestroy;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import reactor.core.Disposable;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

/**
 * 画布视频合成任务业务服务。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-08-11 00:00
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class VideoCompositionTaskService {

    /** 等待状态 */
    private static final String STATUS_PENDING = "pending";

    /** 执行中状态 */
    private static final String STATUS_RUNNING = "running";

    /** 成功状态 */
    private static final String STATUS_SUCCEEDED = "succeeded";

    /** 失败状态 */
    private static final String STATUS_FAILED = "failed";

    /** 已取消状态 */
    private static final String STATUS_CANCELED = "canceled";

    /** 最大合成视频数量 */
    private static final int MAXIMUM_SOURCE_VIDEO_COUNT = 20;

    /** 任务仓储 */
    private final VideoCompositionTaskRepository repository;

    /** 当前用户提供器 */
    private final CurrentUserProvider currentUserProvider;

    /** 媒体持久化服务 */
    private final PersistenceService persistenceService;

    /** 视频媒体处理器 */
    private final VideoCompositionMediaProcessor mediaProcessor;

    /** 视频合成任务调度器 */
    private final VideoCompositionTaskDispatcher taskDispatcher;

    /** 视频合成任务队列 */
    private final VideoCompositionTaskQueue taskQueue;

    /** 视频合成任务取消标记 */
    private final VideoCompositionTaskCancellation cancellation;

    /** 未完成任务恢复订阅 */
    private Disposable recoveryDisposable;

    /**
     * 服务启动时恢复未完成的视频合成任务。
     */
    @EventListener(ApplicationReadyEvent.class)
    public void recoverUnfinishedTasks() {
        if (recoveryDisposable != null) {
            recoveryDisposable.dispose();
        }
        recoveryDisposable = Flux.interval(Duration.ZERO, Duration.ofSeconds(30))
                .concatMap(ignored -> recoverUnfinishedTasksOnce().onErrorResume(exception -> {
                    log.error("恢复视频合成任务失败", exception);
                    return Mono.<Void>empty();
                }))
                .subscribe(
                        ignored -> {
                        },
                        exception -> log.error("视频合成任务恢复订阅异常终止", exception)
                );
    }

    /**
     * 停止未完成任务恢复订阅。
     */
    @PreDestroy
    public void stopRecovery() {
        if (recoveryDisposable != null) {
            recoveryDisposable.dispose();
        }
    }

    /**
     * 将等待任务以及已失去活动租约的运行中任务重新写入队列。
     *
     * @return Mono<Void> 本轮恢复结果
     */
    private Mono<Void> recoverUnfinishedTasksOnce() {
        return repository.listPendingTasks()
                .concatMap(task -> taskDispatcher.enqueue(task.getId()))
                .thenMany(repository.listRunningTasks()
                        .concatMap(task -> taskQueue.hasActiveTask(task.getId())
                                .filter(active -> !active)
                                .flatMap(ignored -> repository.requeueInactiveRunningTask(task.getId()))
                                .filter(Boolean::booleanValue)
                                .flatMap(ignored -> taskDispatcher.enqueue(task.getId()))))
                .then();
    }

    /**
     * 创建当前用户的视频合成任务。
     *
     * @param request CreateVideoCompositionRequest 创建请求
     * @return Mono<VideoCompositionTaskResponse> 已创建任务响应
     */
    public Mono<VideoCompositionDtos.VideoCompositionTaskResponse> createTask(
            VideoCompositionDtos.CreateVideoCompositionRequest request) {
        List<String> sourceStorageKeys = normalizeSourceStorageKeys(request == null ? null : request.sourceStorageKeys());
        return currentUserProvider.currentUserId().flatMap(userId -> Flux.fromIterable(sourceStorageKeys)
                .concatMap(storageKey -> persistenceService.validateVideoMediaForUser(userId, storageKey))
                .then(Mono.defer(() -> {
                    VideoCompositionTask task = new VideoCompositionTask();
                    task.setId(UUID.randomUUID().toString());
                    task.setUserId(userId);
                    task.setStatus(STATUS_PENDING);
                    task.setProgress(0);
                    task.setSourceStorageKeys(JSON.toJSONString(sourceStorageKeys));
                    task.setResultData("{}");
                    task.setErrorMessage("");
                    log.info("创建视频合成任务: taskId={}, userId={}, sourceCount={}", task.getId(), userId, sourceStorageKeys.size());
                    return cancellation.clearCancellation(task.getId())
                            .then(repository.createTask(task))
                            .then(taskDispatcher.enqueue(task.getId()))
                            .thenReturn(taskResponse(task));
                })));
    }

    /**
     * 查询当前用户的视频合成任务。
     *
     * @param task VideoCompositionTask 运行中的任务
     * @return Mono<VideoCompositionTaskResponse> 任务响应
     */
    public Mono<VideoCompositionDtos.VideoCompositionTaskResponse> getTask(String taskId) {
        return currentUserProvider.currentUserId()
                .flatMap(userId -> repository.getTask(userId, taskId)
                        .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "视频合成任务不存在")))
                        .map(this::taskResponse));
    }

    /**
     * 取消当前用户的视频合成任务。
     *
     * @param taskId String 任务ID
     * @return Mono<VideoCompositionTaskResponse> 已取消或原任务响应
     */
    public Mono<VideoCompositionDtos.VideoCompositionTaskResponse> cancelTask(String taskId) {
        return currentUserProvider.currentUserId().flatMap(userId -> repository.getTask(userId, taskId)
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "视频合成任务不存在")))
                .flatMap(task -> {
                    if (isTerminal(task.getStatus())) {
                        return Mono.just(taskResponse(task));
                    }
                    return cancellation.requestCancellation(taskId)
                            .then(repository.cancelTask(userId, taskId))
                            .then(repository.getTask(userId, taskId))
                            .map(this::taskResponse);
                }));
    }

    /**
     * 执行队列中已领取的视频合成任务。
     *
     * @param taskId String 任务ID
     * @return Mono<Void> 执行结果
     */
    public Mono<Void> executeQueuedTask(String taskId) {
        return repository.getTaskById(taskId)
                .switchIfEmpty(Mono.fromRunnable(() -> log.info("跳过视频合成任务执行: taskId={}, reason={}", taskId, "任务不存在")).then(Mono.empty()))
                .flatMap(this::executeTask)
                .onErrorResume(exception -> {
                    log.error("执行视频合成任务发生未处理异常: taskId={}", taskId, exception);
                    return Mono.empty();
                });
    }

    /**
     * 根据当前任务状态执行合成流程。
     *
     * @param task VideoCompositionTask 任务快照
     * @return Mono<Void> 执行结果
     */
    private Mono<Void> executeTask(VideoCompositionTask task) {
        if (!STATUS_PENDING.equals(task.getStatus())) {
            log.info("跳过视频合成任务执行: taskId={}, status={}", task.getId(), task.getStatus());
            return Mono.empty();
        }
        return cancellation.isCancellationRequested(task.getId())
                .flatMap(cancelRequested -> {
                    if (Boolean.TRUE.equals(cancelRequested)) {
                        return repository.cancelTask(task.getUserId(), task.getId()).then(cancellation.clearCancellation(task.getId()));
                    }
                    return repository.markTaskRunning(task.getId())
                            .flatMap(started -> Boolean.TRUE.equals(started) ? composeTask(task) : Mono.empty());
                });
    }

    /**
     * 执行媒体下载、FFmpeg合成和对象存储上传。
     *
     * @param task VideoCompositionTask 运行中的任务
     * @return Mono<Void> 合成结果
     */
    private Mono<Void> composeTask(VideoCompositionTask task) {
        List<String> sourceStorageKeys = parseSourceStorageKeys(task.getSourceStorageKeys());
        return Mono.usingWhen(
                        createWorkingDirectory(task.getId()),
                        directory -> composeInWorkingDirectory(task, sourceStorageKeys, directory),
                        this::deleteWorkingDirectory,
                        (directory, exception) -> deleteWorkingDirectory(directory),
                        this::deleteWorkingDirectory
                )
                .flatMap(media -> finishSucceeded(task, media))
                .onErrorResume(exception -> finishFailed(task, exception))
                .doFinally(signalType -> cancellation.clearCancellation(task.getId()).subscribe(
                        ignored -> {
                        },
                        exception -> log.error("清理视频合成取消标记失败: taskId={}", task.getId(), exception)
                ));
    }

    /**
     * 在任务私有临时目录中完成视频合成。
     *
     * @param task VideoCompositionTask 运行中的任务
     * @param sourceStorageKeys List<String> 源视频媒体存储键
     * @param directory Path 临时目录
     * @return Mono<UploadedMediaResponse> 已上传成片媒体
     */
    private Mono<PersistenceDtos.UploadedMediaResponse> composeInWorkingDirectory(
            VideoCompositionTask task, List<String> sourceStorageKeys, Path directory) {
        AtomicInteger lastProgress = new AtomicInteger(0);
        return Flux.fromIterable(sourceStorageKeys)
                .index()
                .concatMap(indexed -> cancellation.isCancellationRequested(task.getId())
                        .flatMap(cancelRequested -> {
                            if (Boolean.TRUE.equals(cancelRequested)) {
                                return Mono.error(new VideoCompositionMediaProcessor.VideoCompositionCanceledException());
                            }
                            Path target = directory.resolve("source-" + indexed.getT1() + ".media");
                            return persistenceService.downloadVideoMediaToFileForUser(task.getUserId(), indexed.getT2(), target);
                        }))
                .collectList()
                .flatMap(sourceFiles -> Mono.fromCallable(() -> {
                    Path outputFile = directory.resolve("composed-video.mp4");
                    VideoCompositionMediaProcessor.CompositionResult result = mediaProcessor.compose(
                            sourceFiles.stream().map(PersistenceService.DownloadedMediaFile::path).toList(),
                            outputFile,
                            progress -> updateProgress(task.getId(), progress, lastProgress),
                            () -> isCancellationRequested(task.getId())
                    );
                    return new CompositionOutput(outputFile, result);
                }).subscribeOn(Schedulers.boundedElastic()))
                .flatMap(output -> cancellation.isCancellationRequested(task.getId())
                        .flatMap(cancelRequested -> {
                            if (Boolean.TRUE.equals(cancelRequested)) {
                                return Mono.error(new VideoCompositionMediaProcessor.VideoCompositionCanceledException());
                            }
                            return persistenceService.storeGeneratedMediaFileForUser(
                                    task.getUserId(), "video", "canvas-video-composition.mp4", "video/mp4", output.path(),
                                    output.result().width(), output.result().height(), durationAsInteger(output.result().durationMilliseconds())
                            );
                        }));
    }

    /**
     * 创建任务私有临时目录。
     *
     * @param task VideoCompositionTask 运行中的任务
     * @return Mono<Path> 临时目录
     */
    private Mono<Path> createWorkingDirectory(String taskId) {
        String normalizedTaskId = taskId.replaceAll("[^a-zA-Z0-9-]", "");
        return Mono.fromCallable(() -> Files.createTempDirectory("novanova-video-composition-" + normalizedTaskId + "-"))
                .subscribeOn(Schedulers.boundedElastic());
    }

    /**
     * 删除任务临时目录。
     *
     * @param directory Path 临时目录
     * @return Mono<Void> 删除结果
     */
    private Mono<Void> deleteWorkingDirectory(Path directory) {
        return Mono.fromRunnable(() -> {
            try (var paths = Files.walk(directory)) {
                paths.sorted(Comparator.reverseOrder()).forEach(path -> {
                    try {
                        Files.deleteIfExists(path);
                    } catch (IOException exception) {
                        throw new UncheckedIOException(exception);
                    }
                });
            } catch (IOException | UncheckedIOException exception) {
                log.error("清理视频合成临时目录失败: directory={}", directory, exception);
            }
        }).subscribeOn(Schedulers.boundedElastic()).then();
    }

    /**
     * 回写任务进度，避免重复写入相同进度。
     *
     * @param taskId String 任务ID
     * @param progress int 最新进度
     * @param lastProgress AtomicInteger 已写入进度
     */
    private void updateProgress(String taskId, int progress, AtomicInteger lastProgress) {
        int normalized = Math.max(1, Math.min(99, progress));
        if (normalized <= lastProgress.getAndAccumulate(normalized, Math::max)) {
            return;
        }
        repository.updateProgress(taskId, normalized)
                .onErrorResume(exception -> {
                    log.error("更新视频合成任务进度失败: taskId={}, progress={}", taskId, normalized, exception);
                    return Mono.empty();
                })
                .block();
    }

    /**
     * 查询任务是否已请求取消。
     *
     * @param taskId String 任务ID
     * @return boolean 是否已取消
     */
    private boolean isCancellationRequested(String taskId) {
        return Boolean.TRUE.equals(cancellation.isCancellationRequested(taskId)
                .onErrorReturn(false)
                .block());
    }

    /**
     * 将成功结果写入任务。
     *
     * @param task VideoCompositionTask 运行中的任务
     * @param media UploadedMediaResponse 成片媒体信息
     * @return Mono<Void> 更新结果
     */
    private Mono<Void> finishSucceeded(VideoCompositionTask task, PersistenceDtos.UploadedMediaResponse media) {
        JSONObject result = new JSONObject();
        result.put("storageKey", media.storageKey());
        result.put("url", media.url());
        result.put("bytes", media.bytes());
        result.put("mimeType", media.mimeType());
        result.put("width", media.width());
        result.put("height", media.height());
        result.put("durationMs", media.durationMs());
        result.put("objectStorage", JSON.toJSON(media.objectStorage()));
        return cancellation.isCancellationRequested(task.getId())
                .onErrorReturn(false)
                .flatMap(cancelRequested -> {
                    if (Boolean.TRUE.equals(cancelRequested)) {
                        return repository.finishRunningTask(task.getId(), STATUS_CANCELED, "{}", "任务已取消")
                                .then(persistenceService.deleteMediaForUser(task.getUserId(), List.of(media.storageKey())));
                    }
                    return repository.finishRunningTask(task.getId(), STATUS_SUCCEEDED, result.toJSONString(), "")
                            .flatMap(updated -> {
                                if (Boolean.TRUE.equals(updated)) {
                                    log.info("视频合成任务执行成功: taskId={}, storageKey={}", task.getId(), media.storageKey());
                                    return Mono.<Void>empty();
                                }
                                log.info("视频合成任务已取消或已结束，清理未回填的成片媒体: taskId={}, storageKey={}", task.getId(), media.storageKey());
                                return persistenceService.deleteMediaForUser(task.getUserId(), List.of(media.storageKey()));
                            });
                });
    }

    /**
     * 根据异常完成失败或取消任务。
     *
     * @param task VideoCompositionTask 任务快照
     * @param exception Throwable 异常
     * @return Mono<Void> 更新结果
     */
    private Mono<Void> finishFailed(VideoCompositionTask task, Throwable exception) {
        boolean canceled = exception instanceof VideoCompositionMediaProcessor.VideoCompositionCanceledException;
        return cancellation.isCancellationRequested(task.getId())
                .onErrorReturn(false)
                .flatMap(cancelRequested -> {
                    if (canceled || Boolean.TRUE.equals(cancelRequested)) {
                        return repository.finishRunningTask(task.getId(), STATUS_CANCELED, "{}", "任务已取消").then();
                    }
                    String message = errorMessage(exception);
                    log.error("视频合成任务执行失败: taskId={}", task.getId(), exception);
                    return repository.finishRunningTask(task.getId(), STATUS_FAILED, "{}", message).then();
                });
    }

    /**
     * 将请求中的源视频存储键归一化并校验。
     *
     * @param sourceStorageKeys List<String> 原始存储键
     * @return List<String> 归一化后的存储键
     */
    private List<String> normalizeSourceStorageKeys(List<String> sourceStorageKeys) {
        if (sourceStorageKeys == null || sourceStorageKeys.size() < 2) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "至少需要两个视频才能合成");
        }
        if (sourceStorageKeys.size() > MAXIMUM_SOURCE_VIDEO_COUNT) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "单次最多合成20个视频");
        }
        List<String> normalized = sourceStorageKeys.stream().map(value -> value == null ? "" : value.trim()).toList();
        if (normalized.stream().anyMatch(value -> !StringUtils.hasText(value))) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "视频媒体存储键不能为空");
        }
        Set<String> uniqueStorageKeys = new HashSet<>(normalized);
        if (uniqueStorageKeys.size() != normalized.size()) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "同一视频不能重复参与合成");
        }
        return normalized;
    }

    /**
     * 解析任务保存的源视频存储键快照。
     *
     * @param sourceStorageKeys String JSON存储键数组
     * @return List<String> 源视频存储键
     */
    private List<String> parseSourceStorageKeys(String sourceStorageKeys) {
        try {
            return normalizeSourceStorageKeys(JSON.parseArray(sourceStorageKeys, String.class));
        } catch (BusinessException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new BusinessException(ErrorCode.BUSINESS_ERROR, "视频合成任务缺少有效的源视频快照");
        }
    }

    /**
     * 转换任务实体为接口响应。
     *
     * @param task VideoCompositionTask 任务实体
     * @return VideoCompositionTaskResponse 接口响应
     */
    private VideoCompositionDtos.VideoCompositionTaskResponse taskResponse(VideoCompositionTask task) {
        return new VideoCompositionDtos.VideoCompositionTaskResponse(
                task.getId(), task.getStatus(), task.getProgress(), parseSourceStorageKeys(task.getSourceStorageKeys()),
                parseJsonObject(task.getResultData()), task.getErrorMessage(), formatTime(task.getStartedAt()),
                formatTime(task.getCompletedAt()), formatTime(task.getCreatedAt()), formatTime(task.getUpdatedAt())
        );
    }

    /**
     * 判断任务是否已结束。
     *
     * @param status String 任务状态
     * @return boolean 是否已结束
     */
    private boolean isTerminal(String status) {
        return STATUS_SUCCEEDED.equals(status) || STATUS_FAILED.equals(status) || STATUS_CANCELED.equals(status);
    }

    /**
     * 将异常转换为可展示的错误消息。
     *
     * @param exception Throwable 原始异常
     * @return String 错误消息
     */
    private String errorMessage(Throwable exception) {
        String message = exception == null ? "" : exception.getMessage();
        return StringUtils.hasText(message) ? message : "视频合成失败";
    }

    /**
     * 解析JSON对象。
     *
     * @param value String JSON文本
     * @return JSONObject 解析结果
     */
    private JSONObject parseJsonObject(String value) {
        try {
            JSONObject result = JSON.parseObject(value);
            return result == null ? new JSONObject() : result;
        } catch (Exception exception) {
            return new JSONObject();
        }
    }

    /**
     * 格式化时间。
     *
     * @param value OffsetDateTime 时间
     * @return String ISO时间文本
     */
    private String formatTime(OffsetDateTime value) {
        return value == null ? null : DateTimeFormatter.ISO_OFFSET_DATE_TIME.format(value);
    }

    /**
     * 将时长安全转换为整型毫秒数。
     *
     * @param durationMilliseconds long 时长毫秒数
     * @return Integer 整型时长毫秒数
     */
    private Integer durationAsInteger(long durationMilliseconds) {
        return (int) Math.min(Integer.MAX_VALUE, Math.max(0L, durationMilliseconds));
    }

    /**
     * 临时目录中的成片文件及其探测结果。
     *
     * @param path Path 成片文件路径
     * @param result CompositionResult 成片媒体结果
     */
    private record CompositionOutput(Path path, VideoCompositionMediaProcessor.CompositionResult result) {
    }
}
