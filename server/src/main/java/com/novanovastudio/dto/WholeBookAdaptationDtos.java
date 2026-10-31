package com.novanovastudio.dto;

import com.alibaba.fastjson2.annotation.JSONField;
import com.novanovastudio.common.CreditAmountWriter;
import java.math.BigDecimal;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.List;

/**
 * 全书改编的策略确认、固定分集与事件取舍契约。
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-01 16:00
 */
public final class WholeBookAdaptationDtos {
    /** 禁止实例化契约容器。 */
    private WholeBookAdaptationDtos() { }

    /** 初始设置不含集数，集数只能在审阅全书策略后确认。 */
    public record Options(@NotBlank @Pattern(regexp="comicDrama|liveActionShort|animation|advertisement|musicVideo|storyShort") String format,
                          @Min(30) @Max(86400) int episodeDurationSeconds,
                          @NotBlank @Pattern(regexp="slow|balanced|fast") String pacing,
                          @NotBlank @Pattern(regexp="faithful|balanced|bold") String adaptationLevel) { }
    /** 启动时确认费用与输入指纹，避免报价后事实或模型价格变化。 */
    public record StartRequest(@NotBlank String projectId, @Min(0) long expectedRevision,
                               @NotBlank @Size(max=64) String clientRequestId, @NotBlank String model,
                               @NotNull @Valid Options options, @Min(0) @jakarta.validation.constraints.Digits(integer = 18, fraction = 6) @JSONField(serializeUsing = CreditAmountWriter.class) BigDecimal expectedCredits,
                               @NotBlank String expectedFingerprint) { }
    /** 免费报价请求。 */
    public record QuoteRequest(@NotBlank String projectId, @Min(0) long expectedRevision,
                               @NotBlank String model, @NotNull @Valid Options options) { }
    /** 查询与取消任务的公共请求。 */
    public record JobRequest(@NotBlank String projectId, @NotBlank String jobId) { }
    /** 只按项目查询的公共请求。 */
    public record ProjectRequest(@NotBlank String projectId) { }
    /** 查询下一阶段或续跑报价，集数仅在策略确认时提供。 */
    public record NextQuoteRequest(@NotBlank String projectId, @NotBlank String jobId,
                                   @Min(0) @Max(1000) int episodeCount) { }
    /** 策略停点确认：提交任务修订、续跑次数与用户最终确认的集数。 */
    public record AdvanceRequest(@NotBlank String projectId, @NotBlank String jobId,
                                 @Min(0) long expectedRevision, @Min(0) int expectedRetryCount,
                                 @Min(0) @Max(1000) int episodeCount) { }
    /** 生成单元及其价格的不可变报价。 */
    public record Quote(long revision, String phase, int calls, @jakarta.validation.constraints.Digits(integer = 18, fraction = 6) @JSONField(serializeUsing = CreditAmountWriter.class) BigDecimal credits, String fingerprint) { }
    /** 一个输入批次的归纳，只允许简明摘要，不复制全部事件正文。 */
    public record Material(String summary) { }
    /** 全局故事阶段，通过根汇总单元保留完整来源范围。 */
    public record Arc(String title, String summary, List<String> sourceKeys, int recommendedEpisodes) { }
    /** 全书统一策略。 */
    public record Strategy(String mainPlot, String ending, String reasoning, String compression,
                           List<Arc> arcs) { }
    /** 服务端分配的固定分集身份。 */
    public record Slot(String id, int episodeNumber, int sortOrder, int arcIndex) { }
    /** 事件取舍，每个事件只有一个主处理记录；回顾另行列出。 */
    public record Disposition(String factId, String treatment, String episodeId, String reason) { }
    /** 一个素材批次到固定分集的事件分配。 */
    public record Assignment(List<Disposition> events) { }
    /** 一集规划与显式回顾事件。 */
    public record EpisodePlan(ScriptDtos.EpisodeSummary episode, List<String> recapFactIds) { }
    /** 设置生成采用事实标识，由服务端映射到正式标识。 */
    public record CharacterResult(List<ScriptDtos.Character> characters) { }
    /** 地点生成只包含事实地点，全局基调单独生成。 */
    public record LocationResult(List<ScriptDtos.Location> locations) { }
    /** 人物齐备后生成跨批关系。 */
    public record RelationResult(List<ScriptDtos.CharacterRelation> relations) { }
    /** 替换前后的可审阅汇总。 */
    public record Review(ScriptDtos.ProjectOverview overview, ScriptDtos.OutlineDraft outline,
                          List<ScriptDtos.EpisodeSummary> episodes, List<Disposition> dispositions,
                          List<ScriptDtos.EpisodeDetail> bodies, int oldEpisodeCount, int oldSceneCount) { }
    /** 返回当前阶段预算和策略，历史工作流不会自动升级。 */
    public record View(String jobId, String phase, String stage, String status, int totalUnits,
                       int processedUnits, @jakarta.validation.constraints.Digits(integer = 18, fraction = 6) @JSONField(serializeUsing = CreditAmountWriter.class) BigDecimal credits, @jakarta.validation.constraints.Digits(integer = 18, fraction = 6) @JSONField(serializeUsing = CreditAmountWriter.class) BigDecimal refundedCredits, String errorMessage,
                       long revision, int retryCount, Options options, Strategy strategy,
                       int lockedEpisodeCount, List<Slot> slots, boolean historical) { }
}
