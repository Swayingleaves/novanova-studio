package com.novanovastudio.service;

import java.math.BigDecimal;
import com.novanovastudio.common.SystemMessage;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.ai.AiTaskPollingSupport;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.dto.ComicDramaDtos;
import com.novanovastudio.dto.PersistenceDtos;
import com.novanovastudio.dto.ScriptDtos;
import com.novanovastudio.dto.StoryboardExportSnapshot;
import com.novanovastudio.dto.VideoCompositionDtos;
import com.novanovastudio.entity.VideoCompositionTask;
import com.novanovastudio.repository.ComicDramaRepository;
import com.novanovastudio.repository.VideoCompositionTaskRepository;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.task.StoryboardVideoExportProcessor;
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
    /** 后台合成任务的团队恢复。 */
    private final TeamTaskScopeService teamTaskScopeService;

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

    /** 分镜时间轴媒体处理器 */
    private final StoryboardVideoExportProcessor storyboardExportProcessor;

    /** 漫剧项目归属查询。 */
    private final ComicDramaRepository comicDramaRepository;

    /** 剧本分集查询。 */
    private final ScriptService scriptService;

    /** 漫剧媒体任务状态同步。 */
    private final ComicDramaService comicDramaService;

    /** 视频合成任务调度器 */
    private final VideoCompositionTaskDispatcher taskDispatcher;

    /** 视频合成任务队列 */
    private final VideoCompositionTaskQueue taskQueue;

    /** 视频合成任务取消标记 */
    private final VideoCompositionTaskCancellation cancellation;

    /** 服务配置 */
    private final NovanovaProperties properties;

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
        Duration pollingInterval = AiTaskPollingSupport.pollingInterval(properties);
        recoveryDisposable = Flux.interval(Duration.ZERO, pollingInterval)
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
                .then().contextWrite(context -> context.put(com.novanovastudio.security.TeamScope.SYSTEM_KEY, true));
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
        return currentUserProvider.currentUserId().flatMap(userId -> persistenceService.requireStorageWritable(userId).then(Mono.defer(() -> Flux.fromIterable(sourceStorageKeys)
                .concatMap(storageKey -> persistenceService.validateVideoMediaForUser(userId, storageKey))
                .then(Mono.defer(() -> {
                    VideoCompositionTask task = new VideoCompositionTask();
                    task.setId(UUID.randomUUID().toString());
                    task.setUserId(userId);
                    task.setStatus(STATUS_PENDING);
                    task.setProgress(0);
                    task.setSourceStorageKeys(JSON.toJSONString(sourceStorageKeys));
                    task.setTaskType("canvasComposition");
                    task.setResultData("{}");
                    task.setErrorMessage("");
                    log.info("创建视频合成任务: taskId={}, userId={}, sourceCount={}", task.getId(), userId, sourceStorageKeys.size());
                    return cancellation.clearCancellation(task.getId())
                            .then(repository.createTask(task))
                            .then(taskDispatcher.enqueue(task.getId()))
                            .thenReturn(taskResponse(task));
                })))));
    }

    /**
     * 按已保存的项目数据创建分镜导出任务。
     * @param request 导出项目与分集选择
     * @return 已入队任务
     */
    public Mono<VideoCompositionDtos.VideoCompositionTaskResponse> exportStoryboardVideo(
            VideoCompositionDtos.ExportStoryboardVideoRequest request) {
        return currentUserProvider.currentUserId().flatMap(userId -> persistenceService.requireStorageWritable(userId).then(Mono.defer(() -> comicDramaRepository.getProject(userId, request.projectId())
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "漫剧项目不存在")))
                .flatMap(project -> Mono.zip(comicDramaRepository.getSettings(request.projectId()),
                        comicDramaRepository.listShots(request.projectId(), null, null).collectList(),
                        comicDramaService.listMedia(new ComicDramaDtos.ListMediaRequest(request.projectId(), null, null)),
                        comicDramaRepository.listVoiceTracks(request.projectId(), null).collectList(),
                        comicDramaRepository.listTimelineTexts(request.projectId()).collectList(),
                        scriptService.getProject(request.projectId())))
                .flatMap(data -> {
                    StoryboardExportSnapshot snapshot = buildStoryboardSnapshot(request.projectId(), request.episodeId(),
                            data.getT1(), data.getT2(), data.getT3(), data.getT4(), data.getT5(), data.getT6().episodes());
                    VideoCompositionTask task = new VideoCompositionTask();
                    task.setId(UUID.randomUUID().toString());
                    task.setUserId(userId);
                    task.setStatus(STATUS_PENDING);
                    task.setProgress(0);
                    task.setTaskType("storyboardExport");
                    task.setProjectId(request.projectId());
                    task.setSourceStorageKeys("[]");
                    task.setInputSnapshot(JSON.toJSONString(snapshot));
                    task.setResultData("{}");
                    task.setErrorMessage("");
                    log.info("创建分镜导出任务: taskId={}, projectId={}, episodeId={}", task.getId(), request.projectId(), request.episodeId());
                    return cancellation.clearCancellation(task.getId()).then(repository.createTask(task))
                            .then(taskDispatcher.enqueue(task.getId())).thenReturn(taskResponse(task));
                }))));
    }

    /**
     * 查询项目最近的导出任务。
     * @param projectId 项目标识
     * @return 最近任务
     */
    public Mono<VideoCompositionDtos.VideoCompositionTaskResponse> getLatestStoryboardExport(String projectId) {
        return currentUserProvider.currentUserId().flatMap(userId -> comicDramaRepository.getProject(userId, projectId)
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "漫剧项目不存在")))
                .then(repository.getLatestStoryboardExport(userId, projectId))
                .map(this::taskResponse));
    }

    /**
     * 验证导出任务归属与完成状态后读取媒体键。
     * @param taskId 导出任务标识
     * @return 成片媒体键
     */
    public Mono<String> getStoryboardExportStorageKey(String taskId) {
        return currentUserProvider.currentUserId().flatMap(userId -> repository.getTask(userId, taskId)
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "分镜导出任务不存在")))
                .map(task -> {
                    if (!"storyboardExport".equals(task.getTaskType()) || !STATUS_SUCCEEDED.equals(task.getStatus())) {
                        throw new BusinessException(ErrorCode.BUSINESS_ERROR, "分镜视频尚未导出完成");
                    }
                    String key = parseJsonObject(task.getResultData()).getString("storageKey");
                    if (!StringUtils.hasText(key)) throw new BusinessException(ErrorCode.BUSINESS_ERROR, "分镜视频媒体不存在");
                    return key;
                }));
    }

    /**
     * 将已保存的数据冻结为项目绝对时间轴快照。
     * @param projectId 项目标识
     * @param episodeId 可选分集标识
     * @param settings 项目画面设置
     * @param sourceShots 镜头列表
     * @param mediaResults 媒体结果
     * @param voiceTracks 音频轨道
     * @param timelineTexts 文字轨道
     * @param episodes 分集列表
     * @return 导出输入快照
     */
    private StoryboardExportSnapshot buildStoryboardSnapshot(String projectId, String episodeId,
            ComicDramaDtos.ProductionSettings settings, List<ComicDramaDtos.Shot> sourceShots,
            List<ComicDramaDtos.MediaResult> mediaResults, List<ComicDramaDtos.VoiceTrack> voiceTracks,
            List<ComicDramaDtos.TimelineText> timelineTexts, List<ScriptDtos.EpisodeSummary> episodes) {
        if (episodeId != null && episodes.stream().noneMatch(item -> episodeId.equals(item.id()))) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "所选分集不存在");
        }
        List<ComicDramaDtos.Shot> ordered = sourceShots.stream()
                .sorted(Comparator.comparingInt(ComicDramaDtos.Shot::sortOrder)).toList();
        List<StoryboardExportSnapshot.Shot> shots = new java.util.ArrayList<>();
        long cursor = 0;
        long selectedDuration = 0;
        for (ComicDramaDtos.Shot shot : ordered) {
            ComicDramaDtos.MediaResult media = mediaResults.stream()
                    .filter(item -> "shot".equals(item.targetType()) && shot.id().equals(item.targetId())
                            && "video".equals(item.mediaType()))
                    .findFirst().orElse(null);
            JSONObject result = media == null ? null : media.resultData();
            JSONObject item = result == null ? null : result.getJSONObject("item");
            if (item == null && result != null && result.getJSONArray("items") != null
                    && !result.getJSONArray("items").isEmpty()) {
                item = result.getJSONArray("items").getJSONObject(0);
            }
            boolean selected = episodeId == null || episodeId.equals(shot.sourceEpisodeId());
            String storageKey = media != null && ("completed".equals(media.status()) || "needsUpdate".equals(media.status()))
                    && item != null ? item.getString("storageKey") : null;
            if (selected && media != null && ("completed".equals(media.status()) || "needsUpdate".equals(media.status()))
                    && storageKey == null && item != null && StringUtils.hasText(item.getString("url"))) {
                throw new BusinessException(ErrorCode.BUSINESS_ERROR, "镜头视频尚未保存到媒体库，无法导出: " + shot.shotNumber());
            }
            long duration = item != null && item.getLongValue("durationMs") > 0
                    ? item.getLongValue("durationMs") : shot.durationSeconds().multiply(java.math.BigDecimal.valueOf(1000)).longValue();
            if (item != null && item.getLongValue("durationMs") < 1) {
                Object rawDuration = item.get("duration");
                if (rawDuration instanceof Number number && number.doubleValue() > 0) {
                    duration = Math.round(number.doubleValue() * 1000);
                }
            }
            shots.add(new StoryboardExportSnapshot.Shot(shot.id(), storageKey, cursor, duration, selected));
            cursor += duration;
            if (selected) selectedDuration += duration;
        }
        if (selectedDuration < 1) throw new BusinessException(ErrorCode.PARAM_INVALID, "当前导出范围没有镜头");
        long maximum = Math.max(1, properties.getAi().getVideoComposition().getMaximumTotalDurationSeconds()) * 1000L;
        if (selectedDuration > maximum) throw new BusinessException(ErrorCode.PARAM_INVALID, "导出时长不能超过10分钟");
        List<StoryboardExportSnapshot.Text> texts = timelineTexts.stream()
                .map(item -> new StoryboardExportSnapshot.Text(item.id(), item.content(), item.startMs(), item.endMs(),
                        item.trackNumber(), item.positionX().doubleValue(), item.positionY().doubleValue(),
                        item.fontSize(), item.fontFamily(), item.color(), item.alignment(), item.backgroundColor())).toList();
        List<StoryboardExportSnapshot.Audio> audio = voiceTracks.stream()
                .filter(item -> StringUtils.hasText(item.audioStorageKey()) && item.timelineStartMs() != null
                        && item.trimStartMs() != null && item.trimEndMs() != null)
                .map(item -> new StoryboardExportSnapshot.Audio(item.id(), item.audioStorageKey(),
                        item.timelineStartMs(), item.trimStartMs(), item.trimEndMs())).toList();
        return new StoryboardExportSnapshot(projectId, episodeId, settings.aspectRatio(), shots, texts, audio);
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
                        .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, SystemMessage.of("business.videoCompositionTaskNotFound"))))
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
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, SystemMessage.of("business.videoCompositionTaskNotFound"))))
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
        return teamTaskScopeService.execute("video_composition_tasks", taskId, () -> executeQueuedTaskInTeam(taskId));
    }
    /** @param taskId 持久化任务标识 @return 原空间任务执行 */
    private Mono<Void> executeQueuedTaskInTeam(String taskId) {
        return repository.getTaskById(taskId)
                .switchIfEmpty(Mono.fromRunnable(() -> log.info("跳过视频合成任务执行: taskId={}, reason={}", taskId, "任务不存在")).then(Mono.empty()))
                .flatMap(task -> teamTaskScopeService.requireActive(task.getUserId()).then(persistenceService.requireStorageWritable(task.getUserId()))
                        .then(executeTask(task)).onErrorResume(error -> repository.cancelTask(task.getUserId(), taskId).then(Mono.error(error))))
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
        if ("storyboardExport".equals(task.getTaskType())) return composeStoryboardTask(task);
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
     * 执行分镜导出并复用任务结果收尾逻辑。
     * @param task 已领取的导出任务
     * @return 执行完成信号
     */
    private Mono<Void> composeStoryboardTask(VideoCompositionTask task) {
        return Mono.defer(() -> {
                    StoryboardExportSnapshot snapshot = JSON.parseObject(task.getInputSnapshot(), StoryboardExportSnapshot.class);
                    if (snapshot == null) throw new BusinessException(ErrorCode.BUSINESS_ERROR, "分镜导出快照无效");
                    AtomicInteger lastProgress = new AtomicInteger(0);
                    return Mono.usingWhen(createWorkingDirectory(task.getId()), directory ->
                                    storyboardExportProcessor.render(task.getUserId(), snapshot, directory,
                                            progress -> updateProgress(task.getId(), progress, lastProgress),
                                            () -> isCancellationRequested(task.getId()))
                                            .flatMap(output -> cancellation.isCancellationRequested(task.getId())
                                                    .flatMap(cancelRequested -> {
                                                        if (Boolean.TRUE.equals(cancelRequested)) {
                                                            return Mono.error(new VideoCompositionMediaProcessor.VideoCompositionCanceledException());
                                                        }
                                                        return persistenceService.storeGeneratedMediaFileForUser(task.getUserId(),
                                                                "video", "storyboard-export.mp4", "video/mp4", output.path(),
                                                                output.result().width(), output.result().height(), durationAsInteger(output.result().durationMilliseconds()));
                                                    })),
                                    this::deleteWorkingDirectory, (directory, exception) -> deleteWorkingDirectory(directory), this::deleteWorkingDirectory);
                })
                .flatMap(media -> finishSucceeded(task, media)).onErrorResume(exception -> finishFailed(task, exception))
                .doFinally(signal -> cancellation.clearCancellation(task.getId()).subscribe(
                        ignored -> {}, exception -> log.error("清理分镜导出取消标记失败: taskId={}", task.getId(), exception)));
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
                        return repository.finishRunningTask(task.getId(), STATUS_CANCELED, "{}", SystemMessage.of("system.taskCanceled"))
                                .then(persistenceService.deleteMediaForUser(task.getUserId(), List.of(media.storageKey())));
                    }
                    return repository.finishRunningTask(task.getId(), STATUS_SUCCEEDED, result.toJSONString(), null)
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
                        return repository.finishRunningTask(task.getId(), STATUS_CANCELED, "{}", SystemMessage.of("system.taskCanceled")).then();
                    }
                    SystemMessage message = SystemMessage.fromThrowable(exception);
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
            throw new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.atLeastTwoVideosAreRequiredForComposition"));
        }
        if (sourceStorageKeys.size() > MAXIMUM_SOURCE_VIDEO_COUNT) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.atMost20VideosPerComposition"));
        }
        List<String> normalized = sourceStorageKeys.stream().map(value -> value == null ? "" : value.trim()).toList();
        if (normalized.stream().anyMatch(value -> !StringUtils.hasText(value))) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.videoStorageKeyIsRequired"));
        }
        Set<String> uniqueStorageKeys = new HashSet<>(normalized);
        if (uniqueStorageKeys.size() != normalized.size()) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.theSameVideoCannotBeComposedTwice"));
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
            throw new BusinessException(ErrorCode.BUSINESS_ERROR, SystemMessage.of("business.compositionTaskHasNoValidSourceVideoSnapshot"));
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
                task.getId(), task.getStatus(), task.getProgress(),
                "storyboardExport".equals(task.getTaskType()) ? List.of() : parseSourceStorageKeys(task.getSourceStorageKeys()),
                parseJsonObject(task.getResultData()), task.getErrorMessage(), SystemMessage.stored(task.getErrorMessageKey(), task.getErrorMessageArguments()), formatTime(task.getStartedAt()),
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
