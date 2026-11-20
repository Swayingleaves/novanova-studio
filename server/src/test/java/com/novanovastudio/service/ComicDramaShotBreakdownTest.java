package com.novanovastudio.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.novanovastudio.MediaAccessTestSupport;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.dto.ComicDramaDtos;
import com.novanovastudio.dto.ScriptDtos;
import com.novanovastudio.dto.StoryboardDtos;
import com.novanovastudio.repository.ComicDramaRepository;
import com.novanovastudio.security.CurrentUserProvider;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.transaction.reactive.TransactionalOperator;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 漫剧镜头智能拆分：分集目标时长换算、动作/对白加权兜底、按场次并发拆分与场次归属保留测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-18 09:49
 */
class ComicDramaShotBreakdownTest {

    /**
     * 验证当分集设置了 180 秒目标时长时，即使动作描写文字多达数千字，中等档位镜头数仍稳定按 180 秒换算为约 26 镜。
     */
    @Test
    void shouldEstimateEpisodeShotsFromTargetDurationInsteadOfVerboseActionText() {
        String verboseAction = "夜雨如注，霓虹灯影在积水中破碎又重组，林晚站在落地窗前久久凝视远方街道。".repeat(40);
        List<ComicDramaRepository.SceneGenerationSource> scenes = List.of(
                scene("ep-1", 180, "sc-1", 1, "办公室", "林晚：开始吧。", verboseAction),
                scene("ep-1", 180, "sc-2", 2, "走廊", "周启明：等等我。", verboseAction),
                scene("ep-1", 180, "sc-3", 3, "天台", "林晚：你来晚了。", verboseAction));

        int mediumTotal = ComicDramaShotBreakdownPlanner.estimateMultiSceneTotalShots(scenes, "medium");
        List<Integer> quotas = ComicDramaShotBreakdownPlanner.allocateShotsAcrossScenes(scenes, mediumTotal);

        assertEquals(26, mediumTotal);
        assertEquals(26, quotas.stream().mapToInt(Integer::intValue).sum());
        assertTrue(quotas.stream().allMatch(count -> count >= 8 && count <= 9));
    }

    /**
     * 验证未设置分集时长时，大段动作描写按画面节拍降权折算，且纯文本估算有上限封顶不会突破 100 镜。
     */
    @Test
    void shouldWeightActionLowerThanDialogueAndCapAutoEstimate() {
        String longScript = "林晚缓缓推开沉重的木门，目光扫过满是灰尘的书架与斑驳墙面。".repeat(200);
        int rawEstimate = ComicDramaService.estimateShotCount("medium", longScript);
        assertEquals(ComicDramaShotBreakdownPlanner.MAX_AUTO_SHOT_COUNT, rawEstimate);
        assertTrue(rawEstimate < StoryboardDtos.MAX_SHOT_COUNT);

        ComicDramaRepository.SceneGenerationSource actionHeavyScene =
                scene("ep-1", 0, "sc-1", 1, "旧书房", "好。", "她推开门走进房间环顾四周。".repeat(20));
        int sceneShots = ComicDramaShotBreakdownPlanner.estimateSceneShotCount(
                actionHeavyScene, List.of(actionHeavyScene), "medium");
        assertTrue(sceneShots <= 5);
    }

