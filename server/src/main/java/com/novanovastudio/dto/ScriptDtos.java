package com.novanovastudio.dto;

import com.alibaba.fastjson2.JSONObject;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.OffsetDateTime;
import java.util.List;

/**
 * 剧本创作项目、结构化正文、版本与AI草稿数据结构。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-09-20 10:00
 */
public final class ScriptDtos {

    /** 禁止实例化数据结构容器。 */
    private ScriptDtos() {
    }

    /** 剧本模板结构段。 */
    public record TemplateSection(String id, String title, String sectionType, String guidance, int sortOrder) {
    }

    /** 剧本模板。 */
    public record ScriptTemplate(String templateKey, String category, String name, String description,
                                 String contentType, String genre, String structureType,
                                 int recommendedEpisodeCount, List<TemplateSection> sections) {
    }

    /** 项目列表摘要。 */
    public record ProjectSummary(String id, String title, String contentType, String genre, String logline,
                                 String stage, int completionRate, int episodeCount, int targetEpisodeCount,
                                 boolean productionStarted, long revision, OffsetDateTime updatedAt) {
    }

    /** 分页项目列表。 */
    public record ProjectListResponse(List<ProjectSummary> projects, long total, int page, int pageSize) {
    }

    /** 项目基础概览。 */
    public record ProjectOverview(
            @NotBlank(message = "项目名称不能为空") @Size(max = 120, message = "项目名称不能超过120字") String title,
            @NotBlank(message = "内容形式不能为空")
            @Pattern(regexp = "comicDrama|liveActionShort|animation|advertisement|musicVideo|storyShort",
                    message = "内容形式不受支持") String contentType,
            @Size(max = 80, message = "题材不能超过80字") String genre,
            @Size(max = 2000, message = "一句话创意不能超过2000字") String logline,
            @Size(max = 20000, message = "故事简介不能超过20000字") String synopsis,
            @Size(max = 8000, message = "核心卖点不能超过8000字") String sellingPoints,
            @Size(max = 4000, message = "目标受众不能超过4000字") String targetAudience,
            @Min(value = 0, message = "目标时长不能小于0") @Max(value = 864000, message = "目标时长不能超过10天") int targetDurationSeconds,
            @Min(value = 1, message = "目标集数不能小于1") @Max(value = 1000, message = "目标集数不能超过1000") int targetEpisodeCount,
            @Size(max = 8000, message = "叙事风格不能超过8000字") String narrativeStyle,
            @Size(max = 8000, message = "故事主题不能超过8000字") String theme,
            @Size(max = 30000, message = "主线剧情不能超过30000字") String mainPlot,
            @Size(max = 12000, message = "主要冲突不能超过12000字") String mainConflict,
            @Size(max = 12000, message = "结局方向不能超过12000字") String endingDirection) {
    }

    /** 大纲结构段。 */
    public record OutlineSection(@NotBlank @Size(max = 64) String id,
                                 @NotBlank @Pattern(regexp = "act|mainPlot|subplot|characterArc") String sectionType,
                                 @NotBlank @Size(max = 120) String title, @Size(max = 30000) String content,
                                 @Min(0) int sortOrder) {
    }

    /** 故事关键事件。 */
    public record StoryEvent(@NotBlank @Size(max = 64) String id, @Size(max = 64) String outlineSectionId,
                             @Size(max = 64) String episodeId, @Size(max = 64) String sceneId,
                             @NotBlank @Pattern(regexp = "plot|conflict|suspense|twist|climax|ending") String eventType,
                             @NotBlank @Size(max = 160) String title,
                             @Size(max = 12000) String description, @Min(0) int sortOrder) {
    }

