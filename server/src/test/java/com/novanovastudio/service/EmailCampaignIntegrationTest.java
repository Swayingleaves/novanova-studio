package com.novanovastudio.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.config.EmailCampaignProperties;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.config.TeamDatabaseConfiguration;
import com.novanovastudio.dto.EmailCampaignDtos;
import com.novanovastudio.dto.PersistenceDtos;
import com.novanovastudio.repository.EmailCampaignRepository;
import com.novanovastudio.security.CurrentUser;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.security.TeamScope;
import com.novanovastudio.task.EmailCampaignDispatcher;
import io.r2dbc.spi.ConnectionFactories;
import jakarta.mail.Session;
import jakarta.mail.internet.MimeMessage;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.DriverManager;
import java.time.Duration;
import java.util.List;
import java.util.Properties;
import java.util.UUID;
import javax.imageio.ImageIO;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.jsoup.Jsoup;
import org.springframework.boot.autoconfigure.mail.MailProperties;
import org.springframework.mail.MailAuthenticationException;
import org.springframework.mail.MailSendException;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.r2dbc.connection.R2dbcTransactionManager;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.transaction.reactive.TransactionalOperator;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

/**
 * 使用隔离数据库与模拟邮件发送器验证群发事务、跨实例限流和中断恢复，不向真实用户发信。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-24 16:00
 */
@Testcontainers
class EmailCampaignIntegrationTest {
    /** 测试专用数据库，不使用项目运行数据库。 */
    @Container
    private static final PostgreSQLContainer<?> database = new PostgreSQLContainer<>("postgres:17")
            .withDatabaseName("novanova_pro_email_test").withUsername("postgres").withPassword("postgres");
    /** 实际群发仓储。 */
    private EmailCampaignRepository repository;
    /** 实际事务操作器。 */
    private TransactionalOperator transactions;
    /** 实际群发业务服务。 */
    private EmailCampaignService service;
    /** 实际派发器。 */
    private EmailCampaignDispatcher dispatcher;
    /** 测试独立全局限制。 */
    private EmailCampaignProperties limits;
    /** 外部媒体下载由模拟对象隔离。 */
    private PersistenceService media;
    /** 外部邮件发送由模拟对象隔离。 */
    private JavaMailSender sender;

    /** 在独立容器中运行全部生产迁移，覆盖新增迁移与运行权限。 */
    @BeforeAll
    static void migrate() {
        Flyway.configure().dataSource(database.getJdbcUrl(), database.getUsername(), database.getPassword()).load().migrate();
    }

    /**
     * 每个场景从固定用户与空发送队列开始。
     * @throws Exception 测试数据库初始化失败时抛出
     */
    @BeforeEach
    void initialize() throws Exception {
        execute("TRUNCATE email_campaigns CASCADE; UPDATE email_dispatch_control SET next_send_at = CURRENT_TIMESTAMP - INTERVAL '1 hour' WHERE id = 1;"
                + "INSERT INTO users(id, username, email, nickname, role, status, invitation_code) VALUES "
                + "(80001,'mail-admin','admin@example.com','管理员','admin',1,'MAILADMIN'),"
                + "(80002,'mail-user','user@example.com','普通用户','user',1,'MAILUSER'),"
                + "(80003,'mail-disabled','disabled@example.com','禁用用户','user',0,'MAILDISABLED'),"
                + "(80004,'mail-no-email',NULL,'无邮箱用户','user',1,'MAILNOEMAIL') ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;");
        var original = ConnectionFactories.get("r2dbc:postgresql://postgres:postgres@" + database.getHost() + ":" + database.getMappedPort(5432) + "/" + database.getDatabaseName());
        var factory = new TeamDatabaseConfiguration.ScopedConnectionFactory(original);
        repository = new EmailCampaignRepository(DatabaseClient.create(factory));
        transactions = TransactionalOperator.create(new R2dbcTransactionManager(factory));
        var properties = new NovanovaProperties();
        properties.getEmail().setFrom("sender@example.com");
        var mail = new MailProperties();
        mail.setHost("mock-smtp");
        limits = new EmailCampaignProperties();
        media = mock(PersistenceService.class);
        sender = mock(JavaMailSender.class);
        when(sender.createMimeMessage()).thenAnswer(ignored -> new MimeMessage(Session.getInstance(new Properties())));
        service = new EmailCampaignService(repository, new CurrentUserProvider(), media, limits, properties, mail, transactions);
        dispatcher = new EmailCampaignDispatcher(repository, limits, sender, transactions);
    }

