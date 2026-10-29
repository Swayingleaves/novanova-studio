package com.novanovastudio.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.dto.AiTaskDtos;
import com.novanovastudio.dto.ComicDramaDtos;
import com.novanovastudio.dto.StoryboardDtos;
import com.novanovastudio.repository.ComicDramaRepository;
import com.novanovastudio.repository.ComicDramaRepository.ShotReferenceImage;
import com.novanovastudio.security.CurrentUserProvider;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.transaction.reactive.TransactionalOperator;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 漫剧提示词来源继承、图片任务与扣费前校验的业务测试。
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-10-28 10:00
 */
class ComicDramaPromptServiceTest {
    /** 仓储依赖。 */
    private ComicDramaRepository repository;
    /** 共享提示词 Agent。 */
    private StoryboardAgentService storyboardAgentService;
    /** 计费和底层任务依赖。 */
    private AiTaskService aiTaskService;
    /** 独立提示词定价。 */
    private ComicDramaFinalPromptPricingService pricingService;
    /** 本次固定模型，通用价格与专项价格不同。 */
    private final com.novanovastudio.agent.AgentScopeModelFactory.TextModelSelection model =
            new com.novanovastudio.agent.AgentScopeModelFactory.TextModelSelection(null, "model-config", "model", "模型", "渠道", BigDecimal.TEN, 0L);
    /** 被测业务服务。 */
    private ComicDramaService service;
    /** 角色图片。 */
    private final ShotReferenceImage actor = image("character", "actor");
    /** 分镜图片。 */
    private final ShotReferenceImage frame = image("storyboard", "frame");

    /** 建立独立依赖及项目权限、事务边界。 */
    @BeforeEach
    void setUp() {
        repository = mock(ComicDramaRepository.class);
        storyboardAgentService = mock(StoryboardAgentService.class);
        when(storyboardAgentService.refundPromptComposition(anyString(), any(), anyLong())).thenReturn(Mono.empty());
        aiTaskService = mock(AiTaskService.class);
        pricingService = mock(ComicDramaFinalPromptPricingService.class);
        when(pricingService.prepare("model", 1L)).thenReturn(Mono.just(
                new ComicDramaFinalPromptPricingService.PreparedPricing(model, BigDecimal.ONE, 1L)));
        CurrentUserProvider currentUserProvider = mock(CurrentUserProvider.class);
        TransactionalOperator transaction = mock(TransactionalOperator.class);
        when(currentUserProvider.currentUserId()).thenReturn(Mono.just(7L));
        when(repository.getProject(7L, "project")).thenReturn(Mono.just(new ComicDramaRepository.ProjectRecord(
                "project", 7L, "测试项目", "draft", 3L, 1, OffsetDateTime.now(), OffsetDateTime.now())));
        when(repository.getShot("project", "shot")).thenReturn(Mono.just(shot("shot", 1)));
        when(repository.advanceRevision(7L, "project", 3L)).thenReturn(Mono.just(4L));
        when(repository.createPromptVersion(eq("project"), any())).thenReturn(Mono.empty());
        when(repository.refreshProjectProductionStatus("project")).thenReturn(Mono.empty());
        when(transaction.transactional(any(Mono.class))).thenAnswer(invocation -> invocation.getArgument(0));
        service = new ComicDramaService(currentUserProvider, repository, mock(ScriptService.class),
                storyboardAgentService, pricingService, aiTaskService, mock(PersistenceService.class), transaction, new NovanovaProperties());
    }