    /** 人物文字设定。 */
    public record Character(
            @NotBlank @Size(max = 64) String id, @NotBlank @Size(max = 120) String name,
            @Size(max = 4000) String identity, @Size(max = 40) String age, @Size(max = 120) String occupation,
            @Size(max = 80) String roleType, @Size(max = 8000) String personality,
            @Size(max = 8000) String valuesDescription, @Size(max = 8000) String goal,
            @Size(max = 8000) String desire, @Size(max = 8000) String fear,
            @Size(max = 8000) String motivation, @Size(max = 12000) String appearanceDescription,
            @Size(max = 8000) String habits, @Size(max = 8000) String speechStyle,
            @Size(max = 16000) String backgroundStory, @Size(max = 16000) String characterArc,
            double graphPositionX, double graphPositionY, @Min(0) int sortOrder) {
    }

    /** 人物关系。 */
    public record CharacterRelation(
            @NotBlank @Size(max = 64) String id, @NotBlank @Size(max = 64) String sourceCharacterId,
            @NotBlank @Size(max = 64) String targetCharacterId, @NotBlank @Size(max = 120) String relationshipType,
            @NotBlank @Pattern(regexp = "directed|bidirectional") String relationshipDirection,
            @Size(max = 120) String storyStage,
            @Size(max = 8000) String conflictDescription, @Size(max = 8000) String description,
            @Min(0) int sortOrder) {
    }

    /** 世界观基础设定。 */
    public record WorldSetting(@Size(max = 160) String era, @Size(max = 240) String region,
                               @Size(max = 12000) String socialBackground, @Size(max = 8000) String overallTone) {
    }

    /** 世界观分类条目。 */
    public record WorldItem(@NotBlank @Size(max = 64) String id,
                            @NotBlank @Pattern(regexp = "rule|organization|faction|hierarchy|restriction|history") String itemType,
                            @NotBlank @Size(max = 160) String name, @Size(max = 12000) String description,
                            @Min(0) int sortOrder) {
    }

    /** 场景地点文字设定。 */
    public record Location(@NotBlank @Size(max = 64) String id, @NotBlank @Size(max = 160) String name,
                           @Size(max = 8000) String spacePurpose, @Size(max = 8000) String narrativeRole,
                           @Size(max = 120) String defaultTime, @Size(max = 120) String weather,
                           @Size(max = 8000) String atmosphere, @Size(max = 8000) String keyObjects,
                           @Size(max = 12000) String mainEvents, @Min(0) int sortOrder) {
    }

    /** 分集摘要。 */
    public record EpisodeSummary(@NotBlank @Size(max = 64) String id, @Min(1) int episodeNumber,
                                 @NotBlank @Size(max = 160) String title, @Size(max = 16000) String summary,
                                 @Size(max = 12000) String keyEvents, @Size(max = 12000) String mainConflict,
                                 @Size(max = 12000) String climax, @Size(max = 12000) String endingHook,
                                 @Min(0) @Max(86400) int targetDurationSeconds,
                                 @NotBlank @Pattern(regexp = "planning|draft|complete") String completionStatus,
                                 @Min(0) int sortOrder) {
    }

    /** 结构化剧本正文块。 */
    public record ScriptBlock(@NotBlank @Size(max = 64) String id,
                              @NotBlank @Pattern(regexp = "action|dialogue|narration|transition") String blockType,
                              @Size(max = 64) String characterId, @Size(max = 30000) String content,
                              @Min(0) int sortOrder) {
    }

    /** 剧本场次。 */
    public record Scene(@NotBlank @Size(max = 64) String id, @Size(max = 64) String locationId,
                        @Min(1) int sceneNumber, @Size(max = 160) String title,
                        @NotBlank @Pattern(regexp = "interior|exterior|mixed") String interiorExterior,
                        @Size(max = 120) String timeDescription,
                        @Size(max = 12000) String sceneGoal, @Size(max = 20000) String actionSummary,
                        @Size(max = 8000) String transitionDescription, @Size(max = 8000) String previousRelation,
                        @Size(max = 8000) String nextRelation, @Min(0) int sortOrder,
                        @NotNull @Size(max = 100) List<@NotBlank @Size(max = 64) String> characterIds,
                        @NotNull @Size(max = 1000) List<@Valid ScriptBlock> blocks) {
    }