    /** 验证全部有邮箱用户包含禁用用户且排除无邮箱用户，提交后名单保持不变。 */
    @Test
    void snapshotsAllEmailUsersAndKeepsTheOriginalAddresses() throws Exception {
        var campaign = run(service.createCampaign(request("all", List.of(), "<p>系统更新通知</p>")));
        assertEquals(3, campaign.recipientCount());
        assertEquals(3, run(service.listUsers(1, 20, "")).total());
        var deliveries = run(service.listDeliveries(campaign.id(), 1, 20, null));
        assertEquals(3, deliveries.total());
        assertTrue(deliveries.deliveries().stream().anyMatch(delivery -> "disabled@example.com".equals(delivery.email())));
        assertEquals(0, deliveries.deliveries().stream().filter(delivery -> delivery.userId() == 80004).count());
        execute("UPDATE users SET email = 'changed@example.com' WHERE id = 80002");
        assertTrue(run(service.listDeliveries(campaign.id(), 1, 20, null)).deliveries().stream()
                .anyMatch(delivery -> delivery.userId() == 80002 && "user@example.com".equals(delivery.email())));
    }

    /** 并发重试同一请求时只产生一个任务与一份收件快照。 */
    @Test
    void concurrentDuplicateRequestsCreateOnlyOneCampaign() {
        var request = request("selected", List.of(80002L, 80003L), "<p>重复提交验证</p>");
        var results = run(Mono.zip(service.createCampaign(request), service.createCampaign(request)));
        assertEquals(results.getT1().id(), results.getT2().id());
        assertEquals(1, run(repository.countCampaigns()));
        assertEquals(2, run(repository.countDeliveries(results.getT1().id(), "")));
    }

    /** 指定名单中有无邮箱或已删除用户时整次事务回滚。 */
    @Test
    void invalidSelectedUserRollsBackTheWholeTask() {
        StepVerifier.create(scoped(service.createCampaign(request("selected", List.of(80002L, 80004L), "<p>必须完整发送</p>")), 0, "admin"))
                .expectError(BusinessException.class).verify();
        assertEquals(0, run(repository.countCampaigns()));
    }

    /** 任务数量限制只拦截新任务，重复请求仍能返回原任务。 */
    @Test
    void limitsActiveCampaignsWithoutBreakingIdempotency() {
        limits.setMaximumActiveCampaigns(1);
        var request = request("selected", List.of(80002L), "<p>第一个任务</p>");
        var first = run(service.createCampaign(request));
        assertEquals(first.id(), run(service.createCampaign(request)).id());
        StepVerifier.create(scoped(service.createCampaign(request("selected", List.of(80003L), "<p>第二个任务</p>")), 0, "admin"))
                .expectError(BusinessException.class).verify();
        assertEquals(1, run(repository.countCampaigns()));
    }

    /** 多实例同时派发也只能发送一封，完成后间隔未满不能继续派发。 */
    @Test
    void concurrentDispatchAndMinimumIntervalShareOneGlobalSlot() {
        var campaign = run(service.createCampaign(request("all", List.of(), "<p>跨实例发送</p>")));
        var secondDispatcher = new EmailCampaignDispatcher(repository, limits, sender, transactions);
        run(Mono.when(dispatcher.dispatch(), secondDispatcher.dispatch()));
        run(dispatcher.dispatch());
        verify(sender, times(1)).send(any(MimeMessage.class));
        assertEquals(1, run(repository.countDeliveries(campaign.id(), "sent")));
        assertEquals(2, run(repository.countDeliveries(campaign.id(), "queued")));
    }

