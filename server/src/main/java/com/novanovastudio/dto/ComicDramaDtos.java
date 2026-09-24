package com.novanovastudio.dto;

import com.alibaba.fastjson2.JSONObject;
import jakarta.validation.Valid;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.List;

/**
 * 漫剧生产工作台接口请求、响应与结构化领域数据。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-09-21 10:00
 */
public final class ComicDramaDtos {

    /** 禁止实例化数据结构工具类。 */
    private ComicDramaDtos() {
    }

    /** 漫剧项目分页摘要。 */
    public record ProjectSummary(String projectId, String scriptProjectId, String title, String projectType,
                                 String stage, int completionRate, int assetCount, int shotCount,
                                 int completedShotCount, int pendingUpdateCount, int runningTaskCount,
                                 String readiness, long revision, OffsetDateTime updatedAt) {
    }

    /** 漫剧项目分页结果。 */
    public record ProjectListResponse(List<ProjectSummary> projects, long total, int page, int pageSize) {
    }

    /** 项目级生产设置。 */
    public record ProductionSettings(
            @NotBlank @Size(max = 32) String projectType,
            @Min(1) int targetEpisodeCount,
            @Min(0) int episodeTargetDuration,
            @Min(0) int overallDuration,
            @NotBlank @Size(max = 16) String orientation,
            @NotBlank @Size(max = 16) String aspectRatio,
            @Size(max = 8000) String visualStyle,
            @Size(max = 8000) String eraAtmosphere,
            @Size(max = 120) String targetPlatform,
            @Size(max = 200) String useCase) {
    }

    /** 视觉资产。 */
    public record Asset(@NotBlank @Size(max = 64) String id, @NotBlank @Size(max = 20) String assetType,
                        @Size(max = 64) String sourceEntityId, @NotBlank @Size(max = 200) String name,
                        @Size(max = 12000) String description, JSONObject voicePreference,
                        @NotBlank @Size(max = 20) String usageStatus, @Min(0) long revision,
                        OffsetDateTime createdAt, OffsetDateTime updatedAt) {
    }

    /** 视觉资产版本。 */
    public record AssetVersion(@NotBlank @Size(max = 64) String id, @NotBlank @Size(max = 64) String assetId,
                               @NotBlank @Size(max = 160) String versionName,
                               @NotBlank @Size(max = 40) String variantType,
                               @Size(max = 12000) String appearanceDescription,
                               List<JSONObject> referenceMedia, JSONObject attributes,
                               @NotBlank @Size(max = 20) String status, @Min(0) long revision,
                               OffsetDateTime createdAt, OffsetDateTime updatedAt) {
    }

    /** 正式镜头。 */
    public record Shot(@NotBlank @Size(max = 64) String id, @Size(max = 64) String sourceEpisodeId,
                       @Size(max = 64) String sourceSceneId, @Size(max = 30000) String sourceScriptExcerpt,
                       @Positive int shotNumber, @Min(0) int sortOrder,
                       @NotNull BigDecimal durationSeconds, @Size(max = 40) String shotSize,
                       @Size(max = 12000) String composition, @Size(max = 12000) String visualDescription,
                       @Size(max = 12000) String actionDescription, @Size(max = 8000) String cameraMovement,
                       @Size(max = 8000) String lightingAtmosphere, @Size(max = 8000) String dialogueVoiceover,
                       @Size(max = 8000) String soundDescription, @Size(max = 8000) String styleOverride,
                       @NotBlank @Size(max = 24) String productionStatus,
                       @NotNull List<@NotBlank @Size(max = 64) String> assetVersionIds,
                       @Min(0) long revision, OffsetDateTime createdAt, OffsetDateTime updatedAt) {
    }

    /** 镜头拆分草稿。 */
    public record ShotDraft(String id, String projectId, String scopeType, String scopeId,
                            long baseProjectRevision, long baseScriptRevision, String instruction, String model,
                            JSONObject draftData, int chargedCredits, String status,
                            OffsetDateTime createdAt, OffsetDateTime confirmedAt) {
    }

    /** 镜头提示词版本。 */
    public record PromptVersion(String id, String shotId, int versionNumber, String sourceType,
                                String prompt, JSONObject sourceSnapshot, String model, int chargedCredits,
                                String status, OffsetDateTime createdAt) {
    }

    /** 媒体任务或生成结果。 */
    public record MediaResult(String id, String targetType, String targetId, String mediaType, String taskId,
                              JSONObject inputSnapshot, JSONObject resultData, String status, boolean adopted,
                              String failureReason, OffsetDateTime createdAt, OffsetDateTime updatedAt) {
    }