    /** 单集完整内容。 */
    public record EpisodeDetail(@NotNull @Valid EpisodeSummary episode,
                                @NotNull @Size(max = 500) List<@Valid Scene> scenes) {
    }

    /** 项目基础详情，不包含分集正文。 */
    public record ProjectDetail(String id, ProjectOverview overview, List<OutlineSection> outlineSections,
                                List<StoryEvent> storyEvents, List<Character> characters,
                                List<CharacterRelation> characterRelations, WorldSetting worldSetting,
                                List<WorldItem> worldItems, List<Location> locations,
                                List<EpisodeSummary> episodes, String stage, int completionRate,
                                boolean productionStarted, long revision, OffsetDateTime createdAt,
                                OffsetDateTime updatedAt) {
    }

    /** 用于版本保存与恢复的完整项目快照。 */
    public record ProjectSnapshot(ProjectDetail project, List<EpisodeDetail> episodeDetails) {
    }

    /** AI大纲草稿结构。 */
    public record OutlineDraft(@NotNull List<@Valid OutlineSection> sections,
                               @NotNull List<@Valid StoryEvent> events) {
    }

    /** AI人物与人物关系草稿结构。 */
    public record CharacterDraft(@NotNull List<@Valid Character> characters,
                                 @NotNull List<@Valid CharacterRelation> relations) {
    }

    /** AI世界观与地点草稿结构。 */
    public record WorldDraft(@NotNull @Valid WorldSetting worldSetting,
                             @NotNull List<@Valid WorldItem> worldItems,
                             @NotNull List<@Valid Location> locations) {
    }

    /** AI分集规划草稿结构。 */
    public record EpisodePlanDraft(@NotNull List<@Valid EpisodeSummary> episodes) {
    }

    /** 单个候选故事方向。 */
    public record StoryDirection(@NotBlank @Size(max = 120) String name,
                                 @NotBlank @Size(max = 2000) String logline,
                                 @Size(max = 20000) String synopsis,
                                 @Size(max = 8000) String theme,
                                 @Size(max = 12000) String mainConflict,
                                 @Size(max = 12000) String endingDirection) {
    }

    /** 候选故事方向草稿及用户选择。 */
    public record StoryDirectionDraft(
            @NotNull
            @Size(min = 3, max = 3, message = "候选故事方向必须为3个")
            List<@NotNull @Valid StoryDirection> candidates,
            @Min(0) int selectedIndex) {
    }

    /** 新建项目请求。 */
    public record CreateProjectRequest(
            @NotBlank(message = "项目名称不能为空") @Size(max = 120, message = "项目名称不能超过120字") String title,
            @Size(max = 64, message = "模板标识长度不合法") String templateKey,
            @NotBlank(message = "内容形式不能为空")
            @Pattern(regexp = "comicDrama|liveActionShort|animation|advertisement|musicVideo|storyShort",
                    message = "内容形式不受支持") String contentType,
            @Size(max = 2000, message = "一句话创意不能超过2000字") String logline) {
    }

    /** 项目标识请求。 */
    public record ProjectIdRequest(@NotBlank @Size(max = 64) String projectId) {
    }

    /** 带项目修订号的修改请求。 */
    public record ProjectRevisionRequest(@NotBlank @Size(max = 64) String projectId, @Min(0) long expectedRevision) {
    }

    /** 分集标识请求。 */
    public record EpisodeIdRequest(@NotBlank @Size(max = 64) String projectId,
                                   @NotBlank @Size(max = 64) String episodeId) {
    }

    /** 单个待软删除项目及其期望修订号。 */
    public record ProjectDeletion(@NotBlank @Size(max = 64) String projectId, @Min(0) long expectedRevision) {
    }

    /** 批量删除项目请求。 */
    public record DeleteProjectsRequest(@NotEmpty @Size(max = 100) List<@NotNull @Valid ProjectDeletion> projects) {
    }

    /** 已软删除项目的最新修订信息。 */
    public record DeletedProjectResult(String projectId, long revision, OffsetDateTime updatedAt) {
    }

