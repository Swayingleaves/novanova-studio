package com.novanovastudio.service;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;

import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSON;
import com.novanovastudio.agent.AgentScopeAgentFactory;
import com.novanovastudio.agent.AgentScopeModelFactory;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.dto.ScriptDtos;
import com.novanovastudio.dto.NovelAdaptationDtos;
import com.novanovastudio.repository.NovelAdaptationRepository;
import com.novanovastudio.security.CurrentUserProvider;
import io.agentscope.core.ReActAgent;
import io.agentscope.core.agent.RuntimeContext;
import io.agentscope.core.message.Msg;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.IntStream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.ArgumentCaptor;
import org.mockito.junit.jupiter.MockitoExtension;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.reactive.TransactionalOperator;
import reactor.core.publisher.Mono;

/**
 * 剧本AI动作前置条件及上下文安全边界测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-09-20 20:00
 */
@ExtendWith(MockitoExtension.class)
class ScriptAgentServiceTest {

    /** 当前用户。 */
    @Mock private CurrentUserProvider currentUserProvider;
    /** 文本模型解析工厂。 */
    @Mock private AgentScopeModelFactory modelFactory;
    /** 剧本Agent工厂。 */
    @Mock private AgentScopeAgentFactory agentFactory;
    /** 积分服务。 */
    @Mock private CreditService creditService;
    /** 剧本领域服务。 */
    @Mock private ScriptService scriptService;
    /** 小说改编来源仓储。 */
    @Mock private NovelAdaptationRepository novelAdaptationRepository;
    /** 草稿来源保存事务。 */
    @Mock private TransactionalOperator transactionalOperator;
    /** 结构校验器。 */
    private Validator validator;
    /** 被测Agent服务。 */
    private ScriptAgentService service;

    /**
     * 初始化不访问外部模型的被测服务。
     */
    @BeforeEach
    void setUp() {
        validator = Validation.buildDefaultValidatorFactory().getValidator();
        service = new ScriptAgentService(currentUserProvider, modelFactory, agentFactory,
                new NovanovaProperties(), creditService, scriptService, validator,
                novelAdaptationRepository, transactionalOperator);
    }

    /**
     * 验证候选故事方向的嵌套必填字段错误会携带准确字段路径。
     */
    @Test
    void shouldReportInvalidStoryDirectionFieldPath() {
        JSONObject draft = new JSONObject();
        draft.put("selectedIndex", 0);
        draft.put("candidates", List.of(
                new ScriptDtos.StoryDirection("方向一", "", "梗概一", "主题一", "冲突一", "结局一"),
                new ScriptDtos.StoryDirection("方向二", "创意二", "梗概二", "主题二", "冲突二", "结局二"),
                new ScriptDtos.StoryDirection("方向三", "创意三", "梗概三", "主题三", "冲突三", "结局三")));

        BusinessException exception = assertThrows(BusinessException.class,
                () -> ReflectionTestUtils.invokeMethod(service, "validateOverviewDraft", draft, "storyDirections"));

        assertTrue(exception.getMessage().contains("candidates[0].logline"));
    }

    /**
     * 验证三个完整候选方向可以通过校验。
     */
    @Test
    void shouldAcceptCompleteStoryDirections() {
        JSONObject draft = new JSONObject();
        draft.put("selectedIndex", 0);
        draft.put("candidates", List.of(
                new ScriptDtos.StoryDirection("方向一", "创意一", "梗概一", "主题一", "冲突一", "结局一"),
                new ScriptDtos.StoryDirection("方向二", "创意二", "梗概二", "主题二", "冲突二", "结局二"),
                new ScriptDtos.StoryDirection("方向三", "创意三", "梗概三", "主题三", "冲突三", "结局三")));

        assertDoesNotThrow(() -> ReflectionTestUtils.invokeMethod(service, "validateOverviewDraft", draft, "storyDirections"));
    }

    /**
     * 验证模型误用字段名称时不会将空候选项当作有效草稿。
     */
    @Test
    void shouldRejectRenamedStoryDirectionFields() {
        JSONObject draft = JSONObject.parseObject("""
                {"selectedIndex":0,"candidates":[
                  {"title":"方向一","summary":"创意一"},
                  {"title":"方向二","summary":"创意二"},
                  {"title":"方向三","summary":"创意三"}]}
                """);

        BusinessException exception = assertThrows(BusinessException.class,
                () -> ReflectionTestUtils.invokeMethod(service, "validateOverviewDraft", draft, "storyDirections"));

        assertTrue(exception.getMessage().contains("candidates[0]."));
    }

