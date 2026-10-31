package com.novanovastudio.service;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.ai.AiTaskSources;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.CreditAmounts;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.common.StoryboardFontCatalog;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.dto.AiTaskDtos;
import com.novanovastudio.dto.ComicDramaDtos;
import com.novanovastudio.dto.ScriptDtos;
import com.novanovastudio.dto.StoryboardDtos;
import com.novanovastudio.repository.ComicDramaRepository;
import com.novanovastudio.security.CurrentUserProvider;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.reactive.TransactionalOperator;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

/**
 * 漫剧生产工作台业务服务。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-09-21 11:00
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ComicDramaService {

    /** 当前登录用户提供器。 */
    private final CurrentUserProvider currentUserProvider;

    /** 漫剧生产仓储。 */
    private final ComicDramaRepository repository;

    /** 剧本业务服务，用于读取共享剧本与准备度。 */
    private final ScriptService scriptService;

    /** 既有分镜Agent服务。 */
    private final StoryboardAgentService storyboardAgentService;

    /** 漫剧最终提示词独立定价。 */
    private final ComicDramaFinalPromptPricingService finalPromptPricingService;

    /** 既有AI任务服务。 */
    private final AiTaskService aiTaskService;

    /** 无限画布持久化服务，用于验证画布归属。 */
    private final PersistenceService persistenceService;

    /** 响应式事务操作器。 */
    private final TransactionalOperator transactionalOperator;

    /** 应用配置，用于读取提示词合成并发度。 */
    private final NovanovaProperties properties;

    /**
     * 分页查询当前用户漫剧项目。
     *
     * @param page 页码
     * @param pageSize 每页数量
     * @param keyword 搜索词
     * @return 当前用户项目分页结果
     */
    public Mono<ComicDramaDtos.ProjectListResponse> listProjects(int page, int pageSize, String keyword) {
        int normalizedPage = Math.max(page, 1);
        int normalizedPageSize = Math.min(Math.max(pageSize, 1), 100);
        return currentUserProvider.currentUserId().flatMap(userId -> Mono.zip(
                repository.listProjects(userId, text(keyword), (normalizedPage - 1) * normalizedPageSize, normalizedPageSize).collectList(),
                repository.countProjects(userId, text(keyword)),
                (projects, total) -> new ComicDramaDtos.ProjectListResponse(projects, total, normalizedPage, normalizedPageSize)));
    }

    /**
     * 查询漫剧项目完整工作区。
     *
     * @param projectId 项目ID
     * @return 工作区聚合数据
     */
    public Mono<ComicDramaDtos.Workspace> getWorkspace(String projectId) {
        return currentUserProvider.currentUserId().flatMap(userId -> requireProject(userId, projectId).flatMap(project -> {
            Mono<reactor.util.function.Tuple4<ComicDramaDtos.ProductionSettings, List<ComicDramaDtos.Asset>,
                    List<ComicDramaDtos.Shot>, List<ComicDramaDtos.ChangeImpact>>> core = Mono.zip(
                    repository.getSettings(projectId), repository.listAssets(projectId, "").collectList(),
                    repository.listShots(projectId, null, null).collectList(), repository.listImpacts(projectId).collectList());
            Mono<?>[] extraSources = {scriptService.getProject(projectId), getReadiness(projectId),
                    repository.listShotDrafts(projectId).collectList(), repository.listPromptVersions(projectId, null).collectList(),
                    syncMediaStatuses(userId, projectId, null, null),
                    repository.listVoiceTracks(projectId, null).collectList(), repository.listTimelineTexts(projectId).collectList(),
                    repository.listBatchTasks(projectId).collectList(),
                    repository.listCanvasBindings(projectId).collectList()};
            return Mono.zip(core, Mono.zip(values -> values, extraSources)).map(tuple -> {
                var values = tuple.getT2();
                ScriptDtos.ProjectDetail scriptProject = (ScriptDtos.ProjectDetail) values[0];
                ComicDramaDtos.Readiness readiness = (ComicDramaDtos.Readiness) values[1];
                @SuppressWarnings("unchecked") List<ComicDramaDtos.ShotDraft> drafts = (List<ComicDramaDtos.ShotDraft>) values[2];
                @SuppressWarnings("unchecked") List<ComicDramaDtos.PromptVersion> prompts = (List<ComicDramaDtos.PromptVersion>) values[3];
                @SuppressWarnings("unchecked") List<ComicDramaDtos.MediaResult> media = (List<ComicDramaDtos.MediaResult>) values[4];
                @SuppressWarnings("unchecked") List<ComicDramaDtos.VoiceTrack> voices = (List<ComicDramaDtos.VoiceTrack>) values[5];
                @SuppressWarnings("unchecked") List<ComicDramaDtos.TimelineText> timelineTexts = (List<ComicDramaDtos.TimelineText>) values[6];
                @SuppressWarnings("unchecked") List<ComicDramaDtos.BatchTask> batches = (List<ComicDramaDtos.BatchTask>) values[7];
                @SuppressWarnings("unchecked") List<ComicDramaDtos.CanvasBinding> bindings = (List<ComicDramaDtos.CanvasBinding>) values[8];
                var data = tuple.getT1();
                int readyAssets = (int) data.getT2().stream().filter(asset -> "active".equals(asset.usageStatus())).count();
                long completedShots = data.getT3().stream().filter(shot -> media.stream().anyMatch(item ->
                        "shot".equals(item.targetType()) && shot.id().equals(item.targetId())
                                && item.adopted() && "completed".equals(item.status()))).count();
                int pendingUpdates = (int) data.getT4().stream().filter(impact -> "pending".equals(impact.status())).count();
                int runningTasks = (int) media.stream().filter(item -> List.of("queued", "processing").contains(item.status())).count();
                ComicDramaDtos.ProductionProgress progress = new ComicDramaDtos.ProductionProgress(data.getT2().size(),
                        readyAssets, data.getT3().size(), (int) completedShots, pendingUpdates, runningTasks);
                int productionUnits = data.getT2().size() + data.getT3().size();
                int completionRate = productionUnits == 0 ? 0
                        : (readyAssets + (int) completedShots) * 100 / productionUnits;
                return new ComicDramaDtos.Workspace(projectId, projectId, scriptProject, data.getT1(), project.revision(),
                        completionRate, progress, readiness, data.getT2(), data.getT3(), drafts, prompts, media,
                        data.getT4(), voices, timelineTexts, project.textTrackCount(), batches, bindings);
            });
        }));
    }

    /**
     * 将当前用户已有剧本初始化为一对一漫剧生产项目。
     *
     * @param request 初始化请求
     * @return 初始化后的工作区
     */
    public Mono<ComicDramaDtos.Workspace> initializeProject(ComicDramaDtos.InitializeProjectRequest request) {
        String projectType = StringUtils.hasText(request.projectType()) ? request.projectType().trim() : "comicDrama";
        return currentUserProvider.currentUserId().flatMap(userId -> transactionalOperator.transactional(
                repository.initializeProject(userId, request.scriptProjectId(), projectType)
                        .then(requireProject(userId, request.scriptProjectId())))).then(getWorkspace(request.scriptProjectId()));
    }

    /**
     * 使用项目乐观锁更新生产设置。
     *
     * @param request 设置更新请求
     * @return 最新项目修订信息
     */
    public Mono<ComicDramaDtos.MutationResult> updateSettings(ComicDramaDtos.UpdateSettingsRequest request) {
        return mutate(request.projectId(), request.expectedRevision(),
                repository.updateSettings(request.projectId(), request.settings()));
    }

    /**
     * 查询项目视觉资产。
     *
     * @param request 资产列表请求
     * @return 视觉资产列表
     */
    public Mono<List<ComicDramaDtos.Asset>> listAssets(ComicDramaDtos.ListAssetsRequest request) {
        return withProject(request.projectId(), () -> repository.listAssets(request.projectId(), text(request.assetType())).collectList());
    }

    /**
     * 新增或更新视觉资产。
     *
     * @param request 保存请求
     * @return 保存后的资产
     */
    public Mono<ComicDramaDtos.Asset> saveAsset(ComicDramaDtos.SaveAssetRequest request) {
        return currentUserProvider.currentUserId().flatMap(userId -> transactionalOperator.transactional(
                requireProjectRevision(userId, request.projectId(), request.expectedRevision())
                        .then(repository.validateAssetSourceReference(request.projectId(), request.asset()))
                        .flatMap(valid -> valid ? Mono.empty() : Mono.error(new BusinessException(ErrorCode.PARAM_INVALID,
                                "视觉资产来源人物、地点或场次不属于当前共享剧本")))
                        .then(repository.saveAsset(request.projectId(), request.asset()).switchIfEmpty(conflict()))
                        .then(repository.markUpstreamChanges(request.projectId(), "asset", List.of(request.asset().id()), "视觉资产发生变化"))
                        .then(advance(userId, request.projectId(), request.expectedRevision()))
                        .then(repository.refreshProjectProductionStatus(request.projectId()))
                        .then(repository.getAsset(request.projectId(), request.asset().id()))));
    }

    /**
     * 查询视觉资产历史版本。
     *
     * @param request 版本列表请求
     * @return 资产版本列表
     */
    public Mono<List<ComicDramaDtos.AssetVersion>> listAssetVersions(ComicDramaDtos.ListAssetVersionsRequest request) {
        return withProject(request.projectId(), () -> repository.listAssetVersions(request.projectId(), request.assetId()).collectList());
    }

    /** 按版本标识批量查询当前项目内的资产版本。 */
    public Mono<List<ComicDramaDtos.AssetVersion>> listAssetVersionsByIds(ComicDramaDtos.ListAssetVersionsByIdsRequest request) {
        List<String> versionIds = request.versionIds().stream().distinct().toList();
        return withProject(request.projectId(), () -> repository.listAssetVersionsByIds(request.projectId(), versionIds).collectList());
    }

    /**
     * 新增或更新视觉资产版本。
     *
     * @param request 保存版本请求
     * @return 保存后的资产版本
     */
    public Mono<ComicDramaDtos.AssetVersion> saveAssetVersion(ComicDramaDtos.SaveAssetVersionRequest request) {
        return currentUserProvider.currentUserId().flatMap(userId -> transactionalOperator.transactional(
                requireProjectRevision(userId, request.projectId(), request.expectedRevision())
                        .then(repository.getAsset(request.projectId(), request.version().assetId()).switchIfEmpty(notFound("视觉资产不存在")))
                        .then(repository.saveAssetVersion(request.version()).switchIfEmpty(conflict()))
                        .then(repository.markUpstreamChanges(request.projectId(), "assetVersion", List.of(request.version().id()), "视觉资产版本发生变化"))
                        .then(advance(userId, request.projectId(), request.expectedRevision()))
                        .then(repository.getAssetVersion(request.projectId(), request.version().id()))));
    }

    /**
     * 查询共享剧本的生产准备度。
     *
     * @param projectId 项目ID
     * @return 不修改剧本的准备度检查结果
     */
    public Mono<ComicDramaDtos.Readiness> getReadiness(String projectId) {
        return withProject(projectId, () -> scriptService.getProductionReadiness(projectId).map(readiness ->
                new ComicDramaDtos.Readiness(readiness.projectId(), readiness.ready(), readiness.items().stream()
                        .map(item -> new ComicDramaDtos.ReadinessItem(item.key(), item.status(), item.title(),
                                item.description(), item.targetSection())).toList())));
    }

    /**
     * 复用分镜Agent生成待确认镜头草稿。
     *
     * @param request 自动拆镜头请求
     * @return 已持久化草稿
     */
    public Mono<ComicDramaDtos.ShotDraft> generateShotDraft(ComicDramaDtos.GenerateShotDraftRequest request) {
        if (!request.confirmed()) {
            return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "生成镜头草稿前必须明确确认费用"));
        }
        return currentUserProvider.currentUserId().flatMap(userId -> requireProject(userId, request.projectId()).flatMap(project ->
                repository.getShotGenerationSource(request.projectId(), request.episodeId(), request.sceneId())
                        .switchIfEmpty(notFound("未找到可拆分的剧本范围"))
                        .flatMap(source -> {
                            if (!StringUtils.hasText(source.scriptContent())) {
                                return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "所选范围没有可用剧本正文"));
                            }
                            // 预计镜头数量可以不填：不填时由模型按剧本内容自行判断，填了就必须按填的数量来。
                            // 创作重点同样可选，没填就不带这一段，避免指令里留下空的「创作重点：」。
                            String instruction = (request.shotCount() == null
                                    ? "请根据剧本正文的场次、动作与对白自行判断合适的镜头数量"
                                    : "请拆分为约" + request.shotCount() + "个镜头")
                                    + "。节奏：" + text(request.rhythm())
                                    + (StringUtils.hasText(request.focus()) ? "。创作重点：" + request.focus().trim() : "");
                            Mono<String> sourceEpisode = StringUtils.hasText(request.sceneId())
                                    ? repository.getSceneEpisodeId(request.projectId(), request.sceneId())
                                    : Mono.just(text(request.episodeId()));
                            return sourceEpisode.defaultIfEmpty("").flatMap(resolvedEpisodeId -> storyboardAgentService.generateStoryboard(
                                    new StoryboardDtos.GenerateStoryboardRequest(source.scriptContent(), instruction,
                                            source.visualStyle(), request.model()))
                                    .flatMap(response -> {
                                        JSONObject data = (JSONObject) JSON.toJSON(response);
                                        data.put("sourceScriptExcerpt", source.scriptContent());
                                        data.put("sourceEpisodeId", resolvedEpisodeId);
                                        data.put("sourceSceneId", text(request.sceneId()));
                                        ComicDramaDtos.ShotDraft draft = new ComicDramaDtos.ShotDraft(id(), request.projectId(),
                                                scopeType(request), scopeId(request), project.revision(), source.scriptRevision(),
                                                instruction, request.model(), data, response.chargedCredits(), "pending",
                                                OffsetDateTime.now(), null);
                                        return repository.createShotDraft(userId, draft).thenReturn(draft);
                                    }));
                        })));
    }

    /**
     * 确认镜头草稿并追加为正式镜头，不覆盖已有镜头。
     *
     * @param request 草稿确认请求
     * @return 最新项目修订信息
     */
    public Mono<ComicDramaDtos.MutationResult> confirmShotDraft(ComicDramaDtos.ConfirmShotDraftRequest request) {
        return currentUserProvider.currentUserId().flatMap(userId -> requireProjectRevision(userId, request.projectId(), request.expectedRevision())
                .then(repository.getPendingShotDraft(userId, request.projectId(), request.draftId()).switchIfEmpty(notFound("待确认镜头草稿不存在")))
                .flatMap(draft -> scriptService.getProject(request.projectId()).flatMap(scriptProject -> {
                    if (draft.baseProjectRevision() != request.expectedRevision()
                            || draft.baseScriptRevision() != scriptProject.revision()) {
                        return Mono.error(new BusinessException(ErrorCode.DATA_CONFLICT,
                                "镜头草稿生成后剧本或生产设置已变化，请重新生成镜头草稿"));
                    }
                    return repository.listShots(request.projectId(), null, null).collectList().flatMap(existing -> {
                        StoryboardDtos.GenerateStoryboardResponse response = draft.draftData()
                                .toJavaObject(StoryboardDtos.GenerateStoryboardResponse.class);
                        String sourceEpisodeId = text(draft.draftData().getString("sourceEpisodeId"));
                        String sourceSceneId = text(draft.draftData().getString("sourceSceneId"));
                        return buildDraftAssetPlans(request.projectId(), request.draftId(), scriptProject, response)
                                .flatMap(assetPlans -> repository.validateShotSourceReferences(request.projectId(),
                                                sourceEpisodeId.isEmpty() ? null : sourceEpisodeId,
                                                sourceSceneId.isEmpty() ? null : sourceSceneId)
                                        .flatMap(valid -> valid ? Mono.just(existing.size())
                                                : Mono.error(new BusinessException(ErrorCode.PARAM_INVALID,
                                                        "镜头草稿的来源分集或场次不属于当前项目")))
                                        .flatMap(start -> transactionalOperator.transactional(
                                                persistDraftAssets(request.projectId(), assetPlans.values())
                                                .thenMany(Flux.fromIterable(response.shots()).index())
                                                .concatMap(item -> {
                                                    StoryboardDtos.StoryboardShot source = item.getT2();
                                                    List<String> assetVersionIds = source.assetIds().stream()
                                                            .map(assetId -> assetPlans.get(assetId).version().id()).toList();
                                                    ComicDramaDtos.Shot shot = new ComicDramaDtos.Shot(id(),
                                                            sourceEpisodeId.isEmpty() ? null : sourceEpisodeId,
                                                            sourceSceneId.isEmpty() ? null : sourceSceneId,
                                                            text(draft.draftData().getString("sourceScriptExcerpt")),
                                                            start + item.getT1().intValue() + 1, start + item.getT1().intValue(),
                                                            BigDecimal.valueOf(source.durationSeconds()), source.shotSize(), "",
                                                            source.visualDescription(), "", source.cameraMovement(), source.lightingAtmosphere(),
                                                            source.dialogueVoiceover(), source.soundEffect(), "", "draft",
                                                            assetVersionIds, 0, null, null);
                                                    return repository.saveShot(request.projectId(), shot).switchIfEmpty(conflict())
                                                            .then(repository.replaceShotAssetVersions(
                                                                    request.projectId(), shot.id(), assetVersionIds))
                                                            .flatMap(inserted -> inserted == assetVersionIds.size()
                                                                    ? Mono.empty() : conflict());
                                                }).then(repository.confirmShotDraft(request.projectId(), request.draftId())
                                                        .flatMap(count -> count == 1 ? Mono.empty() : conflict()))
                                                .then(advance(userId, request.projectId(), request.expectedRevision()))
                                                .then(repository.refreshProjectProductionStatus(request.projectId()))
                                                .then(requireProject(userId, request.projectId())).map(this::mutationResult))));
                    });
                })));
    }

    /** 保存用户编辑后的待确认镜头草稿。 */
    public Mono<ComicDramaDtos.ShotDraft> updateShotDraft(ComicDramaDtos.UpdateShotDraftRequest request) {
        StoryboardDtos.GenerateStoryboardResponse draft = request.draftData()
                .toJavaObject(StoryboardDtos.GenerateStoryboardResponse.class);
        if (draft == null || draft.shots() == null || draft.shots().isEmpty()) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "镜头草稿至少需要保留一个镜头"));
        }
        validateDraftAssetReferences(draft);
        return currentUserProvider.currentUserId().flatMap(userId -> transactionalOperator.transactional(
                requireProjectRevision(userId, request.projectId(), request.expectedRevision())
                        .then(repository.updateShotDraft(request.projectId(), request.draftId(),
                                request.expectedRevision(), request.draftData()))
                        .flatMap(rows -> rows == 1 ? Mono.empty() : conflict())
                        .then(advance(userId, request.projectId(), request.expectedRevision()))
                        .then(repository.getPendingShotDraft(userId, request.projectId(), request.draftId()))));
    }

    /** 放弃待确认镜头草稿并保留历史记录。 */
    public Mono<ComicDramaDtos.MutationResult> discardShotDraft(ComicDramaDtos.DiscardShotDraftRequest request) {
        return currentUserProvider.currentUserId().flatMap(userId -> transactionalOperator.transactional(
                requireProjectRevision(userId, request.projectId(), request.expectedRevision())
                        .then(repository.discardShotDraft(request.projectId(), request.draftId(), request.expectedRevision()))
                        .flatMap(rows -> rows == 1 ? Mono.empty() : conflict())
                        .then(advance(userId, request.projectId(), request.expectedRevision()))
                        .then(requireProject(userId, request.projectId())).map(this::mutationResult)));
    }

    /** 查询正式镜头清单。 */
    public Mono<List<ComicDramaDtos.Shot>> listShots(ComicDramaDtos.ListShotsRequest request) {
        return withProject(request.projectId(), () -> repository.listShots(request.projectId(), request.episodeId(), request.sceneId()).collectList());
    }

    /** 保存一个正式镜头及其资产版本引用。 */
    public Mono<ComicDramaDtos.Shot> saveShot(ComicDramaDtos.SaveShotRequest request) {
        if (request.shot().assetVersionIds().stream().distinct().count() != request.shot().assetVersionIds().size()) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "镜头资产版本引用不能重复"));
        }
        return currentUserProvider.currentUserId().flatMap(userId -> transactionalOperator.transactional(
                requireProjectRevision(userId, request.projectId(), request.expectedRevision())
                        .then(repository.validateShotSourceReferences(request.projectId(), request.shot()))
                        .flatMap(valid -> valid ? Mono.empty() : Mono.error(new BusinessException(ErrorCode.PARAM_INVALID,
                                "镜头来源分集或场次不属于当前项目")))
                        .then(repository.saveShot(request.projectId(), request.shot()).switchIfEmpty(conflict()))
                        .then(repository.replaceShotAssetVersions(request.projectId(), request.shot().id(), request.shot().assetVersionIds()))
                        .flatMap(inserted -> inserted == request.shot().assetVersionIds().size()
                                ? Mono.empty()
                                : Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "资产版本不存在或不属于当前项目")))
                        .then(advance(userId, request.projectId(), request.expectedRevision()))
                        .then(repository.refreshProjectProductionStatus(request.projectId()))
                        .then(repository.getShot(request.projectId(), request.shot().id()))));
    }

    /** 调整全部镜头排序。 */
    public Mono<ComicDramaDtos.MutationResult> reorderShots(ComicDramaDtos.ReorderShotsRequest request) {
        return withProject(request.projectId(), () -> repository.listShots(request.projectId(), null, null).collectList())
                .flatMap(shots -> {
                    List<String> existingIds = shots.stream().map(ComicDramaDtos.Shot::id).toList();
                    if (request.shotIds().size() != existingIds.size() || !existingIds.containsAll(request.shotIds())
                            || request.shotIds().stream().distinct().count() != request.shotIds().size()) {
                        return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "镜头排序必须包含项目全部且不重复的镜头标识"));
                    }
                    return mutate(request.projectId(), request.expectedRevision(), repository.reorderShots(request.projectId(), request.shotIds()));
                });
    }

    /** 删除用户已二次确认的镜头。 */
    public Mono<ComicDramaDtos.MutationResult> deleteShot(ComicDramaDtos.DeleteShotRequest request) {
        if (!request.confirm()) {
            return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "删除镜头前必须先查询影响范围并明确确认"));
        }
        return mutate(request.projectId(), request.expectedRevision(), repository.deleteShot(request.projectId(), request.shotId())
                .flatMap(rows -> rows > 0 ? Mono.empty() : notFound("镜头不存在")));
    }

    /** 查询镜头删除影响范围，供二次确认弹窗展示。 */
    public Mono<ComicDramaDtos.ShotDeleteImpact> getShotDeleteImpact(String projectId, String shotId) {
        return withProject(projectId, () -> repository.getShotDeleteImpact(projectId, shotId)
                .switchIfEmpty(notFound("镜头不存在")));
    }

    /**
     * 复用分镜提示词Agent生成新的待确认提示词版本。
     *
     * @param request 提示词合成请求
     * @return 新提示词草稿版本
     */
    public Mono<ComicDramaDtos.PromptVersion> composePrompt(ComicDramaDtos.ComposePromptRequest request) {
        if (!request.confirmed()) {
            return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "合成提示词前必须明确确认费用"));
        }
        return currentUserProvider.currentUserId().flatMap(userId -> requireProject(userId, request.projectId())
                .then(repository.getShot(request.projectId(), request.shotId()).switchIfEmpty(notFound("镜头不存在")))
                .flatMap(shot -> repository.getSettings(request.projectId())
                        .flatMap(settings -> finalPromptPricingService.prepare(request.model(), request.expectedPricingRevision())
                                .flatMap(pricing -> composeShotPrompt(request.projectId(), shot, settings, pricing))))
                .flatMap(item -> transactionalOperator.transactional(Mono.defer(() -> repository.nextPromptVersion(request.projectId(), item.shotId()).flatMap(versionNumber -> {
                    ComicDramaDtos.PromptVersion prompt = new ComicDramaDtos.PromptVersion(id(), item.shotId(), versionNumber,
                            "ai", item.prompt(), item.snapshot(), request.model(), item.credits(), "draft", OffsetDateTime.now());
                    return repository.createPromptVersion(request.projectId(), prompt).thenReturn(prompt);
                }))).onErrorResume(error -> refundComposedPrompts(List.of(item), error))));
    }

    /**
     * 批量合成镜头最终提示词：并发请求模型，成功结果统一在一个事务里采用为最新版本。
     *
     * <p>并发只覆盖模型调用与输入加载，版本号生成和写库保持串行，避免同一项目的修订号互相覆盖。</p>
     *
     * @param request 批量合成请求
     * @return 已采用的提示词版本、失败镜头与实际扣费
     */
    public Mono<ComicDramaDtos.ComposePromptsResult> composePrompts(ComicDramaDtos.ComposePromptsRequest request) {
        if (!request.confirmed()) {
            return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "合成提示词前必须明确确认费用"));
        }
        List<String> shotIds = request.shotIds().stream().distinct().toList();
        if (shotIds.isEmpty()) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_MISSING, "请至少选择一个镜头"));
        }
        int concurrency = Math.max(1, properties.getAi().getStoryboardAgent().getComposeConcurrency());
        return currentUserProvider.currentUserId()
                .flatMap(userId -> requireProjectRevision(userId, request.projectId(), request.expectedRevision())
                        .then(Mono.zip(repository.getSettings(request.projectId()),
                                repository.listShots(request.projectId(), null, null).collectList()))
                        .flatMap(tuple -> {
                            Map<String, ComicDramaDtos.Shot> shotById = new LinkedHashMap<>();
                            tuple.getT2().forEach(shot -> shotById.put(shot.id(), shot));
                            List<ComicDramaDtos.Shot> targets = shotIds.stream().map(shotById::get).toList();
                            if (targets.stream().anyMatch(Objects::isNull)) {
                                return notFound("部分镜头不存在或已删除");
                            }
                            log.info("开始批量合成漫剧镜头提示词: projectId={}, shotCount={}, concurrency={}",
                                    request.projectId(), targets.size(), concurrency);
                            return finalPromptPricingService.prepare(request.model(), request.expectedPricingRevision()).flatMap(pricing -> Flux.fromIterable(targets)
                                    .flatMap(shot -> composeShotPrompt(request.projectId(), shot, tuple.getT1(), pricing)
                                            .subscribeOn(Schedulers.boundedElastic())
                                            .onErrorResume(error -> {
                                                log.warn("漫剧镜头提示词合成失败: projectId={}, shotId={}, reason={}",
                                                        request.projectId(), shot.id(), error.getMessage());
                                                return Mono.just(ComposedShotPrompt.failed(shot.id(), error.getMessage()));
                                            }), concurrency)
                                    .collectList()
                                    .flatMap(results -> persistComposedPrompts(userId, request.projectId(),
                                            request.expectedRevision(), request.model(), results)));
                        }));
    }

    /**
     * 为单个镜头合成最终提示词，复用既有分镜提示词Agent完成校验与计费。
     *
     * @param projectId 项目标识
     * @param shot 镜头
     * @param settings 项目生产设置
     * @param pricing 本次请求共用的模型与价格快照
     * @return 单镜头合成产物
     */
    private Mono<ComposedShotPrompt> composeShotPrompt(String projectId, ComicDramaDtos.Shot shot,
                                                       ComicDramaDtos.ProductionSettings settings, ComicDramaFinalPromptPricingService.PreparedPricing pricing) {
        Mono<String> scriptText = StringUtils.hasText(shot.sourceScriptExcerpt())
                ? Mono.just(shot.sourceScriptExcerpt())
                : repository.getShotGenerationSource(projectId, shot.sourceEpisodeId(), shot.sourceSceneId())
                        .map(ComicDramaRepository.ShotGenerationSource::scriptContent).defaultIfEmpty("");
        return scriptText.flatMap(script -> {
            if (!StringUtils.hasText(script)) {
                return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "镜头缺少来源剧本正文"));
            }
            return Mono.zip(repository.listShotStoryboardAssets(projectId, shot.id()).collectList(),
                    repository.listShotReferencesForVideo(projectId, shot.id())).flatMap(inputs -> {
                List<StoryboardDtos.StoryboardAsset> assets = inputs.getT1();
                StoryboardDtos.StoryboardShot agentShot = new StoryboardDtos.StoryboardShot(shot.id(), shot.shotNumber(),
                        Math.max(1, shot.durationSeconds().intValue()), shot.visualDescription(),
                        StringUtils.hasText(shot.shotSize()) ? shot.shotSize() : "中景", shot.lightingAtmosphere(),
                        shot.dialogueVoiceover(), shot.soundDescription(), shot.cameraMovement(), "",
                        assets.stream().map(StoryboardDtos.StoryboardAsset::id).toList());
                StoryboardDtos.ComposePromptsRequest agentRequest = new StoryboardDtos.ComposePromptsRequest(
                        script, shot.visualDescription(), settings.visualStyle(), pricing.model().modelValue(), List.of(agentShot), assets);
                String operationId = id();
                return storyboardAgentService.composePrompts(agentRequest, pricing.model(), pricing.credits(), operationId)
                        .flatMap(response -> Mono.fromCallable(() -> {
                            JSONObject source = new JSONObject();
                            source.put("shot", shot);
                            source.put("settings", settings);
                            JSONObject snapshot = ComicDramaPromptReferences.snapshot(
                                    response.prompts().getFirst().finalPrompt(), inputs.getT2(), source);
                            return new ComposedShotPrompt(shot.id(), shot, settings,
                                    ComicDramaPromptReferences.fullPrompt(snapshot), snapshot,
                                    pricing.credits(), operationId, pricing.model().ownerTeamId(), "");
                        }).onErrorResume(error -> refundComposedPrompts(List.of(new ComposedShotPrompt(
                                shot.id(), shot, settings, null, null, pricing.credits(), operationId,
                                pricing.model().ownerTeamId(), "")), error)));
            });
        });
    }

    /**
     * 把并发合成成功的镜头统一写成已采用版本，并只推进一次项目修订号。
     *
     * @param userId 当前用户ID
     * @param projectId 项目标识
     * @param expectedRevision 期望的项目修订号
     * @param model 提示词模型
     * @param results 并发合成结果，失败项提示词为空
     * @return 批量合成结果
     */
    private Mono<ComicDramaDtos.ComposePromptsResult> persistComposedPrompts(Long userId, String projectId,
                                                                            long expectedRevision, String model,
                                                                            List<ComposedShotPrompt> results) {
        List<ComposedShotPrompt> composed = results.stream().filter(item -> item.prompt() != null).toList();
        List<String> failedShotIds = results.stream().filter(item -> item.prompt() == null)
                .map(ComposedShotPrompt::shotId).toList();
        String failureMessage = results.stream().map(ComposedShotPrompt::failureReason)
                .filter(StringUtils::hasText).findFirst().orElse("");
        BigDecimal credits = composed.stream().map(ComposedShotPrompt::credits)
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        if (composed.isEmpty()) {
            return Mono.just(new ComicDramaDtos.ComposePromptsResult(List.of(), failedShotIds, failureMessage, credits));
        }
        return transactionalOperator.transactional(Flux.fromIterable(composed)
                .concatMap(item -> repository.nextPromptVersion(projectId, item.shotId()).flatMap(versionNumber -> {
                    // 快照只保留合成输入的可读字段，剧本正文按来源场次回溯，避免每个版本重复存整段剧本。
                    JSONObject snapshot = new JSONObject(item.snapshot());
                    snapshot.put("shotId", item.shotId());
                    snapshot.put("shotNumber", item.shot().shotNumber());
                    snapshot.put("shotSize", item.shot().shotSize());
                    snapshot.put("visualDescription", item.shot().visualDescription());
                    snapshot.put("cameraMovement", item.shot().cameraMovement());
                    snapshot.put("lightingAtmosphere", item.shot().lightingAtmosphere());
                    snapshot.put("dialogueVoiceover", item.shot().dialogueVoiceover());
                    snapshot.put("soundDescription", item.shot().soundDescription());
                    snapshot.put("sourceEpisodeId", item.shot().sourceEpisodeId());
                    snapshot.put("sourceSceneId", item.shot().sourceSceneId());
                    snapshot.put("settings", item.settings());
                    ComicDramaDtos.PromptVersion prompt = new ComicDramaDtos.PromptVersion(id(), item.shotId(), versionNumber,
                            "ai", item.prompt(), snapshot, model, item.credits(), "adopted", OffsetDateTime.now());
                    return repository.createPromptVersion(projectId, prompt).thenReturn(prompt);
                }))
                .collectList()
                .flatMap(prompts -> advance(userId, projectId, expectedRevision)
                        .then(repository.refreshProjectProductionStatus(projectId))
                        .thenReturn(prompts))
        ).map(prompts -> new ComicDramaDtos.ComposePromptsResult(
                prompts.stream().map(ComicDramaDtos.PromptVersion::shotId).toList(), failedShotIds, failureMessage, credits))
                // 事务已回滚后再退还原钱包，避免退款随业务事务一起回滚。
                .onErrorResume(error -> refundComposedPrompts(composed, error));
    }

    /**
     * 生成产物转换或写库失败时退还原操作扣费，并保留原始异常。
     * @param composed 已成功调用模型并扣费的镜头
     * @param error 原始业务异常
     * @param <T> 原流程返回类型
     * @return 完成全部退款后传播原始异常
     */
    private <T> Mono<T> refundComposedPrompts(List<ComposedShotPrompt> composed, Throwable error) {
        log.error("漫剧提示词产物处理失败，退还已扣积分: shotCount={}", composed.size(), error);
        return Flux.fromIterable(composed)
                .concatMapDelayError(item -> storyboardAgentService.refundPromptComposition(
                        item.operationId(), item.credits(), item.ownerTeamId()), true, 1)
                .then()
                .onErrorResume(refundError -> {
                    log.error("漫剧提示词产物处理失败后的退款异常", refundError);
                    error.addSuppressed(refundError);
                    return Mono.error(error);
                })
                .then(Mono.error(error));
    }

    /** 单镜头批量合成产物；失败时提示词为空并记录失败原因，版本号统一在写库阶段生成。 */
    private record ComposedShotPrompt(String shotId, ComicDramaDtos.Shot shot,
                                      ComicDramaDtos.ProductionSettings settings, String prompt,
                                      JSONObject snapshot, BigDecimal credits, String operationId,
                                      long ownerTeamId, String failureReason) {

        /** 构造失败产物。 */
        private static ComposedShotPrompt failed(String shotId, String reason) {
            return new ComposedShotPrompt(shotId, null, null, null, null, BigDecimal.ZERO, null, 0L, reason);
        }
    }

    /** 保存用户明确编辑的提示词为新采用版本。 */
    public Mono<ComicDramaDtos.PromptVersion> savePrompt(ComicDramaDtos.SavePromptRequest request) {
        return currentUserProvider.currentUserId().flatMap(userId -> requireProjectRevision(userId, request.projectId(), request.expectedRevision())
                .then(repository.getShot(request.projectId(), request.shotId()).switchIfEmpty(notFound("镜头不存在")))
                .then(repository.nextPromptVersion(request.projectId(), request.shotId())).flatMap(version -> {
                    if (request.expectedPromptVersion() != null && request.expectedPromptVersion() != version - 1) {
                        return conflict();
                    }
                    return savedPromptSnapshot(request).flatMap(snapshot -> {
                        ComicDramaDtos.PromptVersion prompt = new ComicDramaDtos.PromptVersion(id(), request.shotId(), version,
                                "manual", ComicDramaPromptReferences.fullPrompt(snapshot), snapshot, "", BigDecimal.ZERO, "adopted", OffsetDateTime.now());
                        return transactionalOperator.transactional(repository.createPromptVersion(request.projectId(), prompt)
                                .then(advance(userId, request.projectId(), request.expectedRevision())).thenReturn(prompt));
                    });
                }));
    }

    /**
     * 继承明确来源的图片快照，只有首次手动创建才读取当前图片。
     * @param request 正文及来源版本
     * @return 保留原始图片有效性的快照
     * @throws BusinessException 来源版本不属于当前镜头
     */
    private Mono<JSONObject> savedPromptSnapshot(ComicDramaDtos.SavePromptRequest request) {
        Mono<ComicDramaDtos.PromptVersion> source = StringUtils.hasText(request.sourcePromptVersionId())
                ? repository.listPromptVersions(request.projectId(), request.shotId())
                        .filter(version -> request.sourcePromptVersionId().equals(version.id())).next()
                        .switchIfEmpty(notFound("提示词来源版本不存在或不属于当前镜头"))
                : repository.listPromptVersions(request.projectId(), request.shotId()).next();
        return source.map(Optional::of).defaultIfEmpty(Optional.empty()).flatMap(version -> {
            if (version.isPresent()) {
                JSONObject snapshot = version.get().sourceSnapshot() == null
                        ? new JSONObject() : new JSONObject(version.get().sourceSnapshot());
                snapshot.put("promptBody", request.prompt().trim());
                return Mono.just(snapshot);
            }
            return repository.listShotReferencesForVideo(request.projectId(), request.shotId())
                    .map(references -> ComicDramaPromptReferences.snapshot(request.prompt(), references, new JSONObject()));
        });
    }

    /**
     * 估算所选生成范围的任务数和模型积分。
     *
     * @param request 生成报价请求
     * @return 明确的任务数量与预计积分
     */
    public Mono<ComicDramaDtos.GenerationEstimate> estimateGeneration(ComicDramaDtos.EstimateGenerationRequest request) {
        String mediaType = request.settings().getString("mediaType");
        if (!List.of("image", "video").contains(mediaType)) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "生成设置mediaType仅支持image或video"));
        }
        if (request.targetIds().stream().distinct().count() != request.targetIds().size()) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "生成目标不能重复"));
        }
        ComicDramaDtos.CreateGenerationTaskRequest generationRequest = new ComicDramaDtos.CreateGenerationTaskRequest(
                request.projectId(), 0, request.targetType(), request.targetIds(), request.model(), request.settings(), true);
        return withProject(request.projectId(), () -> Flux.fromIterable(request.targetIds())
                .concatMap(targetId -> prepareSingleGeneration(generationRequest, targetId, mediaType))
                .collectList()
                .flatMap(plans -> quoteGenerationPlans(generationRequest, plans, mediaType)
                        .map(credits -> new ComicDramaDtos.GenerationEstimate(request.targetType(), plans.size(),
                                credits, request.model(), request.settings()))));
    }

    /**
     * 为用户明确确认的目标创建实际图片或视频任务，并记录输入快照。
     *
     * @param request 媒体任务请求
     * @return 已排队任务记录
     */
    public Mono<ComicDramaDtos.GenerationTaskResult> createGenerationTask(ComicDramaDtos.CreateGenerationTaskRequest request) {
        String mediaType = request.settings().getString("mediaType");
        if (!List.of("image", "video").contains(mediaType)) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "生成设置mediaType仅支持image或video"));
        }
        if (!request.confirmed()) {
            return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "生成媒体前必须明确确认费用"));
        }
        if (request.targetIds().stream().distinct().count() != request.targetIds().size()) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "生成目标不能重复"));
        }
        return currentUserProvider.currentUserId().flatMap(userId -> requireProject(userId, request.projectId())
                .thenMany(Flux.fromIterable(request.targetIds())
                        .concatMap(targetId -> prepareSingleGeneration(request, targetId, mediaType))).collectList()
                .flatMap(plans -> quoteGenerationPlans(request, plans, mediaType).then(transactionalOperator.transactional(
                                requireProjectRevision(userId, request.projectId(), request.expectedRevision())
                                        .then(advance(userId, request.projectId(), request.expectedRevision()))
                                         .thenMany(Flux.fromIterable(plans)
                                                 .concatMap(plan -> repository.createMediaResult(request.projectId(), plan.media())))
                                         .then(repository.refreshProjectProductionStatus(request.projectId()))
                                         .then())
                        .thenMany(Flux.fromIterable(plans)
                                .concatMap(plan -> executeSingleGeneration(request, plan, mediaType)))
                        .collectList()
                        .map(results -> new ComicDramaDtos.GenerationTaskResult(results, results.size())))));
    }

    /** 查询项目媒体任务与结果。 */
    public Mono<List<ComicDramaDtos.MediaResult>> listMedia(ComicDramaDtos.ListMediaRequest request) {
        return currentUserProvider.currentUserId().flatMap(userId -> requireProject(userId, request.projectId())
                .then(syncMediaStatuses(userId, request.projectId(), request.shotId(), request.assetId())));
    }

    /**
     * 查询并回写当前用户底层AI任务的最新媒体状态。
     *
     * @param userId 当前用户ID
     * @param projectId 漫剧项目ID
     * @param shotId 可选镜头过滤条件
     * @param assetId 可选资产过滤条件
     * @return 已同步的媒体结果列表
     */
    private Mono<List<ComicDramaDtos.MediaResult>> syncMediaStatuses(Long userId, String projectId,
                                                                      String shotId, String assetId) {
        return repository.listMedia(projectId, shotId, assetId).collectList()
                .flatMapMany(Flux::fromIterable)
                .concatMap(media -> syncOneMediaStatus(userId, projectId, media))
                .thenMany(repository.listMedia(projectId, shotId, assetId))
                .collectList();
    }

    /** 同步单个媒体结果对应的底层AI任务。 */
    private Mono<ComicDramaDtos.MediaResult> syncOneMediaStatus(Long userId, String projectId,
                                                                  ComicDramaDtos.MediaResult media) {
        if (!StringUtils.hasText(media.taskId())) {
            return Mono.just(media);
        }
        return aiTaskService.getTaskForUser(userId, media.taskId()).flatMap(task -> {
            String status = List.of("queued", "processing").contains(media.status())
                    ? normalizeMediaStatus(task.status()) : media.status();
            String failureReason = StringUtils.hasText(task.errorMessage()) ? task.errorMessage() : "";
            return repository.updateMediaTaskState(projectId, media.taskId(), status,
                    task.resultData() == null ? new JSONObject() : task.resultData(), failureReason)
                    .then(repository.refreshBatchTaskProgress(projectId))
                    .then(repository.refreshProjectProductionStatus(projectId)).thenReturn(media);
        });
    }

    /** 采用一个生成媒体版本。 */
    public Mono<ComicDramaDtos.MutationResult> adoptMedia(ComicDramaDtos.AdoptMediaRequest request) {
        return mutate(request.projectId(), request.expectedRevision(), repository.adoptMedia(request.projectId(), request.mediaId())
                .flatMap(rows -> rows > 0 ? Mono.empty() : rows < 0
                        ? Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "仅允许采用已完成的媒体结果"))
                        : notFound("媒体结果不存在")));
    }

    /** 查询待处理的上游变化影响。 */
    public Mono<List<ComicDramaDtos.ChangeImpact>> listImpacts(String projectId) {
        return withProject(projectId, () -> repository.listImpacts(projectId).collectList());
    }

    /** 确认用户选择的更新范围，仅关闭影响项且不自动重生成。 */
    public Mono<ComicDramaDtos.MutationResult> confirmUpdate(ComicDramaDtos.ConfirmUpdateRequest request) {
        return currentUserProvider.currentUserId().flatMap(userId -> transactionalOperator.transactional(
                requireProjectRevision(userId, request.projectId(), request.expectedRevision())
                        .then(repository.resolveImpacts(request.projectId(), request.scope(), request.targetId(),
                                request.sourceType(), request.sourceId(), request.resolution()))
                        .then(advance(userId, request.projectId(), request.expectedRevision()))
                        .then(repository.refreshProjectProductionStatus(request.projectId()))
                        .then(requireProject(userId, request.projectId())).map(this::mutationResult)));
    }

    /** 查询P1声音轨。 */
    public Mono<List<ComicDramaDtos.VoiceTrack>> listVoiceTracks(ComicDramaDtos.ListVoiceTracksRequest request) {
        return withProject(request.projectId(), () -> repository.listVoiceTracks(request.projectId(), request.shotId()).collectList());
    }

    /**
     * 保存结构化声音条目及其音频编排。
     *
     * @param request 项目与声音条目保存请求
     * @return 保存后的声音条目
     * @throws BusinessException 音频排期、媒体归属或项目修订不合法时抛出
     */
    public Mono<ComicDramaDtos.VoiceTrack> saveVoiceTrack(ComicDramaDtos.SaveVoiceTrackRequest request) {
        validateVoiceTrackTiming(request.voiceTrack());
        return currentUserProvider.currentUserId().flatMap(userId -> transactionalOperator.transactional(
                requireProjectRevision(userId, request.projectId(), request.expectedRevision())
                        .then(repository.validateVoiceTrackReferences(request.projectId(), request.voiceTrack()))
                        .flatMap(valid -> valid ? Mono.empty() : Mono.error(new BusinessException(ErrorCode.PARAM_INVALID,
                                "声音轨引用的镜头、人物或正文块不属于当前项目")))
                        .then(validateVoiceTrackMedia(userId, request.voiceTrack()))
                        .then(repository.saveVoiceTrack(request.projectId(), request.voiceTrack()).switchIfEmpty(conflict()))
                        .then(advance(userId, request.projectId(), request.expectedRevision()))
                        .then(repository.listVoiceTracks(request.projectId(), null)
                                .filter(item -> item.id().equals(request.voiceTrack().id())).next())));
    }

    /**
     * 查询当前项目的分镜时间轴文字片段。
     *
     * @param request 项目标识请求
     * @return 按起点排序的文字片段列表
     */
    public Mono<List<ComicDramaDtos.TimelineText>> listTimelineTexts(ComicDramaDtos.ListTimelineTextsRequest request) {
        return withProject(request.projectId(), () -> repository.listTimelineTexts(request.projectId()).collectList());
    }

    /**
     * 保存分镜时间轴文字，并推进项目修订号。
     *
     * @param request 项目修订号及文字片段
     * @return 保存后的文字片段
     */
    public Mono<ComicDramaDtos.TimelineText> saveTimelineText(ComicDramaDtos.SaveTimelineTextRequest request) {
        ComicDramaDtos.TimelineText timelineText = request.timelineText();
        StoryboardFontCatalog.fileName(timelineText.fontFamily());
        if (timelineText.endMs() <= timelineText.startMs() || timelineText.fontSize() > 120
                || timelineText.trackNumber() < 0 || timelineText.trackNumber() > 2) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "文字片段时间、字号或轨道编号无效"));
        }
        return currentUserProvider.currentUserId().flatMap(userId -> transactionalOperator.transactional(
                requireProjectRevision(userId, request.projectId(), request.expectedRevision())
                        .flatMap(project -> timelineText.trackNumber() > project.textTrackCount()
                                ? Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "文字轨道不能跳号新增"))
                                : repository.hasTimelineTextOverlap(request.projectId(), timelineText)
                                        .flatMap(overlap -> overlap
                                                ? Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "同一文字轨道的片段时间不能重叠"))
                                                : timelineText.trackNumber() == project.textTrackCount()
                                                        ? repository.setTextTrackCount(request.projectId(), project.textTrackCount() + 1)
                                                        : Mono.empty()))
                        .then(repository.saveTimelineText(request.projectId(), timelineText).switchIfEmpty(conflict()))
                        .then(advance(userId, request.projectId(), request.expectedRevision()))
                        .then(repository.listTimelineTexts(request.projectId())
                                .filter(item -> item.id().equals(timelineText.id())).next())));
    }

    /**
     * 在同一事务中保存文字片段换位，避免逐条保存时触发临时重叠。
     *
     * @param request 项目修订号及换位后的片段
     * @return 更新后的文字片段
     */
    public Mono<List<ComicDramaDtos.TimelineText>> reorderTimelineTexts(ComicDramaDtos.ReorderTimelineTextsRequest request) {
        return currentUserProvider.currentUserId().flatMap(userId -> transactionalOperator.transactional(
                requireProjectRevision(userId, request.projectId(), request.expectedRevision())
                        .flatMap(project -> repository.listTimelineTexts(request.projectId()).collectList()
                                .flatMap(existing -> {
                                    validateTimelineTextReorder(existing, request.timelineTexts(), project.textTrackCount());
                                    Set<String> changedIds = request.timelineTexts().stream()
                                            .map(ComicDramaDtos.TimelineText::id).collect(java.util.stream.Collectors.toSet());
                                    return Flux.fromIterable(request.timelineTexts())
                                            .concatMap(item -> repository.saveTimelineText(request.projectId(), item).switchIfEmpty(conflict()))
                                            .then(advance(userId, request.projectId(), request.expectedRevision()))
                                            .then(repository.listTimelineTexts(request.projectId())
                                                    .filter(item -> changedIds.contains(item.id()))
                                                    .collectList());
                                }))));
    }

    /**
     * 校验批量结果中的实体修订号、轨道范围及最终时间区间。
     *
     * @param existing 当前项目全部文字片段
     * @param changed 待换位文字片段
     * @param trackCount 当前项目文字轨道数
     */
    private void validateTimelineTextReorder(List<ComicDramaDtos.TimelineText> existing,
                                             List<ComicDramaDtos.TimelineText> changed, int trackCount) {
        Map<String, ComicDramaDtos.TimelineText> finalTexts = new LinkedHashMap<>();
        existing.forEach(item -> finalTexts.put(item.id(), item));
        if (changed.stream().map(ComicDramaDtos.TimelineText::id).distinct().count() != changed.size()) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "文字片段列表无效");
        }
        for (ComicDramaDtos.TimelineText item : changed) {
            StoryboardFontCatalog.fileName(item.fontFamily());
            ComicDramaDtos.TimelineText current = finalTexts.get(item.id());
            if (current == null ? item.revision() != 0 : current.revision() != item.revision()) {
                throw new BusinessException(ErrorCode.PARAM_INVALID, "文字片段已变更，请刷新后重试");
            }
            if (item.startMs() < 0 || item.endMs() <= item.startMs()
                    || item.trackNumber() < 0 || item.trackNumber() >= trackCount) {
                throw new BusinessException(ErrorCode.PARAM_INVALID, "文字片段时间或轨道编号无效");
            }
            finalTexts.put(item.id(), item);
        }
        for (int trackNumber = 0; trackNumber < trackCount; trackNumber++) {
            int currentTrack = trackNumber;
            List<ComicDramaDtos.TimelineText> ordered = finalTexts.values().stream()
                    .filter(item -> item.trackNumber() == currentTrack)
                    .sorted(Comparator.comparingLong(ComicDramaDtos.TimelineText::startMs)).toList();
            for (int index = 1; index < ordered.size(); index++) {
                if (ordered.get(index - 1).endMs() > ordered.get(index).startMs()) {
                    throw new BusinessException(ErrorCode.PARAM_INVALID, "同一文字轨道的片段时间不能重叠");
                }
            }
        }
    }

    /**
     * 删除项目所属的分镜时间轴文字。
     *
     * @param request 项目修订号及文字片段标识
     * @return 更新后的项目修订信息
     */
    public Mono<ComicDramaDtos.MutationResult> deleteTimelineText(ComicDramaDtos.DeleteTimelineTextRequest request) {
        return currentUserProvider.currentUserId().flatMap(userId -> transactionalOperator.transactional(
                requireProjectRevision(userId, request.projectId(), request.expectedRevision())
                        .then(repository.deleteTimelineText(request.projectId(), request.timelineTextId()))
                        .flatMap(rows -> rows > 0 ? Mono.<Void>empty() : notFound("文字片段不存在"))
                        .then(advance(userId, request.projectId(), request.expectedRevision()))
                        .then(requireProject(userId, request.projectId())).map(this::mutationResult)));
    }

    /**
     * 删除新增文字轨道及其中片段，默认轨道不可删除。
     *
     * @param request 项目修订号及待删除轨道编号
     * @return 更新后的项目修订信息
     */
    public Mono<ComicDramaDtos.MutationResult> deleteTextTrack(ComicDramaDtos.DeleteTextTrackRequest request) {
        return currentUserProvider.currentUserId().flatMap(userId -> transactionalOperator.transactional(
                requireProjectRevision(userId, request.projectId(), request.expectedRevision())
                        .flatMap(project -> request.trackNumber() < 1 || request.trackNumber() >= project.textTrackCount()
                                ? Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "只能删除已存在的新增文字轨道"))
                                : repository.deleteTextTrack(request.projectId(), request.trackNumber()))
                        .then(advance(userId, request.projectId(), request.expectedRevision()))
                        .then(requireProject(userId, request.projectId())).map(this::mutationResult)));
    }

    /**
     * 校验声音条目的文件和裁剪时间组合，避免保存不可播放的轨道。
     *
     * @param voiceTrack 待保存的声音条目
     * @throws BusinessException 音频字段组合不合法时抛出
     */
    private void validateVoiceTrackTiming(ComicDramaDtos.VoiceTrack voiceTrack) {
        boolean hasAudio = StringUtils.hasText(voiceTrack.audioStorageKey());
        boolean hasDuration = voiceTrack.audioDurationMs() != null && voiceTrack.audioDurationMs() > 0;
        boolean scheduled = voiceTrack.timelineStartMs() != null;
        boolean hasAnyTrim = voiceTrack.trimStartMs() != null || voiceTrack.trimEndMs() != null;
        boolean hasCompleteTrim = voiceTrack.trimStartMs() != null && voiceTrack.trimEndMs() != null;
        if ((voiceTrack.audioStorageKey() != null && !hasAudio) || hasAudio != hasDuration || (!hasAudio && (scheduled || hasAnyTrim)) ||
                (scheduled != hasAnyTrim) || (scheduled != hasCompleteTrim) || (scheduled && (voiceTrack.trimStartMs() < 0 ||
                        voiceTrack.trimEndMs() <= voiceTrack.trimStartMs() || voiceTrack.trimEndMs() > voiceTrack.audioDurationMs()))) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "声音轨音频时长或裁剪范围无效");
        }
    }

    /**
     * 确认音频存储键属于当前用户，且媒体元数据与声音条目一致。
     *
     * @param userId 当前用户标识
     * @param voiceTrack 待保存的声音条目
     * @return 完成媒体归属和格式校验的信号
     */
    private Mono<Void> validateVoiceTrackMedia(Long userId, ComicDramaDtos.VoiceTrack voiceTrack) {
        if (!StringUtils.hasText(voiceTrack.audioStorageKey())) return Mono.empty();
        return persistenceService.getMediaInfoForUser(userId, voiceTrack.audioStorageKey())
                .flatMap(media -> {
                    if (media.mimeType() == null || !List.of("audio/mpeg", "audio/wav").contains(media.mimeType()) ||
                            media.durationMs() == null || media.durationMs().longValue() != voiceTrack.audioDurationMs()) {
                        return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "声音轨音频格式或时长与上传文件不一致"));
                    }
                    return Mono.<Void>empty();
                });
    }

    /** 查询P1批量生产任务。 */
    public Mono<List<ComicDramaDtos.BatchTask>> listBatchTasks(String projectId) {
        return withProject(projectId, () -> repository.listBatchTasks(projectId).collectList());
    }

    /**
     * 创建用户已确认的P1批量生产计划。
     * <p>批量计划只记录用户选择、报价和排队进度；实际媒体任务由生成接口创建，避免伪报已完成。</p>
     *
     * @param request 批量任务请求
     * @return 已排队批量任务
     */
    public Mono<ComicDramaDtos.BatchTask> createBatchTask(ComicDramaDtos.CreateBatchTaskRequest request) {
        if (!List.of("image", "video").contains(request.taskType())) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "当前批量生成仅支持image或video"));
        }
        if (!request.confirmed()) {
            return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "批量生成前必须明确确认费用"));
        }
        if (request.targetIds().stream().distinct().count() != request.targetIds().size()) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "批量生成目标不能重复"));
        }
        ComicDramaDtos.CreateGenerationTaskRequest generationRequest = new ComicDramaDtos.CreateGenerationTaskRequest(
                request.projectId(), request.expectedRevision(),
                Objects.requireNonNullElse(request.settings().getString("targetType"), "shot"), request.targetIds(),
                request.model(), request.settings(), true);
        return currentUserProvider.currentUserId().flatMap(userId -> requireProject(userId, request.projectId()).then(
                Flux.fromIterable(request.targetIds())
                        .concatMap(targetId -> prepareSingleGeneration(generationRequest, targetId, request.taskType()))
                        .collectList()
                        .flatMap(plans -> {
                            return quoteGenerationPlans(generationRequest, plans, request.taskType())
                                    .flatMap(credits -> {
                                        JSONObject scope = new JSONObject();
                                        scope.put("type", request.scope());
                                        scope.put("targetIds", request.targetIds());
                                        JSONObject modelSettings = new JSONObject(request.settings());
                                        modelSettings.put("model", request.model());
                                        modelSettings.put("targetType", generationRequest.targetType());
                                        modelSettings.put("mediaResultIds", plans.stream().map(plan -> plan.media().id()).toList());
                                        ComicDramaDtos.BatchTask task = new ComicDramaDtos.BatchTask(id(),
                                                request.taskType(), request.scope(), scope, modelSettings,
                                                credits, request.targetIds().size(), request.targetIds().size(), 0, 0, 0, 0,
                                                "queued", OffsetDateTime.now(), OffsetDateTime.now(), OffsetDateTime.now());
                                        return transactionalOperator.transactional(
                                                        requireProjectRevision(userId, request.projectId(), request.expectedRevision())
                                                                .then(advance(userId, request.projectId(), request.expectedRevision()))
                                                                .then(repository.createBatchTask(userId, request.projectId(), task))
                                                                .thenMany(Flux.fromIterable(plans)
                                                                        .concatMap(plan -> repository.createMediaResult(request.projectId(), plan.media())))
                                                                .then(repository.refreshProjectProductionStatus(request.projectId()))
                                                                .then())
                                                .thenMany(Flux.fromIterable(plans)
                                                        .concatMap(plan -> executeSingleGeneration(generationRequest, plan, request.taskType())))
                                                .collectList().flatMap(results -> {
                                                    int failedCount = (int) results.stream().filter(result -> "failed".equals(result.status())).count();
                                                    int queuedCount = results.size() - failedCount;
                                                    String status = failedCount == 0 ? "queued"
                                                            : queuedCount == 0 ? "failed" : "partialFailed";
                                                    return repository.updateBatchTaskProgress(request.projectId(), task.id(), queuedCount, failedCount, status)
                                                            .thenReturn(new ComicDramaDtos.BatchTask(task.id(), task.batchType(), task.scopeType(), task.scope(),
                                                                    task.modelSettings(), task.estimatedCredits(), task.totalCount(), queuedCount,
                                                                    0, 0, failedCount, 0, status, task.confirmedAt(), task.createdAt(), OffsetDateTime.now()));
                                                });
                                    });
                        })));
    }

    /** 查询无限画布绑定。 */
    public Mono<List<ComicDramaDtos.CanvasBinding>> listCanvasBindings(String projectId) {
        return withProject(projectId, () -> repository.listCanvasBindings(projectId).collectList());
    }

    /** 创建或更新漫剧实体与无限画布节点绑定。 */
    public Mono<ComicDramaDtos.CanvasBinding> bindCanvas(ComicDramaDtos.BindCanvasRequest request) {
        ComicDramaDtos.CanvasBinding binding = new ComicDramaDtos.CanvasBinding(id(), request.entityType(), request.entityId(),
                request.canvasProjectId(), request.nodeId(), new JSONObject(), OffsetDateTime.now(), OffsetDateTime.now());
        return currentUserProvider.currentUserId().flatMap(userId -> transactionalOperator.transactional(
                requireProjectRevision(userId, request.projectId(), request.expectedRevision())
                        .then(Mono.zip(persistenceService.getProject(request.canvasProjectId()),
                                repository.existsProjectEntity(request.projectId(), request.entityType(), request.entityId())))
                        .flatMap(tuple -> {
                            if (!tuple.getT2()) {
                                return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "绑定实体不存在或不属于当前项目"));
                            }
                            if (!canvasContainsNode(tuple.getT1(), request.nodeId())) {
                                return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "画布节点不存在"));
                            }
                            return repository.bindCanvas(request.projectId(), binding);
                        })
                        .flatMap(saved -> advance(userId, request.projectId(), request.expectedRevision())
                                .then(repository.refreshProjectProductionStatus(request.projectId())).thenReturn(saved))));
    }

    /** 在发生计费前校验生成目标并构建可追踪的媒体计划。 */
    private Mono<GenerationPlan> prepareSingleGeneration(ComicDramaDtos.CreateGenerationTaskRequest request,
                                                          String targetId, String mediaType) {
        if ("shot".equals(request.targetType())) {
            Mono<List<ComicDramaRepository.ShotReferenceImage>> references = "video".equals(mediaType)
                    ? repository.listShotReferencesForVideo(request.projectId(), targetId)
                    : repository.listShotAssetReferenceImages(request.projectId(), targetId).collectList();
            return Mono.zip(repository.getLatestPrompt(request.projectId(), targetId)
                            .switchIfEmpty(notFound("镜头尚无已采用的提示词版本")), references,
                    repository.getShot(request.projectId(), targetId).switchIfEmpty(notFound("镜头不存在")))
                    .map(tuple -> {
                        ComicDramaDtos.PromptVersion version = tuple.getT1();
                        List<ComicDramaRepository.ShotReferenceImage> images = tuple.getT2();
                        if ("video".equals(mediaType)) {
                            ComicDramaPromptReferences.validate(version, images, tuple.getT3().shotNumber());
                        }
                        // 图片任务只使用资产图片，重新编号，不能携带视频专用的分镜图说明。
                        JSONObject promptSnapshot = ComicDramaPromptReferences.snapshot(
                                ComicDramaPromptReferences.body(version), images, new JSONObject());
                        promptSnapshot.put("promptVersionId", version.id());
                        String prompt = "video".equals(mediaType) ? version.prompt()
                                : ComicDramaPromptReferences.fullPrompt(promptSnapshot);
                        String videoSeconds = "video".equals(mediaType)
                                && Boolean.TRUE.equals(request.settings().getBoolean("usePlannedShotDuration"))
                                ? plannedShotVideoSeconds(tuple.getT3().durationSeconds()) : null;
                        return generationPlan(request, targetId, mediaType, prompt,
                                images.stream().map(ComicDramaRepository.ShotReferenceImage::reference).toList(), promptSnapshot,
                                videoSeconds);
                    });
        } else if ("assetVersion".equals(request.targetType())) {
            return repository.getAssetVersion(request.projectId(), targetId).switchIfEmpty(notFound("资产版本不存在"))
                    .map(version -> generationPlan(request, targetId, mediaType,
                            version.versionName() + "\n" + text(version.appearanceDescription()), List.of(), new JSONObject(), null));
        } else {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "生成目标仅支持shot或assetVersion"));
        }
    }

    /**
     * 保存实际提交的提示词、引用映射和媒体计划。
     * @param request 生成参数
     * @param targetId 生成目标
     * @param mediaType 媒体类型
     * @param prompt 完整提示词
     * @param references 实际提交的有序图片
     * @param promptSnapshot 正文和系统说明快照
     * @param videoSeconds 批量视频生成时采用的镜头规划时长
     * @return 可报价和提交的生成计划
     */
    private GenerationPlan generationPlan(ComicDramaDtos.CreateGenerationTaskRequest request, String targetId,
            String mediaType, String prompt, List<AiTaskDtos.AiTaskMediaReference> references, JSONObject promptSnapshot,
            String videoSeconds) {
            JSONObject snapshot = new JSONObject(request.settings());
            snapshot.remove("usePlannedShotDuration");
            snapshot.putAll(promptSnapshot);
            snapshot.put("prompt", prompt);
            snapshot.put("model", request.model());
            snapshot.put("targetType", request.targetType());
            if (videoSeconds != null) {
                snapshot.put("seconds", videoSeconds);
            }
            if (references != null && !references.isEmpty()) {
                snapshot.put("referenceCount", references.size());
            }
            ComicDramaDtos.MediaResult media = new ComicDramaDtos.MediaResult(id(), request.targetType(), targetId,
                    mediaType, null, snapshot, new JSONObject(), "queued", false, "",
                    OffsetDateTime.now(), OffsetDateTime.now());
            return new GenerationPlan(media, prompt, references, videoSeconds);
    }

    /**
     * 在持久化和提交任何任务前逐个报价，保证整批输入都满足所选模型限制。
     * @param request CreateGenerationTaskRequest 批量生成参数
     * @param plans List 每个目标的实际素材计划
     * @param mediaType String 媒体类型
     * @return Mono<BigDecimal> 全部目标的精确总价
     */
    private Mono<BigDecimal> quoteGenerationPlans(ComicDramaDtos.CreateGenerationTaskRequest request,
            List<GenerationPlan> plans, String mediaType) {
        return Flux.fromIterable(plans)
                .concatMap(plan -> aiTaskService.quoteTaskCredits(generationTaskRequest(request, plan, mediaType)))
                .reduce(BigDecimal.ZERO, (total, amount) -> CreditAmounts.of(total.add(amount)));
    }

    /**
     * 为报价与提交构造相同的参数，自动模式按每个镜头自己的素材判定。
     * @param request CreateGenerationTaskRequest 生成设置
     * @param plan GenerationPlan 当前目标计划
     * @param mediaType String 媒体类型
     * @return CreateAiTaskRequest 可报价或提交的任务请求
     */
    private AiTaskDtos.CreateAiTaskRequest generationTaskRequest(ComicDramaDtos.CreateGenerationTaskRequest request,
            GenerationPlan plan, String mediaType) {
        Map<String, Object> parameters = new LinkedHashMap<>(request.settings());
        parameters.remove("usePlannedShotDuration");
        if (plan.videoSeconds() != null) {
            parameters.put("seconds", plan.videoSeconds());
        }
        String videoMode = null;
        if ("video".equals(mediaType)) {
            String mode = (String) parameters.get("videoGenerationMode");
            boolean hasReferences = plan.references() != null && !plan.references().isEmpty();
            videoMode = !StringUtils.hasText(mode) || "text-to-video".equals(mode)
                    ? (hasReferences ? "image-to-video" : "text-to-video") : mode;
            parameters.put("videoGenerationMode", videoMode);
        }
        return new AiTaskDtos.CreateAiTaskRequest(mediaType, plan.prompt(), request.model(), parameters,
                plan.references(), null, AiTaskSources.STORYBOARD, videoMode);
    }

    /**
     * 将批量视频镜头的规划时长转换为底层任务支持的正整数秒。
     * @param durationSeconds 镜头规划时长
     * @return 可传递给视频任务的整数秒
     * @throws BusinessException 镜头时长不是正整数秒时抛出
     */
    private String plannedShotVideoSeconds(BigDecimal durationSeconds) {
        try {
            int seconds = durationSeconds.stripTrailingZeros().intValueExact();
            if (seconds < 1) {
                throw new ArithmeticException("镜头时长必须大于零");
            }
            return Integer.toString(seconds);
        } catch (ArithmeticException exception) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "批量视频生成要求镜头规划时长为正整数秒");
        }
    }

    /** 执行单个已预先持久化的媒体计划。 */
    private Mono<ComicDramaDtos.MediaResult> executeSingleGeneration(ComicDramaDtos.CreateGenerationTaskRequest request,
                                                                      GenerationPlan plan, String mediaType) {
        String targetId = plan.media().targetId();
        String prompt = plan.prompt();
        List<AiTaskDtos.AiTaskMediaReference> references = plan.references();
        java.util.function.Function<AiTaskDtos.AiGenerationTaskResponse, Mono<Void>> attachTask = created ->
                repository.attachMediaTask(request.projectId(), plan.media().id(), created.id(), normalizeMediaStatus(created.status()))
                        .flatMap(rows -> rows == 1 ? Mono.empty() : conflict());
        Mono<AiTaskDtos.AiGenerationTaskResponse> task;
        if ("image".equals(mediaType) && "assetVersion".equals(request.targetType())) {
            task = Mono.zip(repository.getAssetVersion(request.projectId(), targetId), repository.getSettings(request.projectId()))
                    .flatMap(tuple -> repository.getAsset(request.projectId(), tuple.getT1().assetId()).flatMap(asset ->
                            storyboardAgentService.createAssetImageTask(new StoryboardDtos.CreateAssetImageTaskRequest(
                                    request.projectId(), new StoryboardDtos.StoryboardAsset(targetId, asset.assetType(),
                                    asset.name() + "-" + tuple.getT1().versionName(), tuple.getT1().appearanceDescription()),
                                    StringUtils.hasText(request.settings().getString("visualStyle"))
                                            ? request.settings().getString("visualStyle") : tuple.getT2().visualStyle(),
                                    request.model(), new StoryboardDtos.AssetImageSettings(
                                    request.settings().getString("quality"), request.settings().getString("resolution"),
                                    request.settings().getString("size"))), attachTask)));
        } else {
            task = aiTaskService.createTask(generationTaskRequest(request, plan, mediaType), attachTask);
        }
        return task.map(created -> new ComicDramaDtos.MediaResult(plan.media().id(), plan.media().targetType(), targetId,
                        mediaType, created.id(), plan.media().inputSnapshot(), new JSONObject(),
                        normalizeMediaStatus(created.status()), false, "", plan.media().createdAt(), OffsetDateTime.now()))
                .onErrorResume(exception -> {
                    String reason = StringUtils.hasText(exception.getMessage()) ? exception.getMessage() : "AI任务创建失败";
                    ComicDramaDtos.MediaResult failed = new ComicDramaDtos.MediaResult(plan.media().id(),
                            plan.media().targetType(), targetId, mediaType, plan.media().taskId(), plan.media().inputSnapshot(),
                            new JSONObject(), "failed", false, reason, plan.media().createdAt(), OffsetDateTime.now());
                    return repository.failMediaResult(request.projectId(), plan.media().id(), reason).thenReturn(failed);
                });
    }

    /** 判断归属已验证的画布中是否存在目标节点。 */
    private boolean canvasContainsNode(JSONObject canvas, String nodeId) {
        JSONObject scene = canvas == null ? null : canvas.getJSONObject("scene");
        return scene != null && scene.getJSONArray("nodes") != null
                && scene.getJSONArray("nodes").stream()
                .filter(JSONObject.class::isInstance).map(JSONObject.class::cast)
                .anyMatch(node -> nodeId.equals(node.getString("id")));
    }

    /** 媒体生成前已完成权限与输入校验的持久化计划。 */
    private record GenerationPlan(ComicDramaDtos.MediaResult media, String prompt,
                                  List<AiTaskDtos.AiTaskMediaReference> references, String videoSeconds) {
    }

    /**
     * 校验镜头草稿的资产引用，并构建项目资产与初始版本。
     * <p>
     * 资产必须先按剧本实体对齐再复用：分镜 Agent 每次拆分都会自己编一套资产标识，直接按该标识插入的话，
     * 同一个「姜浩」会被拆出多条资产。这里先按名称匹配剧本人物 / 地点写入 {@code sourceEntityId}，
     * 再优先按「类型 + 实体标识」、其次按「类型 + 名称」复用项目已有资产，只为其追加一个新版本。
     */
    private Mono<Map<String, DraftAssetPlan>> buildDraftAssetPlans(String projectId, String draftId,
                                                                   ScriptDtos.ProjectDetail scriptProject,
                                                                   StoryboardDtos.GenerateStoryboardResponse response) {
        Map<String, StoryboardDtos.StoryboardAsset> sources = validateDraftAssetReferences(response);
        return repository.listAssets(projectId, null).collectList().map(existing -> {
            Map<String, String> characterIds = new LinkedHashMap<>();
            scriptProject.characters().forEach(character -> characterIds.putIfAbsent(character.name().trim(), character.id()));
            Map<String, String> locationIds = new LinkedHashMap<>();
            scriptProject.locations().forEach(location -> locationIds.putIfAbsent(location.name().trim(), location.id()));
            Map<String, ComicDramaDtos.Asset> byEntity = new LinkedHashMap<>();
            Map<String, ComicDramaDtos.Asset> byName = new LinkedHashMap<>();
            for (ComicDramaDtos.Asset asset : existing) {
                if (StringUtils.hasText(asset.sourceEntityId())) {
                    byEntity.putIfAbsent(asset.assetType() + "\u0000" + asset.sourceEntityId(), asset);
                }
                byName.putIfAbsent(asset.assetType() + "\u0000" + asset.name().trim(), asset);
            }
            Map<String, DraftAssetPlan> plans = new LinkedHashMap<>();
            for (StoryboardDtos.StoryboardAsset source : sources.values()) {
                String name = source.name().trim();
                // 道具在剧本里没有对应实体，只能靠名称复用。
                String sourceEntityId = switch (source.kind()) {
                    case "character" -> characterIds.get(name);
                    case "scene" -> locationIds.get(name);
                    default -> null;
                };
                ComicDramaDtos.Asset reused = sourceEntityId == null ? null
                        : byEntity.get(source.kind() + "\u0000" + sourceEntityId);
                if (reused == null) {
                    reused = byName.get(source.kind() + "\u0000" + name);
                }
                String assetId = reused == null ? source.id() : reused.id();
                JSONObject attributes = new JSONObject();
                attributes.put("source", "shotDraft");
                attributes.put("draftId", draftId);
                ComicDramaDtos.Asset asset = new ComicDramaDtos.Asset(assetId, source.kind(), sourceEntityId, name,
                        text(source.description()), new JSONObject(), "active",
                        reused == null ? 0 : reused.revision(), null, null);
                ComicDramaDtos.AssetVersion version = new ComicDramaDtos.AssetVersion(id(), assetId, "初始版本",
                        "default", text(source.description()), List.of(), attributes, "active", 0, null, null);
                plans.put(source.id(), new DraftAssetPlan(asset, version, reused != null));
            }
            return plans;
        });
    }

    /** 校验镜头草稿资产与镜头引用是一致的封闭集合。 */
    private Map<String, StoryboardDtos.StoryboardAsset> validateDraftAssetReferences(
            StoryboardDtos.GenerateStoryboardResponse response) {
        if (response == null || response.shots() == null || response.shots().isEmpty()) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "镜头草稿至少需要一个镜头");
        }
        Map<String, StoryboardDtos.StoryboardAsset> sources = new LinkedHashMap<>();
        for (StoryboardDtos.StoryboardAsset source : response.assets() == null
                ? List.<StoryboardDtos.StoryboardAsset>of() : response.assets()) {
            if (source == null || !StringUtils.hasText(source.id()) || !source.id().equals(source.id().trim())
                    || source.id().length() > 64
                    || !List.of("character", "scene", "prop").contains(source.kind())
                    || !StringUtils.hasText(source.name()) || source.name().length() > 200) {
                throw new BusinessException(ErrorCode.PARAM_INVALID, "镜头草稿包含不合法的视觉资产");
            }
            if (sources.putIfAbsent(source.id(), source) != null) {
                throw new BusinessException(ErrorCode.PARAM_INVALID, "镜头草稿的资产标识不能重复");
            }
        }
        for (StoryboardDtos.StoryboardShot shot : response.shots()) {
            if (shot == null || shot.assetIds() == null) {
                throw new BusinessException(ErrorCode.PARAM_INVALID, "镜头草稿的资产引用不完整");
            }
            LinkedHashSet<String> uniqueIds = new LinkedHashSet<>(shot.assetIds());
            if (uniqueIds.size() != shot.assetIds().size() || !sources.keySet().containsAll(uniqueIds)) {
                throw new BusinessException(ErrorCode.PARAM_INVALID, "镜头草稿引用了重复或不存在的资产");
            }
        }
        return sources;
    }

    /** 在镜头确认事务内持久化草稿资产及其初始版本。 */
    private Mono<Void> persistDraftAssets(String projectId, java.util.Collection<DraftAssetPlan> plans) {
        return Flux.fromIterable(plans).concatMap(plan -> {
            // 复用已有资产时只追加新版本，不再插入资产行，否则同一个实体每次拆分都会多出一个资产。
            Mono<Void> assetStep = plan.reused() ? Mono.empty()
                    : repository.createShotDraftAsset(projectId, plan.asset())
                            .flatMap(inserted -> inserted == 1 ? Mono.<Void>empty()
                                    : Mono.error(new BusinessException(ErrorCode.DATA_CONFLICT,
                                            "镜头草稿资产标识已存在，请重新生成草稿")));
            return assetStep.then(repository.createShotDraftAssetVersion(plan.version()))
                    .flatMap(inserted -> inserted == 1 ? Mono.<Void>empty() : conflict());
        }).then();
    }

    /** 镜头草稿资产与其项目初始版本；复用已有资产时 reused 为真，只需追加版本。 */
    private record DraftAssetPlan(ComicDramaDtos.Asset asset, ComicDramaDtos.AssetVersion version, boolean reused) {
    }

    /** 执行带项目乐观锁的通用写操作。 */
    private Mono<ComicDramaDtos.MutationResult> mutate(String projectId, long expectedRevision, Mono<?> mutation) {
        return currentUserProvider.currentUserId().flatMap(userId -> transactionalOperator.transactional(
                requireProjectRevision(userId, projectId, expectedRevision).then(mutation)
                        .then(advance(userId, projectId, expectedRevision))
                        .then(repository.refreshProjectProductionStatus(projectId)).then(requireProject(userId, projectId))
                        .map(this::mutationResult)));
    }

    /** 在严格项目归属校验后执行读取操作。 */
    private <T> Mono<T> withProject(String projectId, java.util.function.Supplier<Mono<T>> operation) {
        return currentUserProvider.currentUserId().flatMap(userId -> requireProject(userId, projectId).then(Mono.defer(operation)));
    }

    /** 校验漫剧项目归属。 */
    private Mono<ComicDramaRepository.ProjectRecord> requireProject(Long userId, String projectId) {
        return repository.getProject(userId, projectId).switchIfEmpty(notFound("漫剧项目不存在"));
    }

    /** 校验漫剧项目修订号。 */
    private Mono<ComicDramaRepository.ProjectRecord> requireProjectRevision(Long userId, String projectId, long expectedRevision) {
        return requireProject(userId, projectId).flatMap(project -> project.revision() == expectedRevision
                ? Mono.just(project) : conflict());
    }

    /** 使用乐观锁推进修订号。 */
    private Mono<Long> advance(Long userId, String projectId, long expectedRevision) {
        return repository.advanceRevision(userId, projectId, expectedRevision).switchIfEmpty(conflict());
    }

    /** 构造通用修订结果。 */
    private ComicDramaDtos.MutationResult mutationResult(ComicDramaRepository.ProjectRecord project) {
        return new ComicDramaDtos.MutationResult(project.projectId(), project.revision(), project.updatedAt());
    }

    /** 判断镜头草稿范围类型。 */
    private String scopeType(ComicDramaDtos.GenerateShotDraftRequest request) {
        return StringUtils.hasText(request.sceneId()) ? "scene" : StringUtils.hasText(request.episodeId()) ? "episode" : "project";
    }

    /** 读取镜头草稿范围标识。 */
    private String scopeId(ComicDramaDtos.GenerateShotDraftRequest request) {
        return StringUtils.hasText(request.sceneId()) ? request.sceneId() : StringUtils.hasText(request.episodeId()) ? request.episodeId() : null;
    }

    /** 创建稳定标识。 */
    private String id() {
        return UUID.randomUUID().toString();
    }

    /** 标准化可选文本。 */
    private String text(String value) {
        return value == null ? "" : value.trim();
    }

    /** 将底层AI任务状态映射为漫剧媒体状态。 */
    private String normalizeMediaStatus(String status) {
        return switch (status) {
            case "success" -> "completed";
            case "running" -> "processing";
            case "failed", "canceled" -> "failed";
            default -> "queued";
        };
    }

    /** 创建资源不存在错误流。 */
    private <T> Mono<T> notFound(String message) {
        return Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, message));
    }

    /** 创建数据修订冲突错误流。 */
    private <T> Mono<T> conflict() {
        return Mono.error(new BusinessException(ErrorCode.DATA_CONFLICT, "数据已被其他操作修改，请刷新后重试"));
    }
}