    /** 保存故事概览请求。 */
    public record SaveOverviewRequest(@NotBlank @Size(max = 64) String projectId, @Min(0) long expectedRevision,
                                      @NotNull @Valid ProjectOverview overview) {
    }

    /** 保存故事大纲请求。 */
    public record SaveOutlineRequest(@NotBlank @Size(max = 64) String projectId, @Min(0) long expectedRevision,
                                     @NotNull @Size(max = 100) List<@Valid OutlineSection> sections,
                                     @NotNull @Size(max = 1000) List<@Valid StoryEvent> events) {
    }

    /** 保存人物设定与关系请求。 */
    public record SaveCharactersRequest(@NotBlank @Size(max = 64) String projectId, @Min(0) long expectedRevision,
                                        @NotNull @Size(max = 300) List<@Valid Character> characters,
                                        @NotNull @Size(max = 2000) List<@Valid CharacterRelation> relations) {
    }

    /** 保存世界观与场景地点请求。 */
    public record SaveWorldRequest(@NotBlank @Size(max = 64) String projectId, @Min(0) long expectedRevision,
                                   @NotNull @Valid WorldSetting worldSetting,
                                   @NotNull @Size(max = 1000) List<@Valid WorldItem> worldItems,
                                   @NotNull @Size(max = 1000) List<@Valid Location> locations) {
    }

    /** 保存单集请求。 */
    public record SaveEpisodeRequest(@NotBlank @Size(max = 64) String projectId, @Min(0) long expectedRevision,
                                     @NotNull @Valid EpisodeDetail episodeDetail) {
    }

    /** 调整分集顺序请求。 */
    public record ReorderEpisodesRequest(@NotBlank @Size(max = 64) String projectId, @Min(0) long expectedRevision,
                                         @NotEmpty @Size(max = 1000) List<@NotBlank @Size(max = 64) String> episodeIds) {
    }

    /** 删除分集请求。 */
    public record DeleteEpisodeRequest(@NotBlank @Size(max = 64) String projectId, @Min(0) long expectedRevision,
                                       @NotBlank @Size(max = 64) String episodeId) {
    }

    /** 修改操作结果。 */
    public record MutationResult(long revision, String stage, int completionRate, OffsetDateTime updatedAt) {
    }

    /** 版本摘要。 */
    public record VersionSummary(String id, String versionName, String changeSource, String changeSummary,
                                 long sourceRevision, OffsetDateTime createdAt) {
    }

    /** 版本详情。 */
    public record VersionDetail(String id, String versionName, String changeSource, String changeSummary,
                                long sourceRevision, JSONObject snapshotData, OffsetDateTime createdAt) {
    }

    /** 创建命名版本请求。 */
    public record CreateVersionRequest(@NotBlank @Size(max = 64) String projectId, @Min(0) long expectedRevision,
                                       @NotBlank @Size(max = 120) String versionName,
                                       @Size(max = 2000) String changeSummary) {
    }

    /** 版本标识请求。 */
    public record VersionIdRequest(@NotBlank @Size(max = 64) String projectId,
                                   @NotBlank @Size(max = 64) String versionId) {
    }

    /** 恢复版本请求。 */
    public record RestoreVersionRequest(@NotBlank @Size(max = 64) String projectId, @Min(0) long expectedRevision,
                                        @NotBlank @Size(max = 64) String versionId) {
    }

    /** AI草稿。 */
    public record AiDraft(String id, String projectId, String actionType, String targetType, String targetId,
                          long baseRevision, String instruction, JSONObject sourceData, JSONObject draftData,
                          String model, int chargedCredits, String status, OffsetDateTime createdAt) {
    }

    /** 应用AI草稿请求。 */
    public record ApplyAiDraftRequest(@NotBlank @Size(max = 64) String projectId, @Min(0) long expectedRevision,
                                      @NotBlank @Size(max = 64) String draftId, @NotNull JSONObject draftData) {
    }

    /** 放弃AI草稿请求。 */
    public record DiscardAiDraftRequest(@NotBlank @Size(max = 64) String projectId,
                                        @Min(0) long expectedRevision,
                                        @NotBlank @Size(max = 64) String draftId) {
    }

