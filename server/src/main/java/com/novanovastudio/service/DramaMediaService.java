package com.novanovastudio.service;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.ai.AiMediaSupport;
import com.novanovastudio.ai.AiTaskSources;
import com.novanovastudio.ai.GeneratedBinary;
import com.novanovastudio.ai.VideoGenerationMode;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.AiTaskDtos;
import com.novanovastudio.dto.DramaContracts;
import com.novanovastudio.dto.DramaDtos;
import com.novanovastudio.repository.DramaRepository;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.security.TeamScope;
import com.novanovastudio.storage.MediaAccessService;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

/**
 * 把短剧生成目标提交给现有的图片和视频任务，并在读取工作台时同步结果。
 * <p>提示词一律由短剧提示词 Agent 产出，这里只做目标解析、参考图挂载和任务提交。</p>
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-14 11:20
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class DramaMediaService {

    private static final Set<String> STATUSES = Set.of("pending", "running", "success", "failed", "canceled");

    /** 正在裁切的项目，合并同一项目的并发裁切请求。 */
    private final Map<String, Mono<Void>> cropping = new ConcurrentHashMap<>();

    /** 当前用户。 */
    private final CurrentUserProvider currentUserProvider;

    /** 短剧仓储。 */
    private final DramaRepository dramaRepository;

    /** 统一生成任务。 */
    private final AiTaskService aiTaskService;

    /** 短剧提示词Agent。 */
    private final DramaMediaPromptService dramaMediaPromptService;

    /** 读取和保存生成图片。 */
    private final AiMediaSupport mediaSupport;

    /** 结果地址签名。 */
    private final MediaAccessService mediaAccessService;

    /** 视频合成任务，用于把成片结果落回项目。 */
    private final VideoCompositionTaskService videoCompositionTaskService;

    /** 媒体库和对象存储。 */
    private final PersistenceService persistenceService;

    /** 对象存储的实际删除。 */
    private final StorageBillingService storageBillingService;

    /**
     * 为角色、场景或镜头创建一个真实的图片或视频任务。
     *
     * @param request 生成请求
     * @return 完成信号。重复的请求号直接返回，不再创建第二个任务
     */
    public Mono<Void> generate(DramaDtos.GenerateMediaRequest request) {
        requireClientId(request.clientRequestId());
        return scope((userId, teamId) -> dramaRepository.findClientRequest(request.clientRequestId(), userId, teamId).hasElement()
                .flatMap(exists -> exists ? Mono.empty() : submit(userId, teamId, request)));
    }

    private Mono<Void> submit(long userId, long teamId, DramaDtos.GenerateMediaRequest request) {
        return dramaRepository.findProject(userId, teamId, request.projectId()).switchIfEmpty(Mono.error(missing()))
                .flatMap(project -> dramaRepository.listVersions(project.id(), teamId).collectList().flatMap(versions -> {
                    DramaRepository.VersionRow version = versions.stream().filter(item -> item.id().equals(request.versionId())).findFirst().orElse(null);
                    if (version == null) {
                        return Mono.error(invalid("版本不存在"));
                    }
                    JSONObject storyboard = contentOf(latest(versions, "storyboard"));
                    JSONObject production = contentOf(latest(versions, "shot"));
                    JSONObject cast = contentOf(latest(versions, "cast"));
                    JSONObject plan = contentOf(latest(versions, "plan"));
                    DramaMediaTargets.Spec spec = DramaMediaTargets.resolve(request.targetKey(), contentOf(version), storyboard);
                    if (!spec.stage().equals(version.stage())) {
                        return Mono.error(invalid("请在对应阶段生成"));
                    }
                    return dramaRepository.listMedia(project.id(), teamId).collectList()
                            .flatMap(media -> prepareFrames(userId, teamId, project.id(), request.targetKey(), media))
                            .flatMap(media -> {
                        if (media.stream().anyMatch(item -> request.targetKey().equals(item.targetKey()) && open(item.status()))) {
                            return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "这一项正在生成"));
                        }
                        return prompt(userId, project, request, spec, storyboard, cast, plan, production, media)
                                // 提示词 Agent 要跑十几秒，参考图可能在这期间才落库，写完再读一次
                                .flatMap(item -> dramaRepository.listMedia(project.id(), teamId).collectList().flatMap(fresh -> {
                            List<AiTaskDtos.AiTaskMediaReference> references = references(request.targetKey(), item.referenceKeys(), spec, fresh, storyboard);
                            String mode = videoMode(request.targetKey(), spec.mediaType(), references);
                            Map<String, Object> parameters = parameters(request, spec);
                            applyAspect(parameters, request.targetKey(), spec.mediaType(), project.aspectRatio());
                            AiTaskDtos.CreateAiTaskRequest taskRequest = new AiTaskDtos.CreateAiTaskRequest(spec.mediaType(), item.prompt(),
                                    request.model().trim(), parameters, references, null, AiTaskSources.DRAMA, null, null, mode);
                            return validateFrameSizes(userId, references)
                                    .then(aiTaskService.createTask(taskRequest, created -> persist(userId, teamId, project.id(), version.id(), request, spec, item, created)))
                                    .doOnNext(created -> log.info("短剧已提交媒体任务: projectId={}, target={}, mediaType={}, model={}, taskId={}",
                                            project.id(), request.targetKey(), spec.mediaType(), request.model().trim(), created.id()))
                                    .onErrorMap(error -> duplicateTarget(error) ? new BusinessException(ErrorCode.BUSINESS_ERROR, "这一项正在生成") : error)
                                    .then();
                        }));
                    });
                }));
    }

    /** 提示词必须来自 Agent：调用方带了就用，没带就让短剧提示词 Agent 现写。 */
    private Mono<DramaContracts.MediaItem> prompt(long userId, DramaRepository.ProjectRow project, DramaDtos.GenerateMediaRequest request,
                                                  DramaMediaTargets.Spec spec, JSONObject storyboard, JSONObject cast, JSONObject plan,
                                                  JSONObject production, List<DramaRepository.MediaRow> media) {
        if (StringUtils.hasText(request.prompt())) {
            List<String> keys = request.referenceKeys() == null ? List.of() : request.referenceKeys().stream()
                    .filter(StringUtils::hasText).map(String::trim).toList();
            return Mono.just(new DramaContracts.MediaItem(request.targetKey(), request.prompt().trim(), keys));
        }
        return dramaMediaPromptService.write(new DramaMediaPromptService.Request(request.targetKey(), spec.mediaType(), spec.seconds(),
                storyboard, cast, plan, production, availableReferences(media), DramaArtifacts.normalizeAspect(project.aspectRatio()),
                project.textModel(), userId));
    }

    /** 已经生成成功、可以挂给模型的参考图目标。 */
    private List<String> availableReferences(List<DramaRepository.MediaRow> media) {
        List<String> keys = new ArrayList<>();
        for (DramaRepository.MediaRow row : media) {
            String key = row.targetKey();
            if (!"success".equals(row.status()) || !StringUtils.hasText(row.storageKey()) || !StringUtils.hasText(key)) {
                continue;
            }
            if (!(key.startsWith("character:") || key.startsWith("location:") || key.startsWith("board:")
                    || key.startsWith("sheet:") || key.startsWith("cut:first:") || key.startsWith("cut:last:"))) {
                continue;
            }
            if (!keys.contains(key)) {
                keys.add(key);
            }
        }
        return keys;
    }

    /**
     * 把当前用户已成功的合成成片记到项目上，刷新后仍可播放和导出。
     *
     * @param projectId 项目ID
     * @param taskId 合成任务ID
     * @return 完成信号。同一任务重复保存直接返回
     */
    public Mono<Void> saveCut(String projectId, String taskId) {
        return scope((userId, teamId) -> dramaRepository.findProject(userId, teamId, projectId)
                .switchIfEmpty(Mono.error(missing()))
                .then(videoCompositionTaskService.getTask(taskId))
                .flatMap(task -> {
                    JSONObject result = task.resultData() == null ? new JSONObject() : task.resultData();
                    String storageKey = text(result, "storageKey");
                    if (!"succeeded".equals(task.status()) || !StringUtils.hasText(storageKey)) {
                        return Mono.error(invalid("成片还没有合成完成"));
                    }
                    return dramaRepository.listMedia(projectId, teamId).collectList().flatMap(rows -> {
                        boolean saved = rows.stream().anyMatch(row -> "cut".equals(row.targetKey()) && taskId.equals(row.taskId()));
                        if (saved) {
                            return Mono.empty();
                        }
                        DramaRepository.MediaRow row = new DramaRepository.MediaRow(UUID.randomUUID().toString(), projectId, "", "cut", "video",
                                taskId, "compose", "成片", "success", text(result, "url"), storageKey,
                                StringUtils.hasText(text(result, "mimeType")) ? text(result, "mimeType") : "video/mp4", "", OffsetDateTime.now());
                        return dramaRepository.insertMedia(teamId, userId, row).then();
                    });
                }));
    }

    /**
     * 删除项目已经生成的图片和视频，并尽量取消还没发出的生成任务。
     *
     * @param userId 用户ID
     * @param teamId 团队空间
     * @param projectId 项目ID
     * @return 完成信号
     */
    public Mono<Void> deleteGenerated(long userId, long teamId, String projectId) {
        return dramaRepository.listMedia(projectId, teamId).collectList()
                .flatMap(rows -> cancelOpenTasks(userId, rows).then(refresh(userId, teamId, rows)))
                .then(dramaRepository.listMedia(projectId, teamId).collectList())
                .flatMap(rows -> deleteStoredMedia(userId, projectId, storageKeys(rows)));
    }

    /**
     * 同步未完成任务并返回可预览的生成记录。
     *
     * @param userId 用户ID
     * @param teamId 团队空间
     * @param projectId 项目ID
     * @return 新记录在前的媒体列表
     */
    public Mono<List<DramaDtos.MediaView>> list(long userId, long teamId, String projectId) {
        return dramaRepository.listMedia(projectId, teamId).collectList()
                .flatMap(rows -> refresh(userId, teamId, rows).then(dramaRepository.listMedia(projectId, teamId).collectList()))
                .flatMap(rows -> cropSheet(userId, teamId, projectId).then(dramaRepository.listMedia(projectId, teamId).collectList()))
                .flatMap(rows -> Flux.fromIterable(rows).concatMap(row -> view(userId, row)).collectList());
    }

    private Mono<Void> cancelOpenTasks(long userId, List<DramaRepository.MediaRow> rows) {
        List<String> taskIds = rows.stream()
                .filter(row -> open(row.status()) && StringUtils.hasText(row.taskId()) && !"compose".equals(row.model()) && !"crop".equals(row.model()))
                .map(DramaRepository.MediaRow::taskId).distinct().toList();
        return Flux.fromIterable(taskIds).concatMap(taskId -> aiTaskService.cancelTaskForUser(userId, taskId)
                .onErrorResume(error -> {
                    log.info("删除短剧时未能取消生成任务: taskId={}, message={}", taskId, error.getMessage());
                    return Mono.empty();
                })).then();
    }

    private List<String> storageKeys(List<DramaRepository.MediaRow> rows) {
        return rows.stream().map(DramaRepository.MediaRow::storageKey).filter(StringUtils::hasText).distinct().toList();
    }

    private Mono<Void> deleteStoredMedia(long userId, String projectId, List<String> storageKeys) {
        if (storageKeys.isEmpty()) {
            return Mono.empty();
        }
        log.info("删除短剧生成的图片和视频: projectId={}, count={}", projectId, storageKeys.size());
        return persistenceService.deleteMediaForUser(userId, storageKeys)
                .then(storageBillingService.deletePendingObjects().onErrorResume(error -> {
                    log.warn("短剧媒体对象删除将稍后重试: projectId={}, message={}", projectId, error.getMessage());
                    return Mono.empty();
                }));
    }

    private Mono<Void> persist(long userId, long teamId, String projectId, String versionId, DramaDtos.GenerateMediaRequest request,
                               DramaMediaTargets.Spec spec, DramaContracts.MediaItem item, AiTaskDtos.AiGenerationTaskResponse created) {
        OffsetDateTime now = OffsetDateTime.now();
        String mediaId = UUID.randomUUID().toString();
        DramaRepository.MediaRow row = new DramaRepository.MediaRow(mediaId, projectId, versionId, request.targetKey(), spec.mediaType(),
                created.id(), request.model().trim(), item.prompt(), status(created.status()), "", "", "", "", now);
        JSONObject result = new JSONObject();
        result.put("projectId", projectId);
        result.put("mediaId", mediaId);
        result.put("taskId", created.id());
        return dramaRepository.insertMedia(teamId, userId, row)
                .then(dramaRepository.insertClientRequest(request.clientRequestId(), teamId, userId, "media", projectId, result.toJSONString()))
                .then();
    }

    private Mono<Void> refresh(long userId, long teamId, List<DramaRepository.MediaRow> rows) {
        return Flux.fromIterable(rows).filter(row -> open(row.status())).concatMap(row -> aiTaskService.getTaskForUser(userId, row.taskId())
                .flatMap(task -> syncMedia(userId, teamId, row, task))
                .onErrorResume(error -> {
                    log.warn("同步短剧媒体任务失败: mediaId={}, taskId={}, message={}", row.id(), row.taskId(), error.getMessage());
                    return Mono.empty();
                })).then();
    }

    /** 任务成功但文件没进对象存储时，卡片改为失败，避免一直停在生成中。 */
    private Mono<Void> syncMedia(long userId, long teamId, DramaRepository.MediaRow row, AiTaskDtos.AiGenerationTaskResponse task) {
        String status = status(task.status());
        JSONObject item = firstItem(task.resultData());
        String url = text(item, "url");
        String storageKey = text(item, "storageKey");
        String mimeType = text(item, "mimeType");
        String error = task.errorMessage() == null ? "" : task.errorMessage();
        if ("success".equals(status) && !StringUtils.hasText(url)) {
            status = "failed";
            error = StringUtils.hasText(error) ? error : "生成结果没有媒体地址";
        }
        if (!"success".equals(status) || !StringUtils.hasText(storageKey)) {
            return writeMedia(teamId, row, status, url, storageKey, mimeType, error);
        }
        String savedUrl = url;
        String savedKey = storageKey;
        String savedMime = mimeType;
        return locallyStored(userId, storageKey)
                .flatMap(stored -> Boolean.TRUE.equals(stored)
                        ? writeMedia(teamId, row, "success", savedUrl, savedKey, savedMime, "")
                        : writeMedia(teamId, row, "failed", "", "", "", unsavedMessage(row)));
    }

    private Mono<Void> writeMedia(long teamId, DramaRepository.MediaRow row, String status, String url, String storageKey, String mimeType, String error) {
        if (status.equals(row.status()) && url.equals(text(row.resultUrl())) && storageKey.equals(text(row.storageKey()))
                && error.equals(text(row.errorMessage()))) {
            return Mono.empty();
        }
        return dramaRepository.updateMedia(row.id(), teamId, status, url, storageKey, mimeType, error);
    }

    /** 文件在对象存储里才算保存成功。查不到记录视为没保存；查询本身失败时留给下次同步。 */
    private Mono<Boolean> locallyStored(long userId, String storageKey) {
        if (!StringUtils.hasText(storageKey)) {
            return Mono.just(false);
        }
        return persistenceService.getMediaInfoForUser(userId, storageKey)
                .map(info -> info.objectStorage() != null && StringUtils.hasText(info.objectStorage().key()))
                .onErrorResume(error -> missingMedia(error) ? Mono.just(false) : Mono.error(error));
    }

    private Mono<Void> failUnsaved(long teamId, DramaRepository.MediaRow sheet) {
        return writeMedia(teamId, sheet, "failed", "", "", "", unsavedMessage(sheet));
    }

    private static String unsavedMessage(DramaRepository.MediaRow row) {
        if (row.targetKey() != null && row.targetKey().startsWith("sheet:")) {
            return "连续图已生成，但保存到本地失败，请重新生成";
        }
        if ("video".equals(row.mediaType())) {
            return "视频已生成，但保存到本地失败，请重新生成";
        }
        return "图片已生成，但保存到本地失败，请重新生成";
    }

    private boolean missingMedia(Throwable error) {
        for (Throwable current = error; current != null; current = current.getCause()) {
            if (current instanceof BusinessException business && business.getCode() == ErrorCode.RESOURCE_NOT_FOUND) {
                return true;
            }
        }
        return false;
    }

    private Mono<List<DramaRepository.MediaRow>> prepareFrames(long userId, long teamId, String projectId, String targetKey, List<DramaRepository.MediaRow> media) {
        if (!targetKey.startsWith("sheet:") && !targetKey.startsWith("shot-video:")) {
            return Mono.just(media);
        }
        return cropSheet(userId, teamId, projectId).then(dramaRepository.listMedia(projectId, teamId).collectList());
    }

    private Mono<Void> cropSheet(long userId, long teamId, String projectId) {
        return cropping.computeIfAbsent(projectId, key -> dramaRepository.listMedia(projectId, teamId).collectList()
                .flatMap(rows -> cutFrames(userId, teamId, projectId, rows))
                .doFinally(signal -> cropping.remove(projectId))
                .cache());
    }

    /** 把成功的连续图裁成首帧和尾帧。并发请求共用同一次裁切，上传完成前不再重复进来。 */
    private Mono<Void> cutFrames(long userId, long teamId, String projectId, List<DramaRepository.MediaRow> rows) {
        java.util.LinkedHashMap<String, DramaRepository.MediaRow> newest = new java.util.LinkedHashMap<>();
        for (DramaRepository.MediaRow row : rows) {
            if (!row.targetKey().startsWith("sheet:") || !"success".equals(row.status()) || !StringUtils.hasText(row.storageKey())) {
                continue;
            }
            newest.putIfAbsent(row.targetKey().substring("sheet:".length()), row);
        }
        return Flux.fromIterable(newest.entrySet()).concatMap(entry -> {
            String ref = entry.getKey();
            DramaRepository.MediaRow sheet = entry.getValue();
            boolean hasFirst = rows.stream().anyMatch(row -> ("cut:first:" + ref).equals(row.targetKey()) && sheet.taskId().equals(row.taskId()));
            boolean hasLast = rows.stream().anyMatch(row -> ("cut:last:" + ref).equals(row.targetKey()) && sheet.taskId().equals(row.taskId()));
            if (hasFirst && hasLast) {
                return Mono.empty();
            }
            return locallyStored(userId, sheet.storageKey())
                    .flatMap(stored -> {
                        if (!Boolean.TRUE.equals(stored)) {
                            return failUnsaved(teamId, sheet);
                        }
                        return mediaSupport.resolveReferenceBinary(userId, new AiTaskDtos.AiTaskMediaReference(sheet.id(), sheet.targetKey(), "image/png",
                                        sheet.storageKey(), sheet.resultUrl()), "image/png")
                                .flatMap(binary -> Mono.fromCallable(() -> DramaArtifacts.cropSheet(binary.data())).subscribeOn(Schedulers.boundedElastic()))
                                .flatMap(cells -> storeFrame(userId, teamId, projectId, sheet, "cut:first:" + ref, "drama-first-frame.png", cells[0], hasFirst)
                                        .then(storeFrame(userId, teamId, projectId, sheet, "cut:last:" + ref, "drama-last-frame.png", cells[1], hasLast)))
                                .onErrorResume(error -> {
                                    // 下载或上传抖一下不该把已经生成成功的连续图判死：这里不写 failed，
                                    // 下一次 list 会重新裁一次，链式生成也能自己接上。
                                    log.warn("裁切短剧连续图失败: projectId={}, target={}, message={}", projectId, sheet.targetKey(), error.getMessage());
                                    return Mono.empty();
                                });
                    })
                    .onErrorResume(error -> {
                        log.warn("确认连续图是否已保存失败: projectId={}, target={}, message={}", projectId, sheet.targetKey(), error.getMessage());
                        return Mono.empty();
                    });
        }).then();
    }

    private Mono<Void> storeFrame(long userId, long teamId, String projectId, DramaRepository.MediaRow sheet, String targetKey,
                                  String fileName, byte[] png, boolean alreadyStored) {
        if (alreadyStored) {
            return Mono.empty();
        }
        return mediaSupport.storeGeneratedMedia(userId, "image", fileName, new GeneratedBinary(png, "image/png"), null, null, null)
                .flatMap(stored -> dramaRepository.insertMedia(teamId, userId, new DramaRepository.MediaRow(UUID.randomUUID().toString(), projectId,
                        text(sheet.versionId()), targetKey, "image", sheet.taskId(), "crop", targetKey, "success",
                        text(stored.url()), text(stored.storageKey()), "image/png", "", OffsetDateTime.now())).then());
    }

    private Mono<DramaDtos.MediaView> view(long userId, DramaRepository.MediaRow row) {
        String url = text(row.resultUrl());
        return (StringUtils.hasText(url) ? mediaAccessService.signUrl(url, MediaAccessService.Purpose.PREVIEW) : Mono.just(""))
                .zipWith(mediaProgress(userId, row))
                .map(pair -> new DramaDtos.MediaView(row.id(), row.versionId(), row.targetKey(), row.mediaType(), row.taskId(), row.model(),
                        row.status(), pair.getT2(), pair.getT1(), text(row.storageKey()), text(row.mimeType()), text(row.errorMessage()),
                        row.createdAt() == null ? "" : row.createdAt().toString()));
    }

    /** 生成中的记录从统一任务表读实时进度，成功时给 100。 */
    private Mono<Integer> mediaProgress(long userId, DramaRepository.MediaRow row) {
        if ("success".equals(row.status())) {
            return Mono.just(100);
        }
        if (!open(row.status()) || !StringUtils.hasText(row.taskId())) {
            return Mono.just(0);
        }
        return aiTaskService.getTaskForUser(userId, row.taskId())
                .map(task -> task.progress() == null ? 0 : Math.max(0, Math.min(99, task.progress())))
                .onErrorResume(error -> Mono.just(0));
    }

    /**
     * 组装参考图。必需的参考图由服务端决定并排在最前，不能依赖提示词 Agent 有没有写进来；
     * 它给的其余参考图按顺序补在后面，库里没有就跳过。
     */
    private List<AiTaskDtos.AiTaskMediaReference> references(String targetKey, List<String> keys, DramaMediaTargets.Spec spec,
                                                             List<DramaRepository.MediaRow> media, JSONObject storyboard) {
        String fixedRole = "image".equals(spec.mediaType()) ? "reference_image" : null;
        List<AiTaskDtos.AiTaskMediaReference> references = new ArrayList<>();
        for (String key : DramaMediaTargets.requiredReferences(targetKey, storyboard)) {
            DramaRepository.MediaRow row = usableMedia(media, key);
            if (row == null) {
                throw invalid("请先生成上一个镜头的连续图，等它的尾帧准备好后，再生成这一张");
            }
            references.add(reference(row, fixedRole != null ? fixedRole : role(key)));
        }
        for (String key : keys) {
            if (references.stream().anyMatch(item -> key.equals(item.name()))) {
                continue;
            }
            DramaRepository.MediaRow row = usableMedia(media, key);
            if (row != null) {
                references.add(reference(row, fixedRole != null ? fixedRole : role(key)));
            }
        }
        if (targetKey.startsWith("shot-video:") && references.size() != 3) {
            String ref = DramaMediaTargets.ref(targetKey);
            throw invalid(media.stream().anyMatch(item -> ("sheet:" + ref).equals(item.targetKey()) && "success".equals(item.status()))
                    ? "连续图的首尾帧还没准备好，请稍后再试" : "请先生成这个镜头的4×3连续图");
        }
        return references;
    }

    /**
     * 找一张可以直接当参考图的记录。
     *
     * @param media 项目全部媒体
     * @param key 目标
     * @return 已成功且有存储的记录，没有时为 null
     */
    private DramaRepository.MediaRow usableMedia(List<DramaRepository.MediaRow> media, String key) {
        return media.stream().filter(item -> key.equals(item.targetKey()) && "success".equals(item.status())
                && (StringUtils.hasText(item.storageKey()) || StringUtils.hasText(item.resultUrl()))).findFirst().orElse(null);
    }

    /** 首帧和尾帧只有连续图的 1/4×1/3，高度低于 300px 会被视频渠道的素材处理拒绝，提交前给出可读提示。 */
    private Mono<Void> validateFrameSizes(long userId, List<AiTaskDtos.AiTaskMediaReference> references) {
        return Flux.fromIterable(references)
                .filter(reference -> reference.name() != null
                        && (reference.name().startsWith("cut:first:") || reference.name().startsWith("cut:last:")))
                .concatMap(reference -> mediaSupport.resolveReferenceBinary(userId, reference, reference.mimeType())
                        .flatMap(binary -> Mono.fromCallable(() -> DramaArtifacts.imageSize(binary.data()))
                                .subscribeOn(Schedulers.boundedElastic()))
                        .flatMap(size -> size[1] >= 300 && size[0] >= 300 ? Mono.empty()
                                : Mono.error(invalid("首帧或尾帧只有 " + size[0] + "×" + size[1]
                                        + "，高度低于 300px，请把连续图分辨率调到 2K 后重新生成"))))
                .then();
    }

    private AiTaskDtos.AiTaskMediaReference reference(DramaRepository.MediaRow item, String role) {
        String mimeType = item.mimeType() != null && item.mimeType().startsWith("image/") ? item.mimeType() : "image/png";
        return new AiTaskDtos.AiTaskMediaReference(item.id(), item.targetKey(), mimeType, text(item.storageKey()), text(item.resultUrl()), role);
    }

    private String role(String key) {
        if (key.startsWith("cut:first:")) {
            return "first_frame";
        }
        if (key.startsWith("cut:last:")) {
            return "last_frame";
        }
        if (key.startsWith("sheet:")) {
            return "reference_image";
        }
        return null;
    }

    private String videoMode(String targetKey, String mediaType, List<AiTaskDtos.AiTaskMediaReference> references) {
        if (!"video".equals(mediaType)) {
            return null;
        }
        if (targetKey.startsWith("shot-video:")) {
            return VideoGenerationMode.REFERENCE_TO_VIDEO;
        }
        return references.isEmpty() ? VideoGenerationMode.TEXT_TO_VIDEO : VideoGenerationMode.IMAGE_TO_VIDEO;
    }

    private Map<String, Object> parameters(DramaDtos.GenerateMediaRequest request, DramaMediaTargets.Spec spec) {
        Map<String, Object> parameters = new LinkedHashMap<>();
        if (request.parameters() != null) {
            parameters.putAll(request.parameters());
        }
        parameters.remove("videoGenerationMode");
        if ("image".equals(spec.mediaType())) {
            parameters.put("count", 1);
            if (request.targetKey().startsWith("sheet:")) {
                // 连续图会被等分成 4×3，单格高度低于 300px 时 Seedance 会拒绝，固定用 2K。
                parameters.put("resolution", "2K");
            } else {
                fill(parameters, "resolution", "2K");
            }
            fill(parameters, "quality", "medium");
            fill(parameters, "size", request.targetKey().startsWith("character:") ? "3:2" : "16:9");
            return parameters;
        }
        parameters.put("seconds", seconds(parameters.get("seconds"), spec.seconds() > 0 ? spec.seconds() : 5));
        fill(parameters, "resolution", "720p");
        fill(parameters, "size", "16:9");
        parameters.putIfAbsent("watermark", false);
        return parameters;
    }

    private void applyAspect(Map<String, Object> parameters, String targetKey, String mediaType, String aspectRatio) {
        if (targetKey.startsWith("character:")) {
            parameters.put("size", "3:2");
            return;
        }
        String ratio = DramaArtifacts.normalizeAspect(aspectRatio);
        if (targetKey.startsWith("sheet:")) {
            parameters.put("size", "16:9");
            return;
        }
        if ("image".equals(mediaType)) {
            parameters.put("size", ratio);
            return;
        }
        Object sent = parameters.get("size");
        parameters.put("size", DramaArtifacts.videoSize(sent == null ? "" : sent.toString(), ratio));
    }

    private int seconds(Object raw, int fallback) {
        if (raw instanceof Number number) {
            int value = number.intValue();
            if (value > 0) {
                return value;
            }
        }
        if (raw != null) {
            try {
                int value = Integer.parseInt(raw.toString().trim());
                if (value > 0) {
                    return value;
                }
            } catch (NumberFormatException ignored) {
                return fallback;
            }
        }
        return fallback;
    }

    private void fill(Map<String, Object> parameters, String key, String fallback) {
        Object value = parameters.get(key);
        if (value == null || !StringUtils.hasText(value.toString())) {
            parameters.put(key, fallback);
        }
    }

    private JSONObject firstItem(JSONObject result) {
        if (result == null) {
            return new JSONObject();
        }
        JSONObject item = result.getJSONObject("item");
        if (item != null) {
            return item;
        }
        JSONArray items = result.getJSONArray("items");
        if (items != null && !items.isEmpty() && items.getJSONObject(0) != null) {
            return items.getJSONObject(0);
        }
        return new JSONObject();
    }

    private JSONObject contentOf(DramaRepository.VersionRow version) {
        if (version == null || !StringUtils.hasText(version.contentJson())) {
            return new JSONObject();
        }
        JSONObject content = JSON.parseObject(version.contentJson());
        return content == null ? new JSONObject() : content;
    }

    private DramaRepository.VersionRow latest(List<DramaRepository.VersionRow> versions, String stage) {
        DramaRepository.VersionRow found = null;
        for (DramaRepository.VersionRow version : versions) {
            if (stage.equals(version.stage()) && (found == null || version.versionNumber() > found.versionNumber())) {
                found = version;
            }
        }
        return found;
    }

    private String status(String status) {
        return STATUSES.contains(status) ? status : "pending";
    }

    private boolean open(String status) {
        return "pending".equals(status) || "running".equals(status);
    }

    private boolean duplicateTarget(Throwable error) {
        for (Throwable current = error; current != null; current = current.getCause()) {
            String message = current.getMessage();
            if (message != null && message.contains("uq_drama_media_open_target")) {
                return true;
            }
        }
        return false;
    }

    private String text(JSONObject item, String key) {
        if (item == null) {
            return "";
        }
        String value = item.getString(key);
        return value == null ? "" : value;
    }

    private String text(String value) {
        return value == null ? "" : value;
    }

    private void requireClientId(String clientRequestId) {
        if (clientRequestId == null || !clientRequestId.matches("[A-Za-z0-9-]{8,50}")) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "请求标识不合法");
        }
    }

    private <T> Mono<T> scope(ScopeAction<T> action) {
        return TeamScope.current().flatMap(scope -> currentUserProvider.currentUserId()
                .flatMap(userId -> action.run(userId, scope.teamId())));
    }

    private BusinessException invalid(String message) {
        return new BusinessException(ErrorCode.PARAM_INVALID, message);
    }

    private BusinessException missing() {
        return new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "短剧项目不存在");
    }

    @FunctionalInterface
    private interface ScopeAction<T> {
        Mono<T> run(long userId, long teamId);
    }
}
