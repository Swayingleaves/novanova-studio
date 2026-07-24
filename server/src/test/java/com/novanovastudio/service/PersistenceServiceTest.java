package com.novanovastudio.service;

import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.agent.AgentActivityService;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.ai.AiHttpClient;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.dto.PersistenceDtos;
import com.novanovastudio.entity.PersistenceRecords;
import com.novanovastudio.repository.PersistenceRepository;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.storage.ObjectStorageService;
import java.util.concurrent.atomic.AtomicReference;
import java.time.OffsetDateTime;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * @title        PersistenceServiceTest.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  业务持久化服务测试
 * @createTime   2026-07-09 22:00:00
 */
@ExtendWith(MockitoExtension.class)
class PersistenceServiceTest {

    /** 业务仓储 */
    @Mock
    private PersistenceRepository repository;

    /** Agent执行活动服务 */
    @Mock
    private AgentActivityService agentActivityService;

    /** 外部媒体下载客户端 */
    @Mock
    private AiHttpClient aiHttpClient;

    /** 当前用户提供器 */
    @Mock
    private CurrentUserProvider currentUserProvider;

    /** 服务配置 */
    @Mock
    private NovanovaProperties properties;

    /** 对象存储服务 */
    @Mock
    private ObjectStorageService objectStorageService;

    /** 待测试服务 */
    private PersistenceService service;

    /**
     * 初始化测试对象。
     */
    @BeforeEach
    void setUp() {
        org.mockito.Mockito.lenient().when(agentActivityService.activitiesForRound(
                org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.any(JSONObject.class)))
                .thenReturn(new JSONArray());
        service = new PersistenceService(repository, agentActivityService, aiHttpClient, currentUserProvider, properties, objectStorageService);
    }

    /**
     * saveProject 应从画布身份分组读取项目 ID 和标题。
     */
    @Test
    void shouldSaveProjectMetadataFromIdentity() {
        JSONObject identity = new JSONObject();
        identity.put("id", "canvas-1");
        identity.put("title", "测试画布");
        JSONObject project = new JSONObject();
        project.put("identity", identity);
        when(currentUserProvider.currentUserId()).thenReturn(Mono.just(9L));
        when(repository.saveProject(org.mockito.ArgumentMatchers.any())).thenReturn(Mono.empty());

        service.saveProject(project).block();

        ArgumentCaptor<PersistenceRecords.SnapshotRecord> captor = ArgumentCaptor.forClass(PersistenceRecords.SnapshotRecord.class);
        verify(repository).saveProject(captor.capture());
        PersistenceRecords.SnapshotRecord record = captor.getValue();
        Assertions.assertEquals("canvas-1", record.getId());
        Assertions.assertEquals("测试画布", record.getTitle());
        Assertions.assertEquals("canvas-1", JSON.parseObject(record.getData()).getJSONObject("identity").getString("id"));
    }

    /**
     * renameGenerationLogTitle 应拒绝空标题。
     */
    @Test
    void shouldRejectBlankGenerationLogTitle() {
        BusinessException exception = Assertions.assertThrows(BusinessException.class, () -> service.renameGenerationLogTitle("conversation-1", "   ").block());

        Assertions.assertTrue(exception.getMessage().contains("标题不能为空"));
    }

    /**
     * renameGenerationLogTitle 应拒绝超过最大长度的标题。
     */
    @Test
    void shouldRejectTooLongGenerationLogTitle() {
        BusinessException exception = Assertions.assertThrows(BusinessException.class, () -> service.renameGenerationLogTitle("conversation-1", "a".repeat(101)).block());

        Assertions.assertTrue(exception.getMessage().contains("标题不能超过100个字符"));
    }

    /**
     * renameGenerationLogTitle 应将裁剪后的标题写入仓储。
     */
    @Test
    void shouldRenameGenerationLogTitleWithTrimmedValue() {
        when(currentUserProvider.currentUserId()).thenReturn(Mono.just(9L));
        when(repository.renameGenerationLogTitle(9L, "conversation-1", "新的标题")).thenReturn(Mono.just(1L));

        service.renameGenerationLogTitle("conversation-1", "  新的标题  ").block();

        verify(repository).renameGenerationLogTitle(9L, "conversation-1", "新的标题");
    }