    /** 生成结构化AI草稿请求。 */
    public record GenerateDraftRequest(
            @NotBlank @Size(max = 64) String projectId, @Min(0) long expectedRevision,
            @NotBlank @Size(max = 40) String actionType, @NotBlank @Size(max = 32) String targetType,
            @Size(max = 64) String targetId, @Size(max = 12000) String instruction,
            @NotBlank @Size(max = 256) String model) {
    }

    /** Agent返回的通用结构化草稿。 */
    public record GeneratedDraft(JSONObject draftData) {
    }

    /** Agent返回的强类型候选故事方向草稿。 */
    public record GeneratedStoryDirectionDraft(@NotNull @Valid StoryDirectionDraft draftData) {
    }

    /** Agent返回的强类型故事大纲草稿。 */
    public record GeneratedOutlineDraft(@NotNull @Valid OutlineDraft draftData) {
    }

    /** Agent返回的强类型项目概览草稿。 */
    public record GeneratedOverviewDraft(@NotNull @Valid ProjectOverview draftData) {
    }

    /** Agent返回的强类型人物草稿。 */
    public record GeneratedCharacterDraft(@NotNull @Valid CharacterDraft draftData) {
    }

    /** Agent返回的强类型世界观草稿。 */
    public record GeneratedWorldDraft(@NotNull @Valid WorldDraft draftData) {
    }

    /** Agent返回的强类型分集规划草稿。 */
    public record GeneratedEpisodePlanDraft(@NotNull @Valid EpisodePlanDraft draftData) {
    }

    /** Agent返回的强类型单集草稿。 */
    public record GeneratedEpisodeDetailDraft(@NotNull @Valid EpisodeDetail draftData) {
    }

    /** Agent返回的强类型场次草稿。 */
    public record GeneratedSceneDraft(@NotNull @Valid Scene draftData) {
    }

    /** Agent返回的强类型正文块草稿。 */
    public record GeneratedScriptBlockDraft(@NotNull @Valid ScriptBlock draftData) {
    }

    /** 生成剧本分析请求。 */
    public record AnalyzeScriptRequest(
            @NotBlank @Size(max = 64) String projectId, @Min(0) long expectedRevision,
            @NotBlank @Size(max = 20) String scopeType, @Size(max = 64) String scopeId,
            @Size(max = 12000) String instruction, @NotBlank @Size(max = 256) String model) {
    }

    /** Agent返回的分析问题。 */
    public record GeneratedAnalysisIssue(
            @NotBlank @Size(max = 32) String category,
            @NotBlank @Pattern(regexp = "info|warning|important") String severity,
            @Size(max = 64) String episodeId,
            @Size(max = 64) String sceneId,
            @Size(max = 64) String blockId,
            @NotBlank @Size(max = 200) String title,
            @NotBlank @Size(max = 12000) String reason,
            @NotBlank @Size(max = 12000) String suggestion) {
    }

    /** Agent返回的结构化分析报告。 */
    public record GeneratedAnalysis(@NotBlank @Size(max = 30000) String summary,
                                    @NotNull @Size(max = 1000) List<@Valid GeneratedAnalysisIssue> issues) {
    }

    /** 分析问题。 */
    public record AnalysisIssue(String id, String category, String severity, String episodeId, String sceneId,
                                String blockId, String title, String reason, String suggestion, int sortOrder) {
    }

    /** 分析报告。 */
    public record AnalysisReport(String id, String projectId, String scopeType, String scopeId, String summary,
                                 String model, int chargedCredits, long sourceRevision,
                                 OffsetDateTime createdAt, List<AnalysisIssue> issues) {
    }

    /** 准备度检查项。 */
    public record ReadinessItem(String key, String status, String title, String description, String targetSection) {
    }

    /** 漫剧生产准备度。 */
    public record ProductionReadiness(String projectId, boolean ready, List<ReadinessItem> items) {
    }
}
