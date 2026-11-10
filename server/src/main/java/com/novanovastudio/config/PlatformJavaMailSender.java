package com.novanovastudio.config;

import com.novanovastudio.config.NovanovaProperties.RuntimeEmailSettings;
import jakarta.mail.internet.MimeMessage;
import java.io.InputStream;
import java.util.Properties;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.JavaMailSenderImpl;
import org.springframework.mail.javamail.MimeMessagePreparator;
import org.springframework.stereotype.Component;

/**
 * 按当前邮件服务配置创建 SMTP 连接。管理后台保存后，下一次发送即使用新配置。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-10 10:10
 */
@Component
public class PlatformJavaMailSender implements JavaMailSender {

    /** 建立 SMTP 连接的超时时间，避免邀请发信长期占用团队行锁。 */
    private static final String CONNECTION_TIMEOUT_MILLISECONDS = "5000";

    /** 等待服务器响应的超时时间。 */
    private static final String READ_TIMEOUT_MILLISECONDS = "10000";

    /** 写入数据到服务器的超时时间。 */
    private static final String WRITE_TIMEOUT_MILLISECONDS = "10000";

    /** 运行时邮件配置。 */
    private final NovanovaProperties properties;

    /**
     * 构造随配置变化的邮件发送器。
     *
     * @param properties NovanovaProperties 运行时配置
     */
    public PlatformJavaMailSender(NovanovaProperties properties) {
        this.properties = properties;
    }

    /**
     * 使用当前快照组装一次发送器。连接固定启用 SSL，端口通常为 465。
     *
     * @return JavaMailSenderImpl 本次发送使用的邮件发送器
     */
    private JavaMailSenderImpl sender() {
        RuntimeEmailSettings settings = properties.emailSettings();
        JavaMailSenderImpl mailSender = new JavaMailSenderImpl();
        mailSender.setHost(settings.smtpHost());
        mailSender.setPort(settings.smtpPort());
        mailSender.setUsername(settings.smtpUsername());
        mailSender.setPassword(settings.smtpPassword());
        mailSender.setDefaultEncoding("UTF-8");
        Properties mail = mailSender.getJavaMailProperties();
        mail.put("mail.transport.protocol", "smtp");
        mail.put("mail.smtp.auth", "true");
        mail.put("mail.smtp.ssl.enable", "true");
        mail.put("mail.smtp.starttls.enable", "false");
        mail.put("mail.smtp.connectiontimeout", CONNECTION_TIMEOUT_MILLISECONDS);
        mail.put("mail.smtp.timeout", READ_TIMEOUT_MILLISECONDS);
        mail.put("mail.smtp.writetimeout", WRITE_TIMEOUT_MILLISECONDS);
        return mailSender;
    }

    /**
     * 创建一封空邮件。
     *
     * @return MimeMessage 空邮件
     */
    @Override
    public MimeMessage createMimeMessage() {
        return sender().createMimeMessage();
    }

    /**
     * 从输入流创建邮件。
     *
     * @param contentStream InputStream 邮件内容
     * @return MimeMessage 解析后的邮件
     */
    @Override
    public MimeMessage createMimeMessage(InputStream contentStream) {
        return sender().createMimeMessage(contentStream);
    }

    /**
     * 发送一封简单邮件。
     *
     * @param simpleMessage SimpleMailMessage 简单邮件
     */
    @Override
    public void send(SimpleMailMessage simpleMessage) {
        sender().send(simpleMessage);
    }

    /**
     * 发送多封简单邮件。
     *
     * @param simpleMessages SimpleMailMessage 简单邮件
     */
    @Override
    public void send(SimpleMailMessage... simpleMessages) {
        sender().send(simpleMessages);
    }

    /**
     * 发送一封 MIME 邮件。
     *
     * @param mimeMessage MimeMessage MIME 邮件
     */
    @Override
    public void send(MimeMessage mimeMessage) {
        sender().send(mimeMessage);
    }

    /**
     * 发送多封 MIME 邮件。
     *
     * @param mimeMessages MimeMessage MIME 邮件
     */
    @Override
    public void send(MimeMessage... mimeMessages) {
        sender().send(mimeMessages);
    }

    /**
     * 组装并发送一封 MIME 邮件。
     *
     * @param mimeMessagePreparator MimeMessagePreparator 邮件组装器
     */
    @Override
    public void send(MimeMessagePreparator mimeMessagePreparator) {
        sender().send(mimeMessagePreparator);
    }

    /**
     * 组装并发送多封 MIME 邮件。
     *
     * @param mimeMessagePreparators MimeMessagePreparator 邮件组装器
     */
    @Override
    public void send(MimeMessagePreparator... mimeMessagePreparators) {
        sender().send(mimeMessagePreparators);
    }
}