    /**
     * testObjectStorage 应直接使用当前请求配置，不查询默认对象存储。
     */
    @Test
    void shouldTestProvidedObjectStorageWithoutReadingDefaultStorage() {
        PersistenceDtos.ObjectStorageConfig config = new PersistenceDtos.ObjectStorageConfig(
                "tencentCos", "secret-id", "secret-key", "example-1250000000", "ap-guangzhou",
                "", "novanova-studio", "", "storage-1", "测试对象存储", "", false);
        when(objectStorageService.putObject(
                org.mockito.ArgumentMatchers.eq(config),
                org.mockito.ArgumentMatchers.anyString(),
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.anyLong(),
                org.mockito.ArgumentMatchers.eq("text/plain;charset=utf-8")))
                .thenReturn("https://cos.example.com/object-storage-test.txt");

        PersistenceDtos.ObjectStorageFile result = service.testObjectStorage(config).block();

        Assertions.assertNotNull(result);
        Assertions.assertEquals("https://cos.example.com/object-storage-test.txt", result.url());
        Assertions.assertEquals("tencentCos", result.provider());
        Assertions.assertEquals("example-1250000000", result.bucket());
        Assertions.assertEquals("ap-guangzhou", result.region());
        Assertions.assertTrue(result.key().contains("/files/"));
        verifyNoInteractions(repository);
    }

    /**
     * renameGenerationLogTitle 应在记录不存在时返回异常。
     */
    @Test
    void shouldRejectMissingGenerationLogWhenRenamingTitle() {
        when(currentUserProvider.currentUserId()).thenReturn(Mono.just(9L));
        when(repository.renameGenerationLogTitle(9L, "conversation-1", "新的标题")).thenReturn(Mono.just(0L));

        BusinessException exception = Assertions.assertThrows(BusinessException.class, () -> service.renameGenerationLogTitle("conversation-1", "新的标题").block());

        Assertions.assertTrue(exception.getMessage().contains("生成记录不存在"));
    }

    /**
     * saveOrUpdateGenerationRound 应在新轮次 ID 不存在时追加到既有轮次之后。
     */
    @Test
    void shouldAppendGenerationRoundWhenRoundIdIsNew() {
        JSONObject existingLog = generationLog(round("round-1", "pending"));
        when(repository.findGenerationLogById(9L, "conversation-1")).thenReturn(Mono.just(generationLogRecord(existingLog)));
        when(repository.saveGenerationLog(org.mockito.ArgumentMatchers.any())).thenReturn(Mono.empty());

        service.saveOrUpdateGenerationRound(9L, "conversation-1", "image", "生成图片", round("round-2", "pending")).block();

        JSONObject savedLog = capturedGenerationLog();
        JSONArray rounds = savedLog.getJSONArray("rounds");
        Assertions.assertEquals(2, rounds.size());
        Assertions.assertEquals("round-1", rounds.getJSONObject(0).getString("id"));
        Assertions.assertEquals("round-2", rounds.getJSONObject(1).getString("id"));
    }

    /**
     * saveOrUpdateGenerationRound 应在同一会话连续完成两轮后保留全部历史轮次。
     */
    @Test
    void shouldKeepPreviousRoundsWhenCompletingAnotherTurn() {
        AtomicReference<JSONObject> persistedLog = new AtomicReference<>(
                generationLog(roundWithResults("server-round-1", "success")));
        when(repository.findGenerationLogById(9L, "conversation-1"))
                .thenAnswer(invocation -> Mono.just(generationLogRecord(persistedLog.get())));
        when(repository.saveGenerationLog(org.mockito.ArgumentMatchers.any())).thenAnswer(invocation -> {
            PersistenceRecords.GenerationLogRecord record = invocation.getArgument(0);
            persistedLog.set(JSON.parseObject(record.getData()));
            return Mono.empty();
        });

        service.saveOrUpdateGenerationRound(9L, "conversation-1", "image", "生成图片",
                roundWithResults("server-round-2", "pending")).block();
        service.saveOrUpdateGenerationRound(9L, "conversation-1", "image", "生成图片",
                roundWithResults("server-round-2", "success")).block();

        JSONArray rounds = persistedLog.get().getJSONArray("rounds");
        Assertions.assertEquals(2, rounds.size());
        Assertions.assertEquals("server-round-1", rounds.getJSONObject(0).getString("id"));
        Assertions.assertEquals("success", rounds.getJSONObject(0).getJSONArray("results")
                .getJSONObject(0).getString("status"));
        Assertions.assertEquals("server-round-2", rounds.getJSONObject(1).getString("id"));
        Assertions.assertEquals("success", rounds.getJSONObject(1).getJSONArray("results")
                .getJSONObject(0).getString("status"));
    }