    /** 分钟额度耗尽后，即使间隔已满且切换任务，也不能绕过全局限流。 */
    @Test
    void rollingMinuteLimitIsSharedAcrossCampaigns() throws Exception {
        limits.setMaximumPerMinute(1);
        run(service.createCampaign(request("selected", List.of(80002L), "<p>任务一</p>")));
        run(service.createCampaign(request("selected", List.of(80003L), "<p>任务二</p>")));
        run(dispatcher.dispatch());
        allowNextInterval();
        run(dispatcher.dispatch());
        verify(sender, times(1)).send(any(MimeMessage.class));
    }

    /** 一小时限额覆盖一分钟以外的发送尝试，失败同样消耗额度。 */
    @Test
    void rollingHourLimitCountsFailedAttempts() throws Exception {
        limits.setMaximumPerHour(1);
        run(service.createCampaign(request("all", List.of(), "<p>小时限制</p>")));
        doThrow(new MailAuthenticationException("模拟认证失败")).when(sender).send(any(MimeMessage.class));
        run(dispatcher.dispatch());
        execute("UPDATE email_deliveries SET started_at = CURRENT_TIMESTAMP - INTERVAL '2 minutes' WHERE id = (SELECT MIN(id) FROM email_deliveries);");
        allowNextInterval();
        run(dispatcher.dispatch());
        verify(sender, times(1)).send(any(MimeMessage.class));
    }

    /** 服务中断的在途邮件标记为不确定，剩余队列继续，原邮件不重发。 */
    @Test
    void interruptedSendBecomesUnknownWithoutResending() throws Exception {
        var campaign = run(service.createCampaign(request("selected", List.of(80002L, 80003L), "<p>恢复队列</p>")));
        var claimed = run(repository.lockControl(false).then(repository.claimNext(20, 200, 3)).as(transactions::transactional));
        run(dispatcher.dispatch());
        verify(sender, never()).send(any(MimeMessage.class));
        execute("UPDATE email_deliveries SET started_at = CURRENT_TIMESTAMP - INTERVAL '6 minutes' WHERE id = " + claimed.deliveryId());
        allowNextInterval();
        run(dispatcher.dispatch());
        verify(sender, times(1)).send(any(MimeMessage.class));
        assertEquals(1, run(repository.countDeliveries(campaign.id(), "unknown")));
        assertEquals(1, run(repository.countDeliveries(campaign.id(), "sent")));
        assertEquals("completed", run(repository.getCampaign(campaign.id())).status());
    }

    /** 连接中断不能假设邮件未发送成功，也不能自动重试。 */
    @Test
    void ambiguousMailFailureIsRecordedAndNotRetried() throws Exception {
        var campaign = run(service.createCampaign(request("selected", List.of(80002L), "<p>网络中断</p>")));
        doThrow(new MailSendException("模拟连接中断")).when(sender).send(any(MimeMessage.class));
        run(dispatcher.dispatch());
        allowNextInterval();
        run(dispatcher.dispatch());
        verify(sender, times(1)).send(any(MimeMessage.class));
        assertEquals(1, run(repository.countDeliveries(campaign.id(), "unknown")));
    }

    /** 邮件已被接受而结果落库失败时，保留在途状态，恢复时不会重复发信。 */
    @Test
    void successfulSendWithFailedPersistenceIsNeverResent() throws Exception {
        var campaign = run(service.createCampaign(request("selected", List.of(80002L), "<p>结果保存失败</p>")));
        var failingRepository = spy(repository);
        doReturn(Mono.error(new IllegalStateException("模拟数据库写入中断"))).when(failingRepository).finishDelivery(anyLong(), anyString(), nullable(String.class));
        var failingDispatcher = new EmailCampaignDispatcher(failingRepository, limits, sender, transactions);
        run(failingDispatcher.dispatch());
        assertEquals(1, run(repository.countDeliveries(campaign.id(), "sending")));
        run(dispatcher.dispatch());
        verify(sender, times(1)).send(any(MimeMessage.class));
        execute("UPDATE email_deliveries SET started_at = CURRENT_TIMESTAMP - INTERVAL '6 minutes' WHERE id = (SELECT MIN(id) FROM email_deliveries)");
        run(dispatcher.dispatch());
        assertEquals(1, run(repository.countDeliveries(campaign.id(), "unknown")));
        verify(sender, times(1)).send(any(MimeMessage.class));
    }

