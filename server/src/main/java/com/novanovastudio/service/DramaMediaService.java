package com.novanovastudio.service;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.ai.AiMediaSupport;
import com.novanovastudio.ai.AiTaskSources;
import com.novanovastudio.ai.GeneratedBinary;
import com.novanovastudio.ai.VideoGenerationMode;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.SystemMessage;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.dto.AiTaskDtos;
import com.novanovastudio.dto.DramaContracts;
import com.novanovastudio.dto.DramaDtos;
import com.novanovastudio.repository.DramaRepository;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.security.TeamScope;
import com.novanovastudio.storage.MediaAccessService;
import com.novanovastudio.storage.VideoCoverExtractor;
import java.nio.file.Files;
import java.nio.file.Path;
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

    /** 媒体库和对象存储。 */
    private final PersistenceService persistenceService;

    /** 应用配置，用于获取 FFmpeg 可执行路径。 */
    private final NovanovaProperties properties;

    /** 正在截取视频尾帧的任务防重表。 */
    private final ConcurrentHashMap<String, Boolean> extractingLastFrames = new ConcurrentHashMap<>();

    /**
     * 批量读取项目封面图，并按需签名可预览地址。
     *
     * @param projectIds 项目ID列表
     * @param teamId 团队空间
     * @return 按项目ID索引的封面记录
     */
    public Mono<Map<String, DramaRepository.ProjectCoverRow>> listFirstImageCovers(List<String> projectIds, long teamId) {
        return dramaRepository.findFirstImageCovers(projectIds, teamId)
                .flatMap(row -> {
                    String url = text(row.url());
                    Mono<String> signed = StringUtils.hasText(url)
                            ? mediaAccessService.signUrl(url, MediaAccessService.Purpose.PREVIEW)
                            : Mono.just("");
                    return signed.map(resolved -> new DramaRepository.ProjectCoverRow(row.projectId(), resolved, text(row.storageKey())));
                })
                .collectMap(DramaRepository.ProjectCoverRow::projectId);
    }

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
                    JSONObject shots = contentOf(latest(versions, "shot"));
                    JSONObject cast = contentOf(latest(versions, "cast"));
                    JSONObject plan = contentOf(latest(versions, "plan"));
                    DramaMediaTargets.Spec spec = DramaMediaTargets.resolve(request.targetKey(), contentOf(version), shots);
                    if (!spec.stage().equals(version.stage())) {
                        return Mono.error(invalid("请在对应阶段生成"));
                    }
                    return dramaRepository.listMedia(project.id(), teamId).collectList()
                            .flatMap(media -> {
                        if (media.stream().anyMatch(item -> request.targetKey().equals(item.targetKey()) && open(item.status()))) {
                            return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "这一项正在生成"));
                        }
                        return prompt(userId, project, request, spec, shots, cast, plan, media)
                                // 提示词 Agent 要跑十几秒，参考图可能在这期间才落库，写完再读一次
                                .flatMap(item -> dramaRepository.listMedia(project.id(), teamId).collectList().flatMap(fresh -> {
                            List<AiTaskDtos.AiTaskMediaReference> rawReferences = references(request.targetKey(), item.referenceKeys(), spec, shots, fresh);
                            Mono<List<String>> capabilitiesMono = "video".equals(spec.mediaType())
                                    ? aiTaskService.resolveModelCapabilities("video", request.model().trim())
                                    : Mono.just(List.of());
                            return capabilitiesMono.flatMap(capabilities -> {
                                String mode = resolveVideoMode(request.targetKey(), spec.mediaType(), rawReferences, capabilities);
                                List<AiTaskDtos.AiTaskMediaReference> references = adjustReferenceRolesForVideoMode(rawReferences, mode);
                                Map<String, Object> parameters = parameters(request, spec);
                                applyAspect(parameters, request.targetKey(), spec.mediaType(), project.aspectRatio());
                                AiTaskDtos.CreateAiTaskRequest taskRequest = new AiTaskDtos.CreateAiTaskRequest(spec.mediaType(), item.prompt(),
                                        request.model().trim(), parameters, references, null, AiTaskSources.DRAMA, null, null, mode);
                                return aiTaskService.createTask(taskRequest, created -> persist(userId, teamId, project.id(), version.id(), request, spec, item, created))
                                        .doOnNext(created -> log.info("短剧已提交媒体任务: projectId={}, target={}, mediaType={}, model={}, mode={}, taskId={}",
                                                project.id(), request.targetKey(), spec.mediaType(), request.model().trim(), mode, created.id()))
                                        .onErrorMap(error -> duplicateTarget(error) ? new BusinessException(ErrorCode.BUSINESS_ERROR, "这一项正在生成") : error)
                                        .then();
                            });
                        }));
                    });
                }));
    }

    /** 提示词必须来自 Agent：调用方带了就用，没带就让短剧提示词 Agent 现写。 */
    private Mono<DramaContracts.MediaItem> prompt(long userId, DramaRepository.ProjectRow project, DramaDtos.GenerateMediaRequest request,
                                                  DramaMediaTargets.Spec spec, JSONObject shots, JSONObject cast, JSONObject plan,
                                                  List<DramaRepository.MediaRow> media) {
        if (StringUtils.hasText(request.prompt())) {
            List<String> keys = request.referenceKeys() == null ? List.of() : request.referenceKeys().stream()
                    .filter(StringUtils::hasText).map(String::trim).toList();
            return Mono.just(new DramaContracts.MediaItem(request.targetKey(), request.prompt().trim(), keys));
        }
        return dramaMediaPromptService.write(new DramaMediaPromptService.Request(request.targetKey(), spec.mediaType(), spec.seconds(),
                shots, cast, plan, availableReferences(media), DramaArtifacts.normalizeAspect(project.aspectRatio()),
                project.textModel(), userId));
    }

    /** 已经生成成功、可以挂给模型的参考图目标。 */
    private List<String> availableReferences(List<DramaRepository.MediaRow> media) {
        List<String> keys = new ArrayList<>();
        for (DramaRepository.MediaRow row : media) {
            String key = row.targetKey();
            if (!"success".equals(row.status())
                    || (!StringUtils.hasText(row.storageKey()) && !StringUtils.hasText(row.resultUrl()))
                    || !StringUtils.hasText(key)) {
                continue;
            }
            if (!(key.startsWith("character:") || key.startsWith("location:")
                    || key.startsWith("shot-first:") || key.startsWith("shot-last:"))) {
                continue;
            }
            if (!keys.contains(key)) {
                keys.add(key);
            }
        }
        return keys;
    }

    /**
     * 删除项目之前收集已生成媒体，并尽量取消还没发出的生成任务。
     *
     * @param userId 用户ID
     * @param teamId 团队空间
     * @param projectId 项目ID
     * @return 待检查和回收的媒体键
     */
    public Mono<List<String>> collectGeneratedForDeletion(long userId, long teamId, String projectId) {
        return dramaRepository.listMedia(projectId, teamId).collectList()
                .flatMap(rows -> cancelOpenTasks(userId, rows).then(refresh(userId, teamId, rows)))
                .then(dramaRepository.listMedia(projectId, teamId).collectList())
                .map(this::storageKeys);
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

    /**
     * 在项目记录移除后登记未被其他内容引用的媒体。
     *
     * @param userId 所属用户
     * @param projectId 已删除的项目标识
     * @param storageKeys 待回收媒体
     * @return 登记完成信号
     */
    public Mono<Void> releaseGeneratedAfterDeletion(long userId, String projectId, List<String> storageKeys) {
        if (storageKeys.isEmpty()) return Mono.empty();
        log.info("检查已删除短剧的生成媒体：项目标识={}，候选数量={}", projectId, storageKeys.size());
        return persistenceService.deleteMediaForUser(userId, storageKeys);
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
        return Flux.fromIterable(rows).filter(row -> open(row.status()) || "failed".equals(row.status())).concatMap(row -> aiTaskService.getTaskForUser(userId, row.taskId())
                .flatMap(task -> syncMedia(userId, teamId, row, task))
                .onErrorResume(error -> {
                    log.warn("同步短剧媒体任务失败: mediaId={}, taskId={}, message={}", row.id(), row.taskId(), error.getMessage());
                    return Mono.empty();
                })).then();
    }

    /** 同步任务结果；转存对象存储失败时 AiMediaSupport 已回退登记原始链接，短剧直接保留原结果链接并标记成功。 */
    private Mono<Void> syncMedia(long userId, long teamId, DramaRepository.MediaRow row, AiTaskDtos.AiGenerationTaskResponse task) {
        String status = status(task.status());
        JSONObject item = firstItem(task.resultData());
        String url = text(item, "url");
        String storageKey = text(item, "storageKey");
        String mimeType = text(item, "mimeType");
        String error = SystemMessage.sanitizeUserMessage(task.errorMessage());
        if ("success".equals(status) && !StringUtils.hasText(url)) {
            status = "failed";
            error = StringUtils.hasText(error) ? error : "生成结果没有媒体地址";
        }
        String finalStatus = status;
        return writeMedia(teamId, row, finalStatus, url, storageKey, mimeType, "success".equals(finalStatus) ? "" : error)
                .then(Mono.defer(() -> "success".equals(finalStatus) && row.targetKey().startsWith("shot-video:")
                        ? ensureExtractedLastFrame(userId, teamId, row, url, storageKey)
                        : Mono.empty()));
    }

    /**
     * 镜头视频生成成功后，自动截取该视频尾帧并落库为 shot-last:<ref>，供下一镜自动作为首帧参考图。
     */
    private Mono<Void> ensureExtractedLastFrame(long userId, long teamId, DramaRepository.MediaRow videoRow,
                                                String videoUrl, String videoStorageKey) {
        String ref = DramaMediaTargets.ref(videoRow.targetKey());
        String lastKey = "shot-last:" + ref;
        String lockKey = videoRow.projectId() + ":" + lastKey + ":" + videoRow.taskId();
        if (extractingLastFrames.putIfAbsent(lockKey, Boolean.TRUE) != null) {
            return Mono.empty();
        }
        return dramaRepository.listMedia(videoRow.projectId(), teamId).collectList()
                .flatMap(existing -> {
                    boolean alreadyExtracted = existing.stream().anyMatch(item ->
                            lastKey.equals(item.targetKey())
                                    && videoRow.taskId().equals(item.taskId())
                                    && "success".equals(item.status()));
                    if (alreadyExtracted) {
                        return Mono.empty();
                    }
                    AiTaskDtos.AiTaskMediaReference videoRef = new AiTaskDtos.AiTaskMediaReference(
                            videoRow.id(), videoRow.targetKey(), "video/mp4", text(videoStorageKey), text(videoUrl), "reference_video");
                    return mediaSupport.resolveReferenceBinary(userId, videoRef, "video/mp4")
                            .flatMap(binary -> Mono.fromCallable(() -> extractLastFrameBytes(binary.data()))
                                    .subscribeOn(Schedulers.boundedElastic()))
                            .flatMap(frameBytes -> {
                                if (frameBytes == null || frameBytes.length == 0) {
                                    return Mono.<Void>empty();
                                }
                                return mediaSupport.storeGeneratedMedia(userId, "image", "drama-last-frame-" + ref + ".jpg",
                                                new GeneratedBinary(frameBytes, "image/jpeg"), null, null, null)
                                        .flatMap(stored -> {
                                            DramaRepository.MediaRow lastRow = new DramaRepository.MediaRow(
                                                    UUID.randomUUID().toString(),
                                                    videoRow.projectId(),
                                                    videoRow.versionId(),
                                                    lastKey,
                                                    "image",
                                                    videoRow.taskId(),
                                                    "extract-last-frame",
                                                    "自动截取自 " + videoRow.targetKey() + " 尾帧",
                                                    "success",
                                                    text(stored.url()),
                                                    text(stored.storageKey()),
                                                    "image/jpeg",
                                                    "",
                                                    OffsetDateTime.now());
                                            log.info("短剧视频尾帧自动截取完成: projectId={}, target={}, storageKey={}",
                                                    videoRow.projectId(), lastKey, stored.storageKey());
                                            return dramaRepository.insertMedia(teamId, userId, lastRow).then();
                                        });
                            });
                })
                .then()
                .onErrorResume(error -> {
                    log.warn("自动截取短剧视频尾帧失败: projectId={}, videoTarget={}, message={}",
                            videoRow.projectId(), videoRow.targetKey(), error.getMessage());
                    return Mono.empty();
                })
                .doFinally(signal -> extractingLastFrames.remove(lockKey));
    }

    private byte[] extractLastFrameBytes(byte[] videoBytes) throws Exception {
        if (videoBytes == null || videoBytes.length == 0) {
            return null;
        }
        Path tempVideo = Files.createTempFile("novanova-drama-video-", ".mp4");
        try {
            Files.write(tempVideo, videoBytes);
            String ffmpeg = properties.getAi().getVideoComposition().getFfmpegExecutable();
            return VideoCoverExtractor.extractLastFrame(tempVideo, ffmpeg);
        } finally {
            Files.deleteIfExists(tempVideo);
        }
    }

    private Mono<Void> writeMedia(long teamId, DramaRepository.MediaRow row, String status, String url, String storageKey, String mimeType, String error) {
        if (status.equals(row.status()) && url.equals(text(row.resultUrl())) && storageKey.equals(text(row.storageKey()))
                && error.equals(text(row.errorMessage()))) {
            return Mono.empty();
        }
        return dramaRepository.updateMedia(row.id(), teamId, status, url, storageKey, mimeType, error);
    }

    private Mono<DramaDtos.MediaView> view(long userId, DramaRepository.MediaRow row) {
        String url = text(row.resultUrl());
        return (StringUtils.hasText(url) ? mediaAccessService.signUrl(url, MediaAccessService.Purpose.PREVIEW) : Mono.just(""))
                .zipWith(mediaProgress(userId, row))
                .map(pair -> new DramaDtos.MediaView(row.id(), row.versionId(), row.targetKey(), row.mediaType(), row.taskId(), row.model(),
                        row.status(), pair.getT2(), pair.getT1(), text(row.storageKey()), text(row.mimeType()), SystemMessage.sanitizeUserMessage(text(row.errorMessage())),
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
     * 组装参考图。
     * <p>镜头视频：第 1 镜默认不强制首帧（若用户手动生成了自定义首帧则排首位），随后挂载角色与场景图；
     * 第 2~N 镜优先使用上一镜视频自动截取的尾帧作为首帧，同时挂载本镜的角色与场景图。</p>
     */
    private List<AiTaskDtos.AiTaskMediaReference> references(String targetKey, List<String> keys, DramaMediaTargets.Spec spec,
                                                             JSONObject shots, List<DramaRepository.MediaRow> media) {
        if (targetKey.startsWith("shot-video:")) {
            String ref = DramaMediaTargets.ref(targetKey);
            String previousRef = DramaMediaTargets.previousRef(shots, ref);
            List<AiTaskDtos.AiTaskMediaReference> videoRefs = new ArrayList<>();
            DramaRepository.MediaRow customFirst = usableMedia(media, "shot-first:" + ref);
            if (customFirst != null) {
                videoRefs.add(reference(customFirst, "first_frame"));
            } else if (StringUtils.hasText(previousRef)) {
                DramaRepository.MediaRow prevLast = usableMedia(media, "shot-last:" + previousRef);
                if (prevLast == null) {
                    throw invalid("请先生成上一镜（" + previousRef + "）的视频，完成后会自动截取尾帧作为本镜首帧");
                }
                videoRefs.add(reference(prevLast, "first_frame"));
            }
            JSONObject shot = findShot(shots, ref);
            if (shot != null) {
                String characterRef = text(shot, "characterRef");
                if (StringUtils.hasText(characterRef)) {
                    appendUniqueRef(videoRefs, usableMedia(media, "character:" + characterRef), "reference_image");
                }
                String locationRef = text(shot, "locationRef");
                if (StringUtils.hasText(locationRef)) {
                    appendUniqueRef(videoRefs, usableMedia(media, "location:" + locationRef), "reference_image");
                }
            }
            for (String key : keys) {
                if (key.startsWith("character:") || key.startsWith("location:")) {
                    appendUniqueRef(videoRefs, usableMedia(media, key), "reference_image");
                }
            }
            return videoRefs;
        }
        String fixedRole = "image".equals(spec.mediaType()) ? "reference_image" : null;
        List<AiTaskDtos.AiTaskMediaReference> references = new ArrayList<>();
        for (String key : DramaMediaTargets.requiredReferences(targetKey, shots)) {
            DramaRepository.MediaRow row = usableMedia(media, key);
            if (row == null) {
                throw invalid("缺少前置参考图: " + key);
            }
            references.add(reference(row, fixedRole));
        }
        for (String key : keys) {
            if (references.stream().anyMatch(item -> key.equals(item.name()))) {
                continue;
            }
            DramaRepository.MediaRow row = usableMedia(media, key);
            if (row != null) {
                references.add(reference(row, fixedRole));
            }
        }
        return references;
    }

    private void appendUniqueRef(List<AiTaskDtos.AiTaskMediaReference> target, DramaRepository.MediaRow row, String role) {
        if (row == null || target.stream().anyMatch(item -> row.targetKey().equals(item.name()))) {
            return;
        }
        target.add(reference(row, role));
    }

    private JSONObject findShot(JSONObject shots, String ref) {
        JSONArray array = shots == null ? null : shots.getJSONArray("shots");
        if (array == null) {
            return null;
        }
        for (int index = 0; index < array.size(); index++) {
            JSONObject item = array.getJSONObject(index);
            if (item != null && ref.equals(item.getString("ref"))) {
                return item;
            }
        }
        return null;
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

    private AiTaskDtos.AiTaskMediaReference reference(DramaRepository.MediaRow item, String role) {
        String mimeType = item.mimeType() != null && item.mimeType().startsWith("image/") ? item.mimeType() : "image/png";
        return new AiTaskDtos.AiTaskMediaReference(item.id(), item.targetKey(), mimeType, text(item.storageKey()), text(item.resultUrl()), role);
    }

    /**
     * 按分镜参考图数量与模型已启用能力决定视频生成模式：
     * <ul>
     *     <li>有首尾帧时优先使用首尾帧模式；若模型未开启首尾帧但开启了全能参考，则自动回退到全能参考。</li>
     *     <li>仅有首帧时优先使用图生视频；若模型未开启图生视频但开启了全能参考，同样回退到全能参考。</li>
     * </ul>
     *
     * @param targetKey String 目标键
     * @param mediaType String 媒体类型
     * @param references List<AiTaskMediaReference> 参考图列表
     * @param modelCapabilities List<String> 模型已启用的能力列表
     * @return String 视频生成模式；非视频目标返回 null
     */
    static String resolveVideoMode(String targetKey, String mediaType,
                                   List<AiTaskDtos.AiTaskMediaReference> references,
                                   List<String> modelCapabilities) {
        if (!"video".equals(mediaType)) {
            return null;
        }
        List<String> capabilities = modelCapabilities == null ? List.of() : modelCapabilities;
        boolean supportsFirstLast = capabilities.contains(VideoGenerationMode.FIRST_LAST_FRAME_TO_VIDEO);
        boolean supportsReference = capabilities.contains(VideoGenerationMode.REFERENCE_TO_VIDEO);
        boolean supportsImageToVideo = capabilities.contains(VideoGenerationMode.IMAGE_TO_VIDEO);
        if (targetKey.startsWith("shot-video:")) {
            if (references == null || references.isEmpty()) {
                return VideoGenerationMode.TEXT_TO_VIDEO;
            }
            boolean isPureFirstLastPair = references.size() == 2
                    && "first_frame".equals(references.get(0).role())
                    && "last_frame".equals(references.get(1).role());
            if (isPureFirstLastPair) {
                if (supportsFirstLast) {
                    return VideoGenerationMode.FIRST_LAST_FRAME_TO_VIDEO;
                }
                if (supportsReference) {
                    return VideoGenerationMode.REFERENCE_TO_VIDEO;
                }
                return VideoGenerationMode.FIRST_LAST_FRAME_TO_VIDEO;
            }
            if (references.size() >= 2) {
                if (supportsReference) {
                    return VideoGenerationMode.REFERENCE_TO_VIDEO;
                }
                if (supportsImageToVideo) {
                    return VideoGenerationMode.IMAGE_TO_VIDEO;
                }
                return VideoGenerationMode.REFERENCE_TO_VIDEO;
            }
            boolean onlyFirstFrame = "first_frame".equals(references.get(0).role());
            if (onlyFirstFrame) {
                if (supportsImageToVideo) {
                    return VideoGenerationMode.IMAGE_TO_VIDEO;
                }
                if (supportsReference) {
                    return VideoGenerationMode.REFERENCE_TO_VIDEO;
                }
                return VideoGenerationMode.IMAGE_TO_VIDEO;
            }
            if (supportsReference) {
                return VideoGenerationMode.REFERENCE_TO_VIDEO;
            }
            return supportsImageToVideo ? VideoGenerationMode.IMAGE_TO_VIDEO : VideoGenerationMode.REFERENCE_TO_VIDEO;
        }
        return references.isEmpty() ? VideoGenerationMode.TEXT_TO_VIDEO : VideoGenerationMode.IMAGE_TO_VIDEO;
    }

    /**
     * 当视频模式回退为全能参考时，把首尾帧角色统一转为 reference_image，兼容全能参考协议。
     *
     * @param references List<AiTaskMediaReference> 原始参考图列表
     * @param mode String 最终视频生成模式
     * @return List<AiTaskMediaReference> 适配角色后的参考图列表
     */
    static List<AiTaskDtos.AiTaskMediaReference> adjustReferenceRolesForVideoMode(
            List<AiTaskDtos.AiTaskMediaReference> references, String mode) {
        if (references == null || references.isEmpty()) {
            return references;
        }
        if (VideoGenerationMode.REFERENCE_TO_VIDEO.equals(mode)) {
            return references.stream()
                    .map(ref -> new AiTaskDtos.AiTaskMediaReference(
                            ref.id(), ref.name(), ref.mimeType(), ref.storageKey(), ref.url(), "reference_image"))
                    .toList();
        }
        if (VideoGenerationMode.IMAGE_TO_VIDEO.equals(mode) && references.size() > 1) {
            AiTaskDtos.AiTaskMediaReference first = references.get(0);
            return List.of(new AiTaskDtos.AiTaskMediaReference(
                    first.id(), first.name(), first.mimeType(), first.storageKey(), first.url(), "first_frame"));
        }
        return references;
    }

    private Map<String, Object> parameters(DramaDtos.GenerateMediaRequest request, DramaMediaTargets.Spec spec) {
        Map<String, Object> parameters = new LinkedHashMap<>();
        if (request.parameters() != null) {
            parameters.putAll(request.parameters());
        }
        parameters.remove("videoGenerationMode");
        if ("image".equals(spec.mediaType())) {
            parameters.put("count", 1);
            fill(parameters, "resolution", "2K");
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