    /**
     * saveOrUpdateGenerationRound 应将后端执行活动写入生成轮次。
     */
    @Test
    void shouldSaveBackendActivitiesWithGenerationRound() {
        JSONObject activity = new JSONObject();
        activity.put("id", "tool-round-1");
        activity.put("type", "tool-execute");
        activity.put("title", "调用图片生成工具");
        activity.put("status", "running");
        when(agentActivityService.activitiesForRound(
                org.mockito.ArgumentMatchers.eq("conversation-1"), org.mockito.ArgumentMatchers.any(JSONObject.class)))
                .thenReturn(JSONArray.of(activity));
        when(repository.findGenerationLogById(9L, "conversation-1")).thenReturn(Mono.empty());
        when(repository.saveGenerationLog(org.mockito.ArgumentMatchers.any())).thenReturn(Mono.empty());

        service.saveOrUpdateGenerationRound(9L, "conversation-1", "image", "生成图片", round("round-1", "pending")).block();

        JSONObject savedRound = capturedGenerationLog().getJSONArray("rounds").getJSONObject(0);
        Assertions.assertEquals("tool-round-1", savedRound.getJSONArray("activities").getJSONObject(0).getString("id"));
    }

    /**
     * saveOrUpdateGenerationRound 应按相同轮次 ID 原位置替换已有轮次。
     */
    @Test
    void shouldReplaceGenerationRoundAtOriginalPositionWhenRoundIdMatches() {
        JSONObject existingLog = generationLog(round("round-1", "pending"), round("round-2", "pending"));
        when(repository.findGenerationLogById(9L, "conversation-1")).thenReturn(Mono.just(generationLogRecord(existingLog)));
        when(repository.saveGenerationLog(org.mockito.ArgumentMatchers.any())).thenReturn(Mono.empty());

        service.saveOrUpdateGenerationRound(9L, "conversation-1", "image", "生成图片", round("round-1", "success")).block();

        JSONArray rounds = capturedGenerationLog().getJSONArray("rounds");
        Assertions.assertEquals(2, rounds.size());
        Assertions.assertEquals("round-1", rounds.getJSONObject(0).getString("id"));
        Assertions.assertEquals("success", rounds.getJSONObject(0).getString("status"));
        Assertions.assertEquals("round-2", rounds.getJSONObject(1).getString("id"));
    }

    /**
     * saveOrUpdateGenerationRound 应在重复写入同一终态时保持轮次数量不变。
     */
    @Test
    void shouldNotDuplicateGenerationRoundWhenTerminalRoundIsSavedRepeatedly() {
        AtomicReference<JSONObject> persistedLog = new AtomicReference<>(generationLog(round("round-1", "pending")));
        when(repository.findGenerationLogById(9L, "conversation-1")).thenAnswer(invocation -> Mono.just(generationLogRecord(persistedLog.get())));
        when(repository.saveGenerationLog(org.mockito.ArgumentMatchers.any())).thenAnswer(invocation -> {
            PersistenceRecords.GenerationLogRecord record = invocation.getArgument(0);
            persistedLog.set(JSON.parseObject(record.getData()));
            return Mono.empty();
        });

        JSONObject terminalRound = round("round-1", "success");
        service.saveOrUpdateGenerationRound(9L, "conversation-1", "image", "生成图片", terminalRound).block();
        service.saveOrUpdateGenerationRound(9L, "conversation-1", "image", "生成图片", terminalRound).block();

        JSONArray rounds = persistedLog.get().getJSONArray("rounds");
        Assertions.assertEquals(1, rounds.size());
        Assertions.assertEquals("success", rounds.getJSONObject(0).getString("status"));
        verify(repository, times(2)).saveGenerationLog(org.mockito.ArgumentMatchers.any());
    }

