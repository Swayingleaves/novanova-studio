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
        aiTaskService = mock(AiTaskService.class);
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
                storyboardAgentService, aiTaskService, mock(PersistenceService.class), transaction, new NovanovaProperties());
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
        when(storyboardAgentService.composePrompts(any())).thenReturn(Mono.just(new StoryboardDtos.ComposePromptsResponse(
                List.of(new StoryboardDtos.StoryboardPrompt("shot", "八段正文及无图道具描述")), BigDecimal.ONE)));

        ComicDramaDtos.PromptVersion single = service.composePrompt(
                new ComicDramaDtos.ComposePromptRequest("project", "shot", "model", true)).block();
        service.composePrompts(new ComicDramaDtos.ComposePromptsRequest("project", 3L, List.of("shot"), "model", true)).block();

        ArgumentCaptor<ComicDramaDtos.PromptVersion> versions = ArgumentCaptor.forClass(ComicDramaDtos.PromptVersion.class);
        verify(repository, times(2)).createPromptVersion(eq("project"), versions.capture());
        ComicDramaDtos.PromptVersion batch = versions.getAllValues().getLast();
        assertEquals(single.prompt(), batch.prompt());
        assertEquals(single.sourceSnapshot().getJSONArray("referenceImages"), batch.sourceSnapshot().getJSONArray("referenceImages"));
        assertEquals("draft", single.status());
        assertEquals("adopted", batch.status());
        assertEquals(2, batch.sourceSnapshot().getJSONArray("referenceImages").size());
        ArgumentCaptor<StoryboardDtos.ComposePromptsRequest> agent = ArgumentCaptor.forClass(StoryboardDtos.ComposePromptsRequest.class);
        verify(storyboardAgentService, times(2)).composePrompts(agent.capture());
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