    /** 单条合成和批量合成必须生成完全相同的正文、说明和映射。 */
    @Test
    void shouldComposeSingleAndBatchWithSameReferenceInstructions() {
        ComicDramaDtos.Shot shot = shot("shot", 1);
        when(repository.getShot("project", "shot")).thenReturn(Mono.just(shot));
        when(repository.listShots("project", null, null)).thenReturn(Flux.just(shot));
        when(repository.getSettings("project")).thenReturn(Mono.just(new ComicDramaDtos.ProductionSettings(
                "comicDrama", 1, 60, 60, "landscape", "16:9", "国风", "", "", "")));
        when(repository.listShotStoryboardAssets("project", "shot")).thenReturn(Flux.just(
                new StoryboardDtos.StoryboardAsset("no-image", "prop", "无图道具", "只保留文字描述")));
        when(repository.listShotReferencesForVideo("project", "shot")).thenReturn(Mono.just(List.of(frame, actor)));
        when(repository.nextPromptVersion("project", "shot")).thenReturn(Mono.just(1));
        when(storyboardAgentService.composePrompts(any(), eq(model), eq(BigDecimal.ONE), anyString())).thenReturn(Mono.just(new StoryboardDtos.ComposePromptsResponse(
                List.of(new StoryboardDtos.StoryboardPrompt("shot", "八段正文及无图道具描述")), BigDecimal.ONE)));

        ComicDramaDtos.PromptVersion single = service.composePrompt(
                new ComicDramaDtos.ComposePromptRequest("project", "shot", "model", 1L, true)).block();
        service.composePrompts(new ComicDramaDtos.ComposePromptsRequest("project", 3L, List.of("shot"), "model", 1L, true)).block();

        ArgumentCaptor<ComicDramaDtos.PromptVersion> versions = ArgumentCaptor.forClass(ComicDramaDtos.PromptVersion.class);
        verify(repository, times(2)).createPromptVersion(eq("project"), versions.capture());
        ComicDramaDtos.PromptVersion batch = versions.getAllValues().getLast();
        assertEquals(single.prompt(), batch.prompt());
        assertEquals(single.sourceSnapshot().getJSONArray("referenceImages"), batch.sourceSnapshot().getJSONArray("referenceImages"));
        assertEquals("draft", single.status());
        assertEquals("adopted", batch.status());
        assertEquals(2, batch.sourceSnapshot().getJSONArray("referenceImages").size());
        ArgumentCaptor<StoryboardDtos.ComposePromptsRequest> agent = ArgumentCaptor.forClass(StoryboardDtos.ComposePromptsRequest.class);
        verify(storyboardAgentService, times(2)).composePrompts(agent.capture(), eq(model), eq(BigDecimal.ONE), anyString());
        assertEquals("无图道具", agent.getValue().assets().getFirst().name());
    }

    /** 采用草稿和手动编辑均保留原引用，修改正文不能让过期引用重新有效。 */
    @Test
    void shouldInheritDraftSnapshotAndKeepStaleReferencesStale() {
        ComicDramaDtos.PromptVersion draft = prompt("shot", List.of(actor));
        when(repository.nextPromptVersion("project", "shot")).thenReturn(Mono.just(2));
        when(repository.listPromptVersions("project", "shot")).thenReturn(Flux.just(draft));
        ComicDramaDtos.PromptVersion adopted = service.savePrompt(new ComicDramaDtos.SavePromptRequest(
                "project", 3L, "shot", ComicDramaPromptReferences.body(draft), 1, draft.id())).block();
        assertEquals(draft.prompt(), adopted.prompt());
        assertEquals(draft.sourceSnapshot(), adopted.sourceSnapshot());
        ComicDramaDtos.PromptVersion edited = service.savePrompt(new ComicDramaDtos.SavePromptRequest(
                "project", 3L, "shot", "新正文", 1, draft.id())).block();
        assertEquals("新正文", ComicDramaPromptReferences.body(edited));
        assertEquals(draft.sourceSnapshot().getJSONArray("referenceImages"), edited.sourceSnapshot().getJSONArray("referenceImages"));
        assertThrows(BusinessException.class, () -> ComicDramaPromptReferences.validate(edited, List.of(frame, actor), 1));
        verify(repository, never()).listShotReferencesForVideo(anyString(), anyString());
    }