    /**
     * saveOrUpdateGenerationRound 应在批量终态合并结果时删除已吸收的其他 pending 轮次。
     */
    @Test
    void shouldRemoveMergedPendingRoundsAndKeepOriginalCreatedAt() {
        JSONObject firstPendingRound = round("call-1", "pending");
        firstPendingRound.put("createdAt", 100L);
        JSONObject secondPendingRound = round("call-2", "pending");
        secondPendingRound.put("createdAt", 200L);
        when(repository.findGenerationLogById(9L, "conversation-1"))
                .thenReturn(Mono.just(generationLogRecord(generationLog(firstPendingRound, secondPendingRound))));
        when(repository.saveGenerationLog(org.mockito.ArgumentMatchers.any())).thenReturn(Mono.empty());

        JSONObject completedRound = round("call-1", "success");
        completedRound.put("createdAt", 300L);
        completedRound.put("results", JSONArray.of(round("call-1", "success"), round("call-2", "success")));
        service.saveOrUpdateGenerationRound(9L, "conversation-1", "image", "生成图片", completedRound).block();

        JSONArray rounds = capturedGenerationLog().getJSONArray("rounds");
        Assertions.assertEquals(1, rounds.size());
        Assertions.assertEquals("call-1", rounds.getJSONObject(0).getString("id"));
        Assertions.assertEquals(100L, rounds.getJSONObject(0).getLongValue("createdAt"));
        Assertions.assertEquals(2, rounds.getJSONObject(0).getJSONArray("results").size());
    }

    /**
     * saveOrUpdateGenerationRound 应在任一结果仍等待时保持记录运行中。
     */
    @Test
    void shouldKeepGenerationLogRunningWhileAnyResultIsPending() {
        JSONObject completedRound = roundWithResults("round-1", "success");
        JSONObject pendingRound = roundWithResults("round-2", "pending");
        when(repository.findGenerationLogById(9L, "conversation-1"))
                .thenReturn(Mono.just(generationLogRecord(generationLog(completedRound, pendingRound))));
        when(repository.saveGenerationLog(org.mockito.ArgumentMatchers.any())).thenReturn(Mono.empty());

        service.saveOrUpdateGenerationRound(9L, "conversation-1", "image", "生成图片", roundWithResults("round-1", "success")).block();

        PersistenceRecords.GenerationLogRecord record = capturedGenerationLogRecord();
        Assertions.assertEquals("running", record.getGenerationStatus());
        Assertions.assertNull(record.getGenerationCompletedAt());
    }

    /**
     * saveOrUpdateGenerationRound 应以最近完成轮次中的任一成功结果标记成功。
     */
    @Test
    void shouldMarkGenerationLogSuccessfulWhenLatestRoundContainsSuccess() {
        JSONObject latestRound = new JSONObject();
        latestRound.put("id", "round-2");
        latestRound.put("results", JSONArray.of(round("result-1", "failed"), round("result-2", "success")));
        when(repository.findGenerationLogById(9L, "conversation-1"))
                .thenReturn(Mono.just(generationLogRecord(generationLog(roundWithResults("round-1", "failed")))));
        when(repository.saveGenerationLog(org.mockito.ArgumentMatchers.any())).thenReturn(Mono.empty());

        service.saveOrUpdateGenerationRound(9L, "conversation-1", "image", "生成图片", latestRound).block();

        PersistenceRecords.GenerationLogRecord record = capturedGenerationLogRecord();
        Assertions.assertEquals("success", record.getGenerationStatus());
        Assertions.assertNotNull(record.getGenerationCompletedAt());
    }

    /**
     * saveOrUpdateGenerationRound 应在最近完成轮次没有成功结果时标记失败。
     */
    @Test
    void shouldMarkGenerationLogFailedWhenLatestRoundHasNoSuccess() {
        when(repository.findGenerationLogById(9L, "conversation-1"))
                .thenReturn(Mono.just(generationLogRecord(generationLog(roundWithResults("round-1", "success")))));
        when(repository.saveGenerationLog(org.mockito.ArgumentMatchers.any())).thenReturn(Mono.empty());

        service.saveOrUpdateGenerationRound(9L, "conversation-1", "video", "生成视频", roundWithSingleResult("round-2", "failed")).block();

        PersistenceRecords.GenerationLogRecord record = capturedGenerationLogRecord();
        Assertions.assertEquals("failed", record.getGenerationStatus());
        Assertions.assertNotNull(record.getGenerationCompletedAt());
    }