    /**
     * 验证动作类型与目标类型不匹配时不扣积分。
     */
    @Test
    void shouldRejectMismatchedActionTargetBeforeCharging() {
        assertThrows(BusinessException.class, () -> service.generateDraft(
                new ScriptDtos.GenerateDraftRequest("project-a", 0L, "outline", "world", null, "", "text-model")));
        verifyNoInteractions(creditService, modelFactory);
    }

    /**
     * 验证未填写任何一句话创意或故事简介时，不能生成候选故事方向。
     */
    @Test
    void shouldRequireStoryOverviewBeforeStoryDirections() {
        ScriptDtos.ProjectSnapshot snapshot = snapshot("", "");
        when(currentUserProvider.currentUserId()).thenReturn(Mono.just(8L));
        when(scriptService.getSnapshotForUser(8L, "project-a", 0L)).thenReturn(Mono.just(snapshot));

        BusinessException exception = assertThrows(BusinessException.class, () -> service.generateDraft(
                new ScriptDtos.GenerateDraftRequest("project-a", 0L, "storyDirections", "overview", null, "", "text-model")).block());
        assertTrue(exception.getMessage().contains("故事概览"));
        verifyNoInteractions(creditService, modelFactory);
    }

    /**
     * 验证未构思故事时不可直接生成大纲。
     */
    @Test
    void shouldRequireStoryDirectionBeforeOutline() {
        ScriptDtos.ProjectSnapshot snapshot = snapshot("", "");
        when(currentUserProvider.currentUserId()).thenReturn(Mono.just(8L));
        when(scriptService.getSnapshotForUser(8L, "project-a", 0L)).thenReturn(Mono.just(snapshot));

        assertThrows(BusinessException.class, () -> service.generateDraft(
                new ScriptDtos.GenerateDraftRequest("project-a", 0L, "outline", "outline", null, "", "text-model")).block());
        verifyNoInteractions(creditService, modelFactory);
    }

    /**
     * 验证模板创建的空白大纲骨架不能绕过后续AI动作前置条件。
     */
    @Test
    void shouldRejectBlankTemplateOutlineBeforeCharacterGeneration() {
        ScriptDtos.ProjectSnapshot base = snapshot("创意", "简介");
        ScriptDtos.ProjectDetail project = base.project();
        ScriptDtos.ProjectDetail withBlankOutline = new ScriptDtos.ProjectDetail(project.id(), project.sourceType(), project.overview(),
                List.of(new ScriptDtos.OutlineSection("outline-a", "act", "开端", "", 0)), project.storyEvents(),
                project.characters(), project.characterRelations(), project.worldSetting(), project.worldItems(),
                project.locations(), project.episodes(), project.stage(), project.completionRate(), project.productionStarted(),
                project.revision(), project.createdAt(), project.updatedAt());
        when(currentUserProvider.currentUserId()).thenReturn(Mono.just(8L));
        when(scriptService.getSnapshotForUser(8L, "project-a", 0L))
                .thenReturn(Mono.just(new ScriptDtos.ProjectSnapshot(withBlankOutline, List.of())));

        assertThrows(BusinessException.class, () -> service.generateDraft(
                new ScriptDtos.GenerateDraftRequest("project-a", 0L, "characters", "characters", null,
                        "", "text-model")).block());

        verifyNoInteractions(creditService, modelFactory);
    }

    /**
     * 验证全项目上下文超限时明确要求缩小范围，不静默截断或扣费。
     */
    @Test
    void shouldRejectOversizedProjectContextBeforeCharging() {
        ScriptDtos.ProjectSnapshot snapshot = snapshot("创意", "剧情".repeat(61_000));
        when(currentUserProvider.currentUserId()).thenReturn(Mono.just(8L));
        when(scriptService.getSnapshotForUser(8L, "project-a", 0L)).thenReturn(Mono.just(snapshot));
        when(scriptService.targetSnapshot(snapshot, "overview", null)).thenReturn(new JSONObject());

        BusinessException exception = assertThrows(BusinessException.class, () -> service.generateDraft(
                new ScriptDtos.GenerateDraftRequest("project-a", 0L, "storyDirections", "overview", null, "", "text-model")).block());

        assertTrue(exception.getMessage().contains("120,000"));
        verifyNoInteractions(creditService, modelFactory);
    }