    /** 上游变化影响项。 */
    public record ChangeImpact(String id, String sourceType, String sourceId, String targetType, String targetId,
                               String changeSummary, JSONObject impactSnapshot, String status,
                               OffsetDateTime createdAt, OffsetDateTime resolvedAt) {
    }

    /** P1结构化声音轨。 */
    public record VoiceTrack(@NotBlank @Size(max = 64) String id, @Size(max = 64) String shotId,
                             @Size(max = 64) String sourceBlockId, @Size(max = 64) String characterId,
                             @NotBlank @Size(max = 20) String trackType, @Size(max = 12000) String content,
                             @Size(max = 256) String voiceModel, @NotNull BigDecimal speechRate,
                             @Size(max = 120) String tone, @Size(max = 120) String emotion,
                             @NotBlank @Size(max = 20) String status, @Min(0) long revision,
                             @Size(max = 256) String audioStorageKey, @Positive Long audioDurationMs,
                             @Min(0) Long timelineStartMs, @Min(0) Long trimStartMs, @Positive Long trimEndMs,
                             OffsetDateTime createdAt, OffsetDateTime updatedAt) {
    }

    /** 分镜时间轴文字片段。 */
    public record TimelineText(@NotBlank @Size(max = 64) String id,
                               @NotBlank @Size(max = 2000) String content,
                               @Min(0) long startMs, @Positive long endMs,
                               @Min(0) @Max(2) int trackNumber,
                               @NotNull @DecimalMin("0") @DecimalMax("1") BigDecimal positionX,
                               @NotNull @DecimalMin("0") @DecimalMax("1") BigDecimal positionY,
                                @Min(12) @Max(120) int fontSize,
                                @NotBlank String fontFamily,
                                @NotBlank @Pattern(regexp = "#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?") String color,
                               @NotBlank @Pattern(regexp = "left|center|right") String alignment,
                               @Pattern(regexp = "#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?") String backgroundColor,
                               @Min(0) long revision, OffsetDateTime createdAt, OffsetDateTime updatedAt) {
    }

    /** P1批量任务。 */
    public record BatchTask(String id, String batchType, String scopeType, JSONObject scope,
                            JSONObject modelSettings, int estimatedCredits, int totalCount, int queuedCount,
                            int processingCount, int completedCount, int failedCount, int needsUpdateCount,
                            String status, OffsetDateTime confirmedAt, OffsetDateTime createdAt,
                            OffsetDateTime updatedAt) {
    }

    /** 无限画布节点绑定。 */
    public record CanvasBinding(String id, String entityType, String entityId, String canvasProjectId,
                                String nodeId, JSONObject bindingData, OffsetDateTime createdAt,
                                OffsetDateTime updatedAt) {
    }

    /** 工作区生产进度统计。 */
    public record ProductionProgress(int assetCount, int readyAssetCount, int shotCount, int completedShotCount,
                                     int pendingUpdateCount, int runningTaskCount) {
    }

    /** 项目生产工作区聚合数据。 */
    public record Workspace(String projectId, String scriptProjectId, ScriptDtos.ProjectDetail scriptProject,
                            ProductionSettings settings, long revision, int completionRate,
                            ProductionProgress productionProgress, Readiness readiness,
                            List<Asset> assets, List<Shot> shots, List<ShotDraft> shotDrafts,
                            List<PromptVersion> promptVersions, List<MediaResult> media, List<ChangeImpact> impacts,
                            List<VoiceTrack> voiceTracks, List<TimelineText> timelineTexts, int textTrackCount,
                            List<BatchTask> batchTasks,
                            List<CanvasBinding> canvasBindings, List<ContinuityIssue> continuityIssues) {
    }

    /** 生产准备度检查项。 */
    public record ReadinessItem(String key, String status, String title, String description, String targetSection) {
    }

    /** 漫剧生产准备度。 */
    public record Readiness(String projectId, boolean ready, List<ReadinessItem> items) {
    }

    /** 生成费用预估。 */
    public record GenerationEstimate(String targetType, int taskCount, int estimatedCredits,
                                     String model, JSONObject settings) {
    }

    /** 批量媒体任务创建结果。 */
    public record GenerationTaskResult(List<MediaResult> mediaResults, int taskCount) {
    }

    /** 通用写操作修订结果。 */
    public record MutationResult(String projectId, long revision, OffsetDateTime updatedAt) {
    }

    /** 连续性问题。 */
    public record ContinuityIssue(String type, String severity, String previousShotId, String shotId,
                                  String title, String description, String suggestion) {
    }

    /** 通用项目标识请求。 */
    public record ProjectIdRequest(@NotBlank @Size(max = 64) String projectId) {
    }