    /** 只有首次手动创建按当前图片构建说明；未显式传来源时也不能覆盖已有来源。 */
    @Test
    void shouldInitializeOnlyFirstManualPromptAndPreserveLegacyStaleness() {
        when(repository.nextPromptVersion("project", "shot")).thenReturn(Mono.just(1));
        when(repository.listPromptVersions("project", "shot")).thenReturn(Flux.empty());
        when(repository.listShotReferencesForVideo("project", "shot")).thenReturn(Mono.just(List.of(actor)));
        ComicDramaDtos.PromptVersion first = service.savePrompt(new ComicDramaDtos.SavePromptRequest(
                "project", 3L, "shot", "手动正文", 0, null)).block();
        assertTrue(first.prompt().contains("@图片1"));
        assertDoesNotThrow(() -> ComicDramaPromptReferences.validate(first, List.of(actor), 1));
        ComicDramaDtos.PromptVersion legacy = new ComicDramaDtos.PromptVersion("legacy", "shot", 1, "manual",
                "旧版正文", new JSONObject(), "model", BigDecimal.ZERO, "adopted", OffsetDateTime.now());
        when(repository.nextPromptVersion("project", "shot")).thenReturn(Mono.just(2));
        when(repository.listPromptVersions("project", "shot")).thenReturn(Flux.just(legacy));
        ComicDramaDtos.PromptVersion edited = service.savePrompt(new ComicDramaDtos.SavePromptRequest(
                "project", 3L, "shot", "旧版编辑", 1, null)).block();
        assertFalse(edited.sourceSnapshot().containsKey("referenceImages"));
        assertThrows(BusinessException.class, () -> ComicDramaPromptReferences.validate(edited, List.of(actor), 1));
        verify(repository, times(1)).listShotReferencesForVideo("project", "shot");
    }

    /** 来源必须属于当前镜头，版本冲突仍在任何写入前被拒绝。 */
    @Test
    void shouldRejectForeignSourceAndVersionConflict() {
        when(repository.nextPromptVersion("project", "shot")).thenReturn(Mono.just(3));
        when(repository.listPromptVersions("project", "shot")).thenReturn(Flux.just(prompt("shot", List.of(actor))));
        assertThrows(BusinessException.class, () -> service.savePrompt(new ComicDramaDtos.SavePromptRequest(
                "project", 3L, "shot", "正文", 2, "foreign-version")).block());
        assertThrows(BusinessException.class, () -> service.savePrompt(new ComicDramaDtos.SavePromptRequest(
                "project", 3L, "shot", "正文", 1, null)).block());
        verify(repository, never()).createPromptVersion(anyString(), any());
    }

    /** 后一个镜头失效时，报价、单条和两种批量入口均不得创建或计费任何任务。 */
    @Test
    void shouldRejectEveryVideoEntryBeforeAnyTaskOrCharge() {
        bindGeneration("valid", 1, prompt("valid", List.of(actor)), List.of(actor));
        bindGeneration("stale", 2, prompt("stale", List.of(actor)), List.of(frame, actor));
        JSONObject settings = JSONObject.of("mediaType", "video");
        assertThrows(BusinessException.class, () -> service.estimateGeneration(new ComicDramaDtos.EstimateGenerationRequest(
                "project", "shot", List.of("valid", "stale"), "model", settings)).block());
        for (List<String> targets : List.of(List.of("stale"), List.of("valid", "stale"))) {
            assertThrows(BusinessException.class, () -> service.createGenerationTask(new ComicDramaDtos.CreateGenerationTaskRequest(
                    "project", 3L, "shot", targets, "model", settings, true)).block());
        }
        assertThrows(BusinessException.class, () -> service.createBatchTask(new ComicDramaDtos.CreateBatchTaskRequest(
                "project", 3L, "project", List.of("valid", "stale"), "video", "model", settings, true)).block());
        verifyNoInteractions(aiTaskService);
        verify(repository, never()).createMediaResult(anyString(), any());
        verify(repository, never()).createBatchTask(anyLong(), anyString(), any());
        verify(repository, never()).advanceRevision(anyLong(), anyString(), anyLong());
    }