    /**
     * 验证全项目分析允许不绑定分集、场次或正文块的项目级问题。
     */
    @Test
    void shouldAcceptProjectLevelAnalysisIssueWithoutEpisodeAnchor() {
        ScriptDtos.GeneratedAnalysis generated = new ScriptDtos.GeneratedAnalysis("项目主线缺少阶段性升级", List.of(
                new ScriptDtos.GeneratedAnalysisIssue("剧情", "warning", "", "", "", "冲突升级不足",
                        "主要冲突在多个分集之间缺少递进", "在关键转折前增加不可逆的代价")));

        assertDoesNotThrow(() -> ReflectionTestUtils.invokeMethod(service, "validateAnalysis",
                generated, snapshot("创意", "简介"), "project", null));
    }

    /**
     * 验证未定位分集的项目级问题不能伪造场次或正文块锚点。
     */
    @Test
    void shouldRejectProjectLevelAnalysisIssueWithDetailAnchor() {
        ScriptDtos.GeneratedAnalysis generated = new ScriptDtos.GeneratedAnalysis("项目主线缺少阶段性升级", List.of(
                new ScriptDtos.GeneratedAnalysisIssue("剧情", "warning", "", "scene-a", "", "冲突升级不足",
                        "主要冲突在多个分集之间缺少递进", "在关键转折前增加不可逆的代价")));

        BusinessException exception = assertThrows(BusinessException.class,
                () -> ReflectionTestUtils.invokeMethod(service, "validateAnalysis",
                        generated, snapshot("创意", "简介"), "project", null));

        assertTrue(exception.getMessage().contains("项目级问题"));
    }

    /**
     * 验证长篇小说的正式引用列表保留全量标识，但不传入冗长的人物与地点设定。
     */
    @Test
    void shouldProvideCompactFormalReferencesForAdaptationEpisode() {
        ScriptDtos.ProjectSnapshot snapshot = adaptationSnapshot();
        List<NovelAdaptationDtos.Fact> facts = List.of(new NovelAdaptationDtos.Fact("fact-character", 1,
                "character", "人物0", "事实设定", "", List.of()));
        NovelAdaptationDtos.GenerateRequest request = new NovelAdaptationDtos.GenerateRequest("project-a", 0,
                "episode", "episode-a", new NovelAdaptationDtos.Settings("comicDrama", 1, 60, "balanced", "faithful"),
                List.of("fact-character"), "text-model");

        Map<String, Object> context = ReflectionTestUtils.invokeMethod(service, "adaptationContext", request, snapshot, facts);
        JSONObject serialized = JSON.parseObject(JSON.toJSONString(context));

        assertEquals(526, serialized.getJSONArray("characters").size());
        assertEquals(261, serialized.getJSONArray("locations").size());
        assertEquals(Set.of("id", "name"), serialized.getJSONArray("characters").getJSONObject(0).keySet());
        assertEquals(Set.of("id", "name"), serialized.getJSONArray("locations").getJSONObject(0).keySet());
        assertEquals("character-0", serialized.getJSONArray("characters").getJSONObject(0).getString("id"));
        assertEquals("location-0", serialized.getJSONArray("locations").getJSONObject(0).getString("id"));
        assertEquals("fact-character", serialized.getJSONArray("confirmedFacts").getJSONObject(0).getString("id"));
        assertEquals("episode-a", serialized.getJSONObject("targetEpisode").getJSONObject("episode").getString("id"));
        assertDoesNotThrow(() -> ReflectionTestUtils.invokeMethod(service, "validateContextSize", context, "episode"));
    }

    /**
     * 验证使用正式人物和地点标识的场次可通过引用校验。
     */
    @Test
    void shouldAcceptFormalReferencesInAdaptationScene() {
        ScriptDtos.Scene scene = adaptationScene("character-0");

        assertDoesNotThrow(() -> ReflectionTestUtils.invokeMethod(service, "validateSceneReferences", scene, adaptationSnapshot()));
    }

    /**
     * 验证知识库事实标识仍不能代替正式人物标识，错误信息准确定位场次与非法引用。
     */
    @Test
    void shouldRejectFactIdentifierAsFormalCharacterReference() {
        BusinessException exception = assertThrows(BusinessException.class,
                () -> ReflectionTestUtils.invokeMethod(service, "validateSceneReferences",
                        adaptationScene("fact-character"), adaptationSnapshot()));

        assertTrue(exception.getMessage().contains("scene-a"));
        assertTrue(exception.getMessage().contains("fact-character"));
    }