    /** 初始化漫剧项目请求。 */
    public record InitializeProjectRequest(@NotBlank @Size(max = 64) String scriptProjectId,
                                           @Size(max = 32) String projectType) {
    }

    /** 更新生产设置请求。 */
    public record UpdateSettingsRequest(@NotBlank @Size(max = 64) String projectId, @Min(0) long expectedRevision,
                                        @NotNull @Valid ProductionSettings settings) {
    }

    /** 资产列表请求。 */
    public record ListAssetsRequest(@NotBlank @Size(max = 64) String projectId, @Size(max = 20) String assetType) {
    }

    /** 保存视觉资产请求。 */
    public record SaveAssetRequest(@NotBlank @Size(max = 64) String projectId, @Min(0) long expectedRevision,
                                   @NotNull @Valid Asset asset) {
    }

    /** 资产版本列表请求。 */
    public record ListAssetVersionsRequest(@NotBlank @Size(max = 64) String projectId,
                                           @NotBlank @Size(max = 64) String assetId) {
    }

    /** 保存资产版本请求。 */
    public record SaveAssetVersionRequest(@NotBlank @Size(max = 64) String projectId, @Min(0) long expectedRevision,
                                          @NotNull @Valid AssetVersion version) {
    }

    /** 生成镜头草稿请求。 */
    public record GenerateShotDraftRequest(@NotBlank @Size(max = 64) String projectId,
                                           @Size(max = 64) String episodeId, @Size(max = 64) String sceneId,
                                           @Min(1) int shotCount, @Size(max = 120) String rhythm,
                                           @Size(max = 8000) String focus,
                                           @NotBlank @Size(max = 256) String model,
                                           @AssertTrue(message = "生成镜头草稿前必须明确确认费用") boolean confirmed) {
    }

    /** 确认镜头草稿请求。 */
    public record ConfirmShotDraftRequest(@NotBlank @Size(max = 64) String projectId,
                                          @Min(0) long expectedRevision,
                                          @NotBlank @Size(max = 64) String draftId) {
    }

    /** 保存用户编辑后的镜头草稿请求。 */
    public record UpdateShotDraftRequest(@NotBlank @Size(max = 64) String projectId,
                                         @Min(0) long expectedRevision,
                                         @NotBlank @Size(max = 64) String draftId,
                                         @NotNull JSONObject draftData) {
    }

    /** 放弃待确认镜头草稿请求。 */
    public record DiscardShotDraftRequest(@NotBlank @Size(max = 64) String projectId,
                                          @Min(0) long expectedRevision,
                                          @NotBlank @Size(max = 64) String draftId) {
    }

    /** 镜头列表请求。 */
    public record ListShotsRequest(@NotBlank @Size(max = 64) String projectId,
                                   @Size(max = 64) String episodeId, @Size(max = 64) String sceneId) {
    }

    /** 保存镜头请求。 */
    public record SaveShotRequest(@NotBlank @Size(max = 64) String projectId, @Min(0) long expectedRevision,
                                  @NotNull @Valid Shot shot) {
    }

    /** 镜头排序请求。 */
    public record ReorderShotsRequest(@NotBlank @Size(max = 64) String projectId, @Min(0) long expectedRevision,
                                      @NotEmpty List<@NotBlank @Size(max = 64) String> shotIds) {
    }

    /** 删除镜头请求。 */
    public record DeleteShotRequest(@NotBlank @Size(max = 64) String projectId, @Min(0) long expectedRevision,
                                    @NotBlank @Size(max = 64) String shotId, @AssertTrue boolean confirm) {
    }

    /** 镜头删除影响预检结果。 */
    public record ShotDeleteImpact(String shotId, int affectedMediaCount, List<String> mediaIds,
                                   boolean requiresConfirmation) {
    }

    /** 镜头删除影响预检请求。 */
    public record ShotDeleteImpactRequest(@NotBlank @Size(max = 64) String projectId,
                                          @NotBlank @Size(max = 64) String shotId) {
    }

    /** AI合成镜头提示词请求。 */
    public record ComposePromptRequest(@NotBlank @Size(max = 64) String projectId,
                                       @NotBlank @Size(max = 64) String shotId,
                                       @NotBlank @Size(max = 256) String model,
                                       @AssertTrue(message = "合成提示词前必须明确确认费用") boolean confirmed) {
    }

    /** 手动保存提示词请求。 */
    public record SavePromptRequest(@NotBlank @Size(max = 64) String projectId, @Min(0) long expectedRevision,
                                    @NotBlank @Size(max = 64) String shotId,
                                    @NotBlank @Size(max = 16000) String prompt,
                                    Integer expectedPromptVersion) {
    }

