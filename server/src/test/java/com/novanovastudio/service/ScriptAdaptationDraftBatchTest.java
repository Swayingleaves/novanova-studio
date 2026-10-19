package com.novanovastudio.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.ScriptDtos;
import com.novanovastudio.repository.NovelAdaptationRepository;
import com.novanovastudio.repository.ScriptRepository;
import com.novanovastudio.security.CurrentUserProvider;
import jakarta.validation.Validation;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import java.util.stream.IntStream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.transaction.ReactiveTransaction;
import org.springframework.transaction.ReactiveTransactionManager;
import org.springframework.transaction.reactive.TransactionalOperator;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 小说改编停点批量应用的共同基线、内容累积与事务边界回归测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-09-30 12:00
 */
@ExtendWith(MockitoExtension.class)
class ScriptAdaptationDraftBatchTest {

    /** 剧本数据仓储。 */
    @Mock private ScriptRepository repository;
    /** 改编来源仓储。 */
    @Mock private NovelAdaptationRepository novelAdaptationRepository;
    /** 当前用户提供器。 */
    @Mock private CurrentUserProvider currentUserProvider;
    /** 下游影响服务。 */
    @Mock private ComicDramaImpactService comicDramaImpactService;
    /** 事务管理器，用真实响应式事务操作器验证提交与回滚。 */
    @Mock private ReactiveTransactionManager transactionManager;
    /** 本批数据库事务。 */
    @Mock private ReactiveTransaction transaction;
    /** 模拟持久化项目修订号。 */
    private final AtomicLong revision = new AtomicLong(4);
    /** 模拟持久化人物列表，验证后续批次读取前序应用结果。 */
    private final AtomicReference<List<ScriptDtos.Character>> characters = new AtomicReference<>(List.of());
    /** 已成功更新状态的草稿标识。 */
    private final List<String> appliedDraftIds = new ArrayList<>();
    /** 被测剧本服务。 */
    private ScriptService service;

    /**
     * 准备按订阅时间读取状态的仓储与真实响应式事务操作器。
     */
    @BeforeEach
    void setUp() {
        service = new ScriptService(repository, currentUserProvider, TransactionalOperator.create(transactionManager),
                Validation.buildDefaultValidatorFactory().getValidator(), comicDramaImpactService, novelAdaptationRepository);
        when(currentUserProvider.currentUserId()).thenReturn(Mono.just(8L));
        when(transactionManager.getReactiveTransaction(any())).thenReturn(Mono.just(transaction));
        lenient().when(transactionManager.commit(transaction)).thenReturn(Mono.empty());
        lenient().when(transactionManager.rollback(transaction)).thenReturn(Mono.empty());
        when(repository.getProject(8L, "project-a")).thenReturn(Mono.fromSupplier(() ->
                new ScriptRepository.ProjectRecord("project-a", 8L,
                        new ScriptDtos.ProjectOverview("剧本", "comicDrama", "", "", "", 0, 1, "", "", "", "", ""),
                        "idea", 0, revision.get(), null, OffsetDateTime.now(), OffsetDateTime.now())));
        when(repository.listOutlineSections("project-a")).thenReturn(Flux.empty());
        when(repository.listStoryEvents("project-a")).thenReturn(Flux.empty());
        when(repository.listCharacters("project-a")).thenReturn(Flux.defer(() -> Flux.fromIterable(characters.get())));
        when(repository.listCharacterRelations("project-a")).thenReturn(Flux.empty());
        when(repository.getWorldSetting("project-a")).thenReturn(Mono.just(new ScriptDtos.WorldSetting("", "", "", "")));
        when(repository.listWorldItems("project-a")).thenReturn(Flux.empty());
        when(repository.listLocations("project-a")).thenReturn(Flux.empty());
        when(repository.listEpisodes("project-a")).thenReturn(Flux.empty());
    }