    /** 取消任务只取消排队收件人，不覆盖已经领取的邮件。 */
    @Test
    void cancellationPreservesTheInFlightDelivery() {
        var campaign = run(service.createCampaign(request("all", List.of(), "<p>取消剩余</p>")));
        run(repository.lockControl(false).then(repository.claimNext(20, 200, 3)).as(transactions::transactional));
        run(service.cancelCampaign(campaign.id()));
        assertEquals(1, run(repository.countDeliveries(campaign.id(), "sending")));
        assertEquals(2, run(repository.countDeliveries(campaign.id(), "cancelled")));
        assertEquals("cancelled", run(repository.getCampaign(campaign.id())).status());
    }

    /** 图片与正文保留独立快照，逐用户邮件不会泄露其他收件人地址。 */
    @Test
    void sanitizesHtmlAndEmbedsOwnedImageSnapshot() throws Exception {
        var output = new ByteArrayOutputStream();
        ImageIO.write(new BufferedImage(1, 1, BufferedImage.TYPE_INT_RGB), "png", output);
        when(media.downloadMedia("image:test")).thenReturn(Mono.just(new PersistenceDtos.DownloadedMedia(output.toByteArray(), "image/png", "test.png")));
        var campaign = run(service.createCampaign(request("selected", List.of(80002L),
                "<p onclick='evil()'>中文图文通知</p><script>evil()</script><img src='https://expired.example/test' data-storage-key='image:test' onerror='evil()'>")));
        var content = run(repository.getContent(campaign.id()));
        assertTrue(content.bodyHtml().contains("cid:email-image-1"));
        assertFalse(content.bodyHtml().contains("script"));
        assertFalse(content.bodyHtml().contains("onerror"));
        assertFalse(content.bodyHtml().contains("onclick"));
        when(media.downloadMedia(anyString())).thenReturn(Mono.error(new IllegalStateException("模拟原文件不可用")));
        run(dispatcher.dispatch());
        var captured = ArgumentCaptor.forClass(MimeMessage.class);
        verify(sender).send(captured.capture());
        var message = captured.getValue();
        assertEquals(1, message.getAllRecipients().length);
        assertEquals("user@example.com", message.getAllRecipients()[0].toString());
        assertEquals("测试中文邮件", message.getSubject());
        message.saveChanges();
        output.reset();
        message.writeTo(output);
        assertTrue(output.toString(java.nio.charset.StandardCharsets.UTF_8).contains("Content-ID: <email-image-1>"));
        assertTrue(run(service.getDetail(campaign.id())).bodyHtml().contains("data:image/png;base64,"));
        verify(media, times(1)).downloadMedia("image:test");
    }

    /**
     * 表格结构、合并单元格与内容排版经过清理、保存、预览和发送后保持完整，危险属性被移除。
     * @throws Exception 模拟邮件内容读取失败时抛出
     */
    @Test
    void preservesSafeTablesThroughSnapshotPreviewAndSending() throws Exception {
        var campaign = run(service.createCampaign(request("selected", List.of(80002L), """
                <table onclick="evil()" style="position:fixed;background:url(https://external.example/track)">
                  <thead><tr><th colspan="2" onmouseover="evil()">更新内容</th></tr></thead>
                  <tbody>
                    <tr><td rowspan="2"><p><strong>功能</strong></p></td><td>表格编辑</td></tr>
                    <tr><td><ul><li>新增行列</li></ul></td></tr>
                  </tbody>
                </table><script>evil()</script>
                """)));
        var content = run(repository.getContent(campaign.id()));
        var document = Jsoup.parseBodyFragment(content.bodyHtml());
        assertEquals(1, document.select("table").size());
        assertEquals(3, document.select("tr").size());
        assertEquals("2", document.select("th").attr("colspan"));
        assertEquals("2", document.select("td").first().attr("rowspan"));
        assertEquals("功能", document.select("td strong").text());
        assertEquals("新增行列", document.select("td li").text());
        assertTrue(document.select("table").attr("style").contains("border-collapse:collapse"));
        assertTrue(document.select("th,td").stream().allMatch(cell -> cell.attr("style").contains("border:1px solid")));
        assertTrue(document.select("[onclick],[onmouseover],script").isEmpty());
        assertFalse(content.bodyHtml().contains("position:fixed"));
        assertFalse(content.bodyHtml().contains("external.example"));
        assertEquals(content.bodyHtml(), run(service.getDetail(campaign.id())).bodyHtml());

        // 使用模拟邮件发送器检查最终正文，避免向真实收件人发送测试邮件。
        run(dispatcher.dispatch());
        var captured = ArgumentCaptor.forClass(MimeMessage.class);
        verify(sender).send(captured.capture());
        assertTrue(captured.getValue().getContent().toString().contains(content.bodyHtml()));
        assertEquals(1, run(repository.countDeliveries(campaign.id(), "sent")));
    }

