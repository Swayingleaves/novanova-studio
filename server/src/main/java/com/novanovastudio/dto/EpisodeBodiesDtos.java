package com.novanovastudio.dto;

import jakarta.validation.constraints.*;
import java.util.List;

/**
 * 逐集正文批量生成的报价、启动与进度契约。
 * <p>
 * 与全书改编共用改编任务与生成单元：素材、策略与统一规划由全书改编负责，
 * 这里只承接“把已固定的分集写成场次与正文”这一段，因此集数与分集身份不在这里设定。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-10-09 10:00
 */
public final class EpisodeBodiesDtos {
    /** 禁止实例化契约容器。 */
    private EpisodeBodiesDtos() { }

    /** 生成模式：只出草稿先审阅，或生成后立即写入正式剧本。 */
    private static final String MODE_PATTERN = "draft|apply";

    /** 逐集正文批量的通用请求。 */
    public record BatchRequest(@NotBlank String projectId, @NotBlank String model,
                               @NotBlank @Pattern(regexp=MODE_PATTERN) String mode,
                               @NotNull @Size(max=1000) List<@NotBlank String> episodeIds) { }

    /** 报价请求，与启动请求同一份输入，保证报价与执行范围一致。 */
    public record QuoteRequest(@NotBlank String projectId, @Min(0) long expectedRevision, @NotBlank String model,
                               @NotBlank @Pattern(regexp=MODE_PATTERN) String mode,
                               @NotNull @Size(max=1000) List<@NotBlank String> episodeIds) { }

    /** 启动请求，提交已确认的报价金额与输入指纹。 */
    public record StartRequest(@NotBlank String projectId, @Min(0) long expectedRevision,
                               @NotBlank @Size(max=64) String clientRequestId, @NotBlank String model,
                               @NotBlank @Pattern(regexp=MODE_PATTERN) String mode,
                               @NotNull @Size(max=1000) List<@NotBlank String> episodeIds,
                               @Min(0) int expectedCredits, @NotBlank String expectedFingerprint) { }

    /** 任务查询与取消请求。 */
    public record JobRequest(@NotBlank String projectId, @NotBlank String jobId) { }

    /** 只按项目查询的请求。 */
    public record ProjectRequest(@NotBlank String projectId) { }

    /** 报价：本次要生成的分集、调用次数与预扣积分。 */
    public record Quote(long revision, int episodes, int calls, int credits, String fingerprint, List<String> episodeIds) { }

    /** 任务进度：分集级进度、当前阶段与结算情况。 */
    public record Job(String jobId, String phase, String status, String mode, int totalEpisodes, int processedEpisodes,
                      int credits, int refundedCredits, String errorMessage, long revision, int retryCount,
                      List<String> failedEpisodeIds) { }

    /** 管理员维护的分集正文定价：文本模型及其每集积分。 */
    public record ModelPricing(String modelConfigId, String model, String displayName, int credits, long revision) { }

    /** 保存分集正文定价请求。 */
    public record SavePricingRequest(@NotBlank String modelConfigId, @Min(0) int credits,
                                     @Min(0) long expectedRevision) { }

    /** 查询所选模型单价的请求。 */
    public record UnitPriceRequest(@NotBlank String model) { }

    /** 所选模型的每集积分，未配置时为空，供界面在报价前显示单价。 */
    public record UnitPrice(Integer unitPrice) { }
}
