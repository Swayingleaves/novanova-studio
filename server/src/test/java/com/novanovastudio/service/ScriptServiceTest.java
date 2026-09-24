package com.novanovastudio.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.any;
import static org.mockito.Mockito.anyString;
import static org.mockito.Mockito.lenient;

import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.ScriptDtos;
import com.novanovastudio.repository.ScriptRepository;
import com.novanovastudio.security.CurrentUserProvider;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import java.time.OffsetDateTime;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.transaction.reactive.TransactionalOperator;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 剧本项目隔离、分页与保存边界测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-09-20 20:00
 */
@ExtendWith(MockitoExtension.class)
class ScriptServiceTest {

    /** 剧本关系数据仓储。 */
    @Mock private ScriptRepository repository;
    /** 当前用户。 */
    @Mock private CurrentUserProvider currentUserProvider;
    /** 响应式事务操作器。 */
    @Mock private TransactionalOperator transactionalOperator;
    /** 漫剧下游影响标记服务。 */
    @Mock private ComicDramaImpactService comicDramaImpactService;
    /** 结构校验器。 */
    private Validator validator;
    /** 被测剧本服务。 */
    private ScriptService service;

    /**
     * 初始化当前用户和被测服务。
     */
    @BeforeEach
    void setUp() {
        validator = Validation.buildDefaultValidatorFactory().getValidator();
        lenient().when(comicDramaImpactService.markUpstreamChanges(anyString(), anyString(), any(), anyString()))
                .thenReturn(Mono.just(0L));
        service = new ScriptService(repository, currentUserProvider, transactionalOperator, validator, comicDramaImpactService);
    }

    /**
     * 验证完整候选方向JSON能够解析并保留用户选择。
     */
    @Test
    void shouldParseSelectedStoryDirectionDraft() {
        JSONObject draftData = storyDirectionDraftData();
        draftData.put("selectedIndex", 2);

        ScriptDtos.StoryDirectionDraft result = ScriptStructuredDraftParser.parseStoryDirectionDraft(draftData);

        assertEquals(2, result.selectedIndex());
        assertEquals("方向三", result.candidates().get(2).name());
    }

    /**
     * 验证候选方向缺少必填字段时返回准确字段路径。
     */
    @Test
    void shouldRejectStoryDirectionDraftWithMissingLogline() {
        JSONObject draftData = storyDirectionDraftData();
        draftData.getJSONArray("candidates").getJSONObject(0).remove("logline");

        BusinessException exception = assertThrows(BusinessException.class,
                () -> serviceTestValidate(ScriptStructuredDraftParser.parseStoryDirectionDraft(draftData)));

        assertTrue(exception.getMessage().contains("candidates[0].logline"));
    }

    /**
     * 验证大纲JSON数组会转换为实际领域对象，而不是保留为JSONObject。
     */
    @Test
    void shouldParseOutlineDraftElementsAsDomainRecords() {
        JSONObject draftData = JSONObject.parseObject("""
                {"sections":[{"id":"section-1","sectionType":"act","title":"开端","content":"建立世界","sortOrder":0}],
                 "events":[{"id":"event-1","outlineSectionId":"section-1","episodeId":"","sceneId":"","eventType":"plot","title":"发现异常","description":"主角发现线索","sortOrder":0}]}
                """);

        ScriptDtos.OutlineDraft result = ScriptStructuredDraftParser.parseOutlineDraft(draftData);

        assertEquals("开端", result.sections().getFirst().title());
        assertEquals("发现异常", result.events().getFirst().title());
    }

    /**
     * 验证分页搜索严格使用登录用户标识。
     */
    @Test
    void shouldScopeProjectSearchToCurrentUser() {
        when(currentUserProvider.currentUserId()).thenReturn(Mono.just(8L));
        when(repository.listProjects(8L, "悬疑", "writing", "comicDrama", 20, 20)).thenReturn(Flux.empty());
        when(repository.countProjects(8L, "悬疑", "writing", "comicDrama")).thenReturn(Mono.just(0L));

        ScriptDtos.ProjectListResponse result = service.listProjects(2, 20, "悬疑", "writing", "comicDrama").block();

        assertEquals(2, result.page());
        assertEquals(0, result.total());
        verify(repository).listProjects(8L, "悬疑", "writing", "comicDrama", 20, 20);
    }