    /** 图片任务使用相同正文但移除自身分镜图并独立编号，快照记录实际输入。 */
    @Test
    void shouldSubmitImageWithOnlyAssetReferencesAndVideoWithExactSavedPrompt() {
        ComicDramaDtos.PromptVersion version = prompt("shot", List.of(frame, actor));
        bindGeneration("shot", 1, version, List.of(frame, actor));
        when(repository.listShotAssetReferenceImages("project", "shot")).thenReturn(Flux.just(actor));
        when(aiTaskService.quoteTaskCredits(any())).thenReturn(Mono.just(BigDecimal.ONE));
        when(aiTaskService.createTask(any(), any())).thenReturn(Mono.just(new AiTaskDtos.AiGenerationTaskResponse(
                "task", "image", "model", "provider", "queued", 0, new JSONObject(), new JSONObject(),
                null, null, null, null, null, null)));
        when(repository.createMediaResult(eq("project"), any())).thenReturn(Mono.empty());
        ComicDramaDtos.GenerationTaskResult image = service.createGenerationTask(new ComicDramaDtos.CreateGenerationTaskRequest(
                "project", 3L, "shot", List.of("shot"), "model", JSONObject.of("mediaType", "image"), true)).block();
        service.createGenerationTask(new ComicDramaDtos.CreateGenerationTaskRequest(
                "project", 3L, "shot", List.of("shot"), "model", JSONObject.of("mediaType", "video"), true)).block();
        ArgumentCaptor<AiTaskDtos.CreateAiTaskRequest> tasks = ArgumentCaptor.forClass(AiTaskDtos.CreateAiTaskRequest.class);
        verify(aiTaskService, times(2)).createTask(tasks.capture(), any());
        AiTaskDtos.CreateAiTaskRequest imageTask = tasks.getAllValues().getFirst();
        assertEquals(List.of(actor.reference()), imageTask.references());
        assertTrue(imageTask.prompt().contains("@图片1"));
        assertFalse(imageTask.prompt().contains("@图片2"));
        assertFalse(imageTask.prompt().contains("首帧与构图参考"));
        ArgumentCaptor<ComicDramaDtos.MediaResult> media = ArgumentCaptor.forClass(ComicDramaDtos.MediaResult.class);
        verify(repository, times(2)).createMediaResult(eq("project"), media.capture());
        JSONObject input = media.getAllValues().getFirst().inputSnapshot();
        assertEquals(imageTask.prompt(), input.getString("prompt"));
        assertEquals(ComicDramaPromptReferences.mapping(List.of(actor)), input.getJSONArray("referenceImages"));
        AiTaskDtos.CreateAiTaskRequest videoTask = tasks.getAllValues().getLast();
        assertEquals(version.prompt(), videoTask.prompt());
        assertEquals(List.of(frame.reference(), actor.reference()), videoTask.references());
        ArgumentCaptor<AiTaskDtos.CreateAiTaskRequest> quoted = ArgumentCaptor.forClass(AiTaskDtos.CreateAiTaskRequest.class);
        verify(aiTaskService, times(2)).quoteTaskCredits(quoted.capture());
        assertEquals(quoted.getAllValues(), tasks.getAllValues());
    }

    /** 旧版无图提示词继续作为文生视频报价。 */
    @Test
    void shouldQuoteLegacyTextToVideoWithoutReferenceSnapshot() {
        ComicDramaDtos.PromptVersion legacy = new ComicDramaDtos.PromptVersion("legacy", "shot", 1, "manual",
                "旧版正文", new JSONObject(), "model", BigDecimal.ZERO, "adopted", OffsetDateTime.now());
        bindGeneration("shot", 1, legacy, List.of());
        when(aiTaskService.quoteTaskCredits(any())).thenReturn(Mono.just(BigDecimal.ONE));
        service.estimateGeneration(new ComicDramaDtos.EstimateGenerationRequest("project", "shot", List.of("shot"),
                "model", JSONObject.of("mediaType", "video"))).block();
        ArgumentCaptor<AiTaskDtos.CreateAiTaskRequest> quoted = ArgumentCaptor.forClass(AiTaskDtos.CreateAiTaskRequest.class);
        verify(aiTaskService).quoteTaskCredits(quoted.capture());
        assertEquals("旧版正文", quoted.getValue().prompt());
        assertEquals("text-to-video", quoted.getValue().videoGenerationMode());
    }