    /**
     * 验证18份同修订人物草稿可连续应用，人工人物与前序批次新增人物全部保留。
     */
    @Test
    void shouldApplyEighteenDraftsWithoutLosingEarlierBatches() {
        characters.set(List.of(character("manual", "人工人物")));
        stubDraftWrites();
        List<String> draftIds = IntStream.range(0, 18).mapToObj(index -> {
            String draftId = "draft-" + index;
            when(repository.getPendingAiDraft("project-a", draftId))
                    .thenReturn(Mono.just(draft(draftId, 4, source(), character("person-" + index, "人物" + index))));
            return draftId;
        }).toList();

        service.applyAdaptationDrafts("project-a", 4, draftIds).block();

        assertEquals(22, revision.get());
        assertEquals(draftIds, appliedDraftIds);
        assertEquals(19, characters.get().size());
        assertEquals("人工人物", characters.get().getFirst().name());
        for (int index = 0; index < 18; index++) {
            assertEquals("人物" + index, characters.get().get(index + 1).name());
            assertEquals(index + 1, characters.get().get(index + 1).sortOrder());
        }
        verify(transactionManager).commit(transaction);
        verify(transactionManager, never()).rollback(transaction);
    }

    /**
     * 验证同名人物跨批次更新复用稳定标识，并保留此前新增的其他人物。
     */
    @Test
    void shouldMergeOverlappingDraftsAgainstLatestContent() {
        stubDraftWrites();
        when(repository.getPendingAiDraft("project-a", "draft-a"))
                .thenReturn(Mono.just(draft("draft-a", 4, source(), character("person-a", "主角"), character("person-b", "配角"))));
        ScriptDtos.Character updated = JSON.parseObject("{\"id\":\"new-id\",\"name\":\"主角\",\"identity\":\"更新设定\"}",
                ScriptDtos.Character.class);
        when(repository.getPendingAiDraft("project-a", "draft-b"))
                .thenReturn(Mono.just(draft("draft-b", 4, source(), updated)));

        service.applyAdaptationDrafts("project-a", 4, List.of("draft-a", "draft-b")).block();

        assertEquals(2, characters.get().size());
        assertEquals("person-a", characters.get().getFirst().id());
        assertEquals("更新设定", characters.get().getFirst().identity());
        assertEquals("配角", characters.get().get(1).name());
    }

    /**
     * 验证后一份草稿基线过期时，在任何正式写入之前拒绝整批应用。
     */
    @Test
    void shouldRejectStaleBaselineBeforeApplyingAnyDraft() {
        when(repository.getPendingAiDraft("project-a", "draft-a"))
                .thenReturn(Mono.just(draft("draft-a", 4, source(), character("person-a", "人物甲"))));
        when(repository.getPendingAiDraft("project-a", "draft-b"))
                .thenReturn(Mono.just(draft("draft-b", 3, source(), character("person-b", "人物乙"))));

        BusinessException exception = assertThrows(BusinessException.class,
                () -> service.applyAdaptationDrafts("project-a", 4, List.of("draft-a", "draft-b")).block());

        assertEquals(ErrorCode.DATA_CONFLICT, exception.getCode());
        verify(repository, never()).advanceRevision(anyLong(), anyString(), anyLong());
        verify(repository, never()).createVersion(anyString(), anyString(), anyLong(), anyString(), anyString(), anyString(), anyLong(), any());
        verify(transactionManager).rollback(transaction);
    }

    /**
     * 验证生成后人工修改目标内容，即使修订号一致也不能静默覆盖。
     */
    @Test
    void shouldRejectChangedTargetBeforeApplyingDrafts() {
        JSONObject baseline = source();
        characters.set(List.of(character("manual", "人工人物")));
        when(repository.getPendingAiDraft("project-a", "draft-a"))
                .thenReturn(Mono.just(draft("draft-a", 4, baseline, character("person-a", "人物甲"))));

        BusinessException exception = assertThrows(BusinessException.class,
                () -> service.applyAdaptationDrafts("project-a", 4, List.of("draft-a")).block());

        assertEquals(ErrorCode.DATA_CONFLICT, exception.getCode());
        verify(repository, never()).advanceRevision(anyLong(), anyString(), anyLong());
        verify(transactionManager).rollback(transaction);
    }

    /**
     * 验证后续草稿事实发生变化时传播错误并回滚本批事务，而非提交前序写入。
     */
    @Test
    void shouldRollBackBatchWhenLaterDraftFactsChange() {
        stubDraftWrites();
        when(repository.getPendingAiDraft("project-a", "draft-a"))
                .thenReturn(Mono.just(draft("draft-a", 4, source(), character("person-a", "人物甲"))));
        when(repository.getPendingAiDraft("project-a", "draft-b"))
                .thenReturn(Mono.just(draft("draft-b", 4, source(), character("person-b", "人物乙"))));
        when(novelAdaptationRepository.recordApplied(eq("draft-b"), eq("project-a"), eq("characters"), any(), any(), anyList()))
                .thenReturn(Mono.error(new BusinessException(ErrorCode.DATA_CONFLICT, "故事事实已发生变化")));

        BusinessException exception = assertThrows(BusinessException.class,
                () -> service.applyAdaptationDrafts("project-a", 4, List.of("draft-a", "draft-b")).block());

        assertEquals(ErrorCode.DATA_CONFLICT, exception.getCode());
        verify(transactionManager).rollback(transaction);
        verify(transactionManager, never()).commit(transaction);
    }

