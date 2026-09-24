package com.novanovastudio.service;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.agent.AgentScopeAgentFactory;
import com.novanovastudio.agent.AgentScopeModelFactory;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.dto.ScriptDtos;
import com.novanovastudio.security.CurrentUserProvider;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;
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
                new NovanovaProperties(), creditService, scriptService, validator);
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
        ScriptDtos.ProjectDetail withBlankOutline = new ScriptDtos.ProjectDetail(project.id(), project.overview(),
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
     * 验证不支持的专业分析范围在访问用户数据前被拒绝。
     */
    @Test
    void shouldRejectUnsupportedAnalysisScope() {
        assertThrows(BusinessException.class, () -> service.analyzeScript(
                new ScriptDtos.AnalyzeScriptRequest("project-a", 0L, "scene", "scene-a", "", "text-model")));
        verifyNoInteractions(creditService, modelFactory, scriptService);
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
     * 创建不包含正文的剧本快照。
     *
     * @param logline 一句话创意
     * @param synopsis 故事简介
     * @return 项目和空分集正文组成的快照
     */
    private ScriptDtos.ProjectSnapshot snapshot(String logline, String synopsis) {
        ScriptDtos.ProjectOverview overview = new ScriptDtos.ProjectOverview("剧本", "comicDrama", "", logline, synopsis,
                0, 1, "", "", "", "", "");
        ScriptDtos.ProjectDetail project = new ScriptDtos.ProjectDetail("project-a", overview, List.of(), List.of(), List.of(),
                List.of(), new ScriptDtos.WorldSetting("", "", "", ""), List.of(), List.of(), List.of(),
                "idea", 0, false, 0L, null, null);
        return new ScriptDtos.ProjectSnapshot(project, List.of());
    }
}