    /** 未确认费用时，单镜头和批量入口均不得查询价格、调用模型或保存版本。 */
    @Test
    void shouldRejectUnconfirmedPromptComposition() {
        clearInvocations(repository, pricingService, storyboardAgentService);
        assertThrows(BusinessException.class, () -> service.composePrompt(
                new ComicDramaDtos.ComposePromptRequest("project", "shot", "model", 1L, false)).block());
        assertThrows(BusinessException.class, () -> service.composePrompts(
                new ComicDramaDtos.ComposePromptsRequest("project", 3L, List.of("shot"), "model", 1L, false)).block());
        verifyNoInteractions(repository, pricingService, storyboardAgentService);
    }

    /** 未定价或修订过期时，单镜头和批量入口均不得调用模型或保存版本。 */
    @Test
    void shouldRejectPricingBeforeEveryPromptEntry() {
        bindPromptComposition();
        when(pricingService.prepare("model", 1L)).thenReturn(Mono.error(new BusinessException(
                com.novanovastudio.common.ErrorCode.DATA_CONFLICT, "价格已变化")));
        assertThrows(BusinessException.class, () -> service.composePrompt(
                new ComicDramaDtos.ComposePromptRequest("project", "shot", "model", 1L, true)).block());
        assertThrows(BusinessException.class, () -> service.composePrompts(
                new ComicDramaDtos.ComposePromptsRequest("project", 3L, List.of("shot", "second"), "model", 1L, true)).block());
        verifyNoInteractions(storyboardAgentService);
        verify(repository, never()).createPromptVersion(anyString(), any());
    }

    /** 同一批次只准备一次价格，成功版本和汇总仅计成功镜头，全部失败为零。 */
    @Test
    void shouldShareBatchSnapshotAndSummarizeOnlySuccessfulShots() {
        bindPromptComposition();
        AtomicBoolean priceChanged = new AtomicBoolean();
        when(pricingService.prepare("model", 1L)).thenAnswer(invocation -> priceChanged.get()
                ? Mono.error(new IllegalStateException("后台已改价"))
                : Mono.just(new ComicDramaFinalPromptPricingService.PreparedPricing(model, BigDecimal.ONE, 1L)));
        when(storyboardAgentService.composePrompts(any(), eq(model), eq(BigDecimal.ONE), anyString())).thenAnswer(invocation -> {
            StoryboardDtos.ComposePromptsRequest request = invocation.getArgument(0);
            String shotId = request.shots().getFirst().id();
            // 模拟批量执行期间后台改价，已启动批次继续使用原快照。
            priceChanged.set(true);
            return "second".equals(shotId) ? Mono.error(new IllegalStateException("模型失败")) : Mono.just(
                    new StoryboardDtos.ComposePromptsResponse(List.of(new StoryboardDtos.StoryboardPrompt(shotId, "正文")), BigDecimal.ONE));
        });
        var result = service.composePrompts(new ComicDramaDtos.ComposePromptsRequest(
                "project", 3L, List.of("shot", "second"), "model", 1L, true)).block();
        assertEquals(List.of("shot"), result.succeededShotIds());
        assertEquals(List.of("second"), result.failedShotIds());
        assertEquals(0, BigDecimal.ONE.compareTo(result.chargedCredits()));
        verify(pricingService).prepare("model", 1L);
        verify(storyboardAgentService, times(2)).composePrompts(any(), eq(model), eq(BigDecimal.ONE), anyString());
        ArgumentCaptor<ComicDramaDtos.PromptVersion> version = ArgumentCaptor.forClass(ComicDramaDtos.PromptVersion.class);
        verify(repository).createPromptVersion(eq("project"), version.capture());
        assertEquals(BigDecimal.ONE, version.getValue().chargedCredits());

        when(pricingService.prepare("model", 1L)).thenReturn(Mono.just(
                new ComicDramaFinalPromptPricingService.PreparedPricing(model, BigDecimal.ONE, 1L)));
        when(storyboardAgentService.composePrompts(any(), eq(model), eq(BigDecimal.ONE), anyString()))
                .thenReturn(Mono.error(new IllegalStateException("模型失败")));
        var failed = service.composePrompts(new ComicDramaDtos.ComposePromptsRequest(
                "project", 3L, List.of("shot", "second"), "model", 1L, true)).block();
        assertTrue(failed.succeededShotIds().isEmpty());
        assertEquals(2, failed.failedShotIds().size());
        assertEquals(0, failed.chargedCredits().signum());
        verify(repository, times(1)).createPromptVersion(anyString(), any());
    }