    /**
     * 准备正式写入的延迟副作用，模拟每次应用递增修订并替换人物列表。
     */
    private void stubDraftWrites() {
        when(repository.createVersion(anyString(), eq("project-a"), eq(8L), anyString(), anyString(), anyString(), anyLong(), any()))
                .thenReturn(Mono.empty());
        when(novelAdaptationRepository.requireTargetSelectionForDraft(anyString(), eq("project-a"), eq("characters"), any(), anyList()))
                .thenReturn(Mono.empty());
        when(repository.countCharacterReferences(eq("project-a"), anyList())).thenReturn(Mono.just(0L));
        when(repository.countIdsOwnedByAnotherProject(eq("project-a"), anyString(), anyList())).thenReturn(Mono.just(0L));
        when(repository.advanceRevision(eq(8L), eq("project-a"), anyLong())).thenAnswer(invocation ->
                Mono.fromSupplier(() -> revision.compareAndSet(invocation.getArgument(2), revision.get() + 1) ? 1L : 0L));
        when(repository.replaceCharacters(eq("project-a"), anyList(), anyList())).thenAnswer(invocation -> {
            List<ScriptDtos.Character> replacement = invocation.getArgument(1);
            return Mono.fromRunnable(() -> characters.set(replacement));
        });
        when(novelAdaptationRepository.recordApplied(anyString(), eq("project-a"), eq("characters"), any(), any(), anyList()))
                .thenReturn(Mono.empty());
        when(repository.updateAiDraftStatus(eq("project-a"), anyString(), eq("applied"), any())).thenAnswer(invocation -> {
            String draftId = invocation.getArgument(1);
            return Mono.fromSupplier(() -> { appliedDraftIds.add(draftId); return 1L; });
        });
        when(repository.updateProgress(eq("project-a"), anyString(), anyInt())).thenReturn(Mono.empty());
        when(comicDramaImpactService.markUpstreamChanges(eq("project-a"), eq("character"), anyList(), anyString()))
                .thenReturn(Mono.just(0L));
    }

    /**
     * 创建最小合法人物设定。
     * @param id String 人物稳定标识
     * @param name String 中文人物名称
     * @return Character 人物设定
     */
    private ScriptDtos.Character character(String id, String name) {
        return JSONObject.of("id", id, "name", name).toJavaObject(ScriptDtos.Character.class);
    }

    /**
     * 创建当前人物内容的生成基线快照。
     * @return JSONObject 人物与关系快照
     */
    private JSONObject source() {
        return JSON.parseObject(JSON.toJSONString(new ScriptDtos.CharacterDraft(characters.get(), List.of())));
    }

    /**
     * 创建指定基线的待确认人物改编草稿。
     * @param id String 草稿标识
     * @param baseRevision long 生成基线修订号
     * @param source JSONObject 生成前正式内容
     * @param proposed Character[] 本批拟写入人物
     * @return AiDraft 待确认小说改编草稿
     */
    private ScriptDtos.AiDraft draft(String id, long baseRevision, JSONObject source, ScriptDtos.Character... proposed) {
        return new ScriptDtos.AiDraft(id, "project-a", "novelAdaptationCharacters", "characters", null, baseRevision, "",
                source, JSON.parseObject(JSON.toJSONString(new ScriptDtos.CharacterDraft(List.of(proposed), List.of()))),
                "text-model", java.math.BigDecimal.valueOf(1), "pending", OffsetDateTime.now());
    }

    /**
     * 验证分集草稿漏填完成状态时按规划态补齐，不让模型遗漏把整批分集卡在结构校验上。
     */
    @Test
    void shouldFillMissingCompletionStatusForEpisodeDraft() {
        AtomicReference<List<ScriptDtos.EpisodeSummary>> stored = new AtomicReference<>(List.of());
        stubEpisodeDraftWrites(stored, episodeDraftWithoutStatus());
        service.applyAdaptationDrafts("project-a", 4, List.of("draft-ep")).block();

        assertEquals(1, stored.get().size());
        assertEquals("planning", stored.get().getFirst().completionStatus());
    }

