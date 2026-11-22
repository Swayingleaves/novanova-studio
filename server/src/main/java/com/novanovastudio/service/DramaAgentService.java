package com.novanovastudio.service;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.agent.AgentEventEmitter;
import com.novanovastudio.agent.AgentScopeAgentFactory;
import com.novanovastudio.agent.AgentScopeModelFactory;
import com.novanovastudio.agent.AgentSessionService;
import com.novanovastudio.agent.DramaReplyStreamMiddleware;
import com.novanovastudio.agent.dto.AgentEvent;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.DramaContracts;
import com.novanovastudio.entity.CreationAgentRequest;
import com.novanovastudio.repository.CreationAgentRequestRepository;
import com.novanovastudio.repository.DramaRepository;
import com.novanovastudio.security.TeamScope;
import io.agentscope.core.ReActAgent;
import io.agentscope.core.agent.RuntimeContext;
import java.time.Duration;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Mono;
import reactor.core.publisher.SignalType;

/**
 * 执行短剧主Agent请求：调用文本模型、保存阶段产物，并在失败、停止和中断时退款。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-14 00:40
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class DramaAgentService {

    private static final Set<String> INTENTS = Set.of("answer", "revise", "regenerate", "confirm", "media");

    /** 模型工厂。 */
    private final AgentScopeModelFactory modelFactory;

    /** Agent工厂。 */
    private final AgentScopeAgentFactory agentFactory;

    /** 运行时扣费。 */
    private final DramaRuntime runtime;

    /** 工作台。 */
    private final DramaWorkspaceService workspaceService;

    /** 短剧仓储。 */
    private final DramaRepository dramaRepository;

    /** 请求仓储。 */
    private final CreationAgentRequestRepository requestRepository;

    /** 会话。 */
    private final AgentSessionService sessionService;

    /** 事件。 */
    private final AgentEventEmitter eventEmitter;

    /** 超时配置。 */
    private final NovanovaProperties properties;

    /**
     * 执行已经被调度器切到运行中的短剧请求。
     *
     * @param request 主Agent请求
     * @return 完成信号
     */
    public Mono<Void> executeRunning(CreationAgentRequest request) {
        AtomicBoolean settled = new AtomicBoolean(false);
        return run(request, settled).onErrorResume(error -> fail(request, error, settled))
                .transformDeferredContextual((mono, context) -> mono.doFinally(signal -> {
                    if (signal == SignalType.CANCEL && settled.compareAndSet(false, true)) {
                        runtime.release(request).contextWrite(view -> view.putAll(context))
                                .subscribe(null, exception -> log.error("短剧请求取消后退款失败: requestId={}", request.getId(), exception));
                    }
                }));
    }

    private Mono<Void> run(CreationAgentRequest request, AtomicBoolean settled) {
        JSONObject payload = JSON.parseObject(request.getRequestData());
        if (payload == null || !StringUtils.hasText(payload.getString("projectId"))) {
            return fail(request, new BusinessException(ErrorCode.PARAM_INVALID, "短剧请求缺少项目"), settled);
        }
        String projectId = payload.getString("projectId");
        String assistantId = UUID.randomUUID().toString();
        return TeamScope.current().flatMap(scope -> dramaRepository.findProject(request.getUserId(), scope.teamId(), projectId)
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "短剧项目不存在")))
                .flatMap(project -> modelFactory.resolveTextModel(project.textModel()).flatMap(model -> runtime.charge(
                                request.getUserId(), project.id(), request.getId(), model.creditCost(), model.modelConfigId())
                        .then(Mono.fromCallable(() -> runtime.withCharge(request.getRequestData(), model.modelConfigId(), model.creditCost())))
                        .flatMap(updated -> {
                            request.setRequestData(updated);
                            return requestRepository.saveRequestData(request.getId(), updated);
                        })
                        .then(dramaRepository.listVersions(project.id(), scope.teamId()).collectList())
                        .flatMap(versions -> dramaRepository.listMedia(project.id(), scope.teamId()).collectList()
                                .flatMap(media -> callModel(request, project, payload, versions, media, model, scope.teamId(), assistantId)))
                        .flatMap(raw -> requestRepository.findStatusById(request.getId()).flatMap(status -> {
                            if (!"running".equals(status)) {
                                settled.set(true);
                                return runtime.release(request);
                            }
                            return apply(request, project, payload, raw, settled, scope.teamId(), assistantId);
                        })))))
                .doOnSubscribe(ignored -> eventEmitter.emit(request.getUserId(), AgentEvent.queueStatus(
                        request.getSessionId(), request.getId(), "running", "生成中")));
    }

    private Mono<Void> apply(CreationAgentRequest request, DramaRepository.ProjectRow project, JSONObject payload, JSONObject raw,
                             AtomicBoolean settled, long teamId, String assistantId) {
        String kind = payload.getString("kind");
        String intent = raw.getString("intent");
        if (!"generate".equals(kind) && !INTENTS.contains(intent)) {
            return fail(request, new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "短剧结果缺少有效意图"), settled);
        }
        String reply = DramaArtifacts.reply(raw);
        String viewedStage = payload.getString("viewedStage");
        if ("converse".equals(kind) && "confirm".equals(intent)) {
            settled.set(true);
            String nextStage = DramaStageRules.next(project.currentStage());
            return runtime.release(request)
                    .then(workspaceService.confirmFromAgent(request.getUserId(), teamId, project.id(), request.getId()))
                    .then(complete(request, teamId, assistantId, reply,
                            simpleMeta("confirm", StringUtils.hasText(nextStage) ? nextStage : project.currentStage())))
                    .then(finish(request, "success", ""));
        }
        if ("converse".equals(kind) && "answer".equals(intent)) {
            settled.set(true);
            return complete(request, teamId, assistantId, reply, simpleMeta("answer", viewedStage))
                    .then(dramaRepository.clearActive(project.id(), request.getId()))
                    .then(finish(request, "success", ""));
        }
        if ("converse".equals(kind) && "media".equals(intent)) {
            settled.set(true);
            // 先把这轮回复落库并发给前端，用户立刻能看到「开始生成…」；
            // 真正的提交要等上一镜尾帧，可能花上几分钟，不能压在这条回复前面。
            return complete(request, teamId, assistantId, reply, mediaMeta(viewedStage, raw))
                    .then(workspaceService.executeMediaPlan(request.getUserId(), teamId, project, request.getId(), raw, payload))
                    .then(dramaRepository.clearActive(project.id(), request.getId()))
                    .then(finish(request, "success", ""));
        }
        String stage = "generate".equals(kind) ? payload.getString("stage") : targetStage(payload, raw, project.currentStage());
        return workspaceService.applyGeneratedVersion(request.getUserId(), teamId, project.id(), request.getId(), stage, raw, payload.getString("message"))
                .flatMap(version -> complete(request, teamId, assistantId, reply, stageMeta(stage, version)))
                .then(Mono.fromRunnable(() -> eventEmitter.emit(request.getUserId(), AgentEvent.dramaStage(request.getSessionId(), project.id(), stage)
                        .withRequestId(request.getId()))))
                .then(finish(request, "success", ""))
                .doOnSuccess(ignored -> settled.set(true));
    }

    /**
     * 保存本轮助手消息并补发终态事件，前端据此收尾流式气泡。
     *
     * @param request 主Agent请求
     * @param teamId 团队空间
     * @param assistantId 本轮助手消息编号
     * @param reply 回复正文
     * @param meta 卡片附加信息
     * @return 完成信号
     */
    private Mono<Void> complete(CreationAgentRequest request, long teamId, String assistantId, String reply, String meta) {
        return sessionService.appendAssistantMessage(request.getSessionId(), assistantId, reply, meta)
                .then(Mono.fromRunnable(() -> eventEmitter.emit(request.getUserId(), teamId,
                        AgentEvent.taskComplete(request.getSessionId(), assistantId, reply))));
    }

    /**
     * 生成不含卡片的附加信息。
     *
     * @param kind 消息种类
     * @param stage 所属阶段
     * @return String 附加信息JSON
     */
    private String simpleMeta(String kind, String stage) {
        JSONObject meta = new JSONObject();
        meta.put("kind", kind);
        if (StringUtils.hasText(stage)) {
            meta.put("stage", stage);
        }
        return meta.toJSONString();
    }

    /**
     * 生成阶段产物卡片的附加信息，只放数字类统计，文案由前端按语言拼接。
     *
     * @param stage 阶段
     * @param version 新落库的版本
     * @return String 附加信息JSON
     */
    private String stageMeta(String stage, DramaRepository.VersionRow version) {
        JSONObject meta = new JSONObject();
        meta.put("kind", "stage");
        meta.put("stage", stage);
        meta.put("versionId", version.id());
        meta.put("versionNumber", version.versionNumber());
        meta.put("counts", counts(stage, version.contentJson()));
        return meta.toJSONString();
    }

    /**
     * 统计阶段产物的条目数量。
     *
     * @param stage 阶段
     * @param contentJson 版本内容JSON
     * @return JSONObject 统计结果
     */
    private JSONObject counts(String stage, String contentJson) {
        JSONObject counts = new JSONObject();
        JSONObject content = JSON.parseObject(contentJson);
        if (content == null) {
            return counts;
        }
        switch (stage) {
            case "plan" -> {
                counts.put("durationSeconds", content.getInteger("durationSeconds"));
                counts.put("aspectRatio", content.getString("aspectRatio"));
            }
            case "script" -> counts.put("scenes", sizeOf(content.getJSONArray("scenes")));
            case "cast" -> {
                counts.put("characters", sizeOf(content.getJSONArray("characters")));
                counts.put("locations", sizeOf(content.getJSONArray("locations")));
            }
            case "storyboard", "shot" -> counts.put("shots", sizeOf(content.getJSONArray("shots")));
            default -> counts.put("checks", sizeOf(content.getJSONArray("checklist")));
        }
        counts.values().removeIf(Objects::isNull);
        return counts;
    }

    /**
     * 生成出图出视频卡片的附加信息。
     *
     * @param stage 所属阶段
     * @param raw 导演结果
     * @return String 附加信息JSON
     */
    private String mediaMeta(String stage, JSONObject raw) {
        JSONObject meta = new JSONObject();
        meta.put("kind", "media");
        if (StringUtils.hasText(stage)) {
            meta.put("stage", stage);
        }
        JSONArray keys = new JSONArray();
        JSONObject plan = raw.getJSONObject("media");
        JSONArray items = plan == null ? null : plan.getJSONArray("items");
        if (items != null) {
            for (int index = 0; index < items.size(); index++) {
                JSONObject item = items.getJSONObject(index);
                if (item != null && StringUtils.hasText(item.getString("targetKey"))) {
                    keys.add(item.getString("targetKey"));
                }
            }
        }
        meta.put("mediaKeys", keys);
        meta.put("mediaCount", keys.size());
        return meta.toJSONString();
    }

    /**
     * 统计数组长度，空数组按0处理。
     *
     * @param array 目标数组
     * @return int 长度
     */
    private int sizeOf(JSONArray array) {
        return array == null ? 0 : array.size();
    }

    private Mono<JSONObject> callModel(CreationAgentRequest request, DramaRepository.ProjectRow project, JSONObject payload,
                                       java.util.List<DramaRepository.VersionRow> versions, java.util.List<DramaRepository.MediaRow> media,
                                       AgentScopeModelFactory.TextModelSelection model, long teamId, String assistantId) {
        JSONObject input = new JSONObject();
        input.put("kind", payload.getString("kind"));
        input.put("targetStage", payload.getString("stage"));
        input.put("viewedStage", payload.getString("viewedStage"));
        input.put("message", payload.getString("message"));
        input.put("idea", project.ideaText());
        input.put("story", project.storyText());
        input.put("durationSeconds", project.durationSeconds());
        input.put("aspectRatio", DramaArtifacts.normalizeAspect(project.aspectRatio()));
        JSONObject stages = new JSONObject();
        for (String stage : DramaStageRules.ORDER) {
            DramaRepository.VersionRow latest = null;
            for (DramaRepository.VersionRow version : versions) {
                if (stage.equals(version.stage()) && (latest == null || version.versionNumber() > latest.versionNumber())) {
                    latest = version;
                }
            }
            if (latest != null) {
                JSONObject content = JSON.parseObject(latest.contentJson());
                DramaArtifacts.hidePersistentIds(content);
                stages.put(stage, content);
            }
        }
        input.put("stages", stages);
        input.put("mediaStatus", mediaStatus(versions, media));
        input.put("referenceRules", "角色用c1，场景用l1，剧本场景用sc1，镜头用sh1。只使用输入里已经出现的短序号；新增条目接着当前最大序号。不要输出持久化标识。media.items 的 targetKey 只能从 mediaStatus 里选；prompt 和 referenceKeys 由短剧提示词 Agent 负责，留空即可。");
        return Mono.defer(() -> {
            ReActAgent agent = agentFactory.dramaAgent(model.agentModel());
            RuntimeContext context = RuntimeContext.builder()
                    .sessionId("drama:" + request.getId()).userId(String.valueOf(request.getUserId())).build();
            context.put(DramaReplyStreamMiddleware.DramaReplyStreamContext.class,
                    new DramaReplyStreamMiddleware.DramaReplyStreamContext(request.getUserId(), teamId,
                            request.getSessionId(), assistantId));
            log.info("短剧Agent请求: requestId={}, userId={}, model={}, input={}", request.getId(), request.getUserId(), model.modelValue(), input.toJSONString());
            return agent.call(input.toJSONString(), DramaContracts.DirectorResult.class, context)
                    .timeout(Duration.ofSeconds(properties.timeoutSettings().scriptAgentTimeoutSeconds()))
                    .map(message -> JSON.parseObject(JSON.toJSONString(message.getStructuredData(DramaContracts.DirectorResult.class))))
                    .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "短剧Agent未返回结构化结果")))
                    .doFinally(signal -> agent.close());
        }).onErrorMap(error -> error instanceof BusinessException ? error
                : new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "短剧Agent调用失败：" + error.getMessage()));
    }

    private String targetStage(JSONObject payload, JSONObject raw, String currentStage) {
        String target = raw.getString("targetStage");
        if (!StringUtils.hasText(target)) {
            target = payload.getString("viewedStage");
        }
        return StringUtils.hasText(target) ? target : currentStage;
    }

    /** 把已有角色、场景、分镜和它们当前的生成状态交给主 Agent，由它决定 targetKey。 */
    private JSONArray mediaStatus(java.util.List<DramaRepository.VersionRow> versions, java.util.List<DramaRepository.MediaRow> media) {
        JSONObject cast = content(versions, "cast");
        JSONObject storyboard = content(versions, "storyboard");
        JSONObject production = content(versions, "shot");
        JSONObject activeShots = DramaMediaTargets.hasShots(production) ? production : storyboard;
        JSONArray rows = new JSONArray();
        addCastStatus(rows, cast, "characters", "character:");
        addCastStatus(rows, cast, "locations", "location:");
        addShotStatus(rows, storyboard, cast, "board:");
        addShotStatus(rows, activeShots, cast, "sheet:");
        addShotStatus(rows, activeShots, cast, "shot-video:");
        for (int index = 0; index < rows.size(); index++) {
            JSONObject row = rows.getJSONObject(index);
            String key = row.getString("targetKey");
            String status = "none";
            for (DramaRepository.MediaRow item : media) {
                if (key.equals(item.targetKey())) {
                    status = item.status() == null ? "none" : item.status();
                    break;
                }
            }
            row.put("status", status);
        }
        return rows;
    }

    private void addCastStatus(JSONArray rows, JSONObject content, String field, String prefix) {
        JSONArray items = content == null ? null : content.getJSONArray(field);
        if (items == null) {
            return;
        }
        for (int index = 0; index < items.size(); index++) {
            JSONObject item = items.getJSONObject(index);
            if (item == null || !StringUtils.hasText(item.getString("ref"))) {
                continue;
            }
            JSONObject row = new JSONObject();
            row.put("targetKey", prefix + item.getString("ref"));
            row.put("name", item.getString("name"));
            rows.add(row);
        }
    }

    private void addShotStatus(JSONArray rows, JSONObject storyboard, JSONObject cast, String prefix) {
        JSONArray shots = storyboard == null ? null : storyboard.getJSONArray("shots");
        if (shots == null) {
            return;
        }
        for (int index = 0; index < shots.size(); index++) {
            JSONObject shot = shots.getJSONObject(index);
            if (shot == null || !StringUtils.hasText(shot.getString("ref"))) {
                continue;
            }
            String name = shot.getString("ref");
            String characterRef = shot.getString("characterRef");
            JSONArray characters = cast == null ? null : cast.getJSONArray("characters");
            if (characters != null && StringUtils.hasText(characterRef)) {
                for (int characterIndex = 0; characterIndex < characters.size(); characterIndex++) {
                    JSONObject character = characters.getJSONObject(characterIndex);
                    if (character != null && characterRef.equals(character.getString("ref")) && StringUtils.hasText(character.getString("name"))) {
                        name = character.getString("name");
                    }
                }
            }
            JSONObject row = new JSONObject();
            row.put("targetKey", prefix + shot.getString("ref"));
            row.put("name", name);
            rows.add(row);
        }
    }

    private JSONObject content(java.util.List<DramaRepository.VersionRow> versions, String stage) {
        DramaRepository.VersionRow latest = null;
        for (DramaRepository.VersionRow version : versions) {
            if (stage.equals(version.stage()) && (latest == null || version.versionNumber() > latest.versionNumber())) {
                latest = version;
            }
        }
        if (latest == null || !StringUtils.hasText(latest.contentJson())) {
            return new JSONObject();
        }
        JSONObject content = JSON.parseObject(latest.contentJson());
        return content == null ? new JSONObject() : content;
    }

    private Mono<Void> fail(CreationAgentRequest request, Throwable error, AtomicBoolean settled) {
        if (!settled.compareAndSet(false, true)) {
            return Mono.empty();
        }
        String message = error instanceof BusinessException business ? business.getMessage() : "短剧生成失败";
        log.error("短剧请求失败: requestId={}, message={}", request.getId(), message, error);
        return runtime.release(request)
                .then(sessionService.appendAssistantMessage(request.getSessionId(), UUID.randomUUID().toString(), message,
                        "{\"kind\":\"error\"}"))
                .onErrorResume(ignored -> Mono.empty())
                .then(finish(request, "failed", message))
                .then(Mono.fromRunnable(() -> eventEmitter.emit(request.getUserId(), AgentEvent.error(request.getSessionId(), message).withRequestId(request.getId()))));
    }

    private Mono<Void> finish(CreationAgentRequest request, String status, String message) {
        return requestRepository.finishRunning(request.getId(), status, message).then();
    }
}