    /**
     * 验证批量软删除仅使用当前用户和项目修订号。
     */
    @Test
    void shouldScopeSoftDeletionToCurrentUser() {
        when(currentUserProvider.currentUserId()).thenReturn(Mono.just(8L));
        when(repository.deleteProject(8L, "project-a", 3L)).thenReturn(Mono.just(
                new ScriptDtos.DeletedProjectResult("project-a", 4L, OffsetDateTime.now())));
        when(transactionalOperator.transactional(org.mockito.ArgumentMatchers.<Mono<List<ScriptDtos.DeletedProjectResult>>>any()))
                .thenAnswer(invocation -> invocation.getArgument(0));

        service.deleteProjects(List.of(new ScriptDtos.ProjectDeletion("project-a", 3L))).block();

        verify(repository).deleteProject(8L, "project-a", 3L);
    }

    /**
     * 验证批量软删除遇到旧修订号时返回数据冲突。
     */
    @Test
    void shouldRejectStaleProjectDeletionRevision() {
        when(currentUserProvider.currentUserId()).thenReturn(Mono.just(8L));
        when(repository.deleteProject(8L, "project-a", 2L)).thenReturn(Mono.empty());
        when(transactionalOperator.transactional(org.mockito.ArgumentMatchers.<Mono<List<ScriptDtos.DeletedProjectResult>>>any()))
                .thenAnswer(invocation -> invocation.getArgument(0));

        BusinessException exception = assertThrows(BusinessException.class, () -> service.deleteProjects(
                List.of(new ScriptDtos.ProjectDeletion("project-a", 2L))).block());

        assertEquals(ErrorCode.DATA_CONFLICT, exception.getCode());
    }

    /**
     * 验证旧修订号无法覆盖云端剧本。
     */
    @Test
    void shouldRejectStaleOverviewRevision() {
        ScriptDtos.ProjectOverview overview = new ScriptDtos.ProjectOverview("剧本", "comicDrama", "", "", "",
                0, 1, "", "", "", "", "");
        when(currentUserProvider.currentUserId()).thenReturn(Mono.just(8L));
        when(repository.updateOverview(8L, "project-a", 3L, overview)).thenReturn(Mono.just(0L));
        when(transactionalOperator.transactional(org.mockito.ArgumentMatchers.<Mono<ScriptDtos.MutationResult>>any()))
                .thenAnswer(invocation -> invocation.getArgument(0));

        BusinessException exception = assertThrows(BusinessException.class,
                () -> service.saveOverview(new ScriptDtos.SaveOverviewRequest("project-a", 3L, overview)).block());

        assertEquals(ErrorCode.DATA_CONFLICT, exception.getCode());
    }

    /**
     * 验证删除仍被对白引用的人物时返回具体集场位置。
     */
    @Test
    void shouldDescribeCharacterReferenceLocationBeforeDeletion() {
        ScriptDtos.ProjectOverview overview = new ScriptDtos.ProjectOverview("剧本", "comicDrama", "", "", "",
                0, 1, "", "", "", "", "");
        ScriptDtos.Character character = new ScriptDtos.Character("person-a", "人物", "", "", "", "", "", "", "", "",
                "", "", "", "", "", "", "", 0, 0, 0);
        ScriptRepository.ProjectRecord project = new ScriptRepository.ProjectRecord("project-a", 8L, overview,
                "writing", 40, 4L, null, OffsetDateTime.now(), OffsetDateTime.now());
        when(currentUserProvider.currentUserId()).thenReturn(Mono.just(8L));
        when(repository.getProject(8L, "project-a")).thenReturn(Mono.just(project));
        when(repository.countIdsOwnedByAnotherProject("project-a", "character", List.of())).thenReturn(Mono.just(0L));
        when(repository.countIdsOwnedByAnotherProject("project-a", "relation", List.of())).thenReturn(Mono.just(0L));
        when(repository.listCharacters("project-a")).thenReturn(Flux.just(character));
        when(repository.countCharacterReferences("project-a", List.of("person-a"))).thenReturn(Mono.just(1L));
        when(repository.listCharacterReferenceLocations("project-a", List.of("person-a")))
                .thenReturn(Flux.just("第1集第2场（对白）"));

        BusinessException exception = assertThrows(BusinessException.class, () -> service.saveCharacters(
                new ScriptDtos.SaveCharactersRequest("project-a", 4L, List.of(), List.of())).block());

        assertTrue(exception.getMessage().contains("第1集第2场（对白）"));
        verifyNoInteractions(transactionalOperator);
    }

