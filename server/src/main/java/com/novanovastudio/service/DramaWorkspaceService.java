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
import java.util.concurrent.ConcurrentHashMap;
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

    /** 正在推进的批次，合并并发刷新，避免同一个目标被提交两次。 */
    private final ConcurrentHashMap<String, Mono<Boolean>> advancing = new ConcurrentHashMap<>();

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
                .flatMap(pair -> {
                    List<DramaRepository.ProjectRow> rows = pair.getT1();
                    long total = pair.getT2() == null ? 0 : pair.getT2();
                    List<String> projectIds = rows.stream().map(DramaRepository.ProjectRow::id).toList();
                    return dramaMediaService.listFirstImageCovers(projectIds, user.teamId())
                            .map(covers -> new DramaDtos.ProjectListResponse(
                                    rows.stream().map(row -> summary(row, covers.get(row.id()))).toList(),
                                    total));
                }));
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
                    JSONObject shots = contentOf(latest(versions, "shot"));
                    List<String> keys = plannedKeys(requested.stream().map(DramaContracts.MediaItem::targetKey).toList(),
                            regenerate, cast, shots, media);
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
                    // 整批落库成待办，先把不依赖别人的提交掉，剩下的等前置完成再唤醒。
                    JSONObject batch = new JSONObject();
                    batch.put("stage", mediaStage(keys));
                    batch.put("items", itemsOf(requested, keys));
                    batch.put("payload", payload == null ? new JSONObject() : payload);
                    batch.put("pending", new com.alibaba.fastjson2.JSONArray(keys));
                    batch.put("tasks", new com.alibaba.fastjson2.JSONArray());
                    batch.put("keys", new com.alibaba.fastjson2.JSONArray());
                    batch.put("notified", false);
                    return dramaRepository.insertClientRequest(requestId, teamId, userId, "chat-media", project.id(), batch.toJSONString())
                            .then(advanceChain(user, project))
                            .then(dramaRepository.clearActive(project.id(), requestId));
                }));
    }

    private Mono<String> submitChatMedia(DramaRepository.ProjectRow project, JSONObject payload, DramaContracts.MediaItem item,
                                         String castVersion, String shotVersion) {
        String targetKey = item.targetKey();
        boolean video = targetKey.startsWith("shot-video:");
        String versionId = targetKey.startsWith("character:") || targetKey.startsWith("location:") ? castVersion : shotVersion;
        if (!StringUtils.hasText(versionId)) {
            return Mono.error(invalid(video ? "还没有分镜镜头，不能生成视频" : "还没有对应阶段的内容"));
        }
        Map<String, Object> parameters = new LinkedHashMap<>();
        if (video) {
            String resolution = payload == null ? "" : payload.getString("videoResolution");
            parameters.put("resolution", StringUtils.hasText(resolution) ? resolution : "720p");
            parameters.put("watermark", false);
            parameters.put("size", DramaArtifacts.normalizeAspect(project.aspectRatio()));
        } else {
            String quality = payload == null ? "" : payload.getString("imageQuality");
            String resolution = payload == null ? "" : payload.getString("imageResolution");
            parameters.put("count", 1);
            parameters.put("quality", StringUtils.hasText(quality) ? quality : "medium");
            parameters.put("resolution", StringUtils.hasText(resolution) ? resolution : "2K");
            parameters.put("size", targetKey.startsWith("character:") ? "3:2" : project.aspectRatio());
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

    /**
     * 推进项目里所有未完成的对话生成批次。
     * <p>不阻塞请求：每次只提交依赖已经就绪的那一个，剩下的留在批次里，
     * 下一次刷新或唤醒时继续，用户不用干等。</p>
     *
     * @param user 当前用户与空间
     * @param project 项目
     * @return 完成信号
     */
    private Mono<Boolean> advanceChain(User user, DramaRepository.ProjectRow project) {
        // 前端每 3 秒刷一次，会有多个 workspace 请求同时在跑；不合并的话同一个目标会被提交两次。
        return advancing.computeIfAbsent(project.id(), key -> advanceAll(user, project)
                .doFinally(signal -> advancing.remove(key)).cache());
    }

    private Mono<Boolean> advanceAll(User user, DramaRepository.ProjectRow project) {
        return dramaRepository.listChatMedia(project.id(), user.userId(), user.teamId())
                .concatMap(batch -> advanceBatch(user, project, batch))
                .any(Boolean::booleanValue);
    }

    private Mono<Boolean> advanceBatch(User user, DramaRepository.ProjectRow project, DramaRepository.ChatMediaBatch batch) {
        return advanceOnce(user, project, batch)
                .flatMap(changed -> changed
                        ? dramaRepository.listChatMedia(project.id(), user.userId(), user.teamId())
                                .filter(item -> batch.id().equals(item.id()))
                                .concatMap(item -> advanceBatch(user, project, item)).then(Mono.just(true))
                        : Mono.just(false));
    }

    /**
     * 从批次里取出一个可提交的目标提交掉；没有可提交的就返回 false。
     *
     * @param user 当前用户与空间
     * @param project 项目
     * @param batch 对话生成批次
     * @return 是否有进展
     */
    private Mono<Boolean> advanceOnce(User user, DramaRepository.ProjectRow project, DramaRepository.ChatMediaBatch batch) {
        JSONObject result = JSON.parseObject(batch.result());
        if (result == null || result.getBooleanValue("notified")) {
            return Mono.just(false);
        }
        com.alibaba.fastjson2.JSONArray pending = result.getJSONArray("pending");
        if (pending == null || pending.isEmpty()) {
            return Mono.just(false);
        }
        List<DramaContracts.MediaItem> items = readItems(result);
        JSONObject payload = result.getJSONObject("payload");
        return dramaRepository.listVersions(project.id(), user.teamId()).collectList()
                .flatMap(versions -> dramaMediaService.list(user.userId(), user.teamId(), project.id()).flatMap(media -> {
                    JSONObject cast = contentOf(latest(versions, "cast"));
                    String castVersion = latest(versions, "cast") == null ? "" : latest(versions, "cast").id();
                    String shotVersion = latest(versions, "shot") == null ? "" : latest(versions, "shot").id();
                    List<DramaMediaCommands.NameTarget> catalog = new ArrayList<>();
                    catalog.addAll(namedTargets(cast, "characters", "character:"));
                    catalog.addAll(namedTargets(cast, "locations", "location:"));
                    com.alibaba.fastjson2.JSONArray rest = new com.alibaba.fastjson2.JSONArray();
                    String target = null;
                    boolean dropped = false;
                    for (int index = 0; index < pending.size(); index++) {
                        String key = pending.getString(index);
                        String state = chainState(key, media);
                        if (target == null && "ready".equals(state)) {
                            target = key;
                            continue;
                        }
                        if (target == null && "dead".equals(state)) {
                            dropped = true;
                            log.warn("短剧跳过无法生成的目标: projectId={}, target={}", project.id(), key);
                            continue;
                        }
                        rest.add(key);
                    }
                    if (target == null) {
                        if (!dropped) {
                            return Mono.just(false);
                        }
                        result.put("pending", rest);
                        return dramaRepository.updateChatMedia(batch.id(), result.toJSONString()).thenReturn(true);
                    }
                    String key = target;
                    return submitChatMedia(project, payload, itemOf(items, key), castVersion, shotVersion)
                            .flatMap(submitted -> appendTask(user, project, result, submitted, catalog))
                            .onErrorResume(error -> {
                                log.warn("短剧对话提交媒体失败: projectId={}, target={}, message={}", project.id(), key, error.getMessage());
                                return Mono.just(result);
                            })
                            .flatMap(updated -> {
                                updated.put("pending", rest);
                                return dramaRepository.updateChatMedia(batch.id(), updated.toJSONString()).thenReturn(true);
                            });
                }));
    }

    /**
     * 把刚提交的目标记进批次的完成清单。
     *
     * @param user 当前用户与空间
     * @param project 项目
     * @param result 批次结果
     * @param key 生成目标
     * @param catalog 角色与场景的短序号目录
     * @return 更新后的批次结果
     */
    private Mono<JSONObject> appendTask(User user, DramaRepository.ProjectRow project, JSONObject result, String key,
                                        List<DramaMediaCommands.NameTarget> catalog) {
        return dramaMediaService.list(user.userId(), user.teamId(), project.id()).map(media -> {
            DramaDtos.MediaView row = media.stream()
                    .filter(item -> key.equals(item.targetKey()) && StringUtils.hasText(item.taskId()))
                    .findFirst().orElse(null);
            if (row == null) {
                return result;
            }
            com.alibaba.fastjson2.JSONArray tasks = result.getJSONArray("tasks");
            if (tasks == null) {
                tasks = new com.alibaba.fastjson2.JSONArray();
                result.put("tasks", tasks);
            }
            com.alibaba.fastjson2.JSONArray keys = result.getJSONArray("keys");
            if (keys == null) {
                keys = new com.alibaba.fastjson2.JSONArray();
                result.put("keys", keys);
            }
            JSONObject task = new JSONObject();
            task.put("taskId", row.taskId());
            task.put("name", mediaLabel(key, catalog));
            tasks.add(task);
            keys.add(key);
            return result;
        });
    }

    /**
     * 判断一个生成目标现在能不能提交。
     *
     * @param key 生成目标
     * @param media 当前项目的全部媒体
     * @return ready 可以提交，wait 等前置，dead 前置已经废了
     */
    private String chainState(String key, List<DramaDtos.MediaView> media) {
        if (!chainedTarget(key)) {
            return "ready";
        }
        List<String> required = DramaMediaTargets.requiredReferences(key);
        if (required.isEmpty() || ready(media, required)) {
            return "ready";
        }
        return blocked(media, required) ? "dead" : "wait";
    }

    /**
     * 把主 Agent 声明的生成目标存进批次，唤醒后还能按同样的提示词重放。
     *
     * @param requested 主 Agent 声明的目标
     * @param keys 实际要提交的目标
     * @return 批次里的目标数组
     */
    private com.alibaba.fastjson2.JSONArray itemsOf(List<DramaContracts.MediaItem> requested, List<String> keys) {
        com.alibaba.fastjson2.JSONArray items = new com.alibaba.fastjson2.JSONArray();
        for (String key : keys) {
            DramaContracts.MediaItem item = itemOf(requested, key);
            JSONObject entry = new JSONObject();
            entry.put("targetKey", key);
            entry.put("prompt", item.prompt());
            entry.put("referenceKeys", item.referenceKeys());
            items.add(entry);
        }
        return items;
    }

    /**
     * 从批次里读回生成目标。
     *
     * @param result 批次结果
     * @return 生成目标
     */
    private List<DramaContracts.MediaItem> readItems(JSONObject result) {
        List<DramaContracts.MediaItem> items = new ArrayList<>();
        com.alibaba.fastjson2.JSONArray array = result.getJSONArray("items");
        if (array == null) {
            return items;
        }
        for (int index = 0; index < array.size(); index++) {
            JSONObject entry = array.getJSONObject(index);
            if (entry == null || !StringUtils.hasText(entry.getString("targetKey"))) {
                continue;
            }
            com.alibaba.fastjson2.JSONArray refs = entry.getJSONArray("referenceKeys");
            items.add(new DramaContracts.MediaItem(entry.getString("targetKey"), entry.getString("prompt"),
                    refs == null ? List.of() : refs.toJavaList(String.class)));
        }
        return items;
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
            // 队列里还有没提交的，说明这一批还没跑完，不能提前发完成清单。
            com.alibaba.fastjson2.JSONArray queue = result.getJSONArray("pending");
            if (queue != null && !queue.isEmpty()) {
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
                            ? sessionService.appendAssistantMessage(project.sessionId(), UUID.randomUUID().toString(),
                                    DramaMediaCommands.completionReply(names, statuses),
                                    mediaDoneMeta(names.size(), result.getString("stage"), result.getJSONArray("keys")))
                            : Mono.empty());
        }).then().onErrorResume(error -> {
            log.warn("短剧生成完成反馈失败: projectId={}, message={}", project.id(), error.getMessage());
            return Mono.empty();
        });
    }

    /**
     * 是否必须串行提交：连续图和镜头视频要用上一镜的尾帧，顺序错了参考图就凑不齐。
     *
     * @param key 生成目标
     * @return 需要串行返回 true
     */
    private static boolean chainedTarget(String key) {
        return key.startsWith("shot-last:") || key.startsWith("shot-video:");
    }

    /**
     * 判断这些参考图是否都已经生成成功。
     *
     * @param media 当前项目的全部媒体
     * @param keys 参考图目标
     * @return boolean 全部就绪时为true
     */
    private static boolean ready(List<DramaDtos.MediaView> media, List<String> keys) {
        return keys.stream().allMatch(key -> media.stream().anyMatch(item -> key.equals(item.targetKey())
                && "success".equals(item.status())
                && (StringUtils.hasText(item.storageKey()) || StringUtils.hasText(item.url()))));
    }

    /**
     * 判断前置素材是不是真的废了。
     * <p>只有既没有成功、也没有在生成的记录才算；用户重发一次时旧记录还是 failed，
     * 但新任务已经在跑，这时提前跳过会让后面整串镜头都不生成。</p>
     *
     * @param media 当前项目的全部媒体
     * @param blockers 前置目标
     * @return boolean 无望时为true
     */
    private static boolean blocked(List<DramaDtos.MediaView> media, List<String> blockers) {
        return blockers.stream().anyMatch(key -> {
            List<DramaDtos.MediaView> rows = media.stream().filter(item -> key.equals(item.targetKey())).toList();
            boolean alive = rows.stream().anyMatch(item -> "success".equals(item.status())
                    || "pending".equals(item.status()) || "running".equals(item.status()));
            return !alive && rows.stream().anyMatch(item -> "failed".equals(item.status()) || "canceled".equals(item.status()));
        });
    }

    private List<String> plannedKeys(List<String> requested, boolean regenerate, JSONObject cast, JSONObject shots, List<DramaRepository.MediaRow> media) {
        java.util.Set<String> allowed = new java.util.LinkedHashSet<>();
        allowed.addAll(prefixed("character:", refs(cast, "characters")));
        allowed.addAll(prefixed("location:", refs(cast, "locations")));
        allowed.addAll(prefixed("shot-first:", refs(shots, "shots")));
        allowed.addAll(prefixed("shot-last:", refs(shots, "shots")));
        allowed.addAll(prefixed("shot-video:", refs(shots, "shots")));
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

    /**
     * 生成完成清单里的显示名。角色和场景用名字；镜头相关的用镜头序号，
     * 否则同一角色的多张连续图会列成「林澈、林澈、林澈」。
     *
     * @param key 生成目标
     * @param catalog 角色与场景的短序号目录
     * @return String 显示名
     */
    private static String mediaLabel(String key, List<DramaMediaCommands.NameTarget> catalog) {
        for (DramaMediaCommands.NameTarget entry : catalog) {
            if (key.equals(entry.key()) && StringUtils.hasText(entry.name())) {
                return entry.name();
            }
        }
        String ref = key.substring(key.lastIndexOf(':') + 1);
        if (key.startsWith("shot-first:")) {
            return ref + " 的首帧";
        }
        if (key.startsWith("shot-last:")) {
            return ref + " 的尾帧";
        }
        if (key.startsWith("shot-video:")) {
            return ref + " 的视频";
        }
        return ref;
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
     * @return 落库的新版本
     */
    public Mono<DramaRepository.VersionRow> applyGeneratedVersion(long userId, long teamId, String projectId, String requestId, String stage, JSONObject raw, String userMessage) {
        User user = new User(userId, teamId);
        return dramaRepository.findProject(userId, teamId, projectId).switchIfEmpty(Mono.error(missing()))
                .flatMap(project -> dramaRepository.listVersions(projectId, teamId).collectList().flatMap(versions -> {
                    DramaStageRules.index(stage);
                    if (!DramaStageRules.canRevise(project.currentStage(), stage, latest(versions, stage) != null)
                            && !stage.equals(project.currentStage())) {
                        return Mono.error(invalid("还不能修改尚未开始的阶段"));
                    }
                    JSONObject content = DramaArtifacts.normalize(stage, raw, contentOf(latest(versions, stage)),
                            contentOf(latest(versions, "cast")), contentOf(latest(versions, "shot")), project.durationSeconds(), project.aspectRatio(), userMessage);
                    return storeVersion(user, project, versions, stage, requestId, content, true);
                }));
    }

    /**
     * 重做指定阶段：直接按生成请求入队，由服务端指定目标阶段，不依赖模型判断意图。
     *
     * @param request 重做请求
     * @return 工作台
     */
    public Mono<DramaDtos.WorkspaceResponse> regenerateStage(DramaDtos.RegenerateStageRequest request) {
        return scope(user -> dramaRepository.findProject(user.userId(), user.teamId(), request.projectId())
                .switchIfEmpty(Mono.error(missing()))
                .flatMap(project -> {
                    if (project.revision() != request.revision()) {
                        return Mono.error(conflict());
                    }
                    DramaStageRules.index(request.stage());
                    return requireIdle(project).then(dramaRepository.listVersions(project.id(), user.teamId()).collectList()
                            .flatMap(versions -> {
                                if (latest(versions, request.stage()) == null && !request.stage().equals(project.currentStage())) {
                                    return Mono.error(invalid("这一阶段还没有产物，不能重做"));
                                }
                                String requestId = request.clientRequestId() + ":regen";
                                JSONObject payload = turn("generate", project.id(), request.stage(), "", request.stage());
                                return dramaRepository.saveProgress(user.userId(), user.teamId(), project.id(), project.revision(),
                                                request.stage(), "active", requestId, project.durationSeconds(), project.name())
                                        .flatMap(this::requireUpdated)
                                        .then(enqueue(user, project, requestId, payload))
                                        .then(workspace(user, project.id()));
                            }));
                }));
    }

    /**
     * 撤销最近一次生成：删除该版本和它的图片视频，必要时把进度退回上一阶段。
     *
     * @param request 撤销请求
     * @return 更新后的工作台
     */
    public Mono<DramaDtos.WorkspaceResponse> discardVersion(DramaDtos.DiscardVersionRequest request) {
        return scope(user -> dramaRepository.findProject(user.userId(), user.teamId(), request.projectId())
                .switchIfEmpty(Mono.error(missing()))
                .flatMap(project -> {
                    if (project.revision() != request.revision()) {
                        return Mono.error(conflict());
                    }
                    return requireIdle(project).then(dramaRepository.listVersions(project.id(), user.teamId()).collectList()
                            .flatMap(versions -> {
                                DramaRepository.VersionRow target = versions.stream()
                                        .filter(item -> item.id().equals(request.versionId())).findFirst().orElse(null);
                                if (target == null) {
                                    return Mono.error(invalid("要撤销的版本不存在"));
                                }
                                DramaRepository.VersionRow newest = latest(versions, target.stage());
                                if (newest == null || !newest.id().equals(target.id())) {
                                    return Mono.error(invalid("只能撤销该阶段的最新版本"));
                                }
                                if (!"pending".equals(target.confirmationStatus())) {
                                    return Mono.error(invalid("已确认的版本不能撤销"));
                                }
                                boolean lastOfStage = versions.stream().noneMatch(item ->
                                        target.stage().equals(item.stage()) && !item.id().equals(target.id()));
                                String stage = target.stage().equals(project.currentStage()) && lastOfStage
                                        ? DramaStageRules.previous(target.stage()) : project.currentStage();
                                return transactionalOperator.transactional(dramaRepository.deleteMediaByVersion(project.id(), target.id())
                                                .then(dramaRepository.deleteVersion(project.id(), target.id()))
                                                .then(dramaRepository.saveProgress(user.userId(), user.teamId(), project.id(), project.revision(),
                                                        stage, "active", "", project.durationSeconds(), project.name())
                                                        .flatMap(this::requireUpdated).then()))
                                        .then(workspace(user, project.id()));
                            }));
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

    private Mono<DramaRepository.VersionRow> storeVersion(User user, DramaRepository.ProjectRow project, List<DramaRepository.VersionRow> versions, String stage,
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
                        "", duration, finalName).flatMap(this::requireUpdated).then())).thenReturn(version);
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
                                .flatMap(media -> advanceChain(user, project)
                                        .flatMap(advanced -> Boolean.TRUE.equals(advanced)
                                                ? dramaMediaService.list(user.userId(), user.teamId(), project.id())
                                                : Mono.just(media))
                                        .flatMap(latestMedia -> notifyFinishedChat(user, project, latestMedia)
                                                .then(active(project).map(active -> new DramaDtos.WorkspaceResponse(detail(project),
                                                versions.stream().map(this::versionView).toList(), active, latestMedia)))))));
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

    /**
     * 生成出图出视频完成提示的附加信息。
     *
     * @param count 本轮完成的目标数量
     * @param stage 这批目标所属阶段，决定对话里由哪个身份说话
     * @param keys 这批目标，前端据此取缩略图
     * @return String 附加信息JSON
     */
    private String mediaDoneMeta(int count, String stage, com.alibaba.fastjson2.JSONArray keys) {
        JSONObject meta = new JSONObject();
        meta.put("kind", "media-done");
        if (StringUtils.hasText(stage)) {
            meta.put("stage", stage);
        }
        meta.put("mediaCount", count);
        if (keys != null && !keys.isEmpty()) {
            meta.put("mediaKeys", keys);
        }
        return meta.toJSONString();
    }

    /**
     * 按生成目标判断这批素材属于哪个阶段。
     *
     * @param keys 生成目标
     * @return String 阶段；角色和场景归 cast，其余归 shot
     */
    private String mediaStage(List<String> keys) {
        if (keys.stream().allMatch(key -> key.startsWith("character:") || key.startsWith("location:"))) {
            return "cast";
        }
        return "shot";
    }

    private DramaDtos.ProjectView summary(DramaRepository.ProjectRow project, DramaRepository.ProjectCoverRow cover) {
        return new DramaDtos.ProjectView(project.id(), project.name(), project.currentStage(), project.status(), project.revision(),
                project.textModel(), project.textCredits(), project.durationSeconds(), DramaArtifacts.normalizeAspect(project.aspectRatio()), text(project.updatedAt()),
                cover == null ? "" : cover.url(), cover == null ? "" : cover.storageKey());
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
