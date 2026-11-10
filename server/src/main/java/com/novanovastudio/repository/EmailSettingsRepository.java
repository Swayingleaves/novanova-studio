package com.novanovastudio.repository;

import java.time.OffsetDateTime;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Mono;

/**
 * 平台邮件服务配置数据访问。密码列保存的是密文。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-10 10:10
 */
@Repository
public class EmailSettingsRepository {

    /** 查询和回写共用的列。 */
    private static final String COLUMNS = """
            smtp_host, smtp_port, smtp_username, smtp_password, from_email, allowed_suffixes, updated_at
            """;

    /** 数据库客户端。 */
    private final DatabaseClient databaseClient;

    /**
     * 构造邮件服务配置仓储。
     *
     * @param databaseClient DatabaseClient 数据库客户端
     */
    public EmailSettingsRepository(DatabaseClient databaseClient) {
        this.databaseClient = databaseClient;
    }

    /**
     * 读取唯一的邮件服务配置。
     *
     * @return Mono<EmailSettingsRow> 配置和更新时间
     */
    public Mono<EmailSettingsRow> find() {
        return databaseClient.sql("SELECT " + COLUMNS + " FROM platform_email_settings WHERE id = 1")
                .map((row, metadata) -> mapRow(row))
                .one();
    }

    /**
     * 更新唯一的邮件服务配置并返回落库结果。
     *
     * @param settings StoredEmailSettings 待保存的配置，密码必须已经加密
     * @return Mono<EmailSettingsRow> 落库后的配置
     */
    public Mono<EmailSettingsRow> update(StoredEmailSettings settings) {
        return databaseClient.sql("""
                        UPDATE platform_email_settings
                        SET smtp_host = :smtpHost,
                            smtp_port = :smtpPort,
                            smtp_username = :smtpUsername,
                            smtp_password = :smtpPassword,
                            from_email = :fromEmail,
                            allowed_suffixes = :allowedSuffixes,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE id = 1
                        RETURNING
                        """ + COLUMNS)
                .bind("smtpHost", settings.smtpHost())
                .bind("smtpPort", settings.smtpPort())
                .bind("smtpUsername", settings.smtpUsername())
                .bind("smtpPassword", settings.smtpPassword())
                .bind("fromEmail", settings.fromEmail())
                .bind("allowedSuffixes", settings.allowedSuffixes())
                .map((row, metadata) -> mapRow(row))
                .one();
    }

    /**
     * 把查询行映射为邮件服务配置。
     *
     * @param row io.r2dbc.spi.Row 数据行
     * @return EmailSettingsRow 配置和更新时间
     */
    private static EmailSettingsRow mapRow(io.r2dbc.spi.Row row) {
        return new EmailSettingsRow(new StoredEmailSettings(
                row.get("smtp_host", String.class),
                row.get("smtp_port", Integer.class),
                row.get("smtp_username", String.class),
                row.get("smtp_password", String.class),
                row.get("from_email", String.class),
                row.get("allowed_suffixes", String.class)),
                row.get("updated_at", OffsetDateTime.class));
    }

    /**
     * 数据库中的邮件服务配置。smtpPassword 是密文或空字符串。
     *
     * @param smtpHost SMTP 服务地址
     * @param smtpPort SMTP 端口
     * @param smtpUsername SMTP 登录用户名
     * @param smtpPassword 加密后的登录密码或授权码
     * @param fromEmail 发件人邮箱
     * @param allowedSuffixes 允许注册的邮箱后缀
     */
    public record StoredEmailSettings(String smtpHost, int smtpPort, String smtpUsername, String smtpPassword,
                                       String fromEmail, String allowedSuffixes) {
    }

    /**
     * 邮件服务配置和它的更新时间。
     *
     * @param settings StoredEmailSettings 邮件服务配置
     * @param updatedAt OffsetDateTime 更新时间
     */
    public record EmailSettingsRow(StoredEmailSettings settings, OffsetDateTime updatedAt) {
    }
}
