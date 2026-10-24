package com.novanovastudio.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

/**
 * 邮件群发请求与查询结果。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-24 16:00
 */
public final class EmailCampaignDtos {
    /** 禁止实例化纯数据结构容器。 */
    private EmailCampaignDtos() { }

    /** @param bodyHtml 待预览的正文，允许空正文以显示空白邮件 */
    public record PreviewRequest(@NotNull @Size(max = 200000, message = "邮件正文过长，请缩短后重试") String bodyHtml) { }

    /** @param documentHtml 与实际发送共用排版的完整邮件文档 */
    public record Preview(String documentHtml) { }

    /**
     * @param requestId 防重复提交标识
     * @param subject 邮件主题，禁止换行
     * @param bodyHtml 图文正文，图片须带已上传的媒体存储键
     * @param recipientMode all全部有邮箱用户，selected指定用户
     * @param userIds 指定收件用户主键，全部用户模式必须为空
     * @param intervalSeconds 逐封发送间隔秒数
     */
    public record CreateRequest(@NotNull(message = "请求标识不能为空") UUID requestId,
            @NotBlank(message = "邮件主题不能为空") @Size(max = 200, message = "邮件主题不能超过200个字符") @Pattern(regexp = "[^\\r\\n]+", message = "邮件主题不能包含换行") String subject,
            @NotBlank(message = "邮件正文不能为空") @Size(max = 200000, message = "邮件正文过长，请缩短后重试") String bodyHtml,
            @NotNull(message = "请选择收件范围") @Pattern(regexp = "all|selected", message = "收件范围不合法") String recipientMode,
            @NotNull(message = "收件用户列表不能为空") @Size(max = 10000, message = "单次指定用户最多10000人") List<@NotNull(message = "用户标识不能为空") @Positive(message = "用户标识必须大于零") Long> userIds,
            @Min(value = 1, message = "发送间隔不能小于1秒") @Max(value = 3600, message = "发送间隔不能超过3600秒") int intervalSeconds) { }

    /** @param campaignId 群发任务主键 */
    public record CampaignRequest(@NotNull @Positive Long campaignId) { }

    /**
     * @param configured 邮件连接与发件人配置是否齐全
     * @param fromEmail 发件人
     * @param minimumIntervalSeconds 最小发送间隔秒数
     * @param maximumPerMinute 连续一分钟发送上限
     * @param maximumPerHour 连续一小时发送上限
     * @param maximumActiveCampaigns 同时排队任务上限
     */
    public record Settings(boolean configured, String fromEmail, int minimumIntervalSeconds,
            int maximumPerMinute, int maximumPerHour, int maximumActiveCampaigns) { }

    /**
     * @param users 有邮箱的用户列表
     * @param total 匹配的用户数量
     */
    public record UserPage(List<RecipientUser> users, long total) { }

    /**
     * @param id 用户主键
     * @param nickname 用户昵称
     * @param email 邮箱
     */
    public record RecipientUser(long id, String nickname, String email) { }

    /**
     * @param campaigns 当前页任务
     * @param total 任务总数
     */
    public record CampaignPage(List<Campaign> campaigns, long total) { }

    /**
     * @param id 任务主键
     * @param subject 邮件主题
     * @param recipientMode 收件范围
     * @param intervalSeconds 发送间隔秒数
     * @param status 任务状态
     * @param recipientCount 收件人数
     * @param queuedCount 待发送数
     * @param sendingCount 发送中数量
     * @param sentCount 邮件服务器已接受数量
     * @param failedCount 发送失败数
     * @param unknownCount 结果不确定数
     * @param cancelledCount 已取消数
     * @param createdByName 创建管理员昵称
     * @param createdAt 创建时间
     * @param finishedAt 完成或取消时间
     */
    public record Campaign(long id, String subject, String recipientMode, int intervalSeconds, String status,
            int recipientCount, long queuedCount, long sendingCount, long sentCount, long failedCount,
            long unknownCount, long cancelledCount, String createdByName, OffsetDateTime createdAt, OffsetDateTime finishedAt) { }

    /**
     * @param campaign 任务汇总
     * @param bodyHtml 可预览的安全正文，图片转为内嵌数据地址
     * @param fromEmail 发件人快照
     * @param documentHtml 与实际发送相同的完整邮件文档，图片使用预览数据地址
     */
    public record Detail(Campaign campaign, String bodyHtml, String fromEmail, String documentHtml) { }

    /**
     * @param deliveries 本页发送记录
     * @param total 匹配的记录数量
     */
    public record DeliveryPage(List<Delivery> deliveries, long total) { }

    /**
     * @param id 记录主键
     * @param userId 收件用户主键
     * @param nickname 收件人昵称快照
     * @param email 收件邮箱快照
     * @param status 发送状态
     * @param errorMessage 失败或结果不确定原因
     * @param startedAt 开始发送时间
     * @param finishedAt 完成时间
     */
    public record Delivery(long id, long userId, String nickname, String email, String status,
            String errorMessage, OffsetDateTime startedAt, OffsetDateTime finishedAt) { }
}