    /**
     * saveOrUpdateGenerationRound 重复保存相同终态时不应刷新完成时间。
     */
    @Test
    void shouldKeepCompletionTimeWhenSameTerminalStateIsSavedAgain() {
        OffsetDateTime completedAt = OffsetDateTime.parse("2026-07-11T10:00:00Z");
        PersistenceRecords.GenerationLogRecord existingRecord = generationLogRecord(generationLog(roundWithResults("round-1", "success")));
        existingRecord.setGenerationStatus("success");
        existingRecord.setGenerationCompletedAt(completedAt);
        when(repository.findGenerationLogById(9L, "conversation-1")).thenReturn(Mono.just(existingRecord));
        when(repository.saveGenerationLog(org.mockito.ArgumentMatchers.any())).thenReturn(Mono.empty());

        service.saveOrUpdateGenerationRound(9L, "conversation-1", "image", "生成图片", roundWithResults("round-1", "success")).block();

        Assertions.assertEquals(completedAt, capturedGenerationLogRecord().getGenerationCompletedAt());
    }

    /**
     * markGenerationLogViewed 应只更新当前用户所属记录。
     */
    @Test
    void shouldMarkGenerationLogViewedForCurrentUser() {
        when(currentUserProvider.currentUserId()).thenReturn(Mono.just(9L));
        when(repository.markGenerationLogViewed(9L, "conversation-1")).thenReturn(Mono.just(1L));

        service.markGenerationLogViewed("conversation-1").block();

        verify(repository).markGenerationLogViewed(9L, "conversation-1");
    }

    /**
     * markGenerationLogViewed 在记录不存在或不属于当前用户时应返回异常。
     */
    @Test
    void shouldRejectMissingGenerationLogWhenMarkingViewed() {
        when(currentUserProvider.currentUserId()).thenReturn(Mono.just(9L));
        when(repository.markGenerationLogViewed(9L, "conversation-1")).thenReturn(Mono.just(0L));

        BusinessException exception = Assertions.assertThrows(BusinessException.class,
                () -> service.markGenerationLogViewed("conversation-1").block());

        Assertions.assertTrue(exception.getMessage().contains("生成记录不存在"));
    }

    /**
     * listGenerationLogs 应返回任务状态和未读判断时间。
     */
    @Test
    void shouldIncludeGenerationTaskMetadataWhenListingLogs() {
        OffsetDateTime completedAt = OffsetDateTime.parse("2026-07-11T10:00:00Z");
        OffsetDateTime viewedAt = OffsetDateTime.parse("2026-07-11T09:00:00Z");
        PersistenceRecords.GenerationLogRecord record = generationLogRecord(generationLog(roundWithResults("round-1", "success")));
        record.setGenerationStatus("success");
        record.setGenerationCompletedAt(completedAt);
        record.setGenerationViewedAt(viewedAt);
        when(currentUserProvider.currentUserId()).thenReturn(Mono.just(9L));
        when(repository.listGenerationLogs(9L, "image")).thenReturn(Flux.just(record));

        JSONObject generationLog = service.listGenerationLogs("image").block().getFirst();

        Assertions.assertEquals("success", generationLog.getString("generationStatus"));
        Assertions.assertEquals("2026-07-11T10:00:00Z", generationLog.getString("generationCompletedAt"));
        Assertions.assertEquals("2026-07-11T09:00:00Z", generationLog.getString("generationViewedAt"));
    }

    /**
     * uploadRemoteMediaToObjectStorage 对已转存媒体应直接返回现有对象存储信息。
     */
    @Test
    void shouldReturnExistingObjectStorageMediaWithoutDownloadingAgain() {
        PersistenceRecords.MediaFileRecord record = new PersistenceRecords.MediaFileRecord();
        record.setStorageKey("image:1");
        record.setUserId(9L);
        record.setKind("image");
        record.setSourceUrl("https://example.com/image.png");
        record.setObjectStorageProvider("qiniuKodo");
        record.setObjectStorageUrl("https://cdn.example.com/image.png");
        record.setObjectStorageKey("images/image.png");
        record.setBucket("bucket");
        record.setRegion("ap-test");
        record.setMimeType("image/png");
        record.setBytes(10L);
        when(currentUserProvider.currentUserId()).thenReturn(Mono.just(9L));
        when(repository.getMedia(9L, "image:1")).thenReturn(Mono.just(record));

        PersistenceDtos.UploadedMediaResponse response = service.uploadRemoteMediaToObjectStorage("image:1").block();

        Assertions.assertNotNull(response);
        Assertions.assertEquals("https://cdn.example.com/image.png", response.url());
        Assertions.assertEquals("qiniuKodo", response.objectStorage().provider());
        verify(aiHttpClient, times(0)).downloadRemoteBinary(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyString());
    }

