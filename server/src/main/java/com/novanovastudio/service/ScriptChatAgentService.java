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
import com.novanovastudio.dto.ScriptChatContracts;
import com.novanovastudio.dto.ScriptDtos;
import com.novanovastudio.repository.ScriptRepository;
import com.novanovastudio.security.CurrentUserProvider;
import io.agentscope.core.ReActAgent;
import io.agentscope.core.agent.RuntimeContext;
import io.agentscope.core.model.Model;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Mono;

/**
 * 剧本创作对话式AI编剧助手服务：绑定项目级会话、汇总当前创作上下文进行多轮讨论，并输出可一键触发正式草稿生成的动作建议卡片。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-27 20:02
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ScriptChatAgentService {

    /** 传给模型的最近历史消息条数上限。 */
    private static final int MAX_HISTORY_MESSAGES = 12;

    /** 单轮最多返回的推荐动作卡片数量。 */
    private static final int MAX_RECOMMENDATIONS = 3;

    /** 单集时长建议下限（秒）。 */
    private static final int MIN_EPISODE_DURATION = 30;

    /** 单集时长建议上限（秒）。 */
    private static final int MAX_EPISODE_DURATION = 600;

    /** 动作编码与默认中文名称映射。 */
    private static final Map<String, String> ACTION_LABELS = Map.ofEntries(
            Map.entry("storyDirections", "生成3个候选故事方向"),
            Map.entry("outline", "生成故事大纲"),
            Map.entry("characters", "生成人物设定"),
            Map.entry("world", "生成世界观与地点"),
            Map.entry("episodePlan", "生成分集规划"),
            Map.entry("episodeDraft", "生成单集场次与正文"),
            Map.entry("polish", "润色"),
            Map.entry("expand", "扩写"),
            Map.entry("condense", "精简"),
            Map.entry("rewrite", "重写"),
            Map.entry("colloquialize", "口语化"),
            Map.entry("dialogue", "优化对白"),
            Map.entry("conflict", "加强冲突"),
            Map.entry("suspense", "增强悬念"),
            Map.entry("twist", "增强反转"),
            Map.entry("motivation", "强化人物动机"),
            Map.entry("emotion", "强化情绪张力"),
            Map.entry("climax", "增强高潮表现"),
            Map.entry("rhythm", "调整节奏"),
            Map.entry("style", "改写风格")
    );

    /** 当前用户提供器。 */
    private final CurrentUserProvider currentUserProvider;

    /** 剧本仓储。 */
    private final ScriptRepository repository;

    /** 剧本业务服务。 */
    private final ScriptService scriptService;

    /** Agent 会话持久化服务。 */
    private final AgentSessionService sessionService;

    /** 文本模型工厂。 */
    private final AgentScopeModelFactory modelFactory;

    /** Agent 实例工厂。 */
    private final AgentScopeAgentFactory agentFactory;

    /** 应用超时配置。 */
    private final NovanovaProperties properties;

    /**
     * 查询剧本项目绑定的编剧助手历史对话。
     *
     * @param projectId 剧本项目标识
     * @return 会话标识及历史消息列表
     */
    public Mono<ScriptDtos.AgentHistoryResponse> getHistory(String projectId) {
        return currentUserProvider.currentUserId().flatMap(userId -> repository.getProject(userId, projectId)
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "剧本项目不存在")))
                .then(repository.getAgentSessionId(userId, projectId))
                .flatMap(sessionId -> sessionService.getSessionHistory(userId, sessionId)
                        .map(messages -> new ScriptDtos.AgentHistoryResponse(sessionId, messages))
                        .onErrorResume(error -> Mono.just(new ScriptDtos.AgentHistoryResponse("", List.of()))))
                .defaultIfEmpty(new ScriptDtos.AgentHistoryResponse("", List.of())));
    }

    /**
     * 重置当前剧本项目的编剧助手会话，开启全新对话上下文。
     *
     * @param projectId 剧本项目标识
     * @return 重置后的空会话响应
     */
    public Mono<ScriptDtos.AgentHistoryResponse> resetSession(String projectId) {
        return currentUserProvider.currentUserId().flatMap(userId -> repository.getProject(userId, projectId)
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "剧本项目不存在")))
                .then(sessionService.createSession(userId, AgentSession.PROFILE_SCRIPT))
                .flatMap(session -> repository.updateAgentSessionId(userId, projectId, session.id())
                        .thenReturn(new ScriptDtos.AgentHistoryResponse(session.id(), List.of()))));
    }

    /**
     * 执行一轮剧本对话：汇总当前剧本与分集上下文、调用编剧助手并返回回复与推荐的正式草稿动作。
     *
     * @param request 剧本对话请求
     * @return 助手回复与推荐动作卡片
     */
    public Mono<ScriptDtos.AgentChatResponse> chat(ScriptDtos.AgentChatRequest request) {
        return currentUserProvider.currentUserId().flatMap(userId -> ensureSessionId(userId, request.projectId())
                .flatMap(sessionId -> {
                    Mono<Optional<ScriptDtos.EpisodeDetail>> episodeMono = StringUtils.hasText(request.selectedEpisodeId())
                            ? scriptService.getEpisode(request.projectId(), request.selectedEpisodeId())
                                    .map(Optional::of)
                                    .onErrorReturn(Optional.empty())
                            : Mono.just(Optional.empty());
                    return Mono.zip(
                            scriptService.getProject(request.projectId()),
                            episodeMono,
                            sessionService.getSessionHistory(userId, sessionId).onErrorReturn(List.of()),
                            resolveModel(request.model()))
                            .flatMap(tuple -> {
                                ScriptDtos.ProjectDetail project = tuple.getT1();
                                Optional<ScriptDtos.EpisodeDetail> selectedEpisode = tuple.getT2();
                                List<AgentSessionHistoryMessage> history = tuple.getT3();
                                Model model = tuple.getT4();
                                RefMapping mapping = buildRefMapping(project, selectedEpisode.orElse(null));
                                JSONObject agentInput = buildAgentInput(project, selectedEpisode.orElse(null), request, mapping, history);
                                String userMsgId = UUID.randomUUID().toString();
                                log.info("剧本编剧助手对话开始: userId={}, projectId={}, section={}, episodeId={}",
                                        userId, request.projectId(), request.section(), request.selectedEpisodeId());
                                return sessionService.appendUserMessage(sessionId, userMsgId, request.message().trim())
                                        .then(invokeAgent(userId, sessionId, model, agentInput))
                                        .flatMap(turn -> persistTurnResult(sessionId, project, request, mapping, turn));
                            });
                }));
    }

    /** 确保剧本项目已绑定可用会话。 */
    private Mono<String> ensureSessionId(Long userId, String projectId) {
        return repository.getProject(userId, projectId)
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "剧本项目不存在")))
                .then(repository.getAgentSessionId(userId, projectId))
                .switchIfEmpty(Mono.defer(() -> sessionService.createSession(userId, AgentSession.PROFILE_SCRIPT)
                        .flatMap(session -> repository.updateAgentSessionId(userId, projectId, session.id())
                                .thenReturn(session.id()))));
    }

    /** 解析指定文本模型或回退到平台默认文本模型。 */
    private Mono<Model> resolveModel(String selectedModel) {
        if (StringUtils.hasText(selectedModel)) {
            return modelFactory.resolveTextModel(selectedModel).map(AgentScopeModelFactory.TextModelSelection::agentModel);
        }
        return modelFactory.defaultTextModel();
    }

    /** 调用 AgentScope 获取编剧助手结构化回复。 */
    private Mono<ScriptChatContracts.AgentTurnResult> invokeAgent(Long userId, String sessionId, Model model, JSONObject input) {
        return Mono.defer(() -> {
            ReActAgent agent = agentFactory.scriptChatAgent(model);
            RuntimeContext context = RuntimeContext.builder()
                    .sessionId("script:" + sessionId)
                    .userId(String.valueOf(userId))
                    .build();
            return agent.call(input.toJSONString(), ScriptChatContracts.AgentTurnResult.class, context)
                    .timeout(Duration.ofSeconds(properties.timeoutSettings().scriptAgentTimeoutSeconds()))
                    .map(msg -> msg.getStructuredData(ScriptChatContracts.AgentTurnResult.class))
                    .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "Nana助手未返回有效结果")))
                    .doFinally(signal -> agent.close());
        }).onErrorMap(error -> error instanceof BusinessException ? error
                : new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "Nana助手调用失败：" + error.getMessage()));
    }

    /** 映射推荐动作并将助手回复写入会话历史。 */
    private Mono<ScriptDtos.AgentChatResponse> persistTurnResult(
            String sessionId,
            ScriptDtos.ProjectDetail project,
            ScriptDtos.AgentChatRequest request,
            RefMapping mapping,
            ScriptChatContracts.AgentTurnResult turn) {
        String reply = StringUtils.hasText(turn.reply()) ? turn.reply().trim() : "已收到你的想法，可以告诉我更具体的方向，或直接点击下方推荐动作生成审核草稿。";
        List<ScriptDtos.AgentActionRecommendation> recommendations = mapRecommendations(
                turn.recommendedActions(), project, request, mapping);
        String assistantMsgId = UUID.randomUUID().toString();
        JSONObject meta = new JSONObject();
        meta.put("kind", "scriptAgent");
        meta.put("recommendations", recommendations);
        return sessionService.appendAssistantMessage(sessionId, assistantMsgId, reply, meta.toJSONString())
                .thenReturn(new ScriptDtos.AgentChatResponse(sessionId, assistantMsgId, reply, recommendations));
    }

    /** 将模型返回的短序号推荐动作校验并映射为真实业务目标。 */
    private List<ScriptDtos.AgentActionRecommendation> mapRecommendations(
            List<ScriptChatContracts.RecommendedAction> raw,
            ScriptDtos.ProjectDetail project,
            ScriptDtos.AgentChatRequest request,
            RefMapping mapping) {
        if (raw == null || raw.isEmpty()) {
            return List.of();
        }
        List<ScriptDtos.AgentActionRecommendation> result = new ArrayList<>();
        for (ScriptChatContracts.RecommendedAction item : raw) {
            if (result.size() >= MAX_RECOMMENDATIONS) {
                break;
            }
            if (item == null || !StringUtils.hasText(item.actionType())) {
                continue;
            }
            String actionType = item.actionType().trim();
            if (!ScriptAiActions.ALL_SET.contains(actionType)) {
                continue;
            }
            ResolvedTarget target = resolveRecommendationTarget(actionType, item.targetRef(), project, request, mapping);
            String label = StringUtils.hasText(item.label())
                    ? item.label().trim()
                    : ACTION_LABELS.getOrDefault(actionType, actionType);
            String description = item.description() == null ? "" : item.description().trim();
            String instruction = item.instruction() == null ? "" : item.instruction().trim();
            Integer duration = null;
            if (("episodePlan".equals(actionType) || "episodeDraft".equals(actionType))
                    && item.episodeDurationSeconds() != null) {
                duration = Math.min(MAX_EPISODE_DURATION, Math.max(MIN_EPISODE_DURATION, item.episodeDurationSeconds()));
            }
            result.add(new ScriptDtos.AgentActionRecommendation(
                    actionType, label, description, instruction,
                    target.targetType(), target.targetId(), target.targetLabel(), duration));
        }
        return result;
    }

    /** 按动作类型与批内短序号解析真实的草稿目标。 */
    private ResolvedTarget resolveRecommendationTarget(
            String actionType,
            String targetRef,
            ScriptDtos.ProjectDetail project,
            ScriptDtos.AgentChatRequest request,
            RefMapping mapping) {
        if ("storyDirections".equals(actionType)) {
            return new ResolvedTarget("overview", "", "故事概览");
        }
        if ("outline".equals(actionType)) {
            return new ResolvedTarget("outline", "", "故事大纲");
        }
        if ("characters".equals(actionType)) {
            return new ResolvedTarget("characters", "", "人物设定");
        }
        if ("world".equals(actionType)) {
            return new ResolvedTarget("world", "", "世界观与地点");
        }
        if ("episodePlan".equals(actionType)) {
            return new ResolvedTarget("episodes", "", "分集规划");
        }
        String cleanRef = targetRef == null ? "" : targetRef.trim();
        if ("episodeDraft".equals(actionType)) {
            ScriptDtos.EpisodeSummary refEpisode = mapping.refToEpisode().get(cleanRef);
            if (refEpisode != null) {
                return new ResolvedTarget("episode", refEpisode.id(), episodeLabel(refEpisode));
            }
            ScriptDtos.EpisodeSummary selected = findEpisode(project, request.selectedEpisodeId());
            if (selected != null) {
                return new ResolvedTarget("episode", selected.id(), episodeLabel(selected));
            }
            if (project.episodes() != null && !project.episodes().isEmpty()) {
                ScriptDtos.EpisodeSummary first = project.episodes().get(0);
                return new ResolvedTarget("episode", first.id(), episodeLabel(first));
            }
            return new ResolvedTarget("episode", "", "当前分集");
        }
        // 正文优化类动作（润色/扩写/加强冲突等）：优先解析场次/分集短序号，其次回退当前选中目标
        ScriptDtos.Scene refScene = mapping.refToScene().get(cleanRef);
        if (refScene != null) {
            return new ResolvedTarget("scene", refScene.id(), sceneLabel(refScene));
        }
        ScriptDtos.EpisodeSummary refEpisode = mapping.refToEpisode().get(cleanRef);
        if (refEpisode != null) {
            return new ResolvedTarget("episode", refEpisode.id(), episodeLabel(refEpisode));
        }
        if (StringUtils.hasText(request.targetType()) && StringUtils.hasText(request.targetId())) {
            String label = StringUtils.hasText(request.targetLabel()) ? request.targetLabel().trim() : "当前选中目标";
            return new ResolvedTarget(request.targetType().trim(), request.targetId().trim(), label);
        }
        ScriptDtos.EpisodeSummary selected = findEpisode(project, request.selectedEpisodeId());
        if (selected != null) {
            return new ResolvedTarget("episode", selected.id(), episodeLabel(selected));
        }
        return new ResolvedTarget("episode", "", "当前分集");
    }

    /** 为项目分集和当前分集场次分配从 1 起的批内短序号（ep1、sc1）。 */
    private RefMapping buildRefMapping(ScriptDtos.ProjectDetail project, ScriptDtos.EpisodeDetail selectedEpisode) {
        Map<String, ScriptDtos.EpisodeSummary> refToEpisode = new LinkedHashMap<>();
        Map<String, String> episodeIdToRef = new LinkedHashMap<>();
        if (project.episodes() != null) {
            for (int i = 0; i < project.episodes().size(); i++) {
                String ref = "ep" + (i + 1);
                ScriptDtos.EpisodeSummary ep = project.episodes().get(i);
                refToEpisode.put(ref, ep);
                episodeIdToRef.put(ep.id(), ref);
            }
        }
        Map<String, ScriptDtos.Scene> refToScene = new LinkedHashMap<>();
        Map<String, String> sceneIdToRef = new LinkedHashMap<>();
        if (selectedEpisode != null && selectedEpisode.scenes() != null) {
            for (int i = 0; i < selectedEpisode.scenes().size(); i++) {
                String ref = "sc" + (i + 1);
                ScriptDtos.Scene scene = selectedEpisode.scenes().get(i);
                refToScene.put(ref, scene);
                sceneIdToRef.put(scene.id(), ref);
            }
        }
        return new RefMapping(refToEpisode, episodeIdToRef, refToScene, sceneIdToRef);
    }

    /** 构造给编剧助手的剧本上下文输入（全部使用批内短序号，不暴露 UUID）。 */
    private JSONObject buildAgentInput(
            ScriptDtos.ProjectDetail project,
            ScriptDtos.EpisodeDetail selectedEpisode,
            ScriptDtos.AgentChatRequest request,
            RefMapping mapping,
            List<AgentSessionHistoryMessage> history) {
        JSONObject root = new JSONObject();
        root.put("currentSection", StringUtils.hasText(request.section()) ? request.section().trim() : "overview");
        if (StringUtils.hasText(request.selectedEpisodeId()) && mapping.episodeIdToRef().containsKey(request.selectedEpisodeId())) {
            root.put("selectedEpisodeRef", mapping.episodeIdToRef().get(request.selectedEpisodeId()));
        }
        if (StringUtils.hasText(request.targetType())) {
            JSONObject targetObj = new JSONObject();
            targetObj.put("targetType", request.targetType().trim());
            if ("scene".equals(request.targetType()) && StringUtils.hasText(request.targetId())) {
                targetObj.put("targetRef", mapping.sceneIdToRef().getOrDefault(request.targetId(), ""));
            } else if ("episode".equals(request.targetType()) && StringUtils.hasText(request.targetId())) {
                targetObj.put("targetRef", mapping.episodeIdToRef().getOrDefault(request.targetId(), ""));
            }
            if (StringUtils.hasText(request.targetLabel())) {
                targetObj.put("label", request.targetLabel().trim());
            }
            root.put("currentTarget", targetObj);
        }

        ScriptDtos.ProjectOverview ov = project.overview();
        JSONObject overviewObj = new JSONObject();
        overviewObj.put("title", safe(ov.title()));
        overviewObj.put("contentType", safe(ov.contentType()));
        overviewObj.put("genre", safe(ov.genre()));
        overviewObj.put("logline", clip(ov.logline(), 600));
        overviewObj.put("synopsis", clip(ov.synopsis(), 1200));
        overviewObj.put("theme", clip(ov.theme(), 400));
        overviewObj.put("mainPlot", clip(ov.mainPlot(), 1000));
        overviewObj.put("mainConflict", clip(ov.mainConflict(), 600));
        overviewObj.put("endingDirection", clip(ov.endingDirection(), 500));
        overviewObj.put("targetEpisodeCount", ov.targetEpisodeCount());
        overviewObj.put("targetDurationSeconds", ov.targetDurationSeconds());
        root.put("overview", overviewObj);

        JSONArray outlineArr = new JSONArray();
        if (project.outlineSections() != null) {
            for (ScriptDtos.OutlineSection sec : project.outlineSections()) {
                JSONObject item = new JSONObject();
                item.put("title", safe(sec.title()));
                item.put("content", clip(sec.content(), 450));
                outlineArr.add(item);
            }
        }
        root.put("outlineSections", outlineArr);

        JSONArray charArr = new JSONArray();
        if (project.characters() != null) {
            int limit = Math.min(project.characters().size(), 20);
            for (int i = 0; i < limit; i++) {
                ScriptDtos.Character ch = project.characters().get(i);
                JSONObject item = new JSONObject();
                item.put("name", safe(ch.name()));
                item.put("roleType", safe(ch.roleType()));
                item.put("identity", clip(ch.identity(), 160));
                item.put("goal", clip(ch.goal(), 160));
                charArr.add(item);
            }
        }
        root.put("characters", charArr);

        if (project.worldSetting() != null) {
            JSONObject worldObj = new JSONObject();
            worldObj.put("era", safe(project.worldSetting().era()));
            worldObj.put("region", safe(project.worldSetting().region()));
            worldObj.put("overallTone", clip(project.worldSetting().overallTone(), 300));
            worldObj.put("worldItemCount", project.worldItems() == null ? 0 : project.worldItems().size());
            if (project.locations() != null && !project.locations().isEmpty()) {
                worldObj.put("locations", project.locations().stream()
                        .limit(15).map(ScriptDtos.Location::name).toList());
            }
            root.put("world", worldObj);
        }

        JSONArray episodesArr = new JSONArray();
        mapping.refToEpisode().forEach((ref, ep) -> {
            JSONObject item = new JSONObject();
            item.put("ref", ref);
            item.put("episodeNumber", ep.episodeNumber());
            item.put("title", safe(ep.title()));
            item.put("summary", clip(ep.summary(), 260));
            item.put("targetDurationSeconds", ep.targetDurationSeconds());
            item.put("completionStatus", safe(ep.completionStatus()));
            episodesArr.add(item);
        });
        root.put("episodes", episodesArr);

        if (selectedEpisode != null) {
            JSONArray scenesArr = new JSONArray();
            mapping.refToScene().forEach((ref, scene) -> {
                JSONObject item = new JSONObject();
                item.put("ref", ref);
                item.put("sceneNumber", scene.sceneNumber());
                item.put("title", safe(scene.title()));
                item.put("sceneGoal", clip(scene.sceneGoal(), 220));
                item.put("excerpt", buildSceneExcerpt(scene));
                scenesArr.add(item);
            });
            root.put("selectedEpisodeScenes", scenesArr);
        }

        JSONArray actionsArr = new JSONArray();
        for (String actionType : ScriptAiActions.ALL) {
            JSONObject item = new JSONObject();
            item.put("actionType", actionType);
            item.put("label", ACTION_LABELS.getOrDefault(actionType, actionType));
            actionsArr.add(item);
        }
        root.put("availableActions", actionsArr);

        JSONArray historyArr = new JSONArray();
        int start = Math.max(0, history.size() - MAX_HISTORY_MESSAGES);
        for (int i = start; i < history.size(); i++) {
            AgentSessionHistoryMessage msg = history.get(i);
            JSONObject h = new JSONObject();
            h.put("role", msg.role());
            h.put("content", clip(msg.text(), 800));
            historyArr.add(h);
        }
        root.put("history", historyArr);
        root.put("userMessage", request.message().trim());
        return root;
    }

    /** 拼接单个场次的简短正文摘要供模型理解上下文。 */
    private String buildSceneExcerpt(ScriptDtos.Scene scene) {
        if (scene.blocks() == null || scene.blocks().isEmpty()) {
            return clip(scene.actionSummary(), 260);
        }
        StringBuilder sb = new StringBuilder();
        for (ScriptDtos.ScriptBlock block : scene.blocks()) {
            if (!StringUtils.hasText(block.content())) {
                continue;
            }
            if (!sb.isEmpty()) {
                sb.append(" / ");
            }
            sb.append(block.content().trim());
            if (sb.length() >= 320) {
                break;
            }
        }
        return clip(sb.toString(), 320);
    }

    private ScriptDtos.EpisodeSummary findEpisode(ScriptDtos.ProjectDetail project, String episodeId) {
        if (!StringUtils.hasText(episodeId) || project.episodes() == null) {
            return null;
        }
        return project.episodes().stream().filter(ep -> episodeId.equals(ep.id())).findFirst().orElse(null);
    }

    private String episodeLabel(ScriptDtos.EpisodeSummary ep) {
        return "第" + ep.episodeNumber() + "集" + (StringUtils.hasText(ep.title()) ? " · " + ep.title().trim() : "");
    }

    private String sceneLabel(ScriptDtos.Scene scene) {
        return "第" + scene.sceneNumber() + "场" + (StringUtils.hasText(scene.title()) ? " · " + scene.title().trim() : "");
    }

    private String safe(String value) {
        return value == null ? "" : value.trim();
    }

    private String clip(String value, int maxLen) {
        String text = safe(value);
        if (text.length() <= maxLen) {
            return text;
        }
        return text.substring(0, maxLen) + "…";
    }

    /** 批内短序号与真实分集/场次映射。 */
    private record RefMapping(
            Map<String, ScriptDtos.EpisodeSummary> refToEpisode,
            Map<String, String> episodeIdToRef,
            Map<String, ScriptDtos.Scene> refToScene,
            Map<String, String> sceneIdToRef) {
    }

    /** 解析后的真实推荐动作目标。 */
    private record ResolvedTarget(String targetType, String targetId, String targetLabel) {
    }
}