    /**
     * 验证放弃AI草稿也必须校验当前项目修订号。
     */
    @Test
    void shouldRejectDiscardingAiDraftWithStaleRevision() {
        ScriptDtos.ProjectOverview overview = new ScriptDtos.ProjectOverview("剧本", "comicDrama", "", "", "",
                0, 1, "", "", "", "", "");
        ScriptRepository.ProjectRecord project = new ScriptRepository.ProjectRecord("project-a", 8L, overview,
                "idea", 0, 4L, null, OffsetDateTime.now(), OffsetDateTime.now());
        when(currentUserProvider.currentUserId()).thenReturn(Mono.just(8L));
        when(repository.getProject(8L, "project-a")).thenReturn(Mono.just(project));
        when(transactionalOperator.transactional(org.mockito.ArgumentMatchers.<Mono<ScriptDtos.MutationResult>>any()))
                .thenAnswer(invocation -> invocation.getArgument(0));

        BusinessException exception = assertThrows(BusinessException.class, () -> service.discardAiDraft(
                new ScriptDtos.DiscardAiDraftRequest("project-a", 3L, "draft-a")).block());

        assertEquals(ErrorCode.DATA_CONFLICT, exception.getCode());
    }

    /**
     * 验证错误的场次顺序在访问仓储前被拒绝。
     */
    @Test
    void shouldRejectNonContinuousSceneOrder() {
        ScriptDtos.EpisodeSummary episode = new ScriptDtos.EpisodeSummary("episode", 1, "第一集", "", "", "", "", "", 0, "draft", 0);
        ScriptDtos.Scene scene = new ScriptDtos.Scene("scene", null, 1, "场次", "interior", "", "", "", "", "", "", 2,
                List.of(), List.of());

        assertThrows(BusinessException.class, () -> service.saveEpisode(new ScriptDtos.SaveEpisodeRequest("project-a", 0L,
                new ScriptDtos.EpisodeDetail(episode, List.of(scene)))));
        verifyNoInteractions(repository);
    }

    /**
     * 验证基于旧修订生成的AI草稿不能通过伪造当前修订号应用。
     */
    @Test
    void shouldRejectAiDraftWhoseBaseRevisionIsStale() {
        ScriptDtos.ProjectOverview overview = new ScriptDtos.ProjectOverview("剧本", "comicDrama", "", "", "",
                0, 1, "", "", "", "", "");
        ScriptRepository.ProjectRecord project = new ScriptRepository.ProjectRecord("project-a", 8L, overview,
                "idea", 0, 4L, null, OffsetDateTime.now(), OffsetDateTime.now());
        ScriptDtos.AiDraft draft = new ScriptDtos.AiDraft("draft-a", "project-a", "polish", "overview", null,
                3L, "", new JSONObject(), new JSONObject(), "text-model", 1, "pending", OffsetDateTime.now());
        when(currentUserProvider.currentUserId()).thenReturn(Mono.just(8L));
        when(repository.getProject(8L, "project-a")).thenReturn(Mono.just(project));
        when(repository.getPendingAiDraft("project-a", "draft-a")).thenReturn(Mono.just(draft));

        BusinessException exception = assertThrows(BusinessException.class, () -> service.applyAiDraft(
                new ScriptDtos.ApplyAiDraftRequest("project-a", 4L, "draft-a", new JSONObject())).block());

        assertEquals(ErrorCode.DATA_CONFLICT, exception.getCode());
        verifyNoInteractions(transactionalOperator);
    }

    /**
     * 创建包含三个完整候选项的故事方向JSON。
     *
     * @return JSONObject 候选故事方向草稿
     */
    private JSONObject storyDirectionDraftData() {
        return JSONObject.parseObject("""
                {"selectedIndex":0,"candidates":[
                  {"name":"方向一","logline":"创意一","synopsis":"梗概一","theme":"主题一","mainConflict":"冲突一","endingDirection":"结局一"},
                  {"name":"方向二","logline":"创意二","synopsis":"梗概二","theme":"主题二","mainConflict":"冲突二","endingDirection":"结局二"},
                  {"name":"方向三","logline":"创意三","synopsis":"梗概三","theme":"主题三","mainConflict":"冲突三","endingDirection":"结局三"}]}
                """);
    }

    /**
     * 使用服务内相同的Bean Validation规则校验测试草稿。
     *
     * @param draft StoryDirectionDraft 待校验候选方向
     * @return void 无返回值
     * @throws BusinessException 草稿字段不符合约束时抛出
     */
    private void serviceTestValidate(ScriptDtos.StoryDirectionDraft draft) {
        var violations = validator.validate(draft);
        if (!violations.isEmpty()) {
            var violation = violations.iterator().next();
            throw new BusinessException(ErrorCode.PARAM_INVALID,
                    violation.getPropertyPath() + "：" + violation.getMessage());
        }
    }
}