    /**
     * Markdown 解析后的标题、代码、引用及分隔线在安全清理和最终发送后保留。
     * @throws Exception 模拟邮件内容读取失败时抛出
     */
    @Test
    void preservesMarkdownFormattingThroughSanitizationAndSending() throws Exception {
        var campaign = run(service.createCampaign(request("selected", List.of(80002L), """
                <h1>一级标题</h1><h2>二级标题</h2><h3>三级标题</h3><h4>四级标题</h4><h5>五级标题</h5><h6>六级标题</h6>
                <p><strong>加粗</strong><em>斜体</em><s>删除线</s><code>行内代码</code><a href="https://example.com">链接</a></p>
                <blockquote><p>引用说明</p></blockquote><hr>
                <ul><li>第一项</li></ul><ol><li>第一步</li></ol>
                <pre onclick="evil()"><code>&lt;div&gt;
                  内容
                &lt;/div&gt;</code></pre><script>evil()</script>
                """)));
        var content = run(repository.getContent(campaign.id()));
        var document = Jsoup.parseBodyFragment(content.bodyHtml());
        assertEquals(6, document.select("h1,h2,h3,h4,h5,h6").size());
        assertEquals(1, document.select("blockquote").size());
        assertEquals(1, document.select("hr").size());
        assertEquals(2, document.select("code").size());
        assertEquals("<div>\n  内容\n</div>", document.selectFirst("pre code").wholeText());
        assertTrue(document.select("pre").attr("style").contains("white-space:pre-wrap"));
        assertEquals("删除线", document.select("s").text());
        assertEquals("https://example.com", document.select("a").attr("href"));
        assertTrue(document.select("[onclick],script").isEmpty());
        assertEquals(content.bodyHtml(), run(service.getDetail(campaign.id())).bodyHtml());
        run(dispatcher.dispatch());
        var captured = ArgumentCaptor.forClass(MimeMessage.class);
        verify(sender).send(captured.capture());
        assertTrue(captured.getValue().getContent().toString().contains(content.bodyHtml()));
    }