    /**
     * AI供应商返回的远程结果地址应按统一远程媒体链路登记。
     */
    @Test
    void shouldRegisterAiGeneratedRemoteMediaThroughUnifiedPath() {
        String sourceUrl = "https://127.0.0.1/generated.png";
        PersistenceDtos.RegisterRemoteMediaRequest input = new PersistenceDtos.RegisterRemoteMediaRequest("image", sourceUrl, null, "image/png", 12L, 1, 1, 0, null);
        when(aiHttpClient.validateRemoteMediaUrl(sourceUrl)).thenReturn(Mono.empty());
        when(repository.saveMedia(org.mockito.ArgumentMatchers.any(PersistenceRecords.MediaFileRecord.class))).thenReturn(Mono.empty());

        PersistenceDtos.UploadedMediaResponse response = service.registerRemoteMediaForUser(9L, input).block();

        Assertions.assertNotNull(response);
        ArgumentCaptor<PersistenceRecords.MediaFileRecord> recordCaptor = ArgumentCaptor.forClass(PersistenceRecords.MediaFileRecord.class);
        verify(repository).saveMedia(recordCaptor.capture());
        Assertions.assertNotNull(recordCaptor.getValue().getMetadata());
        verify(aiHttpClient).validateRemoteMediaUrl(sourceUrl);
    }

    /** 删除仍被模型配置引用的渠道时应拒绝操作。 */
    @Test
    void shouldRejectDeletingReferencedChannel() {
        when(repository.existsPlatformModelConfigByChannel("channel-1")).thenReturn(Mono.just(true));

        BusinessException exception = Assertions.assertThrows(BusinessException.class, () -> service.deleteChannel("channel-1").block());

        Assertions.assertTrue(exception.getMessage().contains("仍被全站模型引用"));
    }

    /** 创建模型配置时应校验模型属于指定渠道。 */
    @Test
    void shouldRejectModelOutsideChannelModelList() {
        PersistenceRecords.UserAiChannelRecord channel = new PersistenceRecords.UserAiChannelRecord();
        channel.setModels("[\"known-model\"]");
        when(repository.getPlatformAiChannel("channel-1")).thenReturn(Mono.just(channel));

        BusinessException exception = Assertions.assertThrows(BusinessException.class, () -> service.createModelConfig(
                new com.novanovastudio.dto.PersistenceDtos.CreateModelConfigRequest("channel-1", "unknown-model", "image", java.util.List.of(), 0, 0, true, "high")).block());

        Assertions.assertTrue(exception.getMessage().contains("不在所属渠道"));
    }

    /**
     * 模型思考配置应在新建、更新和查询间完整往返。
     */
    @Test
    void shouldRoundTripModelThinkingConfiguration() {
        PersistenceRecords.UserAiChannelRecord channel = new PersistenceRecords.UserAiChannelRecord();
        channel.setModels("[\"deepseek-reasoner\"]");
        when(repository.getPlatformAiChannel("channel-1")).thenReturn(Mono.just(channel));
        when(repository.createPlatformAiModelConfig(org.mockito.ArgumentMatchers.any(PersistenceRecords.UserAiModelConfigRecord.class))).thenReturn(Mono.empty());

        PersistenceDtos.ModelConfig created = service.createModelConfig(new PersistenceDtos.CreateModelConfigRequest(
                "channel-1", "deepseek-reasoner", "text", java.util.List.of(), 0, 0, false, "max")).block();

        Assertions.assertNotNull(created);
        Assertions.assertFalse(created.thinkingEnabled());
        Assertions.assertEquals("max", created.reasoningEffort());
        ArgumentCaptor<PersistenceRecords.UserAiModelConfigRecord> createCaptor = ArgumentCaptor.forClass(PersistenceRecords.UserAiModelConfigRecord.class);
        verify(repository).createPlatformAiModelConfig(createCaptor.capture());
        PersistenceRecords.UserAiModelConfigRecord record = createCaptor.getValue();
        Assertions.assertFalse(record.getThinkingEnabled());
        Assertions.assertEquals("max", record.getReasoningEffort());

        when(repository.getPlatformAiModelConfig(created.id())).thenReturn(Mono.just(record));
        when(repository.updatePlatformAiModelConfig(record)).thenReturn(Mono.just(1L));
        PersistenceDtos.ModelConfig updated = service.updateModelConfig(new PersistenceDtos.UpdateModelConfigRequest(
                created.id(), "text", java.util.List.of(), 0, 0, true, "high")).block();

        Assertions.assertNotNull(updated);
        Assertions.assertTrue(updated.thinkingEnabled());
        Assertions.assertEquals("high", updated.reasoningEffort());
        when(repository.listPlatformAiModelConfigs()).thenReturn(Flux.just(record));
        PersistenceDtos.ModelConfig listed = service.listModelConfigs().block().getFirst();
        Assertions.assertTrue(listed.thinkingEnabled());
        Assertions.assertEquals("high", listed.reasoningEffort());
    }

