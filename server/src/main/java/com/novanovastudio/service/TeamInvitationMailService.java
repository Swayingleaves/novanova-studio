package com.novanovastudio.service;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.common.SystemMessage;
import com.novanovastudio.config.NovanovaProperties;
import jakarta.mail.MessagingException;
import jakarta.mail.internet.MimeMessage;
import java.net.URI;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.mail.MailProperties;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.util.UriComponentsBuilder;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

/**
 * 团队邀请邮件，与邀请事务同生共死：发不出去就让本次邀请回滚。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-23 10:00
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class TeamInvitationMailService {
    /** 邮件品牌名称，与密码重置邮件保持一致。 */
    private static final String MAIL_BRAND_NAME = "Novanova Studio";
    /** 邮件品牌图标地址，与密码重置邮件保持一致。 */
    private static final String MAIL_BRAND_LOGO_URL = "https://www.novanovastudio.cn/logo/novanovastudio-108x108.png";
    /** 邀请有效期天数，与 team_invitations.expires_at 的 7 天保持一致。 */
    public static final int INVITATION_VALID_DAYS = 7;

    /** 邮件发送器。 */
    private final JavaMailSender mailSender;
    /** 项目业务配置。 */
    private final NovanovaProperties properties;
    /** Spring 邮件连接配置。 */
    private final MailProperties mailProperties;

    /**
     * 建邀请前做纯内存校验，配置缺失时立即失败，不占用事务与团队行锁。
     */
    public void requireConfigured() {
        if (!StringUtils.hasText(mailProperties.getHost()) || !StringUtils.hasText(properties.getEmail().getFrom())) {
            throw new BusinessException(ErrorCode.SYSTEM_ERROR, SystemMessage.of("business.mailServiceNotConfiguredForTeamInvitation"));
        }
        frontendBaseUri();
    }

    /**
     * 发送团队邀请邮件，阻塞式 SMTP 放入 boundedElastic，异常原样抛回事务链。
     *
     * @param email 收件邮箱
     * @param teamName 团队名称
     * @param inviterName 邀请人昵称
     * @param invitationId 邀请标识，同时是邮件链接凭据
     * @return 发送完成信号
     */
    public Mono<Void> send(String email, String teamName, String inviterName, UUID invitationId) {
        String invitationUrl = invitationUrl(invitationId);
        return Mono.fromRunnable(() -> {
            try {
                MimeMessage message = mailSender.createMimeMessage();
                MimeMessageHelper helper = new MimeMessageHelper(message, false, "UTF-8");
                helper.setFrom(properties.getEmail().getFrom());
                helper.setTo(email);
                helper.setSubject(MAIL_BRAND_NAME + " 团队邀请");
                helper.setText(buildInvitationEmailHtml(teamName, inviterName, invitationUrl), true);
                mailSender.send(message);
                log.info("团队邀请邮件已发送：邮箱={}, invitationId={}", email, invitationId);
            } catch (MessagingException | RuntimeException exception) {
                log.error("发送团队邀请邮件失败，邮箱={}, invitationId={}, 异常类型={}", email, invitationId, exception.getClass().getName());
                throw new BusinessException(ErrorCode.SYSTEM_ERROR, SystemMessage.of("business.failedToSendTeamInvitationEmail"));
            }
        }).subscribeOn(Schedulers.boundedElastic()).then();
    }

    /**
     * 构建邀请落地链接。
     *
     * @param invitationId 邀请标识
     * @return String 前端团队邀请链接
     */
    private String invitationUrl(UUID invitationId) {
        URI frontendUri = frontendBaseUri();
        return UriComponentsBuilder.newInstance()
                .scheme(frontendUri.getScheme())
                .host(frontendUri.getHost())
                .port(frontendUri.getPort())
                .path("/teams")
                .queryParam("invitation", invitationId)
                .build()
                .encode()
                .toUriString();
    }

    /**
     * 校验前端公开地址配置。
     *
     * @return URI 合法的前端公开地址
     */
    private URI frontendBaseUri() {
        String frontendBaseUrl = properties.getApp().getFrontendBaseUrl();
        if (!StringUtils.hasText(frontendBaseUrl)) {
            throw new BusinessException(ErrorCode.SYSTEM_ERROR, SystemMessage.of("business.fRONTENDBASEURLIsMissingCannotSendTeamInvitationEmail"));
        }
        try {
            URI frontendUri = URI.create(frontendBaseUrl.trim());
            String scheme = frontendUri.getScheme();
            String path = frontendUri.getPath();
            if ((!("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)))
                    || !StringUtils.hasText(frontendUri.getHost())
                    || StringUtils.hasText(frontendUri.getRawUserInfo())
                    || StringUtils.hasText(frontendUri.getRawQuery())
                    || StringUtils.hasText(frontendUri.getRawFragment())
                    || (StringUtils.hasText(path) && !"/".equals(path))) {
                throw new BusinessException(ErrorCode.SYSTEM_ERROR, SystemMessage.of("business.fRONTENDBASEURLMustBeAPublicHTTPSOrigin"));
            }
            return frontendUri;
        } catch (IllegalArgumentException exception) {
            throw new BusinessException(ErrorCode.SYSTEM_ERROR, SystemMessage.of("business.invalidFRONTENDBASEURL"));
        }
    }

    /**
     * 构建团队邀请邮件HTML内容。
     *
     * @param teamName String 团队名称
     * @param inviterName String 邀请人昵称
     * @param invitationUrl String 邀请链接
     * @return String HTML邮件正文
     */
    private String buildInvitationEmailHtml(String teamName, String inviterName, String invitationUrl) {
        return """
                <!DOCTYPE html>
                <html lang="zh-CN">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>%s 团队邀请</title>
                </head>
                <body style="margin:0;padding:0;background-color:#f5f7fb;font-family:'PingFang SC','Microsoft YaHei',Arial,sans-serif;color:#2f3a4a;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%%" style="background-color:#f5f7fb;margin:0;padding:0;width:100%%;">
                        <tr>
                            <td align="center" style="padding:40px 16px;">
                                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%%" style="max-width:640px;background-color:#f3f5f8;border-radius:12px;overflow:hidden;">
                                    <tr>
                                        <td align="center" style="padding:32px 24px 0;">
                                            <img src="%s" alt="%s" width="56" height="56" style="display:block;width:56px;height:56px;border:0;outline:none;">
                                        </td>
                                    </tr>
                                    <tr>
                                        <td align="center" style="padding:16px 24px 20px;font-size:18px;font-weight:700;color:#223046;">
                                            %s 团队邀请
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="padding:0 22px 28px;">
                                            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%%" style="background-color:#ffffff;border-radius:12px;">
                                                <tr>
                                                    <td style="padding:34px 22px 18px;font-size:15px;line-height:1.9;color:#314056;">
                                                        <div style="margin-bottom:8px;">您好！</div>
                                                        <div>%s 邀请你加入团队「%s」。</div>
                                                    </td>
                                                </tr>
                                                <tr>
                                                    <td align="center" style="padding:6px 22px 28px;">
                                                        <a href="%s" style="display:inline-block;padding:12px 22px;border-radius:8px;background-color:#526F1E;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;">查看并接受邀请</a>
                                                    </td>
                                                </tr>
                                                <tr>
                                                    <td style="padding:0 22px 34px;font-size:14px;line-height:1.9;color:#314056;">
                                                        <div>此邀请在 %d 天内有效，接受后即可进入该团队空间。</div>
                                                        <div>如果这不是你预期的邀请，请忽略此邮件。</div>
                                                    </td>
                                                </tr>
                                            </table>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td align="center" style="padding:0 24px 40px;font-size:12px;line-height:1.8;color:#8a94a6;">
                                            <div>此邮件由系统自动发送，请勿回复</div>
                                        </td>
                                    </tr>
                                </table>
                            </td>
                        </tr>
                    </table>
                </body>
                </html>
                """.formatted(MAIL_BRAND_NAME, MAIL_BRAND_LOGO_URL, MAIL_BRAND_NAME, MAIL_BRAND_NAME, inviterName, teamName, invitationUrl, INVITATION_VALID_DAYS);
    }
}