    /**
     * 四列价格表在服务端预览、数据库快照和实际邮件编码后保持相同结构，不依赖网页 CSS。
     * @throws Exception 邮件编码或验证文件写入失败时抛出
     */
    @Test
    void previewAndEncodedEmailKeepTheSameFourColumnPricingTable() throws Exception {
        String bodyHtml = """
                <p>亲爱的 NovanovaStudio 用户：</p><h3>Seedance 全系模型专属特价</h3>
                <table style="display:block"><tbody>
                  <tr><th>模型版本</th><th>分辨率</th><th>专属价（元/秒）</th><th>折扣力度</th></tr>
                  <tr><td rowspan="2"><p><strong>Seedance-2.0</strong></p></td><td><p>480P</p></td><td><p><strong>0.4</strong></p></td><td><p>≈ 8.7 折</p></td></tr>
                  <tr><td>720P</td><td>0.9</td><td>≈ 9.1 折</td></tr>
                  <tr><td>Seedance-2.0-mini</td><td>480P</td><td>0.1</td><td>≈ 4.3 折</td></tr>
                  <tr><td>Seedance-2.5</td><td>1080P</td><td>3.2</td><td>≈ 8.6 折</td></tr>
                </tbody></table><p>祝您创作愉快！</p>
                """;
        var preview = run(service.previewContent(new EmailCampaignDtos.PreviewRequest(bodyHtml)));
        assertEquals(0, run(repository.countCampaigns()));
        var campaign = run(service.createCampaign(request("selected", List.of(80002L), bodyHtml)));
        assertEquals(preview.documentHtml(), run(service.getDetail(campaign.id())).documentHtml());
        run(dispatcher.dispatch());
        var captured = ArgumentCaptor.forClass(MimeMessage.class);
        verify(sender).send(captured.capture());
        var output = new ByteArrayOutputStream();
        captured.getValue().saveChanges();
        captured.getValue().writeTo(output);
        var received = new MimeMessage(Session.getInstance(new Properties()), new ByteArrayInputStream(output.toByteArray()));
        assertTrue(received.isMimeType("text/html"));
        String receivedHtml = received.getContent().toString();
        // 邮件传输将换行标准化为回车换行，正文结构与样式必须逐字保持一致。
        assertEquals(preview.documentHtml().replace("\r\n", "\n"), receivedHtml.replace("\r\n", "\n"));
        var document = Jsoup.parse(receivedHtml);
        assertEquals(1, document.select("table").size());
        assertEquals(5, document.select("tr").size());
        assertEquals(4, document.select("th").size());
        assertEquals(15, document.select("td").size());
        assertEquals("2", document.selectFirst("td").attr("rowspan"));
        assertEquals("100%", document.select("table").attr("width"));
        assertEquals("1", document.select("table").attr("border"));
        assertEquals("0", document.select("table").attr("cellspacing"));
        assertTrue(document.select("style").isEmpty());
        assertTrue(document.select("th,td").stream().allMatch(cell -> cell.attr("style").contains("display:table-cell")
                && cell.attr("style").contains("border:1px solid") && "top".equals(cell.attr("valign"))));
        assertEquals("margin:0;line-height:1.75", document.selectFirst("td p").attr("style"));
        // 保存经过真实邮件编码往返验证的产物，可离线查看最终邮件格式。
        Files.write(Path.of("target", "email-table-verification.eml"), output.toByteArray());
        Files.writeString(Path.of("target", "email-table-verification.html"), receivedHtml, StandardCharsets.UTF_8);
    }

    /** 预览使用相同安全清理，危险标签和样式不会绕过过滤进入邮件，也不创建任务。 */
    @Test
    void previewSanitizesContentWithoutCreatingOrSendingCampaigns() {
        var preview = run(service.previewContent(new EmailCampaignDtos.PreviewRequest(
                "<table onclick='evil()' style='display:block'><tr><td>正文<script>evil()</script></td></tr></table>")));
        var document = Jsoup.parse(preview.documentHtml());
        assertTrue(document.select("script,[onclick]").isEmpty());
        assertTrue(document.select("table").attr("style").contains("display:table"));
        assertEquals(0, run(repository.countCampaigns()));
        verify(sender, never()).send(any(MimeMessage.class));
        StepVerifier.create(scoped(service.previewContent(new EmailCampaignDtos.PreviewRequest("<p>正文</p>")), 0, "user"))
                .expectError(BusinessException.class).verify();
    }

    /** 团队管理员、团队空间中的平台管理员与普通用户都不能使用全站群发。 */
    @Test
    void rejectsNonPlatformAdministratorAccess() {
        StepVerifier.create(scoped(service.getSettings(), 0, "user")).expectError(BusinessException.class).verify();
        StepVerifier.create(scoped(service.getSettings(), 9, "user")).expectError(BusinessException.class).verify();
        StepVerifier.create(scoped(service.getSettings(), 9, "admin")).expectError(BusinessException.class).verify();
        run(service.createCampaign(request("all", List.of(), "<p>平台任务</p>")));
        assertEquals(0, scoped(repository.countCampaigns(), 9, "admin").block(Duration.ofSeconds(20)));
    }

