package com.novanovastudio.service;

import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.ComicDramaDtos;
import com.novanovastudio.dto.VideoCompositionDtos;
import com.novanovastudio.repository.ComicDramaRepository;
import com.novanovastudio.security.CurrentUser;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.security.TeamScope;
import jakarta.annotation.PreDestroy;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import reactor.core.Disposable;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;
import reactor.util.context.Context;

/**
 * 漫剧单集一键出集流水线编排服务：串联拆镜头、补资产图、批量提示词、批量生视频与成片导出，并支持断点停顿确认与页面刷新恢复。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-27 19:28
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ComicDramaPipelineService {

    /** 后台轮询等待底层异步媒体或导出任务完成的间隔。 */
    private static final Duration POLL_INTERVAL = Duration.ofSeconds(3);

    /** 单个异步等待阶段的最大轮询次数（约 30 分钟）。 */
    private static final int MAX_POLL_ROUNDS = 600;

    /** 当前用户提供器。 */
    private final CurrentUserProvider currentUserProvider;

    /** 漫剧仓储。 */
    private final ComicDramaRepository repository;

    /** 漫剧生产业务服务。 */
    private final ComicDramaService comicDramaService;

    /** 最终提示词定价服务。 */
    private final ComicDramaFinalPromptPricingService finalPromptPricingService;

    /** 分镜视频合成导出服务。 */
    private final VideoCompositionTaskService videoCompositionTaskService;

    /** 正在本机运行的流水线订阅句柄，供取消或停机清理。 */
    private final Map<String, Disposable> runningPipelines = new ConcurrentHashMap<>();

    /** 服务关闭时释放正在运行的流水线订阅。 */
    @PreDestroy
    public void shutdown() {
        runningPipelines.values().forEach(Disposable::dispose);
        runningPipelines.clear();
    }

    /**
     * 查询项目或指定分集最近一次一键出集流水线记录。
     *
     * @param projectId 项目ID
     * @param episodeId 分集ID，可为空
     * @return 最近一次流水线记录，无记录时为空
     */
    public Mono<ComicDramaDtos.EpisodePipeline> getLatestPipeline(String projectId, String episodeId) {
        return currentUserProvider.currentUserId().flatMap(userId -> repository.getProject(userId, projectId)
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "漫剧项目不存在")))
                .then(repository.getLatestEpisodePipeline(userId, projectId, episodeId)));
    }

    /**
     * 创建并异步启动单集一键出集流水线。
     *
     * @param request 启动配置与用户确认标记
     * @return 已落库的流水线初始状态
     */
    public Mono<ComicDramaDtos.EpisodePipeline> startPipeline(ComicDramaDtos.StartEpisodePipelineRequest request) {
        if (!request.confirmed()) {
            return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "启动一键出集流水线前必须明确确认预算"));
        }
        return Mono.deferContextual(ctxView -> currentUserProvider.currentUser().flatMap(user -> {
            TeamScope scope = TeamScope.from(ctxView);
            return repository.getProject(user.id(), request.projectId())
                    .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "漫剧项目不存在")))
                    .then(repository.getLatestEpisodePipeline(user.id(), request.projectId(), request.episodeId()))
                    .flatMap(existing -> "running".equals(existing.status())
                            ? Mono.<ComicDramaDtos.EpisodePipeline>error(new BusinessException(ErrorCode.BUSINESS_ERROR, "当前分集已有一键出集任务正在运行"))
                            : Mono.empty())
                    .switchIfEmpty(Mono.defer(() -> {
                        JSONObject config = buildConfig(request);
                        JSONObject progress = initialProgress("已启动单集出集流水线", 5);
                        ComicDramaDtos.EpisodePipeline created = new ComicDramaDtos.EpisodePipeline(
                                UUID.randomUUID().toString(),
                                request.projectId(),
                                StringUtils.hasText(request.episodeId()) ? request.episodeId().trim() : null,
                                request.executionMode(),
                                "pending",
                                "running",
                                config,
                                progress,
                                "",
                                OffsetDateTime.now(),
                                OffsetDateTime.now());
                        return repository.saveEpisodePipeline(user.id(), created)
                                .thenReturn(created)
                                .doOnSuccess(pipeline -> launchAsync(user, scope, pipeline, false));
                    }));
        }));
    }

    /**
     * 在关键节点停顿确认后继续执行后续阶段（提示词、生视频与成片导出）。
     *
     * @param request 继续执行请求
     * @return 更新为运行中的流水线记录
     */
    public Mono<ComicDramaDtos.EpisodePipeline> resumePipeline(ComicDramaDtos.EpisodePipelineActionRequest request) {
        return Mono.deferContextual(ctxView -> currentUserProvider.currentUser().flatMap(user -> {
            TeamScope scope = TeamScope.from(ctxView);
            return repository.getEpisodePipeline(user.id(), request.projectId(), request.pipelineId())
                    .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "一键出集流水线不存在")))
                    .flatMap(pipeline -> {
                        if (!"paused".equals(pipeline.status())) {
                            return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "当前流水线不处于等待确认状态"));
                        }
                        JSONObject progress = new JSONObject(pipeline.progress());
                        progress.put("message", "已确认，继续生成提示词与镜头视频...");
                        ComicDramaDtos.EpisodePipeline resumed = withState(pipeline, "prompts", "running", progress, "");
                        return repository.saveEpisodePipeline(user.id(), resumed)
                                .thenReturn(resumed)
                                .doOnSuccess(saved -> launchAsync(user, scope, saved, true));
                    });
        }));
    }

    /**
     * 取消正在运行或等待确认的流水线。
     *
     * @param request 取消请求
     * @return 更新后的流水线记录
     */
    public Mono<ComicDramaDtos.EpisodePipeline> cancelPipeline(ComicDramaDtos.EpisodePipelineActionRequest request) {
        return currentUserProvider.currentUserId().flatMap(userId -> repository.getEpisodePipeline(userId, request.projectId(), request.pipelineId())
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "一键出集流水线不存在")))
                .flatMap(pipeline -> {
                    Disposable active = runningPipelines.remove(pipeline.id());
                    if (active != null && !active.isDisposed()) {
                        active.dispose();
                    }
                    JSONObject progress = new JSONObject(pipeline.progress());
                    progress.put("message", "已手动停止流水线");
                    ComicDramaDtos.EpisodePipeline canceled = withState(pipeline, "canceled", "canceled", progress, "");
                    return repository.saveEpisodePipeline(userId, canceled).thenReturn(canceled);
                }));
    }

    /** 在独立弹性线程池启动流水线，并携带当前用户与团队作用域上下文。 */
    private void launchAsync(CurrentUser user, TeamScope scope, ComicDramaDtos.EpisodePipeline initial, boolean skipBeforePause) {
        Context executionContext = scope.apply(Context.empty()).put(CurrentUserProvider.CURRENT_USER_CONTEXT_KEY, user);
        Disposable disposable = executePipeline(user.id(), initial, skipBeforePause)
                .contextWrite(executionContext)
                .subscribeOn(Schedulers.boundedElastic())
                .doFinally(signal -> runningPipelines.remove(initial.id()))
                .subscribe(
                        ignored -> log.info("单集一键出集流水线结束: pipelineId={}, projectId={}", initial.id(), initial.projectId()),
                        error -> log.error("单集一键出集流水线异常: pipelineId={}, message={}", initial.id(), error.getMessage(), error));
        runningPipelines.put(initial.id(), disposable);
    }

    /** 顺序推进各个流水线阶段。 */
    private Mono<Void> executePipeline(Long userId, ComicDramaDtos.EpisodePipeline initial, boolean skipBeforePause) {
        Mono<ComicDramaDtos.EpisodePipeline> chain = Mono.just(initial);
        if (!skipBeforePause) {
            chain = chain
                    .flatMap(p -> runSplitStage(userId, p))
                    .flatMap(p -> runAssetStage(userId, p))
                    .flatMap(p -> maybePauseForReview(userId, p));
        }
        return chain
                .flatMap(p -> "running".equals(p.status()) ? runPromptStage(userId, p) : Mono.just(p))
                .flatMap(p -> "running".equals(p.status()) ? runVideoStage(userId, p) : Mono.just(p))
                .flatMap(p -> "running".equals(p.status()) ? runExportStage(userId, p) : Mono.just(p))
                .flatMap(p -> {
                    if (!"running".equals(p.status())) {
                        return Mono.just(p);
                    }
                    JSONObject progress = new JSONObject(p.progress());
                    progress.put("percent", 100);
                    progress.put("message", "本集一键出集已完成");
                    ComicDramaDtos.EpisodePipeline done = withState(p, "completed", "completed", progress, "");
                    return repository.saveEpisodePipeline(userId, done).thenReturn(done);
                })
                .then()
                .onErrorResume(error -> {
                    String msg = StringUtils.hasText(error.getMessage()) ? error.getMessage() : "一键出集执行失败";
                    log.error("漫剧一键出集失败: pipelineId={}, projectId={}, reason={}", initial.id(), initial.projectId(), msg, error);
                    return repository.getEpisodePipeline(userId, initial.projectId(), initial.id())
                            .defaultIfEmpty(initial)
                            .flatMap(latest -> {
                                if ("canceled".equals(latest.status())) {
                                    return Mono.empty();
                                }
                                JSONObject progress = new JSONObject(latest.progress());
                                progress.put("message", "执行失败：" + msg);
                                ComicDramaDtos.EpisodePipeline failed = withState(latest, "failed", "failed", progress, msg);
                                return repository.saveEpisodePipeline(userId, failed).then();
                            });
                });
    }

    /** 阶段1：若当前分集尚无镜头，则拆镜头草稿并确认写入正式镜头。 */
    private Mono<ComicDramaDtos.EpisodePipeline> runSplitStage(Long userId, ComicDramaDtos.EpisodePipeline pipeline) {
        if (!pipeline.config().getBooleanValue("includeSplit")) {
            return Mono.just(pipeline);
        }
        return comicDramaService.getWorkspace(pipeline.projectId()).flatMap(workspace -> {
            List<ComicDramaDtos.Shot> episodeShots = filterEpisodeShots(workspace, pipeline.episodeId());
            if (!episodeShots.isEmpty()) {
                JSONObject progress = updateProgress(pipeline, "split", "skipped", 15, "当前分集已有镜头，已跳过拆分");
                return persistStep(userId, pipeline, "split", "running", progress);
            }
            String textModel = pipeline.config().getString("textModel");
            if (!StringUtils.hasText(textModel)) {
                return Mono.error(new BusinessException(ErrorCode.PARAM_MISSING, "拆镜头缺少文本模型配置"));
            }
            JSONObject progress = updateProgress(pipeline, "split", "running", 12, "正在按本集剧本智能拆镜头...");
            return persistStep(userId, pipeline, "split", "running", progress)
                    .flatMap(running -> comicDramaService.generateShotDraft(new ComicDramaDtos.GenerateShotDraftRequest(
                                    pipeline.projectId(),
                                    pipeline.episodeId(),
                                    null,
                                    null,
                                    StringUtils.hasText(pipeline.config().getString("rhythm")) ? pipeline.config().getString("rhythm") : "紧凑利落",
                                    "",
                                    StringUtils.hasText(pipeline.config().getString("shotDuration")) ? pipeline.config().getString("shotDuration") : "medium",
                                    textModel,
                                    true))
                            .flatMap(draft -> comicDramaService.getWorkspace(pipeline.projectId())
                                    .flatMap(latest -> comicDramaService.confirmShotDraft(
                                            new ComicDramaDtos.ConfirmShotDraftRequest(pipeline.projectId(), latest.revision(), draft.id()))))
                            .then(Mono.defer(() -> {
                                JSONObject done = updateProgress(running, "split", "completed", 25, "本集镜头拆分并生效完成");
                                return persistStep(userId, running, "split", "running", done);
                            })));
        });
    }

    /** 阶段2：补齐本集镜头引用但尚无图片的视觉资产版本，并等待渲染完成。 */
    private Mono<ComicDramaDtos.EpisodePipeline> runAssetStage(Long userId, ComicDramaDtos.EpisodePipeline pipeline) {
        if (!pipeline.config().getBooleanValue("includeAssets")) {
            return Mono.just(pipeline);
        }
        return comicDramaService.getWorkspace(pipeline.projectId()).flatMap(workspace -> {
            List<ComicDramaDtos.Shot> shots = filterEpisodeShots(workspace, pipeline.episodeId());
            Set<String> readyVersionIds = new LinkedHashSet<>();
            for (ComicDramaDtos.MediaResult media : workspace.media()) {
                if ("assetVersion".equals(media.targetType()) && "image".equals(media.mediaType())
                        && ("completed".equals(media.status()) || "needsUpdate".equals(media.status()))) {
                    readyVersionIds.add(media.targetId());
                }
            }
            Set<String> missingVersionIds = new LinkedHashSet<>();
            for (ComicDramaDtos.Shot shot : shots) {
                for (String versionId : shot.assetVersionIds()) {
                    if (!readyVersionIds.contains(versionId)) {
                        missingVersionIds.add(versionId);
                    }
                }
            }
            if (missingVersionIds.isEmpty()) {
                JSONObject progress = updateProgress(pipeline, "assets", "skipped", 35, "本集关联资产图已就绪，已跳过");
                return persistStep(userId, pipeline, "assets", "running", progress);
            }
            String imageModel = pipeline.config().getString("imageModel");
            if (!StringUtils.hasText(imageModel)) {
                return Mono.error(new BusinessException(ErrorCode.PARAM_MISSING, "补齐资产图缺少生图模型配置"));
            }
            JSONObject progress = updateProgress(pipeline, "assets", "running", 32,
                    "正在补齐 " + missingVersionIds.size() + " 张缺失资产设定图...");
            JSONObject settings = new JSONObject();
            settings.put("mediaType", "image");
            settings.put("size", "1:1");
            return persistStep(userId, pipeline, "assets", "running", progress)
                    .flatMap(running -> comicDramaService.createGenerationTask(new ComicDramaDtos.CreateGenerationTaskRequest(
                                    pipeline.projectId(), workspace.revision(), "assetVersion",
                                    new ArrayList<>(missingVersionIds), imageModel, settings, true))
                            .flatMap(result -> awaitMediaResults(userId, pipeline, result.mediaResults())
                                    .then(Mono.defer(() -> {
                                        JSONObject done = updateProgress(running, "assets", "completed", 45, "资产设定图补齐完成");
                                        return persistStep(userId, running, "assets", "running", done);
                                    }))));
        });
    }

    /** 关键节点确认停顿：review 模式在进入批量提示词和视频前暂停，给创作者检查镜头与角色图的机会。 */
    private Mono<ComicDramaDtos.EpisodePipeline> maybePauseForReview(Long userId, ComicDramaDtos.EpisodePipeline pipeline) {
        if (!"review".equals(pipeline.executionMode())) {
            return Mono.just(pipeline);
        }
        boolean ranFrontSteps = "completed".equals(stepState(pipeline, "split")) || "completed".equals(stepState(pipeline, "assets"));
        boolean hasLaterSteps = pipeline.config().getBooleanValue("includePrompts") || pipeline.config().getBooleanValue("includeVideos");
        if (!ranFrontSteps || !hasLaterSteps) {
            return Mono.just(pipeline);
        }
        JSONObject progress = new JSONObject(pipeline.progress());
        progress.put("percent", 48);
        progress.put("message", "分镜与资产图已就绪，请检查后点击「继续生成视频」");
        return persistStep(userId, pipeline, "paused", "paused", progress);
    }

    /** 阶段3：为本集缺少已采用最终提示词的镜头批量合成提示词。 */
    private Mono<ComicDramaDtos.EpisodePipeline> runPromptStage(Long userId, ComicDramaDtos.EpisodePipeline pipeline) {
        if (!pipeline.config().getBooleanValue("includePrompts")) {
            return Mono.just(pipeline);
        }
        return comicDramaService.getWorkspace(pipeline.projectId()).flatMap(workspace -> {
            List<ComicDramaDtos.Shot> shots = filterEpisodeShots(workspace, pipeline.episodeId());
            Set<String> adoptedShotIds = new LinkedHashSet<>();
            for (ComicDramaDtos.PromptVersion version : workspace.promptVersions()) {
                if ("adopted".equals(version.status())) {
                    adoptedShotIds.add(version.shotId());
                }
            }
            List<String> missingPromptShots = shots.stream().map(ComicDramaDtos.Shot::id)
                    .filter(id -> !adoptedShotIds.contains(id)).toList();
            if (missingPromptShots.isEmpty()) {
                JSONObject progress = updateProgress(pipeline, "prompts", "skipped", 58, "本集镜头均已有最终提示词，已跳过");
                return persistStep(userId, pipeline, "prompts", "running", progress);
            }
            String textModel = pipeline.config().getString("textModel");
            if (!StringUtils.hasText(textModel)) {
                return Mono.error(new BusinessException(ErrorCode.PARAM_MISSING, "批量合成提示词缺少文本模型配置"));
            }
            JSONObject progress = updateProgress(pipeline, "prompts", "running", 54,
                    "正在批量合成 " + missingPromptShots.size() + " 个镜头的最终视频提示词...");
            return persistStep(userId, pipeline, "prompts", "running", progress)
                    .flatMap(running -> resolvePricingRevision(pipeline, textModel)
                            .flatMap(pricingRev -> comicDramaService.composePrompts(new ComicDramaDtos.ComposePromptsRequest(
                                    pipeline.projectId(), workspace.revision(), missingPromptShots, textModel, pricingRev, true)))
                            .flatMap(result -> {
                                JSONObject done = updateProgress(running, "prompts", "completed", 64,
                                        "提示词合成完成（成功 " + result.succeededShotIds().size() + " 个）");
                                return persistStep(userId, running, "prompts", "running", done);
                            }));
        });
    }

    /** 阶段4：为本集尚未完成视频的镜头批量创建视频任务并等待渲染完成。 */
    private Mono<ComicDramaDtos.EpisodePipeline> runVideoStage(Long userId, ComicDramaDtos.EpisodePipeline pipeline) {
        if (!pipeline.config().getBooleanValue("includeVideos")) {
            return Mono.just(pipeline);
        }
        return comicDramaService.getWorkspace(pipeline.projectId()).flatMap(workspace -> {
            List<ComicDramaDtos.Shot> shots = filterEpisodeShots(workspace, pipeline.episodeId());
            Set<String> completedVideoShots = new LinkedHashSet<>();
            for (ComicDramaDtos.MediaResult media : workspace.media()) {
                if ("shot".equals(media.targetType()) && "video".equals(media.mediaType())
                        && ("completed".equals(media.status()) || "needsUpdate".equals(media.status()))) {
                    completedVideoShots.add(media.targetId());
                }
            }
            List<String> targetShotIds = shots.stream().map(ComicDramaDtos.Shot::id)
                    .filter(id -> !completedVideoShots.contains(id)).toList();
            if (targetShotIds.isEmpty()) {
                JSONObject progress = updateProgress(pipeline, "videos", "skipped", 86, "本集镜头视频已全部完成，已跳过");
                return persistStep(userId, pipeline, "videos", "running", progress);
            }
            String videoModel = pipeline.config().getString("videoModel");
            if (!StringUtils.hasText(videoModel)) {
                return Mono.error(new BusinessException(ErrorCode.PARAM_MISSING, "生成镜头视频缺少视频模型配置"));
            }
            JSONObject progress = updateProgress(pipeline, "videos", "running", 70,
                    "正在批量生成 " + targetShotIds.size() + " 个镜头视频...");
            JSONObject settings = new JSONObject();
            settings.put("mediaType", "video");
            settings.put("size", StringUtils.hasText(pipeline.config().getString("videoSize"))
                    ? pipeline.config().getString("videoSize") : workspace.settings().aspectRatio());
            settings.put("resolution", StringUtils.hasText(pipeline.config().getString("videoResolution"))
                    ? pipeline.config().getString("videoResolution") : "720p");
            settings.put("usePlannedShotDuration", true);
            return persistStep(userId, pipeline, "videos", "running", progress)
                    .flatMap(running -> comicDramaService.createGenerationTask(new ComicDramaDtos.CreateGenerationTaskRequest(
                                    pipeline.projectId(), workspace.revision(), "shot", targetShotIds, videoModel, settings, true))
                            .flatMap(result -> awaitMediaResults(userId, running, result.mediaResults())
                                    .then(Mono.defer(() -> {
                                        JSONObject done = updateProgress(running, "videos", "completed", 88, "镜头视频批量生成完成");
                                        return persistStep(userId, running, "videos", "running", done);
                                    }))));
        });
    }

    /** 阶段5：触发本集 MP4 成片导出任务并轮询直到完成。 */
    private Mono<ComicDramaDtos.EpisodePipeline> runExportStage(Long userId, ComicDramaDtos.EpisodePipeline pipeline) {
        if (!pipeline.config().getBooleanValue("includeExport")) {
            return Mono.just(pipeline);
        }
        JSONObject progress = updateProgress(pipeline, "export", "running", 92, "正在合成并导出本集 MP4 成片...");
        return persistStep(userId, pipeline, "export", "running", progress)
                .flatMap(running -> videoCompositionTaskService.exportStoryboardVideo(
                                new VideoCompositionDtos.ExportStoryboardVideoRequest(pipeline.projectId(), pipeline.episodeId()))
                        .flatMap(task -> {
                            JSONObject withTask = new JSONObject(running.progress());
                            withTask.put("exportTaskId", task.id());
                            return persistStep(userId, running, "export", "running", withTask)
                                    .flatMap(saved -> awaitExportTask(userId, saved, task.id()));
                        }));
    }

    /** 轮询等待一组媒体结果全部到达终态，同时检测流水线是否被用户取消。 */
    private Mono<Void> awaitMediaResults(Long userId, ComicDramaDtos.EpisodePipeline pipeline, List<ComicDramaDtos.MediaResult> created) {
        if (created == null || created.isEmpty()) {
            return Mono.empty();
        }
        Set<String> mediaIds = new LinkedHashSet<>();
        created.forEach(item -> mediaIds.add(item.id()));
        return Flux.interval(POLL_INTERVAL).take(MAX_POLL_ROUNDS)
                .concatMap(tick -> checkNotCanceled(userId, pipeline)
                        .then(comicDramaService.listMedia(new ComicDramaDtos.ListMediaRequest(pipeline.projectId(), null, null)))
                        .map(allMedia -> allMedia.stream()
                                .filter(item -> mediaIds.contains(item.id()))
                                .allMatch(item -> !List.of("quoted", "queued", "processing").contains(item.status()))))
                .filter(Boolean::booleanValue)
                .next()
                .then();
    }

    /** 轮询等待分镜导出任务完成。 */
    private Mono<ComicDramaDtos.EpisodePipeline> awaitExportTask(Long userId, ComicDramaDtos.EpisodePipeline pipeline, String taskId) {
        return Flux.interval(POLL_INTERVAL).take(MAX_POLL_ROUNDS)
                .concatMap(tick -> checkNotCanceled(userId, pipeline)
                        .then(videoCompositionTaskService.getLatestStoryboardExport(pipeline.projectId())))
                .filter(task -> taskId.equals(task.id()) && !List.of("pending", "running").contains(task.status()))
                .next()
                .flatMap(task -> {
                    if ("succeeded".equals(task.status())) {
                        JSONObject done = updateProgress(pipeline, "export", "completed", 98, "本集 MP4 成片导出完成");
                        done.put("exportTaskId", task.id());
                        return persistStep(userId, pipeline, "export", "running", done);
                    }
                    return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR,
                            StringUtils.hasText(task.errorMessage()) ? task.errorMessage() : "成片导出失败"));
                });
    }

    private Mono<Void> checkNotCanceled(Long userId, ComicDramaDtos.EpisodePipeline pipeline) {
        return repository.getEpisodePipeline(userId, pipeline.projectId(), pipeline.id())
                .flatMap(latest -> "canceled".equals(latest.status())
                        ? Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "流水线已取消"))
                        : Mono.empty());
    }

    private Mono<Long> resolvePricingRevision(ComicDramaDtos.EpisodePipeline pipeline, String textModel) {
        Long configured = pipeline.config().getLong("expectedPricingRevision");
        if (configured != null && configured > 0) {
            return Mono.just(configured);
        }
        return finalPromptPricingService.getUnitPrice(textModel)
                .map(unitPrice -> unitPrice.revision() > 0 ? unitPrice.revision() : 1L);
    }

    private List<ComicDramaDtos.Shot> filterEpisodeShots(ComicDramaDtos.Workspace workspace, String episodeId) {
        if (!StringUtils.hasText(episodeId) || "all".equals(episodeId)) {
            return workspace.shots();
        }
        return workspace.shots().stream().filter(shot -> episodeId.equals(shot.sourceEpisodeId())).toList();
    }

    private JSONObject buildConfig(ComicDramaDtos.StartEpisodePipelineRequest request) {
        JSONObject config = new JSONObject();
        config.put("includeSplit", request.includeSplit());
        config.put("includeAssets", request.includeAssets());
        config.put("includePrompts", request.includePrompts());
        config.put("includeVideos", request.includeVideos());
        config.put("includeExport", request.includeExport());
        config.put("textModel", request.textModel() == null ? "" : request.textModel().trim());
        config.put("imageModel", request.imageModel() == null ? "" : request.imageModel().trim());
        config.put("videoModel", request.videoModel() == null ? "" : request.videoModel().trim());
        config.put("shotDuration", StringUtils.hasText(request.shotDuration()) ? request.shotDuration() : "medium");
        config.put("rhythm", StringUtils.hasText(request.rhythm()) ? request.rhythm() : "紧凑利落");
        config.put("videoSize", request.videoSize() == null ? "" : request.videoSize().trim());
        config.put("videoResolution", request.videoResolution() == null ? "" : request.videoResolution().trim());
        if (request.expectedPricingRevision() != null) {
            config.put("expectedPricingRevision", request.expectedPricingRevision());
        }
        return config;
    }

    private JSONObject initialProgress(String message, int percent) {
        JSONObject progress = new JSONObject();
        progress.put("message", message);
        progress.put("percent", percent);
        progress.put("steps", new JSONObject());
        return progress;
    }

    private JSONObject updateProgress(ComicDramaDtos.EpisodePipeline pipeline, String step, String state, int percent, String message) {
        JSONObject progress = pipeline.progress() == null ? initialProgress(message, percent) : new JSONObject(pipeline.progress());
        JSONObject steps = progress.getJSONObject("steps");
        if (steps == null) {
            steps = new JSONObject();
            progress.put("steps", steps);
        }
        steps.put(step, state);
        progress.put("percent", percent);
        progress.put("message", message);
        return progress;
    }

    private String stepState(ComicDramaDtos.EpisodePipeline pipeline, String step) {
        JSONObject steps = pipeline.progress() == null ? null : pipeline.progress().getJSONObject("steps");
        return steps == null ? "" : String.valueOf(steps.getOrDefault(step, ""));
    }

    private Mono<ComicDramaDtos.EpisodePipeline> persistStep(Long userId, ComicDramaDtos.EpisodePipeline pipeline,
                                                             String step, String status, JSONObject progress) {
        ComicDramaDtos.EpisodePipeline next = withState(pipeline, step, status, progress, "");
        return repository.saveEpisodePipeline(userId, next).thenReturn(next);
    }

    private ComicDramaDtos.EpisodePipeline withState(ComicDramaDtos.EpisodePipeline base, String step, String status,
                                                     JSONObject progress, String errorMessage) {
        return new ComicDramaDtos.EpisodePipeline(base.id(), base.projectId(), base.episodeId(), base.executionMode(),
                step, status, base.config(), progress, errorMessage, base.createdAt(), OffsetDateTime.now());
    }
}