    /**
     * 验证非法地点引用包含场次和具体地点标识，能够直接定位模型错误。
     */
    @Test
    void shouldReportInvalidLocationWithSceneAndIdentifier() {
        ScriptDtos.Scene scene = new ScriptDtos.Scene("scene-invalid", "invented-location", 1, "开场", "interior", "白天",
                "", "", "", "", "", 0, List.of(), List.of());

        BusinessException exception = assertThrows(BusinessException.class,
                () -> ReflectionTestUtils.invokeMethod(service, "validateSceneReferences", scene, adaptationSnapshot()));

        assertTrue(exception.getMessage().contains("scene-invalid"));
        assertTrue(exception.getMessage().contains("invented-location"));
    }

    /**
     * 验证整集、单场与正文块生成在模型输入中使用短序号，并在结构校验前还原正式引用。
     *
     * @param targetType String 本次生成的局部目标类型
     * @param adaptation boolean 是否使用小说改编上下文
     */
    @ParameterizedTest
    @CsvSource({"episode,false", "scene,false", "block,false", "episode,true"})
    void shouldRestoreFormalReferencesAfterDraftAgentCall(String targetType, boolean adaptation) {
        ReActAgent agent = mock(ReActAgent.class);
        Msg message = mock(Msg.class);
        ScriptDtos.ScriptBlock block = new ScriptDtos.ScriptBlock("block-a", "dialogue", "character1", "你好", "original", 0);
        ScriptDtos.Scene scene = new ScriptDtos.Scene("scene-a", "location1", 1, "开场", "interior", "白天",
                "", "", "", "", "", 0, List.of("character1"), List.of(block));
        ScriptDtos.ProjectSnapshot snapshot = adaptationSnapshot();
        Class<?> resultType = switch (targetType) {
            case "episode" -> ScriptDtos.GeneratedEpisodeDetailDraft.class;
            case "scene" -> ScriptDtos.GeneratedSceneDraft.class;
            default -> ScriptDtos.GeneratedScriptBlockDraft.class;
        };
        Object structured = switch (targetType) {
            case "episode" -> new ScriptDtos.GeneratedEpisodeDetailDraft(
                    new ScriptDtos.EpisodeDetail(snapshot.project().episodes().getFirst(), List.of(scene)));
            case "scene" -> new ScriptDtos.GeneratedSceneDraft(scene);
            default -> new ScriptDtos.GeneratedScriptBlockDraft(block);
        };
        String targetId = targetType + "-a";
        // 使用实际调用入口验证转换接线，模型由测试替身返回固定结构，不访问外部服务。
        when(agentFactory.scriptAgent(null)).thenReturn(agent);
        when(agent.call(anyString(), eq(resultType), any(RuntimeContext.class))).thenReturn(Mono.just(message));
        when(message.getStructuredData(any())).thenReturn(structured);
        Map<String, Object> context = Map.of("project", snapshot.project());
        if (adaptation) {
            NovelAdaptationDtos.GenerateRequest request = new NovelAdaptationDtos.GenerateRequest("project-a", 0,
                    "episode", targetId, new NovelAdaptationDtos.Settings("comicDrama", 1, 60, "balanced", "faithful"),
                    List.of("fact-character"), "text-model");
            context = ReflectionTestUtils.invokeMethod(service, "adaptationContext", request, snapshot,
                    List.of(new NovelAdaptationDtos.Fact("fact-character", 1, "character", "人物0", "事实设定", "", List.of())));
        }
        AgentScopeModelFactory.TextModelSelection model = new AgentScopeModelFactory.TextModelSelection(
                null, "text-model", "测试模型", "openai", java.math.BigDecimal.ZERO, 0L);
        Mono<ScriptDtos.GeneratedDraft> result = ReflectionTestUtils.invokeMethod(service, "callDraftAgent", 8L,
                "operation-a", model, new ScriptDtos.GenerateDraftRequest("project-a", 0, "polish", targetType,
                        targetId, "润色正文", "text-model"), context);
        ScriptDtos.GeneratedDraft generated = result.block();
        Mono<JSONObject> validated = ReflectionTestUtils.invokeMethod(service, "validateGeneratedDraft", generated,
                "polish", targetType, targetId, snapshot);
        assertDoesNotThrow(() -> {
            validated.block();
        });

        ArgumentCaptor<String> input = ArgumentCaptor.forClass(String.class);
        verify(agent).call(input.capture(), eq(resultType), any(RuntimeContext.class));
        JSONObject modelInput = JSON.parseObject(input.getValue());
        JSONObject modelContext = modelInput.getJSONObject("context");
        JSONObject project = adaptation ? modelContext : modelContext.getJSONObject("project");
        assertEquals("character1", project.getJSONArray("characters").getJSONObject(0).getString("id"));
        assertEquals("location1", project.getJSONArray("locations").getJSONObject(0).getString("id"));
        if (adaptation) {
            assertEquals("fact-character", modelContext.getJSONArray("confirmedFacts").getJSONObject(0).getString("id"));
        }
        assertTrue(modelInput.getString("referenceRules").contains("没有对应地点"));
        JSONObject restoredScene = "episode".equals(targetType)
                ? generated.draftData().getJSONArray("scenes").getJSONObject(0) : generated.draftData();
        if ("block".equals(targetType)) {
            assertEquals("character-0", restoredScene.getString("characterId"));
        } else {
            assertEquals("location-0", restoredScene.getString("locationId"));
            assertEquals("character-0", restoredScene.getJSONArray("blocks").getJSONObject(0).getString("characterId"));
        }
        verify(agent).close();
    }

