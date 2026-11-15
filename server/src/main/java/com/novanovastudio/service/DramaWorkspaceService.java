package com.novanovastudio.service;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.agent.AgentSessionService;
import com.novanovastudio.agent.CreationAgentRequestDispatcher;
import com.novanovastudio.agent.dto.AgentSession;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.DramaContracts;
import com.novanovastudio.dto.DramaDtos;
import com.novanovastudio.entity.CreationAgentRequest;
import com.novanovastudio.repository.CreationAgentRequestRepository;
import com.novanovastudio.repository.DramaRepository;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.security.TeamScope;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;
import org.springframework.transaction.reactive.TransactionalOperator;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 智能短剧项目、确认和对话入队。阶段产物由短剧处理器在请求执行时写入。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-14 00:40
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class DramaWorkspaceService {

    /** 当前用户。 */
    private final CurrentUserProvider currentUserProvider;

    /** 短剧仓储。 */
    private final DramaRepository dramaRepository;

    /** 主Agent请求仓储。 */
    private final CreationAgentRequestRepository requestRepository;

    /** 会话服务。 */
    private final AgentSessionService sessionService;

    /** 调度器，延迟获取以避免和编排器循环依赖。 */
    private final ObjectProvider<CreationAgentRequestDispatcher> dispatchers;

    /** 事务。 */
    private final TransactionalOperator transactionalOperator;

    /** 图片和视频生成记录。 */
    private final DramaMediaService dramaMediaService;

    /**
     * 创建项目并排队制作方案。
     *
     * @param request 创建请求
     * @return 工作台
     */
    public Mono<DramaDtos.WorkspaceResponse> createProject(DramaDtos.CreateProjectRequest request) {
        requireClientId(request.clientRequestId());
        String idea = request.ideaText() == null ? "" : request.ideaText().trim();
        String story = request.storyText() == null ? "" : request.storyText().trim();
        if (!StringUtils.hasText(idea) && !StringUtils.hasText(story)) {
            return Mono.error(invalid("请先写下创意或粘贴故事正文"));
        }
        return scope(user -> dramaRepository.insertClientRequest(request.clientRequestId(), user.teamId(), user.userId(), "create",
                        request.clientRequestId(), pending()).flatMap(inserted -> inserted
                        ? createNew(user, request.clientRequestId(), idea, story, request.textModel().trim(), DramaArtifacts.normalizeAspect(request.aspectRatio()))
                        : existing(user, request.clientRequestId())));
    }

    /**
     * 分页查询当前用户的短剧项目。
     *
     * @param page 页码
     * @param pageSize 每页数量
     * @return 项目页
     */
    public Mono<DramaDtos.ProjectListResponse> listProjects(int page, int pageSize) {
        int resolvedPage = Math.max(page, 1);
        int resolvedSize = Math.min(Math.max(pageSize, 1), 50);
        return scope(user -> dramaRepository.listProjects(user.userId(), user.teamId(), resolvedSize, (resolvedPage - 1) * resolvedSize).collectList()
                .zipWith(dramaRepository.countProjects(user.userId(), user.teamId()))
                .map(pair -> new DramaDtos.ProjectListResponse(pair.getT1().stream().map(this::summary).toList(), pair.getT2() == null ? 0 : pair.getT2())));
    }

    /**
     * 读取工作台。
     *
     * @param projectId 项目ID
     * @return 项目、版本和活动请求
     */
    public Mono<DramaDtos.WorkspaceResponse> getWorkspace(String projectId) {
        return scope(user -> workspace(user, projectId));
    }

    /**
     * 修改名称、后续使用的文本模型，以及制作方案里的目标时长。
     *
     * @param request 修改请求
     * @return 更新后的工作台
     */
    public Mono<DramaDtos.WorkspaceResponse> updateProject(DramaDtos.UpdateProjectRequest request) {
        return scope(user -> dramaRepository.findProject(user.userId(), user.teamId(), request.projectId())
                .switchIfEmpty(Mono.error(missing())).flatMap(project -> {
                    if (project.revision() != request.revision()) {
                        return Mono.error(conflict());
                    }
                    int duration = request.durationSeconds() == null ? project.durationSeconds() : request.durationSeconds();
                    String aspect = DramaArtifacts.normalizeAspect(StringUtils.hasText(request.aspectRatio()) ? request.aspectRatio() : project.aspectRatio());
                    if (duration == project.durationSeconds()) {
                        return dramaRepository.updateSettings(user.userId(), user.teamId(), project.id(), project.revision(),
                                request.name().trim(), request.textModel().trim(), duration, aspect).flatMap(updated -> updated ? workspace(user, project.id()) : Mono.error(conflict()));
                    }
                    return requireIdle(project).then(changeDuration(user, project, request.name().trim(), request.textModel().trim(), duration, aspect));
                }));
    }

    /**
     * 确认指定版本并排队下一阶段。末阶段确认后项目完成。
     *
     * @param request 确认请求
     * @return 工作台
     */
    public Mono<DramaDtos.WorkspaceResponse> confirmStage(DramaDtos.ConfirmStageRequest request) {
        requireClientId(request.clientRequestId());
        return scope(user -> dramaRepository.insertClientRequest(request.clientRequestId(), user.teamId(), user.userId(), "confirm",
                        request.projectId(), pending()).flatMap(inserted -> inserted
                        ? confirmNow(user, request, "")
                        : existing(user, request.clientRequestId())));
    }

    /**
     * 自然语言确认走和按钮相同的确认，并替换当前这条对话请求。
     *
     * @param userId 用户ID
     * @param teamId 团队空间
     * @param projectId 项目ID
     * @param runningRequestId 正在执行的对话请求
     * @return 完成信号
     */
    public Mono<Void> confirmFromAgent(long userId, long teamId, String projectId, String runningRequestId) {
        User user = new User(userId, teamId);
        String clientRequestId = runningRequestId + ":confirm";
        return dramaRepository.insertClientRequest(clientRequestId, teamId, userId, "confirm", projectId, pending())
                .flatMap(inserted -> inserted ? confirmNow(user, new DramaDtos.ConfirmStageRequest(clientRequestId, projectId, 0, ""), runningRequestId).then()
                        : Mono.empty());
    }

    /**
     * 发送对话。同一项目有请求在跑时拒绝。
     *
     * @param request 对话请求
     * @return 工作台
     */
    public Mono<DramaDtos.WorkspaceResponse> sendMessage(DramaDtos.SendMessageRequest request) {
        requireClientId(request.clientRequestId());
        return scope(user -> requestRepository.findByIdForUser(user.userId(), request.clientRequestId())
                .flatMap(existing -> workspace(user, request.projectId()))
                .switchIfEmpty(Mono.defer(() -> dramaRepository.findProject(user.userId(), user.teamId(), request.projectId())
                        .switchIfEmpty(Mono.error(missing()))
                        .flatMap(project -> {
                            if (project.revision() != request.revision()) {
                                return Mono.error(conflict());
                            }
                            return dramaRepository.claimActive(user.userId(), user.teamId(), project.id(), project.revision(),
                                            request.clientRequestId(), "").flatMap(claimed -> {
                                        if (!claimed) {
                                            return Mono.error(busy());
                                        }
                                        JSONObject payload = turn("converse", project.id(), project.currentStage(), request.message().trim(), request.viewedStage());
                                        payload.put("imageModel", request.imageModel() == null ? "" : request.imageModel());
                                        payload.put("videoModel", request.videoModel() == null ? "" : request.videoModel());
                                        payload.put("imageQuality", request.imageQuality() == null ? "" : request.imageQuality());
                                        payload.put("imageResolution", request.imageResolution() == null ? "" : request.imageResolution());
                                        payload.put("videoResolution", request.videoResolution() == null ? "" : request.videoResolution());
                                        return sessionService.appendUserMessage(project.sessionId(), UUID.randomUUID().toString(), request.message().trim())
                                                .then(enqueue(user, project, request.clientRequestId(), payload))
                                                .then(workspace(user, project.id()));
                                    });
                        }))));
    }

    /**
     * 按主 Agent 给出的 media.items 提交图片或视频。不从用户原话里猜范围。
     *
     * @param userId 用户ID
     * @param teamId 团队空间
     * @param project 项目
     * @param requestId 对话请求ID
     * @param raw 导演结果
     * @param payload 入队时保存的模型参数
     * @return 完成信号
     */
    public Mono<Void> executeMediaPlan(long userId, long teamId, DramaRepository.ProjectRow project, String requestId, JSONObject raw, JSONObject payload) {
        User user = new User(userId, teamId);
        JSONObject plan = raw == null ? null : raw.getJSONObject("media");
        com.alibaba.fastjson2.JSONArray items = plan == null ? null : plan.getJSONArray("items");
        List<DramaContracts.MediaItem> requested = new ArrayList<>();
        if (items != null) {
            for (int index = 0; index < items.size(); index++) {
                JSONObject entry = items.getJSONObject(index);
                if (entry == null || !StringUtils.hasText(entry.getString("targetKey"))) {
                    continue;
                }
                List<String> referenceKeys = new ArrayList<>();
                com.alibaba.fastjson2.JSONArray refs = entry.getJSONArray("referenceKeys");
                if (refs != null) {
                    for (int refIndex = 0; refIndex < refs.size(); refIndex++) {
                        String key = refs.getString(refIndex);
                        if (StringUtils.hasText(key) && !referenceKeys.contains(key.trim())) {
                            referenceKeys.add(key.trim());
                        }
                    }
                }
                requested.add(new DramaContracts.MediaItem(entry.getString("targetKey").trim(), entry.getString("prompt"), referenceKeys));
            }
        }
        com.alibaba.fastjson2.JSONArray legacyKeys = plan == null ? null : plan.getJSONArray("targetKeys");
        if (requested.isEmpty() && legacyKeys != null) {
            for (int index = 0; index < legacyKeys.size(); index++) {
                String key = legacyKeys.getString(index);
                if (StringUtils.hasText(key)) {
                    requested.add(new DramaContracts.MediaItem(key.trim(), null, List.of()));
                }
            }
        }
        boolean regenerate = plan != null && Boolean.TRUE.equals(plan.getBoolean("regenerate"));
        if (requested.isEmpty()) {
            return dramaRepository.clearActive(project.id(), requestId);
        }
        return dramaRepository.listVersions(project.id(), teamId).collectList()
                .flatMap(versions -> dramaRepository.listMedia(project.id(), teamId).collectList().flatMap(media -> {
                    JSONObject cast = contentOf(latest(versions, "cast"));
                    JSONObject storyboard = contentOf(latest(versions, "storyboard"));
                    List<String> keys = plannedKeys(requested.stream().map(DramaContracts.MediaItem::targetKey).toList(),
                            regenerate, cast, storyboard, media);
                    if (keys.isEmpty()) {
                        return dramaRepository.clearActive(project.id(), requestId);
                    }
                    boolean video = keys.stream().anyMatch(key -> key.startsWith("shot-video:"));
                    boolean image = keys.stream().anyMatch(key -> !key.startsWith("shot-video:"));
                    String imageModel = payload == null ? "" : payload.getString("imageModel");
                    String videoModel = payload == null ? "" : payload.getString("videoModel");
                    if ((video && !StringUtils.hasText(videoModel)) || (image && !StringUtils.hasText(imageModel))) {
                        String reply = video && !StringUtils.hasText(videoModel) ? "请先在右侧选择视频模型。" : "请先在右侧选择图片模型。";
                        return sessionService.appendAssistantMessage(project.sessionId(), UUID.randomUUID().toString(), reply)
                                .then(dramaRepository.clearActive(project.id(), requestId));
                    }
                    String castVersion = latest(versions, "cast") == null ? "" : latest(versions, "cast").id();
                    String storyboardVersion = latest(versions, "storyboard") == null ? "" : latest(versions, "storyboard").id();
                    List<DramaMediaCommands.NameTarget> catalog = new ArrayList<>();
                    catalog.addAll(namedTargets(cast, "characters", "character:"));
                    catalog.addAll(namedTargets(cast, "locations", "location:"));
                    return Flux.fromIterable(keys).concatMap(key -> submitChatMedia(project, payload, itemOf(requested, key), castVersion, storyboardVersion)
                                    .onErrorResume(error -> Mono.just("")))
                            .collectList()
                            .flatMap(startedKeys -> {
                                List<String> started = startedKeys.stream().filter(StringUtils::hasText).toList();
                                return rememberChatMedia(user, project, requestId, started, catalog, cast, storyboard)
                                        .then(dramaRepository.clearActive(project.id(), requestId));
                            });
                }));
    }

    private Mono<String> submitChatMedia(DramaRepository.ProjectRow project, JSONObject payload, DramaContracts.MediaItem item,
                                         String castVersion, String storyboardVersion) {
        String targetKey = item.targetKey();
        boolean video = targetKey.startsWith("shot-video:");
        String versionId = targetKey.startsWith("character:") || targetKey.startsWith("location:") ? castVersion : storyboardVersion;
        if (!StringUtils.hasText(versionId)) {
            return Mono.error(invalid(video ? "还没有分镜，不能生成视频" : "还没有对应阶段的内容"));
        }
        Map<String, Object> parameters = new LinkedHashMap<>();
        if (video) {
            String resolution = payload == null ? "" : payload.getString("videoResolution");
            parameters.put("resolution", StringUtils.hasText(resolution) ? resolution : "720p");
            parameters.put("watermark", false);
        } else {
            String quality = payload == null ? "" : payload.getString("imageQuality");
            String resolution = payload == null ? "" : payload.getString("imageResolution");
            parameters.put("count", 1);
            parameters.put("quality", StringUtils.hasText(quality) ? quality : "medium");
            parameters.put("resolution", StringUtils.hasText(resolution) ? resolution : "2K");
            parameters.put("size", targetKey.startsWith("sheet:") ? "16:9" : targetKey.startsWith("character:") ? "3:2" : project.aspectRatio());
        }
        String model = payload == null ? "" : payload.getString(video ? "videoModel" : "imageModel");
        return dramaMediaService.generate(new DramaDtos.GenerateMediaRequest(UUID.randomUUID().toString(), project.id(), versionId, targetKey,
                model.trim(), parameters, item.prompt(), item.referenceKeys())).thenReturn(targetKey);
    }

    /** 取该目标的提示词；主 Agent 没写时留空，由服务端的短剧提示词 Agent 现写。 */
    private DramaContracts.MediaItem itemOf(List<DramaContracts.MediaItem> items, String key) {
        return items.stream().filter(item -> key.equals(item.targetKey())).findFirst()
                .orElse(new DramaContracts.MediaItem(key, null, List.of()));
    }

    private Mono<Void> rememberChatMedia(User user, DramaRepository.ProjectRow project, String clientRequestId, List<String> keys, List<DramaMediaCommands.NameTarget> catalog, JSONObject cast, JSONObject storyboard) {
        if (keys.isEmpty()) {
            return Mono.empty();
        }
        return dramaRepository.listMedia(project.id(), user.teamId()).collectList().flatMap(rows -> {
            com.alibaba.fastjson2.JSONArray tasks = new com.alibaba.fastjson2.JSONArray();
            for (String key : keys) {
                DramaRepository.MediaRow row = rows.stream().filter(item -> key.equals(item.targetKey()) && StringUtils.hasText(item.taskId())).findFirst().orElse(null);
                if (row == null) {
                    continue;
                }
                com.alibaba.fastjson2.JSONObject task = new com.alibaba.fastjson2.JSONObject();
                task.put("taskId", row.taskId());
                task.put("name", mediaLabel(key, catalog, cast, storyboard));
                tasks.add(task);
            }
            if (tasks.isEmpty()) {
                return Mono.empty();
            }
            com.alibaba.fastjson2.JSONObject result = new com.alibaba.fastjson2.JSONObject();
            result.put("tasks", tasks);
            result.put("notified", false);
            return dramaRepository.insertClientRequest(clientRequestId, user.teamId(), user.userId(), "chat-media", project.id(), result.toJSONString()).then();
        });
    }

    private Mono<Void> notifyFinishedChat(User user, DramaRepository.ProjectRow project, List<DramaDtos.MediaView> media) {
        return dramaRepository.listChatMedia(project.id(), user.userId(), user.teamId()).concatMap(batch -> {
            com.alibaba.fastjson2.JSONObject result = JSON.parseObject(batch.result());
            if (result == null || result.getBooleanValue("notified")) {
                return Mono.empty();
            }
            com.alibaba.fastjson2.JSONArray tasks = result.getJSONArray("tasks");
            if (tasks == null || tasks.isEmpty()) {
                return Mono.empty();
            }
            List<String> names = new ArrayList<>();
            List<String> statuses = new ArrayList<>();
            for (int index = 0; index < tasks.size(); index++) {
                com.alibaba.fastjson2.JSONObject task = tasks.getJSONObject(index);
                if (task == null) {
                    continue;
                }
                String taskId = task.getString("taskId");
                DramaDtos.MediaView item = media.stream().filter(row -> taskId != null && taskId.equals(row.taskId())).findFirst().orElse(null);
                if (item == null || "pending".equals(item.status()) || "running".equals(item.status())) {
                    return Mono.empty();
                }
                names.add(task.getString("name"));
                statuses.add(item.status());
            }
            if (names.isEmpty()) {
                return Mono.empty();
            }
            result.put("notified", true);
            return dramaRepository.finishChatMedia(batch.id(), result.toJSONString())
                    .flatMap(updated -> Boolean.TRUE.equals(updated)
                            ? sessionService.appendAssistantMessage(project.sessionId(), UUID.randomUUID().toString(), DramaMediaCommands.completionReply(names, statuses))
                            : Mono.empty());
        }).then().onErrorResume(error -> {
            log.warn("短剧生成完成反馈失败: projectId={}, message={}", project.id(), error.getMessage());
            return Mono.empty();
        });
    }

    private List<String> plannedKeys(List<String> requested, boolean regenerate, JSONObject cast, JSONObject storyboard, List<DramaRepository.MediaRow> media) {
        java.util.Set<String> allowed = new java.util.LinkedHashSet<>();
        allowed.addAll(prefixed("character:", refs(cast, "characters")));
        allowed.addAll(prefixed("location:", refs(cast, "locations")));
        allowed.addAll(prefixed("board:", refs(storyboard, "shots")));
        allowed.addAll(prefixed("sheet:", refs(storyboard, "shots")));
        allowed.addAll(prefixed("shot-video:", refs(storyboard, "shots")));
        List<String> keys = new ArrayList<>();
        for (String key : requested) {
            if (!allowed.contains(key) || keys.contains(key)) {
                continue;
            }
            DramaRepository.MediaRow latest = media.stream().filter(item -> key.equals(item.targetKey())).findFirst().orElse(null);
            if (latest != null && ("pending".equals(latest.status()) || "running".equals(latest.status()))) {
                continue;
            }
            if (latest != null && "success".equals(latest.status()) && !regenerate) {
                continue;
            }
            keys.add(key);
        }
        return keys;
    }

    private static List<String> prefixed(String prefix, List<String> values) {
        return values.stream().map(value -> prefix + value).toList();
    }

    private static List<String> refs(JSONObject content, String field) {
        List<String> refs = new ArrayList<>();
        com.alibaba.fastjson2.JSONArray items = content == null ? null : content.getJSONArray(field);
        if (items == null) {
            return refs;
        }
        for (int index = 0; index < items.size(); index++) {
            com.alibaba.fastjson2.JSONObject item = items.getJSONObject(index);
            if (item != null && StringUtils.hasText(item.getString("ref"))) {
                refs.add(item.getString("ref"));
            }
        }
        return refs;
    }

    private static String mediaLabel(String key, List<DramaMediaCommands.NameTarget> catalog, JSONObject cast, JSONObject storyboard) {
        for (DramaMediaCommands.NameTarget entry : catalog) {
            if (key.equals(entry.key()) && StringUtils.hasText(entry.name())) {
                return entry.name();
            }
        }
        String ref = key.substring(key.lastIndexOf(':') + 1);
        com.alibaba.fastjson2.JSONArray shots = storyboard == null ? null : storyboard.getJSONArray("shots");
        if (shots != null) {
            for (int index = 0; index < shots.size(); index++) {
                com.alibaba.fastjson2.JSONObject shot = shots.getJSONObject(index);
                if (shot == null || !ref.equals(shot.getString("ref"))) {
                    continue;
                }
                String characterRef = shot.getString("characterRef");
                for (DramaMediaCommands.NameTarget entry : catalog) {
                    if (("character:" + characterRef).equals(entry.key()) && StringUtils.hasText(entry.name())) {
                        return entry.name();
                    }
                }
            }
        }
        if (key.startsWith("shot-video:")) {
            return ref + " 的视频";
        }
        return "分镜 " + ref;
    }

    private static List<DramaMediaCommands.NameTarget> namedTargets(JSONObject content, String field, String prefix) {
        List<DramaMediaCommands.NameTarget> targets = new ArrayList<>();
        com.alibaba.fastjson2.JSONArray items = content == null ? null : content.getJSONArray(field);
        if (items == null) {
            return targets;
        }
        for (int index = 0; index < items.size(); index++) {
            com.alibaba.fastjson2.JSONObject item = items.getJSONObject(index);
            if (item != null && StringUtils.hasText(item.getString("name")) && StringUtils.hasText(item.getString("ref"))) {
                targets.add(new DramaMediaCommands.NameTarget(item.getString("name"), prefix + item.getString("ref")));
            }
        }
        return targets;
    }

    /**
     * 删除项目，并删除该项目已经生成的图片和视频。进行中的文本请求需要先停止。
     *
     * @param request 删除请求
     * @return 完成信号
     */
    public Mono<Void> deleteProject(DramaDtos.DeleteProjectRequest request) {
        return scope(user -> dramaRepository.findProject(user.userId(), user.teamId(), request.projectId())
                .switchIfEmpty(Mono.error(missing())).flatMap(project -> {
                    if (project.revision() != request.revision()) {
                        return Mono.error(conflict());
                    }
                    return requireIdle(project)
                            .then(dramaMediaService.deleteGenerated(user.userId(), user.teamId(), project.id()))
                            .then(dramaRepository.deleteProject(user.userId(), user.teamId(), project.id(), project.revision()))
                            .flatMap(deleted -> deleted ? dramaRepository.deleteSession(project.sessionId(), user.userId()) : Mono.error(conflict()));
                })).then();
    }

    /**
     * 保存模型生成的新版本，并把进度放到这个阶段。
     *
     * @param userId 用户ID
     * @param teamId 团队空间
     * @param projectId 项目ID
     * @param requestId 来源请求
     * @param stage 阶段
     * @param raw 导演结果
     * @param userMessage 用户原话，用来判断是否允许缩短分镜
     * @return 完成信号
     */
    public Mono<Void> applyGeneratedVersion(long userId, long teamId, String projectId, String requestId, String stage, JSONObject raw, String userMessage) {
        User user = new User(userId, teamId);
        return dramaRepository.findProject(userId, teamId, projectId).switchIfEmpty(Mono.error(missing()))
                .flatMap(project -> dramaRepository.listVersions(projectId, teamId).collectList().flatMap(versions -> {
                    DramaStageRules.index(stage);
                    if (!DramaStageRules.canRevise(project.currentStage(), stage, latest(versions, stage) != null)
                            && !stage.equals(project.currentStage())) {
                        return Mono.error(invalid("还不能修改尚未开始的阶段"));
                    }
                    JSONObject content = DramaArtifacts.normalize(stage, raw, contentOf(latest(versions, stage)),
                            contentOf(latest(versions, "cast")), contentOf(latest(versions, "storyboard")), project.durationSeconds(), project.aspectRatio(), userMessage);
                    return storeVersion(user, project, versions, stage, requestId, content, true);
                }));
    }

    private Mono<DramaDtos.WorkspaceResponse> createNew(User user, String clientRequestId, String idea, String story, String textModel, String aspectRatio) {
        String requestId = clientRequestId + ":plan";
        String name = defaultName(idea, story);
        OffsetDateTime now = OffsetDateTime.now();
        return sessionService.createSession(user.userId(), DramaStageRules.ENTRY).flatMap(session -> {
            DramaRepository.ProjectRow project = new DramaRepository.ProjectRow(clientRequestId, user.teamId(), user.userId(), name,
                    idea, story, textModel, session.id(), "plan", "active", 1, requestId, 60, aspectRatio, BigDecimal.ZERO, now, now);
            String opening = StringUtils.hasText(story) ? idea + (StringUtils.hasText(idea) ? "\n" : "") + story : idea;
            return dramaRepository.insertProject(project)
                    .then(sessionService.persist(new AgentSession(session.id(), user.userId(), name, DramaStageRules.ENTRY, List.of(), now, now)))
                    .then(sessionService.appendUserMessage(session.id(), UUID.randomUUID().toString(), opening))
                    .then(enqueue(user, project, requestId, turn("generate", project.id(), "plan", opening, "plan")))
                    .then(dramaRepository.saveClientResult(clientRequestId, project.id(), done(project.id(), requestId)))
                    .then(workspace(user, project.id()));
        });
    }

    private Mono<DramaDtos.WorkspaceResponse> confirmNow(User user, DramaDtos.ConfirmStageRequest request, String replacingRequestId) {
        return dramaRepository.findProject(user.userId(), user.teamId(), request.projectId()).switchIfEmpty(Mono.error(missing()))
                .flatMap(project -> dramaRepository.listVersions(project.id(), user.teamId()).collectList().flatMap(versions -> {
                    DramaRepository.VersionRow current = latest(versions, project.currentStage());
                    String versionId = StringUtils.hasText(request.versionId()) ? request.versionId() : current == null ? "" : current.id();
                    if (current == null || !current.id().equals(versionId) || !"pending".equals(current.confirmationStatus())) {
                        return Mono.error(invalid("请确认当前阶段的最新版本"));
                    }
                    if (request.revision() > 0 && project.revision() != request.revision() && !StringUtils.hasText(replacingRequestId)) {
                        return Mono.error(conflict());
                    }
                    Mono<Void> idle = StringUtils.hasText(replacingRequestId) ? Mono.empty() : requireIdle(project);
                    String next = DramaStageRules.next(project.currentStage());
                    String requestId = request.clientRequestId() + ":next";
                    return idle.then(transactionalOperator.transactional(dramaRepository.confirmVersion(project.id(), current.id()).flatMap(confirmed -> {
                        if (!confirmed) {
                            return Mono.error(conflict());
                        }
                        if (next == null) {
                            return dramaRepository.saveProgress(user.userId(), user.teamId(), project.id(), project.revision(),
                                    project.currentStage(), "completed", "", project.durationSeconds(), project.name()).flatMap(this::requireUpdated);
                        }
                        JSONObject payload = turn("generate", project.id(), next, "", next);
                        return dramaRepository.saveProgress(user.userId(), user.teamId(), project.id(), project.revision(),
                                        next, "active", requestId, project.durationSeconds(), project.name()).flatMap(this::requireUpdated)
                                .then(insertRequest(user, project.sessionId(), requestId, payload));
                    }))).then(next == null ? Mono.empty() : dispatch(user, project.sessionId(), requestId))
                            .then(dramaRepository.saveClientResult(request.clientRequestId(), project.id(), done(project.id(), next == null ? "" : requestId)))
                            .then(workspace(user, project.id()));
                }));
    }

    private Mono<DramaDtos.WorkspaceResponse> changeDuration(User user, DramaRepository.ProjectRow project, String name, String textModel, int duration, String aspectRatio) {
        return dramaRepository.listVersions(project.id(), user.teamId()).collectList().flatMap(versions -> {
            DramaRepository.VersionRow plan = latest(versions, "plan");
            if (plan == null) {
                return dramaRepository.updateSettings(user.userId(), user.teamId(), project.id(), project.revision(), name, textModel, duration, aspectRatio)
                        .flatMap(updated -> updated ? workspace(user, project.id()) : Mono.error(conflict()));
            }
            JSONObject content = JSON.parseObject(plan.contentJson());
            content.put("durationSeconds", duration);
            content.put("aspectRatio", aspectRatio);
            DramaRepository.ProjectRow renamed = new DramaRepository.ProjectRow(project.id(), project.teamId(), project.userId(), name,
                    project.ideaText(), project.storyText(), textModel, project.sessionId(), "plan", "active", project.revision(),
                    project.activeRequestId(), duration, aspectRatio, project.textCredits(), project.createdAt(), project.updatedAt());
            return storeVersion(user, renamed, versions, "plan", "", content, false).then(Mono.defer(() ->
                    dramaRepository.updateSettings(user.userId(), user.teamId(), project.id(), project.revision() + 1, name, textModel, duration, aspectRatio)
                            .flatMap(ignored -> workspace(user, project.id()))));
        });
    }

    private Mono<Void> storeVersion(User user, DramaRepository.ProjectRow project, List<DramaRepository.VersionRow> versions, String stage,
                                    String requestId, JSONObject content, boolean fromModel) {
        DramaRepository.VersionRow previous = latest(versions, stage);
        int number = previous == null ? 1 : previous.versionNumber() + 1;
        String name = project.name();
        if (fromModel && "plan".equals(stage) && previous == null && StringUtils.hasText(content.getString("title"))) {
            name = clip(content.getString("title"), 120);
        }
        Integer planDuration = content.getInteger("durationSeconds");
        int duration = "plan".equals(stage) && planDuration != null ? planDuration : project.durationSeconds();
        if ("plan".equals(stage)) {
            content.put("aspectRatio", DramaArtifacts.normalizeAspect(project.aspectRatio()));
        }
        DramaRepository.VersionRow version = new DramaRepository.VersionRow(UUID.randomUUID().toString(), project.id(), stage, number,
                baseline(versions, stage).toJSONString(), content.toJSONString(), "pending", "current", requestId, null, OffsetDateTime.now());
        String finalName = name;
        return transactionalOperator.transactional(dramaRepository.insertVersion(version, user.teamId())
                .then(Flux.fromIterable(DramaStageRules.downstream(stage)).concatMap(item -> dramaRepository.markLatestStale(project.id(), item)).then())
                .then(dramaRepository.saveProgress(user.userId(), user.teamId(), project.id(), project.revision(), stage, "active",
                        "", duration, finalName).flatMap(this::requireUpdated).then()));
    }

    private Mono<Void> enqueue(User user, DramaRepository.ProjectRow project, String requestId, JSONObject payload) {
        return insertRequest(user, project.sessionId(), requestId, payload).then(dispatch(user, project.sessionId(), requestId));
    }

    private Mono<Void> insertRequest(User user, String sessionId, String requestId, JSONObject payload) {
        return requestRepository.findById(requestId).switchIfEmpty(Mono.defer(() -> {
            CreationAgentRequest request = new CreationAgentRequest();
            request.setId(requestId);
            request.setUserId(user.userId());
            request.setTeamId(user.teamId());
            request.setSessionId(sessionId);
            request.setEntrySource(DramaStageRules.ENTRY);
            request.setRequestData(payload.toJSONString());
            request.setStatus("queued");
            request.setCreatedAt(OffsetDateTime.now());
            return requestRepository.create(request).then(requestRepository.findById(requestId));
        })).then();
    }

    private Mono<Void> dispatch(User user, String sessionId, String requestId) {
        return requestRepository.findById(requestId).flatMap(request -> {
            request.setTeamId(user.teamId());
            log.info("短剧请求入队: projectSession={}, requestId={}, stage={}", sessionId, requestId, request.getRequestData());
            return dispatchers.getObject().enqueue(request);
        });
    }

    private Mono<DramaDtos.WorkspaceResponse> existing(User user, String clientRequestId) {
        return dramaRepository.findClientRequest(clientRequestId, user.userId(), user.teamId())
                .switchIfEmpty(Mono.error(invalid("请勿重复提交")))
                .flatMap(result -> {
                    String projectId = result.getString("projectId");
                    if (!StringUtils.hasText(projectId)) {
                        return Mono.error(invalid("请勿重复提交"));
                    }
                    return workspace(user, projectId);
                });
    }

    private Mono<DramaDtos.WorkspaceResponse> workspace(User user, String projectId) {
        return dramaRepository.findProject(user.userId(), user.teamId(), projectId).switchIfEmpty(Mono.error(missing()))
                .flatMap(project -> dramaRepository.listVersions(project.id(), user.teamId()).collectList()
                        .flatMap(versions -> dramaMediaService.list(user.userId(), user.teamId(), project.id())
                                .flatMap(media -> notifyFinishedChat(user, project, media)
                                        .then(active(project).map(active -> new DramaDtos.WorkspaceResponse(detail(project),
                                        versions.stream().map(this::versionView).toList(), active, media))))));
    }

    private Mono<DramaDtos.ActiveRequest> active(DramaRepository.ProjectRow project) {
        if (!StringUtils.hasText(project.activeRequestId())) {
            return Mono.just(new DramaDtos.ActiveRequest("", "", ""));
        }
        return requestRepository.findById(project.activeRequestId())
                .map(request -> new DramaDtos.ActiveRequest(request.getId(), request.getStatus(),
                        request.getErrorMessage() == null ? "" : request.getErrorMessage()))
                .defaultIfEmpty(new DramaDtos.ActiveRequest(project.activeRequestId(), "", ""));
    }

    private Mono<Void> requireIdle(DramaRepository.ProjectRow project) {
        if (!StringUtils.hasText(project.activeRequestId())) {
            return Mono.empty();
        }
        return requestRepository.findById(project.activeRequestId()).flatMap(request ->
                "queued".equals(request.getStatus()) || "running".equals(request.getStatus()) ? Mono.error(busy()) : Mono.<Void>empty());
    }

    private Mono<Boolean> requireUpdated(Boolean updated) {
        return Boolean.TRUE.equals(updated) ? Mono.just(true) : Mono.error(conflict());
    }

    private DramaDtos.ProjectView summary(DramaRepository.ProjectRow project) {
        return new DramaDtos.ProjectView(project.id(), project.name(), project.currentStage(), project.status(), project.revision(),
                project.textModel(), project.textCredits(), project.durationSeconds(), DramaArtifacts.normalizeAspect(project.aspectRatio()), text(project.updatedAt()));
    }

    private DramaDtos.ProjectDetail detail(DramaRepository.ProjectRow project) {
        return new DramaDtos.ProjectDetail(project.id(), project.name(), project.ideaText(), project.storyText(), project.textModel(),
                project.sessionId(), project.currentStage(), project.status(), project.revision(), project.durationSeconds(),
                DramaArtifacts.normalizeAspect(project.aspectRatio()), project.textCredits(), text(project.updatedAt()));
    }

    private DramaDtos.VersionView versionView(DramaRepository.VersionRow version) {
        JSONObject content = JSON.parseObject(version.contentJson());
        return new DramaDtos.VersionView(version.id(), version.stage(), version.versionNumber(), version.confirmationStatus(),
                version.freshness(), content == null ? new JSONObject() : content, text(version.createdAt()), text(version.confirmedAt()));
    }

    private JSONObject baseline(List<DramaRepository.VersionRow> versions, String stage) {
        JSONObject baseline = new JSONObject();
        for (String item : DramaStageRules.ORDER) {
            if (item.equals(stage)) {
                break;
            }
            DramaRepository.VersionRow latest = latest(versions, item);
            if (latest != null) {
                baseline.put(item, latest.id());
            }
        }
        return baseline;
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

    private JSONObject contentOf(DramaRepository.VersionRow version) {
        return version == null ? null : JSON.parseObject(version.contentJson());
    }

    private JSONObject turn(String kind, String projectId, String stage, String message, String viewedStage) {
        JSONObject payload = new JSONObject();
        payload.put("kind", kind);
        payload.put("projectId", projectId);
        payload.put("stage", stage);
        payload.put("message", message == null ? "" : message);
        payload.put("viewedStage", StringUtils.hasText(viewedStage) ? viewedStage : stage);
        return payload;
    }

    private <T> Mono<T> scope(java.util.function.Function<User, Mono<T>> action) {
        return TeamScope.current().flatMap(scope -> currentUserProvider.currentUserId()
                .flatMap(userId -> action.apply(new User(userId, scope.teamId()))));
    }

    private void requireClientId(String clientRequestId) {
        if (clientRequestId == null || !clientRequestId.matches("[A-Za-z0-9-]{8,50}")) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "请求标识不合法");
        }
    }

    private String pending() {
        return "{\"pending\":true}";
    }

    private String done(String projectId, String requestId) {
        JSONObject result = new JSONObject();
        result.put("projectId", projectId);
        result.put("requestId", requestId);
        result.put("completed", true);
        return result.toJSONString();
    }

    private String defaultName(String idea, String story) {
        String source = StringUtils.hasText(idea) ? idea : story;
        return StringUtils.hasText(source) ? clip(source, 24) : "未命名短剧";
    }

    private String clip(String value, int max) {
        String trimmed = value.trim().replaceAll("\\s+", " ");
        return trimmed.length() <= max ? trimmed : trimmed.substring(0, max);
    }

    private String text(OffsetDateTime value) {
        return value == null ? "" : value.toString();
    }

    private BusinessException invalid(String message) {
        return new BusinessException(ErrorCode.PARAM_INVALID, message);
    }

    private BusinessException conflict() {
        return new BusinessException(ErrorCode.DATA_CONFLICT, "项目已经变化，请刷新后继续");
    }

    private BusinessException missing() {
        return new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "短剧项目不存在");
    }

    private BusinessException busy() {
        return new BusinessException(ErrorCode.BUSINESS_ERROR, "当前请求结束后才能继续");
    }

    private record User(long userId, long teamId) {
    }
}