    /** 明确保存的免费价格必须原样传递并记录在生成版本中。 */
    @Test
    void shouldAllowFreePromptComposition() {
        bindPromptComposition();
        when(pricingService.prepare("model", 1L)).thenReturn(Mono.just(
                new ComicDramaFinalPromptPricingService.PreparedPricing(model, BigDecimal.ZERO, 1L)));
        when(storyboardAgentService.composePrompts(any(), eq(model), eq(BigDecimal.ZERO), anyString())).thenReturn(Mono.just(
                new StoryboardDtos.ComposePromptsResponse(List.of(new StoryboardDtos.StoryboardPrompt("shot", "正文")), BigDecimal.ZERO)));
        var version = service.composePrompt(new ComicDramaDtos.ComposePromptRequest("project", "shot", "model", 1L, true)).block();
        assertEquals(0, version.chargedCredits().signum());
        verify(storyboardAgentService).composePrompts(any(), eq(model), eq(BigDecimal.ZERO), anyString());
    }

    /** 单镜头写库失败后按原扣费操作退款。 */
    @Test
    void shouldRefundSinglePromptWhenPersistenceFails() {
        bindPromptComposition();
        stubSuccessfulComposition();
        when(repository.createPromptVersion(eq("project"), any())).thenReturn(Mono.error(new IllegalStateException("写库失败")));
        assertThrows(IllegalStateException.class, () -> service.composePrompt(
                new ComicDramaDtos.ComposePromptRequest("project", "shot", "model", 1L, true)).block());
        ArgumentCaptor<String> operation = ArgumentCaptor.forClass(String.class);
        verify(storyboardAgentService).composePrompts(any(), eq(model), eq(BigDecimal.ONE), operation.capture());
        verify(storyboardAgentService).refundPromptComposition(operation.getValue(), BigDecimal.ONE, model.ownerTeamId());
    }

    /** 批量写库事务失败时，单次退款异常不能阻止其他已扣费镜头退款。 */
    @Test
    void shouldRefundEveryComposedPromptWhenBatchPersistenceFails() {
        bindPromptComposition();
        stubSuccessfulComposition();
        when(repository.advanceRevision(7L, "project", 3L)).thenReturn(Mono.error(new IllegalStateException("版本冲突")));
        when(storyboardAgentService.refundPromptComposition(anyString(), any(), anyLong()))
                .thenReturn(Mono.error(new IllegalStateException("退款异常")), Mono.empty());
        IllegalStateException failure = assertThrows(IllegalStateException.class, () -> service.composePrompts(
                new ComicDramaDtos.ComposePromptsRequest("project", 3L, List.of("shot", "second"), "model", 1L, true)).block());
        assertEquals("版本冲突", failure.getMessage());
        ArgumentCaptor<String> charged = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> refunded = ArgumentCaptor.forClass(String.class);
        verify(storyboardAgentService, times(2)).composePrompts(any(), eq(model), eq(BigDecimal.ONE), charged.capture());
        verify(storyboardAgentService, times(2)).refundPromptComposition(refunded.capture(), eq(BigDecimal.ONE), eq(model.ownerTeamId()));
        assertEquals(new java.util.HashSet<>(charged.getAllValues()), new java.util.HashSet<>(refunded.getAllValues()));
        assertEquals(2, new java.util.HashSet<>(charged.getAllValues()).size());
    }

    /** 转换失败退原扣费；模型调用失败由底层退款，避免重复补偿。 */
    @Test
    void shouldRefundOnlySuccessfulModelCallsWhenConversionFails() {
        bindPromptComposition();
        when(storyboardAgentService.composePrompts(any(), eq(model), eq(BigDecimal.ONE), anyString()))
                .thenReturn(Mono.just(new StoryboardDtos.ComposePromptsResponse(List.of(), BigDecimal.ONE)));
        assertThrows(java.util.NoSuchElementException.class, () -> service.composePrompt(
                new ComicDramaDtos.ComposePromptRequest("project", "shot", "model", 1L, true)).block());
        verify(storyboardAgentService).refundPromptComposition(anyString(), eq(BigDecimal.ONE), eq(model.ownerTeamId()));
        clearInvocations(storyboardAgentService);
        when(storyboardAgentService.composePrompts(any(), eq(model), eq(BigDecimal.ONE), anyString()))
                .thenReturn(Mono.error(new IllegalStateException("模型失败")));
        assertThrows(IllegalStateException.class, () -> service.composePrompt(
                new ComicDramaDtos.ComposePromptRequest("project", "shot", "model", 1L, true)).block());
        verify(storyboardAgentService, never()).refundPromptComposition(anyString(), any(), anyLong());
    }