    /**
     * 创建包含大量冗长设定的正式项目，模拟长篇小说改编的上下文容量压力。
     * @return ProjectSnapshot 包含正式人物、地点和目标集的项目快照
     */
    private ScriptDtos.ProjectSnapshot adaptationSnapshot() {
        ScriptDtos.ProjectDetail base = snapshot("创意", "简介").project();
        List<ScriptDtos.Character> characters = IntStream.range(0, 526).mapToObj(index ->
                JSONObject.of("id", "character-" + index, "name", "人物" + index,
                        "backgroundStory", "人物经历".repeat(1000)).toJavaObject(ScriptDtos.Character.class)).toList();
        List<ScriptDtos.Location> locations = IntStream.range(0, 261).mapToObj(index ->
                JSONObject.of("id", "location-" + index, "name", "地点" + index,
                        "mainEvents", "地点事件".repeat(1000)).toJavaObject(ScriptDtos.Location.class)).toList();
        ScriptDtos.EpisodeSummary episode = new ScriptDtos.EpisodeSummary("episode-a", 1, "第一集", "剧情摘要",
                "", "", "", "", 60, "planning", 0);
        ScriptDtos.ProjectDetail project = new ScriptDtos.ProjectDetail(base.id(), base.sourceType(), base.overview(), base.outlineSections(),
                base.storyEvents(), characters, List.of(), base.worldSetting(), base.worldItems(), locations,
                List.of(episode), base.stage(), base.completionRate(), false, base.revision(), null, null);
        return new ScriptDtos.ProjectSnapshot(project, List.of(new ScriptDtos.EpisodeDetail(episode, List.of())));
    }

    /**
     * 创建指定人物引用的最小合法场次。
     * @param characterId String 待校验的正式人物标识或非法事实标识
     * @return Scene 包含人物、地点引用的场次
     */
    private ScriptDtos.Scene adaptationScene(String characterId) {
        return new ScriptDtos.Scene("scene-a", "location-0", 1, "开场", "interior", "白天",
                "", "", "", "", "", 0, List.of(characterId), List.of());
    }

    /**
     * 创建不包含正文的剧本快照。
     *
     * @param logline 一句话创意
     * @param synopsis 故事简介
     * @return 项目和空分集正文组成的快照
     */
    private ScriptDtos.ProjectSnapshot snapshot(String logline, String synopsis) {
        ScriptDtos.ProjectOverview overview = new ScriptDtos.ProjectOverview("剧本", "comicDrama", "", logline, synopsis,
                0, 1, "", "", "", "", "");
        ScriptDtos.ProjectDetail project = new ScriptDtos.ProjectDetail("project-a", "", overview, List.of(), List.of(), List.of(),
                List.of(), new ScriptDtos.WorldSetting("", "", "", ""), List.of(), List.of(), List.of(),
                "idea", 0, false, 0L, null, null);
        return new ScriptDtos.ProjectSnapshot(project, List.of());
    }
}