    /** 裸图片链接与空正文必须明确拒绝，不静默丢弃内容。 */
    @Test
    void rejectsEmptyContentAndUnownedImages() {
        assertThrows(BusinessException.class, () -> service.prepareContent("<script>evil()</script><p> </p>"));
        assertThrows(BusinessException.class, () -> service.prepareContent("<table><tr><td><p></p></td></tr></table>"));
        assertThrows(BusinessException.class, () -> service.prepareContent("<p>正文</p><img src='https://external.example/image.png'>"));
    }

    /** 主题换行可能形成邮件头注入，必须在接口参数校验阶段拒绝。 */
    @Test
    void rejectsSubjectHeaderInjectionAndInvalidRecipientMode() {
        try (var validators = jakarta.validation.Validation.buildDefaultValidatorFactory()) {
            var validator = validators.getValidator();
            assertFalse(validator.validate(new EmailCampaignDtos.CreateRequest(UUID.randomUUID(), "通知\r\nBcc: other@example.com", "<p>正文</p>", "selected", List.of(80002L), 3)).isEmpty());
            assertFalse(validator.validate(new EmailCampaignDtos.CreateRequest(UUID.randomUUID(), "通知", "<p>正文</p>", "invalid", List.of(80002L), 3)).isEmpty());
        }
    }

    /** 不支持的矢量图片不能伪装成上传图片进入邮件快照。 */
    @Test
    void rejectsInvalidImageDataWithoutCreatingTask() {
        when(media.downloadMedia("image:invalid")).thenReturn(Mono.just(new PersistenceDtos.DownloadedMedia(
                "<svg onload='evil()'></svg>".getBytes(java.nio.charset.StandardCharsets.UTF_8), "image/png", "invalid.png")));
        StepVerifier.create(scoped(service.createCampaign(request("selected", List.of(80002L),
                "<p>非法图片</p><img src='https://example.com/image.png' data-storage-key='image:invalid'>")), 0, "admin"))
                .expectError(BusinessException.class).verify();
        assertEquals(0, run(repository.countCampaigns()));
    }

    /**
     * @param mode 收件范围
     * @param userIds 指定用户
     * @param html 图文正文
     * @return 独立请求
     */
    private EmailCampaignDtos.CreateRequest request(String mode, List<Long> userIds, String html) {
        return new EmailCampaignDtos.CreateRequest(UUID.randomUUID(), "测试中文邮件", html, mode, userIds, 3);
    }

    /**
     * @param source 待执行操作
     * @param teamId 当前空间
     * @param role 当前用户角色
     * @param <T> 结果类型
     * @return 带身份与作用域的响应式操作
     */
    private <T> Mono<T> scoped(Mono<T> source, long teamId, String role) {
        return source.contextWrite(context -> new TeamScope(teamId, "administrator").apply(context)
                .put(CurrentUserProvider.CURRENT_USER_CONTEXT_KEY, new CurrentUser(80001L, "admin@example.com", role, 1)));
    }

    /**
     * @param source 平台管理员操作
     * @param <T> 结果类型
     * @return 操作结果，超时视为失败
     */
    private <T> T run(Mono<T> source) { return scoped(source, 0, "admin").block(Duration.ofSeconds(20)); }

    /**
     * 仅推进测试数据库中的发送间隔，不等待真实时间。
     * @throws Exception 数据库操作失败时抛出
     */
    private void allowNextInterval() throws Exception {
        execute("UPDATE email_dispatch_control SET next_send_at = CURRENT_TIMESTAMP - INTERVAL '1 minute' WHERE id = 1");
    }

    /**
     * @param sql 只作用于测试容器的固定SQL
     * @throws Exception 执行失败时抛出
     */
    private void execute(String sql) throws Exception {
        try (var connection = DriverManager.getConnection(database.getJdbcUrl(), database.getUsername(), database.getPassword());
                var statement = connection.createStatement()) { statement.execute(sql); }
    }
}
