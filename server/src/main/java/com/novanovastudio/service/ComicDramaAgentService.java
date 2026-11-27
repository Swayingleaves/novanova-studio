package com.novanovastudio.service;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.agent.AgentScopeAgentFactory;
import com.novanovastudio.agent.AgentScopeModelFactory;
import com.novanovastudio.agent.AgentSessionService;
import com.novanovastudio.agent.dto.AgentSession;
import com.novanovastudio.agent.dto.AgentSessionHistoryMessage;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.dto.ComicDramaAgentContracts;
import com.novanovastudio.dto.ComicDramaDtos;
import com.novanovastudio.repository.ComicDramaRepository;
import com.novanovastudio.security.CurrentUserProvider;
import io.agentscope.core.ReActAgent;
import io.agentscope.core.agent.RuntimeContext;
import io.agentscope.core.model.Model;
import java.math.BigDecimal;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 漫剧工作台AI制片助手服务：绑定项目会话、即时落库镜头与提示词修订，并为扣费生成操作输出待确认建议卡片。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-27 19:26
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ComicDramaAgentService {

    /** 允许返回的待确认动作类型集合。 */
    private static final Set<String> ALLOWED_ACTIONS = Set.of(
            "oneClickEpisode", "splitEpisode", "generateAssets", "composePrompts", "generateVideos", "exportVideo");

    /** 历史对话窗口上限，避免输入上下文无限增长。 */
    private static final int MAX_HISTORY_MESSAGES = 12;

    /** 当前用户提供器。 */
    private final CurrentUserProvider currentUserProvider;

    /** 漫剧仓储。 */
    private final ComicDramaRepository repository;

    /** 漫剧业务服务。 */
    private final ComicDramaService comicDramaService;

    /** Agent 会话持久化服务。 */
    private final AgentSessionService sessionService;

    /** 文本模型工厂。 */
    private final AgentScopeModelFactory modelFactory;

    /** Agent 实例工厂。 */
    private final AgentScopeAgentFactory agentFactory;

    /** 应用超时配置。 */
    private final NovanovaProperties properties;

    /**
     * 查询漫剧项目绑定的制片助手历史对话。
     *
     * @param projectId 项目ID
     * @return 会话标识及历史消息列表
     */
    public Mono<ComicDramaDtos.AgentHistoryResponse> getHistory(String projectId) {
        return currentUserProvider.currentUserId().flatMap(userId -> repository.getProject(userId, projectId)
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "漫剧项目不存在")))
                .then(repository.getAgentSessionId(userId, projectId))
                .flatMap(sessionId -> sessionService.getSessionHistory(userId, sessionId)
                        .map(messages -> new ComicDramaDtos.AgentHistoryResponse(sessionId, messages))
                        .onErrorResume(error -> Mono.just(new ComicDramaDtos.AgentHistoryResponse("", List.of()))))
                .defaultIfEmpty(new ComicDramaDtos.AgentHistoryResponse("", List.of())));
    }

    /**
     * 重置当前项目的制片助手会话，开启全新对话上下文。
     *
     * @param projectId 项目ID
     * @return 重置后的空历史响应
     */
    public Mono<ComicDramaDtos.AgentHistoryResponse> resetSession(String projectId) {
        return currentUserProvider.currentUserId().flatMap(userId -> repository.getProject(userId, projectId)
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "漫剧项目不存在")))
                .then(sessionService.createSession(userId, AgentSession.PROFILE_COMIC_DRAMA))
                .flatMap(session -> repository.updateAgentSessionId(userId, projectId, session.id())
                        .thenReturn(new ComicDramaDtos.AgentHistoryResponse(session.id(), List.of()))));
    }

    /**
     * 执行一轮制片助手对话：读取当前分集上下文、调用Agent、立即落库镜头/提示词改动并持久化会话。
     *
     * @param request 对话请求
     * @return 助手回复、已应用的修改及待确认动作建议
     */
    public Mono<ComicDramaDtos.AgentChatResponse> chat(ComicDramaDtos.AgentChatRequest request) {
        return currentUserProvider.currentUserId().flatMap(userId -> ensureSessionId(userId, request.projectId())
                .flatMap(sessionId -> Mono.zip(
                        comicDramaService.getWorkspace(request.projectId()),
                        sessionService.getSessionHistory(userId, sessionId).onErrorReturn(List.of()),
                        resolveModel(request.model()))
                        .flatMap(tuple -> {
                            ComicDramaDtos.Workspace workspace = tuple.getT1();
                            List<AgentSessionHistoryMessage> history = tuple.getT2();
                            Model model = tuple.getT3();
                            String userMsgId = UUID.randomUUID().toString();
                            ShotRefMapping mapping = buildShotMapping(workspace, request.episodeId());
                            JSONObject agentInput = buildAgentInput(workspace, request, mapping, history);
                            log.info("漫剧制片助手对话开始: userId={}, projectId={}, episodeId={}, shotCount={}",
                                    userId, request.projectId(), request.episodeId(), mapping.refToShot().size());
                            return sessionService.appendUserMessage(sessionId, userMsgId, request.message().trim())
                                    .then(invokeAgent(userId, sessionId, model, agentInput))
                                    .flatMap(turn -> applyTurnResult(sessionId, request.projectId(), workspace, mapping, turn));
                        })));
    }

    /** 确保项目已绑定可用会话。 */
    private Mono<String> ensureSessionId(Long userId, String projectId) {
        return repository.getProject(userId, projectId)
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "漫剧项目不存在")))
                .then(repository.getAgentSessionId(userId, projectId))
                .switchIfEmpty(Mono.defer(() -> sessionService.createSession(userId, AgentSession.PROFILE_COMIC_DRAMA)
                        .flatMap(session -> repository.updateAgentSessionId(userId, projectId, session.id())
                                .thenReturn(session.id()))));
    }

    /** 解析指定模型或回退到平台默认文本模型。 */
    private Mono<Model> resolveModel(String selectedModel) {
        if (StringUtils.hasText(selectedModel)) {
            return modelFactory.resolveTextModel(selectedModel).map(AgentScopeModelFactory.TextModelSelection::agentModel);
        }
        return modelFactory.defaultTextModel();
    }

    /** 调用 AgentScope 获取结构化制片助手结果。 */
    private Mono<ComicDramaAgentContracts.AgentTurnResult> invokeAgent(Long userId, String sessionId, Model model, JSONObject input) {
        return Mono.defer(() -> {
            ReActAgent agent = agentFactory.comicDramaAgent(model);
            RuntimeContext context = RuntimeContext.builder()
                    .sessionId("comic-drama:" + sessionId)
                    .userId(String.valueOf(userId))
                    .build();
            return agent.call(input.toJSONString(), ComicDramaAgentContracts.AgentTurnResult.class, context)
                    .timeout(Duration.ofSeconds(properties.timeoutSettings().scriptAgentTimeoutSeconds()))
                    .map(msg -> msg.getStructuredData(ComicDramaAgentContracts.AgentTurnResult.class))
                    .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "Nana助手未返回有效结果")))
                    .doFinally(signal -> agent.close());
        }).onErrorMap(error -> error instanceof BusinessException ? error
                : new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "Nana助手调用失败：" + error.getMessage()));
    }

    /** 将镜头/提示词修订落库，整理动作建议并写入助手消息。 */
    private Mono<ComicDramaDtos.AgentChatResponse> applyTurnResult(
            String sessionId,
            String projectId,
            ComicDramaDtos.Workspace workspace,
            ShotRefMapping mapping,
            ComicDramaAgentContracts.AgentTurnResult turn) {
        List<ComicDramaAgentContracts.ShotEdit> edits = turn.shotEdits() == null ? List.of() : turn.shotEdits();
        Map<String, ComicDramaDtos.PromptVersion> adoptedPrompts = latestAdoptedPrompts(workspace);
        return Flux.fromIterable(edits)
                .concatMap(edit -> applySingleEdit(projectId, mapping, adoptedPrompts, edit))
                .collectList()
                .flatMap(appliedEdits -> {
                    List<ComicDramaDtos.AgentActionSuggestion> suggestions = mapSuggestions(turn.proposedActions(), mapping);
                    String reply = StringUtils.hasText(turn.reply()) ? turn.reply().trim() : "已完成处理。";
                    String assistantMsgId = UUID.randomUUID().toString();
                    JSONObject meta = new JSONObject();
                    meta.put("kind", "comicDramaAgent");
                    meta.put("appliedEdits", appliedEdits);
                    meta.put("suggestions", suggestions);
                    return sessionService.appendAssistantMessage(sessionId, assistantMsgId, reply, meta.toJSONString())
                            .thenReturn(new ComicDramaDtos.AgentChatResponse(
                                    sessionId, assistantMsgId, reply, appliedEdits, suggestions, !appliedEdits.isEmpty()));
                });
    }

    /** 应用单个镜头的字段与提示词改动，每次读取最新项目修订号保证乐观锁一致。 */
    private Mono<ComicDramaDtos.AgentAppliedEdit> applySingleEdit(
            String projectId,
            ShotRefMapping mapping,
            Map<String, ComicDramaDtos.PromptVersion> adoptedPrompts,
            ComicDramaAgentContracts.ShotEdit edit) {
        if (edit == null || !StringUtils.hasText(edit.shotRef())) {
            return Mono.empty();
        }
        ComicDramaDtos.Shot target = mapping.refToShot().get(edit.shotRef().trim());
        if (target == null) {
            return Mono.empty();
        }
        List<String> updatedFields = new ArrayList<>();
        ComicDramaDtos.Shot updatedShot = mergeShot(target, edit, updatedFields);
        boolean promptChanged = StringUtils.hasText(edit.finalPrompt());
        if (updatedFields.isEmpty() && !promptChanged) {
            return Mono.empty();
        }
        Mono<Void> saveShotMono = updatedFields.isEmpty()
                ? Mono.empty()
                : comicDramaService.getWorkspace(projectId)
                        .flatMap(latest -> {
                            ComicDramaDtos.Shot fresh = latest.shots().stream()
                                    .filter(item -> target.id().equals(item.id())).findFirst().orElse(target);
                            ComicDramaDtos.Shot merged = mergeShot(fresh, edit, new ArrayList<>());
                            return comicDramaService.saveShot(new ComicDramaDtos.SaveShotRequest(projectId, latest.revision(), merged)).then();
                        });
        Mono<Void> savePromptMono = !promptChanged
                ? Mono.empty()
                : comicDramaService.getWorkspace(projectId)
                        .flatMap(latest -> {
                            ComicDramaDtos.PromptVersion source = adoptedPrompts.get(target.id());
                            return comicDramaService.savePrompt(new ComicDramaDtos.SavePromptRequest(
                                    projectId, latest.revision(), target.id(), edit.finalPrompt().trim(),
                                    null, source == null ? null : source.id())).then();
                        });
        if (promptChanged) {
            updatedFields.add("最终视频提示词");
        }
        return saveShotMono.then(savePromptMono)
                .thenReturn(new ComicDramaDtos.AgentAppliedEdit(target.id(), target.shotNumber(), updatedFields));
    }

    /** 仅覆写模型明确给出的非空镜头字段，保留服务端身份与排序字段。 */
    private ComicDramaDtos.Shot mergeShot(ComicDramaDtos.Shot base, ComicDramaAgentContracts.ShotEdit edit, List<String> updatedFields) {
        String shotSize = pick(edit.shotSize(), base.shotSize(), "景别", updatedFields);
        String cameraMovement = pick(edit.cameraMovement(), base.cameraMovement(), "运镜", updatedFields);
        BigDecimal duration = base.durationSeconds();
        if (edit.durationSeconds() != null && edit.durationSeconds().compareTo(BigDecimal.valueOf(0.5)) >= 0
                && edit.durationSeconds().compareTo(BigDecimal.valueOf(120)) <= 0
                && (base.durationSeconds() == null || edit.durationSeconds().compareTo(base.durationSeconds()) != 0)) {
            duration = edit.durationSeconds();
            updatedFields.add("时长");
        }
        String visual = pick(edit.visualDescription(), base.visualDescription(), "画面描述", updatedFields);
        String action = pick(edit.actionDescription(), base.actionDescription(), "动作描述", updatedFields);
        String lighting = pick(edit.lightingAtmosphere(), base.lightingAtmosphere(), "光影氛围", updatedFields);
        String dialogue = pick(edit.dialogueVoiceover(), base.dialogueVoiceover(), "对白旁白", updatedFields);
        String sound = pick(edit.soundDescription(), base.soundDescription(), "音效", updatedFields);
        return new ComicDramaDtos.Shot(base.id(), base.sourceEpisodeId(), base.sourceSceneId(), base.sourceScriptExcerpt(),
                base.shotNumber(), base.sortOrder(), duration, shotSize, base.composition(), visual, action,
                cameraMovement, lighting, dialogue, sound, base.styleOverride(), base.productionStatus(),
                base.assetVersionIds(), base.revision(), base.createdAt(), base.updatedAt());
    }

    private String pick(String incoming, String fallback, String label, List<String> updatedFields) {
        if (StringUtils.hasText(incoming) && !incoming.trim().equals(fallback == null ? "" : fallback.trim())) {
            updatedFields.add(label);
            return incoming.trim();
        }
        return fallback;
    }

    /** 将模型返回的动作建议映射为真实镜头标识。 */
    private List<ComicDramaDtos.AgentActionSuggestion> mapSuggestions(
            List<ComicDramaAgentContracts.ProposedAction> raw, ShotRefMapping mapping) {
        if (raw == null || raw.isEmpty()) {
            return List.of();
        }
        List<ComicDramaDtos.AgentActionSuggestion> result = new ArrayList<>();
        for (ComicDramaAgentContracts.ProposedAction action : raw) {
            if (action == null || !ALLOWED_ACTIONS.contains(action.actionType())) {
                continue;
            }
            List<String> shotIds = new ArrayList<>();
            if (action.shotRefs() != null) {
                for (String ref : action.shotRefs()) {
                    ComicDramaDtos.Shot shot = ref == null ? null : mapping.refToShot().get(ref.trim());
                    if (shot != null && !shotIds.contains(shot.id())) {
                        shotIds.add(shot.id());
                    }
                }
            }
            String label = StringUtils.hasText(action.label()) ? action.label().trim() : defaultActionLabel(action.actionType());
            String desc = action.description() == null ? "" : action.description().trim();
            result.add(new ComicDramaDtos.AgentActionSuggestion(action.actionType(), label, desc, shotIds));
        }
        return result;
    }

    private String defaultActionLabel(String actionType) {
        return switch (actionType) {
            case "oneClickEpisode" -> "打开一键出集";
            case "splitEpisode" -> "AI 拆分本集镜头";
            case "generateAssets" -> "补齐缺失资产图";
            case "composePrompts" -> "批量合成提示词";
            case "generateVideos" -> "生成镜头视频";
            case "exportVideo" -> "导出本集 MP4";
            default -> "确认执行";
        };
    }

    /** 为当前分集镜头分配从 1 起的批内短序号（s1, s2...），避免模型转抄 UUID。 */
    private ShotRefMapping buildShotMapping(ComicDramaDtos.Workspace workspace, String episodeId) {
        List<ComicDramaDtos.Shot> scoped = workspace.shots().stream()
                .filter(shot -> !StringUtils.hasText(episodeId) || "all".equals(episodeId) || episodeId.equals(shot.sourceEpisodeId()))
                .sorted(Comparator.comparingInt(ComicDramaDtos.Shot::sortOrder))
                .toList();
        Map<String, ComicDramaDtos.Shot> refToShot = new LinkedHashMap<>();
        Map<String, String> idToRef = new LinkedHashMap<>();
        for (int index = 0; index < scoped.size(); index++) {
            String ref = "s" + (index + 1);
            ComicDramaDtos.Shot shot = scoped.get(index);
            refToShot.put(ref, shot);
            idToRef.put(shot.id(), ref);
        }
        return new ShotRefMapping(refToShot, idToRef);
    }

    /** 构造给制片助手的完整上下文输入。 */
    private JSONObject buildAgentInput(
            ComicDramaDtos.Workspace workspace,
            ComicDramaDtos.AgentChatRequest request,
            ShotRefMapping mapping,
            List<AgentSessionHistoryMessage> history) {
        JSONObject root = new JSONObject();
        root.put("projectTitle", workspace.scriptProject().overview().title());
        root.put("visualStyle", workspace.settings().visualStyle());
        root.put("aspectRatio", workspace.settings().aspectRatio());
        root.put("episodeId", StringUtils.hasText(request.episodeId()) ? request.episodeId() : "all");
        workspace.scriptProject().episodes().stream()
                .filter(ep -> ep.id().equals(request.episodeId()))
                .findFirst()
                .ifPresent(ep -> root.put("episodeTitle", "第" + ep.episodeNumber() + "集：" + ep.title()));
        if (StringUtils.hasText(request.selectedShotId()) && mapping.idToRef().containsKey(request.selectedShotId())) {
            root.put("selectedShotRef", mapping.idToRef().get(request.selectedShotId()));
        }
        if (request.mentionedShotIds() != null && !request.mentionedShotIds().isEmpty()) {
            List<String> mentionedRefs = request.mentionedShotIds().stream()
                    .map(mapping.idToRef()::get).filter(StringUtils::hasText).toList();
            root.put("mentionedShotRefs", mentionedRefs);
        }
        Map<String, ComicDramaDtos.PromptVersion> adoptedPrompts = latestAdoptedPrompts(workspace);
        Map<String, String> videoStatusByShot = latestVideoStatusByShot(workspace);
        JSONArray shotsArr = new JSONArray();
        mapping.refToShot().forEach((ref, shot) -> {
            JSONObject item = new JSONObject();
            item.put("shotRef", ref);
            item.put("shotNumber", shot.shotNumber());
            item.put("shotSize", shot.shotSize());
            item.put("cameraMovement", shot.cameraMovement());
            item.put("durationSeconds", shot.durationSeconds());
            item.put("visualDescription", shot.visualDescription());
            item.put("dialogueVoiceover", shot.dialogueVoiceover());
            item.put("lightingAtmosphere", shot.lightingAtmosphere());
            item.put("soundDescription", shot.soundDescription());
            item.put("videoStatus", videoStatusByShot.getOrDefault(shot.id(), "empty"));
            ComicDramaDtos.PromptVersion prompt = adoptedPrompts.get(shot.id());
            item.put("finalPrompt", prompt == null ? "" : prompt.prompt());
            shotsArr.add(item);
        });
        root.put("shots", shotsArr);
        JSONArray historyArr = new JSONArray();
        int start = Math.max(0, history.size() - MAX_HISTORY_MESSAGES);
        for (int i = start; i < history.size(); i++) {
            AgentSessionHistoryMessage msg = history.get(i);
            JSONObject entry = new JSONObject();
            entry.put("role", msg.role());
            entry.put("text", msg.text());
            historyArr.add(entry);
        }
        root.put("recentHistory", historyArr);
        root.put("userMessage", request.message().trim());
        return root;
    }

    private Map<String, ComicDramaDtos.PromptVersion> latestAdoptedPrompts(ComicDramaDtos.Workspace workspace) {
        Map<String, ComicDramaDtos.PromptVersion> map = new LinkedHashMap<>();
        for (ComicDramaDtos.PromptVersion version : workspace.promptVersions()) {
            if (!"adopted".equals(version.status())) {
                continue;
            }
            ComicDramaDtos.PromptVersion current = map.get(version.shotId());
            if (current == null || version.versionNumber() > current.versionNumber()) {
                map.put(version.shotId(), version);
            }
        }
        return map;
    }

    private Map<String, String> latestVideoStatusByShot(ComicDramaDtos.Workspace workspace) {
        Map<String, String> map = new LinkedHashMap<>();
        for (ComicDramaDtos.MediaResult media : workspace.media()) {
            if ("shot".equals(media.targetType()) && "video".equals(media.mediaType())) {
                map.putIfAbsent(media.targetId(), media.status());
            }
        }
        return map;
    }

    /** 批内镜头短序号映射。 */
    private record ShotRefMapping(Map<String, ComicDramaDtos.Shot> refToShot, Map<String, String> idToRef) {
    }
}