    /** 生成报价请求。 */
    public record EstimateGenerationRequest(@NotBlank @Size(max = 64) String projectId,
                                            @NotBlank @Size(max = 24) String targetType,
                                            @NotEmpty List<@NotBlank @Size(max = 64) String> targetIds,
                                            @NotBlank @Size(max = 256) String model,
                                            @NotNull JSONObject settings) {
    }

    /** 创建媒体生成任务请求。 */
    public record CreateGenerationTaskRequest(@NotBlank @Size(max = 64) String projectId,
                                              @Min(0) long expectedRevision,
                                              @NotBlank @Size(max = 24) String targetType,
                                              @NotEmpty List<@NotBlank @Size(max = 64) String> targetIds,
                                              @NotBlank @Size(max = 256) String model,
                                              @NotNull JSONObject settings, @AssertTrue boolean confirmed) {
    }

    /** 查询媒体结果请求。 */
    public record ListMediaRequest(@NotBlank @Size(max = 64) String projectId, @Size(max = 64) String shotId,
                                   @Size(max = 64) String assetId) {
    }

    /** 采用媒体结果请求。 */
    public record AdoptMediaRequest(@NotBlank @Size(max = 64) String projectId, @Min(0) long expectedRevision,
                                    @NotBlank @Size(max = 64) String mediaId) {
    }

    /** 确认处理上游变化请求。 */
    public record ConfirmUpdateRequest(@NotBlank @Size(max = 64) String projectId,
                                       @Min(0) long expectedRevision,
                                       @NotBlank @Size(max = 24) String scope,
                                       @Size(max = 64) String targetId,
                                       @NotBlank @jakarta.validation.constraints.Pattern(regexp = "keepOld|update",
                                               message = "resolution仅支持keepOld或update") String resolution,
                                       @AssertTrue boolean confirmed) {
    }

    /** 查询声音轨请求。 */
    public record ListVoiceTracksRequest(@NotBlank @Size(max = 64) String projectId,
                                         @Size(max = 64) String shotId) {
    }

    /** 保存声音轨请求。 */
    public record SaveVoiceTrackRequest(@NotBlank @Size(max = 64) String projectId,
                                        @Min(0) long expectedRevision,
                                        @NotNull @Valid VoiceTrack voiceTrack) {
    }

    /** 查询分镜时间轴文字片段请求。 */
    public record ListTimelineTextsRequest(@NotBlank @Size(max = 64) String projectId) {
    }

    /** 保存分镜时间轴文字片段请求。 */
    public record SaveTimelineTextRequest(@NotBlank @Size(max = 64) String projectId,
                                          @Min(0) long expectedRevision,
                                          @NotNull @Valid TimelineText timelineText) {
    }

    /** 批量保存同轨文字片段换位请求。 */
    public record ReorderTimelineTextsRequest(@NotBlank @Size(max = 64) String projectId,
                                              @Min(0) long expectedRevision,
                                              @NotEmpty List<@NotNull @Valid TimelineText> timelineTexts) {
    }

    /** 删除分镜时间轴文字片段请求。 */
    public record DeleteTimelineTextRequest(@NotBlank @Size(max = 64) String projectId,
                                            @Min(0) long expectedRevision,
                                            @NotBlank @Size(max = 64) String timelineTextId) {
    }

    /** 删除新增文字轨道请求。 */
    public record DeleteTextTrackRequest(@NotBlank @Size(max = 64) String projectId,
                                         @Min(0) long expectedRevision,
                                         @Min(1) @Max(2) int trackNumber) {
    }

    /** 创建批量任务请求。 */
    public record CreateBatchTaskRequest(@NotBlank @Size(max = 64) String projectId,
                                         @Min(0) long expectedRevision, @NotBlank @Size(max = 20) String scope,
                                         @NotEmpty List<@NotBlank @Size(max = 64) String> targetIds,
                                         @NotBlank @Size(max = 24) String taskType,
                                         @NotBlank @Size(max = 256) String model,
                                         @NotNull JSONObject settings, @AssertTrue boolean confirmed) {
    }

    /** 画布绑定列表请求。 */
    public record ListCanvasBindingsRequest(@NotBlank @Size(max = 64) String projectId) {
    }

    /** 创建或更新画布绑定请求。 */
    public record BindCanvasRequest(@NotBlank @Size(max = 64) String projectId,
                                    @Min(0) long expectedRevision,
                                    @NotBlank @Size(max = 128) String canvasProjectId,
                                    @NotBlank @Size(max = 32) String entityType,
                                    @NotBlank @Size(max = 64) String entityId,
                                    @NotBlank @Size(max = 128) String nodeId) {
    }
}
