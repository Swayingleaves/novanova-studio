package com.novanovastudio.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * 小说改编分阶段生成、事实溯源与影响检查的数据结构。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-09-28 18:00
 */
public final class NovelAdaptationDtos {
    /**
     * 禁止实例化数据结构容器。
     */
    private NovelAdaptationDtos() { }

    /** 用户确认的改编设置。 */
    public record Settings(
            @NotBlank @Size(max = 32) String format,
            @Min(1) @Max(1000) int episodeCount,
            @Min(30) @Max(86400) int episodeDurationSeconds,
            @NotBlank @Pattern(regexp = "slow|balanced|fast") String pacing,
            @NotBlank @Pattern(regexp = "faithful|balanced|bold") String adaptationLevel) { }

    /** 生成概览、人物与关系、世界观与地点、大纲、分集或单集的请求。 */
    public record GenerateRequest(
            @NotBlank @Size(max = 64) String projectId,
            @Min(0) long expectedRevision,
            @NotBlank @Pattern(regexp = "overview|characters|world|outline|episodes|episode") String stage,
            @Size(max = 64) String episodeId,
            @NotNull @Valid Settings settings,
            @NotEmpty @Size(max = 30) List<@NotBlank @Size(max = 64) String> factIds,
            @NotBlank @Size(max = 256) String model) { }

    /** 改编输入使用的原文片段：只保留模型需要的位置与引文，避免标识字段挤占上下文。 */
    public record FactEvidence(int startOffset, int endOffset, String quote) { }

    /** 事实与证据的生成时快照。 */
    public record Fact(String id, long revision, String itemType, String name, String summary,
                       String storyTime, List<FactEvidence> evidences) { }

    /** 待审或已应用草稿的来源。 */
    public record DraftSource(String draftId, String stage, Settings settings, List<Fact> facts, String status) { }

    /** 正式产物对上游事实的引用及变化状态。 */
    public record SourceImpact(String targetType, String targetId, String factId, String factName,
                               long factRevision, Long currentRevision, boolean needsReview) { }

    /** 用户确认把知识库人物或地点关联到现有或新视觉资产。 */
    public record LinkAssetRequest(@NotBlank @Size(max = 64) String projectId,
                                   @NotBlank @Size(max = 64) String factId,
                                   @Size(max = 64) String assetId,
                                   @Min(0) long expectedProductionRevision) { }

    /** 已建立的事实与视觉资产关联。 */
    public record AssetLink(String assetId, String factId, long factRevision, String factName,
                            String assetName, boolean needsReview) { }

    /** 免费规则检查发现的待人工审阅问题。 */
    public record ConsistencyIssue(String category, String severity, String title, String description,
                                   String factId, String targetType, String targetId) { }

    /** 付费深入检查请求，必须由用户确认模型积分费用后提交。 */
    public record AnalyzeRequest(@NotBlank @Size(max = 64) String projectId,
                                 @Min(0) long expectedRevision,
                                 @NotEmpty @Size(max = 30) List<@NotBlank @Size(max = 64) String> factIds,
                                 @NotBlank @Size(max = 256) String model) { }

    /** 查询项目来源的请求。 */
    public record ProjectRequest(@NotBlank @Size(max = 64) String projectId) { }

    /** 一键改编启动请求，事实范围固定为全部已确认事实。 */
    public record StartJobRequest(@NotBlank @Size(max = 64) String projectId,
                                  @Min(0) long expectedRevision,
                                  @NotBlank @Size(max = 64) String clientRequestId,
                                  @NotNull @Valid Settings settings,
                                  @NotBlank @Size(max = 256) String model) { }

    /** 一键改编报价，调用次数按阶段分流后估算。 */
    public record JobQuote(int factCount, int skeletonCalls, int episodeCalls, int estimatedCalls, int credits) { }

    /** 一键改编任务请求。 */
    public record JobRequest(@NotBlank @Size(max = 64) String projectId,
                             @NotBlank @Size(max = 64) String jobId) { }

    /** 失败续跑报价，费用仅涵盖尚未生成成功的内容。 */
    public record RetryQuote(long revision, String phase, int completedCalls, int remainingCalls, int credits, int retryCount) { }

    /** 用户确认失败续跑报价，修订、费用和续跑次数必须与服务端重新计算结果一致。 */
    public record RetryJobRequest(@NotBlank @Size(max = 64) String projectId,
                                  @NotBlank @Size(max = 64) String jobId, @Min(0) long expectedRevision,
                                  @Min(0) int expectedRemainingCalls, @Min(0) int expectedCredits,
                                  @Min(0) int expectedRetryCount) { }

    /** 任务产出的草稿摘要。 */
    public record JobDraft(String draftId, String stage, String status) { }

    /** 一键改编任务状态与进度。 */
    public record JobView(String jobId, String phase, String stage, String status, int totalUnits, int processedUnits,
                          int estimatedCalls, int settledCalls, int credits, int refundedCredits, String errorMessage,
                          String createdAt, List<JobDraft> drafts) { }
}
