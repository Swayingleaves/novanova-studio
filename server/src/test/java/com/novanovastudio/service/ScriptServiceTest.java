package com.novanovastudio.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.any;
import static org.mockito.Mockito.anyString;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.ScriptDtos;
import com.novanovastudio.repository.ScriptRepository;
import com.novanovastudio.repository.NovelAdaptationRepository;
import com.novanovastudio.security.CurrentUserProvider;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.mockito.ArgumentCaptor;
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
    /** 小说改编来源仓储。 */
    @Mock private NovelAdaptationRepository novelAdaptationRepository;
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
        service = new ScriptService(repository, currentUserProvider, transactionalOperator, validator,
                comicDramaImpactService, novelAdaptationRepository);
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
        ScriptDtos.ProjectOverview stored = new ScriptDtos.ProjectOverview("剧本", "comicDrama", "", "", "",
                0, 1, "", "", "", "", "");
        // 内容必须与库中不同：saveOverview 对未变更的概览会短路返回，不写库也不校验修订号，
        // 那样就测不到旧修订号这条分支了。
        ScriptDtos.ProjectOverview changed = new ScriptDtos.ProjectOverview("剧本", "comicDrama", "玄幻", "新的一句话创意",
                "", 0, 1, "", "", "", "", "");
        ScriptRepository.ProjectRecord project = new ScriptRepository.ProjectRecord("project-a", 8L, stored,
                "writing", 40, 4L, null, OffsetDateTime.now(), OffsetDateTime.now());
        when(currentUserProvider.currentUserId()).thenReturn(Mono.just(8L));
        when(repository.getProject(8L, "project-a")).thenReturn(Mono.just(project));
        stubEmptyProjectReads();
        when(repository.updateOverview(8L, "project-a", 3L, changed)).thenReturn(Mono.just(0L));
        when(transactionalOperator.transactional(org.mockito.ArgumentMatchers.<Mono<ScriptDtos.MutationResult>>any()))
                .thenAnswer(invocation -> invocation.getArgument(0));

        BusinessException exception = assertThrows(BusinessException.class,
                () -> service.saveOverview(new ScriptDtos.SaveOverviewRequest("project-a", 3L, changed)).block());

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
                "", "", "", "", "", "", "", 0);
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
                3L, "", new JSONObject(), new JSONObject(), "text-model", java.math.BigDecimal.valueOf(1), "pending", OffsetDateTime.now());
        when(currentUserProvider.currentUserId()).thenReturn(Mono.just(8L));
        when(repository.getProject(8L, "project-a")).thenReturn(Mono.just(project));
        when(repository.getPendingAiDraft("project-a", "draft-a")).thenReturn(Mono.just(draft));

        BusinessException exception = assertThrows(BusinessException.class, () -> service.applyAiDraft(
                new ScriptDtos.ApplyAiDraftRequest("project-a", 4L, "draft-a", new JSONObject())).block());

        assertEquals(ErrorCode.DATA_CONFLICT, exception.getCode());
        verifyNoInteractions(transactionalOperator);
    }

    /** 验证已生成草稿中的通用短标识不会占用其他项目的主键，应用状态保存同步后的引用。 */
    @Test
    void shouldApplyOutlineDraftWithIdsAlreadyUsedByAnotherProject() {
        JSONObject data = outlineDraftData();
        stubOutlineDraft(data, List.of(), List.of(), "outline");
        stubOutlineWrites(List.of("section-1", "event-1"));

        service.applyAiDraft(new ScriptDtos.ApplyAiDraftRequest("project-a", 4L, "draft-a", data)).block();

        ScriptDtos.OutlineDraft applied = captureAppliedOutline();
        String sectionId = applied.sections().getFirst().id();
        String eventId = applied.events().getFirst().id();
        assertNotEquals("section-1", sectionId);
        assertNotEquals("event-1", eventId);
        assertEquals(sectionId, UUID.fromString(sectionId).toString());
        assertEquals(eventId, UUID.fromString(eventId).toString());
        assertEquals(sectionId, applied.events().getFirst().outlineSectionId());
        verify(repository).updateAiDraftStatus("project-a", "draft-a", "applied", data);
        assertEquals(applied, ScriptStructuredDraftParser.parseOutlineDraft(data));
    }

    /** 验证编辑已有大纲时保留结构段和事件的稳定标识。 */
    @Test
    void shouldPreserveExistingOutlineIds() {
        JSONObject data = outlineDraftData();
        ScriptDtos.OutlineDraft existing = ScriptStructuredDraftParser.parseOutlineDraft(data);
        stubOutlineDraft(data, existing.sections(), existing.events(), "outline");
        stubOutlineWrites(List.of());

        service.applyAiDraft(new ScriptDtos.ApplyAiDraftRequest("project-a", 4L, "draft-a", data)).block();

        assertEquals(existing, captureAppliedOutline());
    }

    /** 验证新增事件引用已有结构段时，只给新增事件分配唯一标识。 */
    @Test
    void shouldAssignNewEventIdAndPreserveExistingSectionReference() {
        JSONObject data = outlineDraftData();
        ScriptDtos.OutlineDraft existing = ScriptStructuredDraftParser.parseOutlineDraft(data);
        stubOutlineDraft(data, existing.sections(), List.of(), "outline");
        stubOutlineWrites(List.of());

        service.applyAiDraft(new ScriptDtos.ApplyAiDraftRequest("project-a", 4L, "draft-a", data)).block();

        ScriptDtos.OutlineDraft applied = captureAppliedOutline();
        assertEquals("section-1", applied.sections().getFirst().id());
        assertEquals("section-1", applied.events().getFirst().outlineSectionId());
        assertNotEquals("event-1", applied.events().getFirst().id());
    }

    /** 验证小说改编来源追溯使用应用后的正式标识。 */
    @Test
    void shouldRecordAdaptationSourcesWithAssignedOutlineIds() {
        JSONObject data = outlineDraftData();
        stubOutlineDraft(data, List.of(), List.of(), "novelAdaptationoutline");
        stubOutlineWrites(List.of());

        service.applyAiDraft(new ScriptDtos.ApplyAiDraftRequest("project-a", 4L, "draft-a", data)).block();

        ScriptDtos.OutlineDraft applied = captureAppliedOutline();
        verify(novelAdaptationRepository).recordApplied("draft-a", "project-a", "outline", null, data,
                List.of(applied.sections().getFirst().id(), applied.events().getFirst().id()));
    }

    /** 验证不存在的结构段引用不会在标识映射时被清空并静默放行。 */
    @Test
    void shouldRejectUnknownOutlineSectionReferenceBeforeAssigningIds() {
        JSONObject data = outlineDraftData();
        data.getJSONArray("events").getJSONObject(0).put("outlineSectionId", "unknown-section");
        stubOutlineDraft(data, List.of(), List.of(), "outline");

        BusinessException exception = assertThrows(BusinessException.class, () -> service.applyAiDraft(
                new ScriptDtos.ApplyAiDraftRequest("project-a", 4L, "draft-a", data)).block());

        assertTrue(exception.getMessage().contains("故事事件关联了不存在的大纲结构段"));
        assertEquals("section-1", data.getJSONArray("sections").getJSONObject(0).getString("id"));
        verify(repository, never()).advanceRevision(anyLong(), anyString(), anyLong());
    }

    /** 验证重复事件标识不会通过分配新标识被掩盖。 */
    @Test
    void shouldRejectDuplicateOutlineEventIdsBeforeAssigningIds() {
        JSONObject data = outlineDraftData();
        JSONObject duplicate = JSON.parseObject(data.getJSONArray("events").getJSONObject(0).toJSONString());
        duplicate.put("sortOrder", 1);
        data.getJSONArray("events").add(duplicate);
        stubOutlineDraft(data, List.of(), List.of(), "outline");

        BusinessException exception = assertThrows(BusinessException.class, () -> service.applyAiDraft(
                new ScriptDtos.ApplyAiDraftRequest("project-a", 4L, "draft-a", data)).block());

        assertTrue(exception.getMessage().contains("故事事件"));
        verify(repository, never()).advanceRevision(anyLong(), anyString(), anyLong());
    }

    /**
     * 创建最小合法大纲草稿，模拟模型重复使用的通用标识。
     *
     * @return JSONObject 大纲草稿
     */
    private JSONObject outlineDraftData() {
        return JSONObject.parseObject("""
                {"sections":[{"id":"section-1","sectionType":"act","title":"开端","content":"建立世界","sortOrder":0}],
                 "events":[{"id":"event-1","outlineSectionId":"section-1","episodeId":"","sceneId":"","eventType":"plot","title":"发现异常","description":"主角发现线索","sortOrder":0}]}
                """);
    }

    /**
     * 准备待应用草稿与真实序列化形态的目标基线。
     *
     * @param data JSONObject 待应用草稿
     * @param sections List 当前项目结构段
     * @param events List 当前项目事件
     * @param actionType String 草稿动作类型
     */
    private void stubOutlineDraft(JSONObject data, List<ScriptDtos.OutlineSection> sections,
                                  List<ScriptDtos.StoryEvent> events, String actionType) {
        ScriptDtos.ProjectOverview overview = new ScriptDtos.ProjectOverview("剧本", "comicDrama", "", "", "",
                0, 1, "", "", "", "", "");
        when(currentUserProvider.currentUserId()).thenReturn(Mono.just(8L));
        when(repository.getProject(8L, "project-a")).thenReturn(Mono.just(new ScriptRepository.ProjectRecord(
                "project-a", 8L, overview, "idea", 0, 4L, null, OffsetDateTime.now(), OffsetDateTime.now())));
        stubEmptyProjectReads();
        when(repository.listOutlineSections("project-a")).thenReturn(Flux.fromIterable(sections));
        when(repository.listStoryEvents("project-a")).thenReturn(Flux.fromIterable(events));
        JSONObject source = JSON.parseObject(JSON.toJSONString(new ScriptDtos.OutlineDraft(sections, events)));
        when(repository.getPendingAiDraft("project-a", "draft-a")).thenReturn(Mono.just(new ScriptDtos.AiDraft(
                "draft-a", "project-a", actionType, "outline", null, 4L, "", source,
                JSON.parseObject(data.toJSONString()), "text-model", java.math.BigDecimal.valueOf(1), "pending", OffsetDateTime.now())));
        when(transactionalOperator.transactional(org.mockito.ArgumentMatchers.<Mono<ScriptDtos.MutationResult>>any()))
                .thenAnswer(invocation -> invocation.getArgument(0));
    }

    /**
     * 准备大纲应用的版本、来源、修订和状态写入。
     *
     * @param foreignIds List 其他项目已占用的标识
     */
    private void stubOutlineWrites(List<String> foreignIds) {
        when(repository.createVersion(anyString(), eq("project-a"), eq(8L), anyString(), anyString(), anyString(), anyLong(), any()))
                .thenReturn(Mono.empty());
        when(novelAdaptationRepository.requireTargetSelectionForDraft("draft-a", "project-a", "outline", null, List.of()))
                .thenReturn(Mono.empty());
        when(repository.countIdsOwnedByAnotherProject(eq("project-a"), anyString(), anyList()))
                .thenAnswer(invocation -> Mono.just(invocation.<List<String>>getArgument(2).stream()
                        .filter(foreignIds::contains).count()));
        when(repository.advanceRevision(8L, "project-a", 4L)).thenReturn(Mono.just(1L));
        when(repository.replaceOutline(eq("project-a"), anyList(), anyList())).thenReturn(Mono.empty());
        when(novelAdaptationRepository.recordApplied(eq("draft-a"), eq("project-a"), eq("outline"), any(), any(), anyList()))
                .thenReturn(Mono.empty());
        when(repository.updateAiDraftStatus(eq("project-a"), eq("draft-a"), eq("applied"), any())).thenReturn(Mono.just(1L));
        when(repository.updateProgress(eq("project-a"), anyString(), anyInt())).thenReturn(Mono.empty());
    }

    /**
     * 捕获正式写入的大纲，核对持久化标识与引用。
     *
     * @return OutlineDraft 正式写入的数据
     */
    private ScriptDtos.OutlineDraft captureAppliedOutline() {
        ArgumentCaptor<List<ScriptDtos.OutlineSection>> sections = ArgumentCaptor.forClass(List.class);
        ArgumentCaptor<List<ScriptDtos.StoryEvent>> events = ArgumentCaptor.forClass(List.class);
        verify(repository).replaceOutline(eq("project-a"), sections.capture(), events.capture());
        return new ScriptDtos.OutlineDraft(sections.getValue(), events.getValue());
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

    /**
     * 准备项目详情读取的空结果，供需要完整快照的保存类用例复用。
     * <p>
     * 保存类接口会先读取全量项目详情判断内容是否变化，缺任一读取都会在 zip 阶段拿到 null。
     */
    private void stubEmptyProjectReads() {
        lenient().when(repository.listOutlineSections("project-a")).thenReturn(Flux.empty());
        lenient().when(repository.listStoryEvents("project-a")).thenReturn(Flux.empty());
        lenient().when(repository.listCharacters("project-a")).thenReturn(Flux.empty());
        lenient().when(repository.listCharacterRelations("project-a")).thenReturn(Flux.empty());
        lenient().when(repository.getWorldSetting("project-a"))
                .thenReturn(Mono.just(new ScriptDtos.WorldSetting("", "", "", "")));
        lenient().when(repository.listWorldItems("project-a")).thenReturn(Flux.empty());
        lenient().when(repository.listLocations("project-a")).thenReturn(Flux.empty());
        lenient().when(repository.listEpisodes("project-a")).thenReturn(Flux.empty());
    }
}
