package com.novanovastudio.config;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Max;
import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;
import org.springframework.validation.annotation.Validated;

/**
 * 邮件群发的全局限流配置，多实例共用数据库中的发送额度。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-24 16:00
 */
@Data
@Validated
@Component
@ConfigurationProperties("novanova.email-campaign")
public class EmailCampaignProperties {
    /** 两封群发邮件之间的最小间隔，单位为秒。 */
    @Min(1)
    @Max(3600)
    private int minimumIntervalSeconds = 3;
    /** 任意连续一分钟内最多尝试发送的邮件数。 */
    @Min(1)
    private int maximumPerMinute = 20;
    /** 任意连续一小时内最多尝试发送的邮件数。 */
    @Min(1)
    private int maximumPerHour = 200;
    /** 同时排队或发送的任务数量上限。 */
    @Min(1)
    private int maximumActiveCampaigns = 20;
}
