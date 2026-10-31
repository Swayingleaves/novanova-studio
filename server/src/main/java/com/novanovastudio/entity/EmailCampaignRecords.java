package com.novanovastudio.entity;

/**
 * 群发调度需要的邮件与图片快照。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-24 16:00
 */
public final class EmailCampaignRecords {
    /** 禁止实例化记录容器。 */
    private EmailCampaignRecords() { }

    /**
     * @param contentId 邮件内嵌图片内容标识
     * @param mimeType 图片媒体类型
     * @param data 图片内容快照
     */
    public record Image(String contentId, String mimeType, byte[] data) { }

    /**
     * @param deliveryId 发送记录主键
     * @param campaignId 群发任务主键
     * @param email 收件邮箱快照
     * @param subject 邮件主题
     * @param bodyHtml 安全正文快照
     * @param fromEmail 发件人快照
     * @param intervalSeconds 完成后的最小间隔
     */
    public record Dispatch(long deliveryId, long campaignId, String email, String subject, String bodyHtml,
            String fromEmail, int intervalSeconds) { }

    /**
     * @param bodyHtml 正文快照
     * @param fromEmail 发件人快照
     */
    public record Content(String bodyHtml, String fromEmail) { }
}