    /**
     * 验证草稿已给出的完成状态被保留，不会被服务端补齐逻辑改写。
     */
    @Test
    void shouldPreserveProvidedCompletionStatus() {
        AtomicReference<List<ScriptDtos.EpisodeSummary>> stored = new AtomicReference<>(List.of());
        stubEpisodeDraftWrites(stored, episodeDraft("complete"));
        service.applyAdaptationDrafts("project-a", 4, List.of("draft-ep")).block();

        assertEquals("complete", stored.get().getFirst().completionStatus());
    }

    /**
     * 准备分集草稿应用所需的写入桩，并把写入结果记录到给定引用。
     */
    private void stubEpisodeDraftWrites(AtomicReference<List<ScriptDtos.EpisodeSummary>> stored,
                                        ScriptDtos.AiDraft draft) {
        when(repository.getPendingAiDraft("project-a", "draft-ep")).thenReturn(Mono.just(draft));
        lenient().when(repository.listEpisodes("project-a")).thenAnswer(ignored -> Flux.fromIterable(stored.get()));
        when(repository.createVersion(anyString(), eq("project-a"), eq(8L), anyString(), anyString(), anyString(),
                anyLong(), any())).thenReturn(Mono.empty());
        when(novelAdaptationRepository.requireTargetSelectionForDraft(anyString(), eq("project-a"), eq("episodes"),
                any(), anyList())).thenReturn(Mono.empty());
        when(repository.countIdsOwnedByAnotherProject(eq("project-a"), eq("episode"), anyList()))
                .thenReturn(Mono.just(0L));
        when(repository.advanceRevision(eq(8L), eq("project-a"), anyLong())).thenAnswer(invocation ->
                Mono.fromSupplier(() -> revision.compareAndSet(invocation.getArgument(2), revision.get() + 1) ? 1L : 0L));
        when(repository.replaceEpisodePlan(eq("project-a"), anyList())).thenAnswer(invocation -> {
            List<ScriptDtos.EpisodeSummary> replacement = invocation.getArgument(1);
            return Mono.fromRunnable(() -> stored.set(replacement));
        });
        when(novelAdaptationRepository.recordApplied(anyString(), eq("project-a"), eq("episodes"), any(), any(), anyList()))
                .thenReturn(Mono.empty());
        when(repository.updateAiDraftStatus(eq("project-a"), anyString(), eq("applied"), any())).thenReturn(Mono.just(1L));
        when(repository.updateProgress(eq("project-a"), anyString(), anyInt())).thenReturn(Mono.empty());
        when(comicDramaImpactService.markUpstreamChanges(eq("project-a"), eq("overview"), anyList(), anyString()))
                .thenReturn(Mono.just(0L));
    }

    /**
     * 创建分集规划草稿，完成状态由 status 决定，传空则省略该字段以模拟模型漏填。
     */
    private ScriptDtos.AiDraft episodeDraft(String status) {
        JSONObject episode = new JSONObject();
        episode.put("id", "episode-a");
        episode.put("episodeNumber", 1);
        episode.put("title", "第一集");
        episode.put("summary", "剧情摘要");
        episode.put("keyEvents", "关键事件");
        episode.put("mainConflict", "主要冲突");
        episode.put("climax", "高潮");
        episode.put("endingHook", "结尾悬念");
        episode.put("targetDurationSeconds", 180);
        episode.put("sortOrder", 0);
        if (status != null) episode.put("completionStatus", status);
        JSONObject data = new JSONObject().fluentPut("episodes", new com.alibaba.fastjson2.JSONArray().fluentAdd(episode));
        return new ScriptDtos.AiDraft("draft-ep", "project-a", "novelAdaptationepisodes", "episodes", null, 4, "",
                JSON.parseObject("{\"episodes\":[]}"), data, "text-model", java.math.BigDecimal.valueOf(1), "pending", OffsetDateTime.now());
    }

    /** 省略完成状态的分集草稿。 */
    private ScriptDtos.AiDraft episodeDraftWithoutStatus() {
        return episodeDraft(null);
    }
}