    /** 让模型按请求镜头返回成功正文。 */
    private void stubSuccessfulComposition() {
        when(storyboardAgentService.composePrompts(any(), eq(model), eq(BigDecimal.ONE), anyString())).thenAnswer(invocation -> {
            StoryboardDtos.ComposePromptsRequest request = invocation.getArgument(0);
            return Mono.just(new StoryboardDtos.ComposePromptsResponse(List.of(new StoryboardDtos.StoryboardPrompt(
                    request.shots().getFirst().id(), "正文")), BigDecimal.ONE));
        });
    }

    /** 初始化两个镜头的提示词合成输入与版本持久化。 */
    private void bindPromptComposition() {
        when(repository.listShots("project", null, null)).thenReturn(Flux.just(shot("shot", 1), shot("second", 2)));
        when(repository.getSettings("project")).thenReturn(Mono.just(new ComicDramaDtos.ProductionSettings(
                "comicDrama", 1, 60, 60, "landscape", "16:9", "国风", "", "", "")));
        for (String shotId : List.of("shot", "second")) {
            when(repository.listShotStoryboardAssets("project", shotId)).thenReturn(Flux.empty());
            when(repository.listShotReferencesForVideo("project", shotId)).thenReturn(Mono.just(List.of()));
            when(repository.nextPromptVersion("project", shotId)).thenReturn(Mono.just(1));
        }
    }

    /** 设置当前镜头及其采用版本和图片。
     * @param shotId 镜头标识
     * @param number 镜头序号
     * @param version 已采用版本
     * @param images 当前视频图片
     */
    private void bindGeneration(String shotId, int number, ComicDramaDtos.PromptVersion version, List<ShotReferenceImage> images) {
        when(repository.getShot("project", shotId)).thenReturn(Mono.just(shot(shotId, number)));
        when(repository.getLatestPrompt("project", shotId)).thenReturn(Mono.just(version));
        when(repository.listShotReferencesForVideo("project", shotId)).thenReturn(Mono.just(images));
    }

    /** 创建指定来源的测试图片。
     * @param type 资产类型
     * @param id 媒体身份
     * @return 测试图片
     */
    private static ShotReferenceImage image(String type, String id) {
        return new ShotReferenceImage("storyboard".equals(type) ? "shot" : "assetVersion", id, type, id,
                new AiTaskDtos.AiTaskMediaReference(id, id, "image/png", id + ".png", "", "storyboard".equals(type) ? "first_frame" : "subject"));
    }

    /** 创建完整提示词版本。
     * @param shotId 所属镜头
     * @param images 生成时图片
     * @return 带快照的提示词版本
     */
    private static ComicDramaDtos.PromptVersion prompt(String shotId, List<ShotReferenceImage> images) {
        JSONObject snapshot = ComicDramaPromptReferences.snapshot("八段正文", images, new JSONObject());
        return new ComicDramaDtos.PromptVersion("prompt-" + shotId, shotId, 1, "ai", ComicDramaPromptReferences.fullPrompt(snapshot),
                snapshot, "model", BigDecimal.ZERO, "adopted", OffsetDateTime.now());
    }

    /** 创建带来源正文的镜头。
     * @param id 镜头标识
     * @param number 镜头序号
     * @return 测试镜头
     */
    private static ComicDramaDtos.Shot shot(String id, int number) {
        return new ComicDramaDtos.Shot(id, null, null, "来源剧本", number, number, BigDecimal.valueOf(5),
                "中景", "", "画面", "", "固定", "", "", "", "", "ready", List.of("actor"), 0, null, null);
    }
}