    /**
     * 验证整集拆分会按场次生成并发请求，合并同名视觉资产、连续重排镜号，并在确认草稿时为每个镜头保留各自的场次ID与场次摘录。
     */
    @Test
    void shouldSplitEntireEpisodeByScenesMergeAssetsAndPreserveSceneOriginsOnConfirm() {
        CurrentUserProvider currentUserProvider = mock(CurrentUserProvider.class);
        ComicDramaRepository repository = mock(ComicDramaRepository.class);
        ScriptService scriptService = mock(ScriptService.class);
        StoryboardAgentService storyboardAgentService = mock(StoryboardAgentService.class);
        TransactionalOperator transaction = mock(TransactionalOperator.class);
        when(transaction.transactional(any(Mono.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(currentUserProvider.currentUserId()).thenReturn(Mono.just(1L));
        when(repository.getProject(1L, "proj-1")).thenReturn(Mono.just(new ComicDramaRepository.ProjectRecord(
                "proj-1", 1L, "漫剧项目", "draft", 2L, 1, OffsetDateTime.now(), OffsetDateTime.now())));
        when(repository.validateShotSourceReferences(eq("proj-1"), any(), any())).thenReturn(Mono.just(true));

        List<ComicDramaRepository.SceneGenerationSource> scenes = List.of(
                scene("ep-1", 120, "sc-1", 1, "咖啡馆", "林晚：你来了。", "林晚放下咖啡杯。"),
                scene("ep-1", 120, "sc-2", 2, "街道", "周启明：外面下雨了。", "两人撑伞走入雨幕。"));
        when(repository.listShotGenerationScenes("proj-1", "ep-1", null)).thenReturn(Flux.fromIterable(scenes));
        when(repository.createShotDraft(eq(1L), any())).thenReturn(Mono.empty());

        StoryboardDtos.GenerateStoryboardResponse firstSegment = new StoryboardDtos.GenerateStoryboardResponse(
                List.of(new StoryboardDtos.StoryboardShot("shot-a", 1, 3, "林晚放下咖啡杯", "近景",
                        "暖光", "林晚：你来了。", "", "固定", "", List.of("asset-lin-1", "asset-cafe"))),
                List.of(
                        new StoryboardDtos.StoryboardAsset("asset-lin-1", "character", "林晚", "短发风衣"),
                        new StoryboardDtos.StoryboardAsset("asset-cafe", "scene", "咖啡馆", "木质桌椅")),
                BigDecimal.ZERO);
        StoryboardDtos.GenerateStoryboardResponse secondSegment = new StoryboardDtos.GenerateStoryboardResponse(
                List.of(new StoryboardDtos.StoryboardShot("shot-b", 1, 12, "两人撑伞走入雨幕", "全景",
                        "冷色雨夜", "周启明：外面下雨了。", "雨声", "后拉", "", List.of("asset-lin-2"))),
                List.of(new StoryboardDtos.StoryboardAsset("asset-lin-2", "character", "林晚", "短发，深色风衣，手持黑伞")),
                BigDecimal.ZERO);
        when(storyboardAgentService.generateStoryboardSegments(any(), eq("channel::gpt")))
                .thenReturn(Mono.just(new StoryboardAgentService.StoryboardSegmentsResult(
                        List.of(firstSegment, secondSegment), BigDecimal.valueOf(2))));

        ComicDramaService service = new ComicDramaService(currentUserProvider, repository, scriptService,
                storyboardAgentService, mock(ComicDramaFinalPromptPricingService.class), mock(AiTaskService.class),
                mock(PersistenceService.class), transaction, new NovanovaProperties(), MediaAccessTestSupport.echo());

        ComicDramaDtos.ShotDraft draft = service.generateShotDraft(new ComicDramaDtos.GenerateShotDraftRequest(
                "proj-1", "ep-1", null, null, "紧凑利落", "", "medium", "channel::gpt", true)).block();

        assertNotNull(draft);
        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<StoryboardDtos.GenerateStoryboardRequest>> requestsCaptor = ArgumentCaptor.forClass(List.class);
        verify(storyboardAgentService).generateStoryboardSegments(requestsCaptor.capture(), eq("channel::gpt"));
        assertEquals(2, requestsCaptor.getValue().size());
        assertTrue(requestsCaptor.getValue().get(0).scriptContent().contains("场景地点：咖啡馆"));
        assertTrue(requestsCaptor.getValue().get(1).scriptContent().contains("场景地点：街道"));

        StoryboardDtos.GenerateStoryboardResponse merged = draft.draftData()
                .toJavaObject(StoryboardDtos.GenerateStoryboardResponse.class);
        assertEquals(2, merged.shots().size());
        assertEquals(1, merged.shots().get(0).shotNumber());
        assertEquals(2, merged.shots().get(1).shotNumber());
        assertEquals(5, merged.shots().get(0).durationSeconds());
        assertEquals(8, merged.shots().get(1).durationSeconds());
        // 两个场次中的同名角色「林晚」应被合并为同一个资产，且保留更丰富的描述。
        assertEquals(2, merged.assets().size());
        assertEquals(merged.shots().get(0).assetIds().getFirst(), merged.shots().get(1).assetIds().getFirst());

        // 验证确认草稿时会覆盖替换当前分集原有的旧镜头，保留其他分集镜头，且每个新镜头保留真实场次ID与单场摘录。
        ComicDramaDtos.Shot oldEpisodeOneShotA = existingShot("old-ep1-1", "ep-1", "sc-1", 1, 0);
        ComicDramaDtos.Shot oldEpisodeOneShotB = existingShot("old-ep1-2", "ep-1", null, 2, 1);
        ComicDramaDtos.Shot keptEpisodeTwoShot = existingShot("keep-ep2-1", "ep-2", "sc-20", 3, 2);
        when(repository.getPendingShotDraft(1L, "proj-1", draft.id())).thenReturn(Mono.just(draft));
        when(scriptService.getProject("proj-1")).thenReturn(Mono.just(scriptProject()));
        when(repository.listShots("proj-1", null, null))
                .thenReturn(Flux.just(oldEpisodeOneShotA, oldEpisodeOneShotB, keptEpisodeTwoShot));
        when(repository.listAssets("proj-1", null)).thenReturn(Flux.empty());
        when(repository.createShotDraftAsset(eq("proj-1"), any())).thenReturn(Mono.just(1L));
        when(repository.createShotDraftAssetVersion(any())).thenReturn(Mono.just(1L));
        when(repository.deleteShotsForReplacement(eq("proj-1"), any())).thenReturn(Mono.empty());
        when(repository.saveShot(eq("proj-1"), any())).thenReturn(Mono.just(1L));
        when(repository.reorderShots(eq("proj-1"), any())).thenReturn(Mono.empty());
        when(repository.replaceShotAssetVersions(eq("proj-1"), anyString(), any())).thenAnswer(invocation -> {
            List<?> ids = invocation.getArgument(2);
            return Mono.just((long) ids.size());
        });
        when(repository.confirmShotDraft("proj-1", draft.id())).thenReturn(Mono.just(1L));
        when(repository.advanceRevision(1L, "proj-1", 2L)).thenReturn(Mono.just(3L));
        when(repository.refreshProjectProductionStatus("proj-1")).thenReturn(Mono.empty());

        service.confirmShotDraft(new ComicDramaDtos.ConfirmShotDraftRequest("proj-1", 2L, draft.id())).block();

        verify(repository).deleteShotsForReplacement("proj-1", List.of("old-ep1-1", "old-ep1-2"));
        ArgumentCaptor<ComicDramaDtos.Shot> savedShots = ArgumentCaptor.forClass(ComicDramaDtos.Shot.class);
        verify(repository, times(2)).saveShot(eq("proj-1"), savedShots.capture());
        assertEquals(1, savedShots.getAllValues().get(0).shotNumber());
        assertEquals(2, savedShots.getAllValues().get(1).shotNumber());
        assertEquals("sc-1", savedShots.getAllValues().get(0).sourceSceneId());
        assertEquals("sc-2", savedShots.getAllValues().get(1).sourceSceneId());
        assertTrue(savedShots.getAllValues().get(0).sourceScriptExcerpt().contains("咖啡馆"));
        assertTrue(savedShots.getAllValues().get(1).sourceScriptExcerpt().contains("街道"));
        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<String>> reorderCaptor = ArgumentCaptor.forClass(List.class);
        verify(repository).reorderShots(eq("proj-1"), reorderCaptor.capture());
        assertEquals(3, reorderCaptor.getValue().size());
        assertEquals("keep-ep2-1", reorderCaptor.getValue().get(2));
    }

    /** 构造已有正式镜头。 */
    private static ComicDramaDtos.Shot existingShot(String id, String episodeId, String sceneId,
                                                    int shotNumber, int sortOrder) {
        return new ComicDramaDtos.Shot(id, episodeId, sceneId, "旧摘录", shotNumber, sortOrder,
                BigDecimal.valueOf(5), "中景", "", "旧画面", "", "固定", "", "", "", "",
                "draft", List.of(), 0, null, null);
    }

    /** 构造测试用场次源数据。 */
    private static ComicDramaRepository.SceneGenerationSource scene(
            String episodeId, int episodeSeconds, String sceneId, int sceneNumber,
            String locationName, String dialogue, String action) {
        return new ComicDramaRepository.SceneGenerationSource(
                episodeId, 1, episodeSeconds, sceneId, sceneNumber, "场次" + sceneNumber,
                locationName, "interior", "夜晚",
                dialogue + "\n" + action, dialogue, action, "赛博国风", 0, 5L);
    }

    /** 构造最小共享剧本详情。 */
    private static ScriptDtos.ProjectDetail scriptProject() {
        ScriptDtos.ProjectOverview overview = new ScriptDtos.ProjectOverview(
                "剧本", "comicDrama", "", "", "", 120, 1, "", "", "", "", "");
        return new ScriptDtos.ProjectDetail("proj-1", "", overview, List.of(), List.of(),
                List.of(), List.of(), new ScriptDtos.WorldSetting("", "", "", ""),
                List.of(), List.of(), List.of(), "writing", 50, true, 5L, null, null, "");
    }
}