    /**
     * 未填写思考配置时应使用历史记录迁移后的默认值。
     */
    @Test
    void shouldDefaultModelThinkingConfiguration() {
        PersistenceRecords.UserAiChannelRecord channel = new PersistenceRecords.UserAiChannelRecord();
        channel.setModels("[\"deepseek-chat\"]");
        when(repository.getPlatformAiChannel("channel-1")).thenReturn(Mono.just(channel));
        when(repository.createPlatformAiModelConfig(org.mockito.ArgumentMatchers.any(PersistenceRecords.UserAiModelConfigRecord.class))).thenReturn(Mono.empty());

        PersistenceDtos.ModelConfig created = service.createModelConfig(new PersistenceDtos.CreateModelConfigRequest(
                "channel-1", "deepseek-chat", "text", java.util.List.of(), 0, 0, null, null)).block();

        Assertions.assertNotNull(created);
        Assertions.assertTrue(created.thinkingEnabled());
        Assertions.assertEquals("high", created.reasoningEffort());
    }

    /**
     * 构建包含指定轮次的生成记录。
     *
     * @param rounds JSONObject[] 生成轮次数组
     * @return JSONObject 生成记录
     */
    private JSONObject generationLog(JSONObject... rounds) {
        JSONObject log = new JSONObject();
        log.put("id", "conversation-1");
        log.put("title", "生成图片");
        log.put("rounds", JSONArray.of(rounds));
        return log;
    }

    /**
     * 构建生成轮次。
     *
     * @param id String 轮次稳定ID
     * @param status String 生成状态
     * @return JSONObject 生成轮次
     */
    private JSONObject round(String id, String status) {
        JSONObject round = new JSONObject();
        round.put("id", id);
        round.put("status", status);
        return round;
    }

    /**
     * 将生成记录 JSON 转换为仓储返回对象。
     *
     * @param log JSONObject 生成记录
     * @return GenerationLogRecord 仓储记录
     */
    private PersistenceRecords.GenerationLogRecord generationLogRecord(JSONObject log) {
        PersistenceRecords.GenerationLogRecord record = new PersistenceRecords.GenerationLogRecord();
        record.setData(JSON.toJSONString(log));
        return record;
    }

    /**
     * 捕获并解析最近一次保存的生成记录。
     *
     * @return JSONObject 保存后的生成记录
     */
    private JSONObject capturedGenerationLog() {
        return JSON.parseObject(capturedGenerationLogRecord().getData());
    }

    /**
     * 捕获最近一次保存的生成记录实体。
     *
     * @return GenerationLogRecord 保存后的生成记录实体
     */
    private PersistenceRecords.GenerationLogRecord capturedGenerationLogRecord() {
        ArgumentCaptor<PersistenceRecords.GenerationLogRecord> captor = ArgumentCaptor.forClass(PersistenceRecords.GenerationLogRecord.class);
        verify(repository).saveGenerationLog(captor.capture());
        return captor.getValue();
    }

    /**
     * 构建包含结果数组的生成轮次。
     *
     * @param id String 轮次稳定ID
     * @param status String 结果状态
     * @return JSONObject 生成轮次
     */
    private JSONObject roundWithResults(String id, String status) {
        JSONObject round = new JSONObject();
        round.put("id", id);
        round.put("results", JSONArray.of(round(id, status)));
        return round;
    }

    /**
     * 构建包含单结果对象的视频生成轮次。
     *
     * @param id String 轮次稳定ID
     * @param status String 结果状态
     * @return JSONObject 生成轮次
     */
    private JSONObject roundWithSingleResult(String id, String status) {
        JSONObject round = new JSONObject();
        round.put("id", id);
        round.put("result", round(id, status));
        return round;
    }
}
