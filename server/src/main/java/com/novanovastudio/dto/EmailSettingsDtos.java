package com.novanovastudio.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * 平台邮件服务配置的请求和响应。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-10 10:10
 */
public final class EmailSettingsDtos {

    private EmailSettingsDtos() {
    }

    /**
     * 管理后台可见的邮件服务配置。授权码只返回是否已设置。
     *
     * @param smtpHost SMTP 服务地址
     * @param smtpPort SMTP 端口
     * @param smtpUsername SMTP 登录用户名
     * @param passwordConfigured 是否已保存登录密码或授权码
     * @param fromEmail 发件人邮箱
     * @param allowedSuffixes 允许注册的邮箱后缀
     */
    public record EmailServiceSettings(String smtpHost, int smtpPort, String smtpUsername, boolean passwordConfigured,
                                        String fromEmail, String allowedSuffixes) {
    }

    /**
     * 保存邮件服务配置。登录密码或授权码留空时保留已保存的值。
     *
     * @param smtpHost SMTP 服务地址
     * @param smtpPort SMTP 端口
     * @param smtpUsername SMTP 登录用户名
     * @param smtpPassword SMTP 登录密码或授权码，留空表示不修改
     * @param fromEmail 发件人邮箱
     * @param allowedSuffixes 允许注册的邮箱后缀
     */
    public record UpdateEmailServiceSettings(
            @Size(max = 255, message = "business.emailSmtpHostInvalid")
            String smtpHost,
            @NotNull(message = "business.emailSmtpPortOutOfRange")
            @Min(value = 1, message = "business.emailSmtpPortOutOfRange")
            @Max(value = 65535, message = "business.emailSmtpPortOutOfRange")
            Integer smtpPort,
            @Size(max = 320, message = "business.emailSmtpUsernameInvalid")
            String smtpUsername,
            @Size(max = 512, message = "business.emailSmtpPasswordTooLong")
            String smtpPassword,
            @Size(max = 320, message = "business.emailFromInvalid")
            String fromEmail,
            @Size(max = 4000, message = "business.emailAllowedSuffixesTooLong")
            String allowedSuffixes) {
    }
}
