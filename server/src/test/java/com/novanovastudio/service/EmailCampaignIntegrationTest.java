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
        execute("TRUNCATE email_campaigns CASCADE; DELETE FROM users WHERE id IN (80005,80006) OR id BETWEEN 81000 AND 91024; UPDATE email_dispatch_control SET next_send_at = CURRENT_TIMESTAMP - INTERVAL '1 hour' WHERE id = 1;"
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
        assertEquals(3, run(service.listUsers(1, 20, "", List.of())).total());
        var deliveries = run(service.listDeliveries(campaign.id(), 1, 20, null));
        assertEquals(3, deliveries.total());
        assertTrue(deliveries.deliveries().stream().anyMatch(delivery -> "disabled@example.com".equals(delivery.email())));
        assertEquals(0, deliveries.deliveries().stream().filter(delivery -> delivery.userId() == 80004).count());
        execute("UPDATE users SET email = 'changed@example.com' WHERE id = 80002");
        assertTrue(run(service.listDeliveries(campaign.id(), 1, 20, null)).deliveries().stream()
                .anyMatch(delivery -> delivery.userId() == 80002 && "user@example.com".equals(delivery.email())));
    }

    /**
     * 收件人搜索按完整域名筛选，列表与人数保持一致，不误匹配子域名及相似后缀。
     * @throws Exception 测试用户初始化失败时抛出
     */
    @Test
    void filtersRecipientSearchByExactEmailDomains() throws Exception {
        execute("UPDATE users SET email = CASE id WHEN 80001 THEN ' ADMIN@QQ.COM ' WHEN 80002 THEN 'user@gmail.com' WHEN 80003 THEN 'disabled@qq.com' END WHERE id IN (80001,80002,80003);"
                + "INSERT INTO users(id,username,email,nickname,role,status,invitation_code) VALUES "
                + "(80005,'mail-similar','similar@qq.com.evil','相似后缀','user',1,'MAILSIMILAR'),"
                + "(80006,'mail-subdomain','sub@sub.qq.com','子域名','user',1,'MAILSUBDOMAIN');");
        var domains = run(service.listEmailDomains());
        assertEquals(2, domains.stream().filter(item -> item.domain().equals("qq.com")).findFirst().orElseThrow().userCount());
        assertEquals(1, domains.stream().filter(item -> item.domain().equals("gmail.com")).findFirst().orElseThrow().userCount());
        var singleDomain = run(service.listUsers(1, 20, "", List.of(" @QQ.COM ")));
        assertEquals(2, singleDomain.total());
        assertEquals(List.of(80001L,80003L), singleDomain.users().stream().map(EmailCampaignDtos.RecipientUser::id).toList());
        var firstPage = run(service.listUsers(1, 1, "", List.of("qq.com", "gmail.com")));
        var secondPage = run(service.listUsers(2, 1, "", List.of("qq.com", "gmail.com")));
        assertEquals(3, firstPage.total());
        assertNotEquals(firstPage.users().getFirst().id(), secondPage.users().getFirst().id());
        assertEquals(1, run(service.listUsers(1, 20, "禁用", List.of("qq.com"))).total());
        assertEquals(3, run(service.listUsers(1, 20, "", List.of("@QQ.COM", "gmail.com", "qq.com"))).total());
    }

    /**
     * 搜索后缀只影响候选列表，跨筛选勾选的用户完整发送，全部用户模式仍包含所有有邮箱用户。
     * @throws Exception 测试邮箱调整失败时抛出
     */
    @Test
    void sendsSelectedRecipientsAcrossSearchFiltersAndKeepsAllUsersModeUnfiltered() throws Exception {
        execute("UPDATE users SET email = 'user@gmail.com' WHERE id = 80002; UPDATE users SET email = 'disabled@qq.com' WHERE id = 80003");
        var gmailUsers = run(service.listUsers(1, 20, "", List.of("gmail.com"))).users();
        var qqUsers = run(service.listUsers(1, 20, "", List.of("qq.com"))).users();
        var selectedUserIds = java.util.stream.Stream.concat(gmailUsers.stream(), qqUsers.stream())
                .map(EmailCampaignDtos.RecipientUser::id).toList();
        assertEquals(List.of(80002L, 80003L), selectedUserIds);
        var campaign = run(service.createCampaign(request("selected", selectedUserIds, "<p>跨后缀选择</p>")));
        assertEquals(2, campaign.recipientCount());
        assertEquals(List.of("user@gmail.com", "disabled@qq.com"), run(service.listDeliveries(campaign.id(), 1, 20, null))
                .deliveries().stream().map(EmailCampaignDtos.Delivery::email).toList());
        assertEquals(3, run(service.createCampaign(request("all", List.of(), "<p>全部用户</p>"))).recipientCount());
        execute("UPDATE users SET email = 'changed@other.com' WHERE id = 80003");
        assertEquals("disabled@qq.com", run(service.listDeliveries(campaign.id(), 1, 20, null)).deliveries().get(1).email());
    }

    /**
     * 全选筛选结果覆盖所有分页并支持超过一万名收件人，提交后名单保持固定，重复提交不新增任务。
     * @throws Exception 批量测试用户初始化失败时抛出
     */
    @Test
    void snapshotsAllMatchingRecipientsBeyondPaginationAndManualSelectionLimits() throws Exception {
        execute("INSERT INTO users(id,username,email,nickname,role,status,invitation_code) "
                + "SELECT value, 'mail-bulk-' || value, 'bulk' || value || '@gmail.com', '批量用户', 'user', 1, 'MAILBULK' || value "
                + "FROM generate_series(81000,91024) AS value; "
                + "INSERT INTO users(id,username,email,nickname,role,status,invitation_code) VALUES "
                + "(80005,'mail-similar','bulk@gmail.com.evil','相似后缀','user',1,'MAILSIMILAR'),"
                + "(80006,'mail-subdomain','bulk@sub.gmail.com','子域名','user',1,'MAILSUBDOMAIN');");
        var search = run(service.listUsers(1, 20, "bulk", List.of("gmail.com")));
        assertEquals(20, search.users().size());
        assertEquals(10025, search.total());
        var request = new EmailCampaignDtos.CreateRequest(UUID.randomUUID(), "筛选全选", "<p>正文</p>", "selected", List.of(), 3,
                new EmailCampaignDtos.RecipientFilter(" bulk ", List.of(" @GMAIL.COM ", "gmail.com")));
        var campaign = run(service.createCampaign(request));
        assertEquals(search.total(), campaign.recipientCount());
        assertEquals(search.total(), run(repository.countDeliveries(campaign.id(), "")));
        execute("UPDATE users SET email = 'changed@qq.com' WHERE id = 81000; UPDATE users SET email = 'new@gmail.com' WHERE id = 80005");
        var deliveries = run(service.listDeliveries(campaign.id(), 1, 20, null));
        assertEquals(10025, deliveries.total());
        assertTrue(deliveries.deliveries().stream().anyMatch(delivery -> delivery.userId() == 81000 && delivery.email().equals("bulk81000@gmail.com")));
        assertEquals(campaign.id(), run(service.createCampaign(request)).id());
        assertEquals(1, run(repository.countCampaigns()));
        assertEquals(10025, run(repository.countDeliveries(campaign.id(), "")));
    }

    /**
     * 多后缀全选取并集并应用搜索词，收件快照与搜索结果完全一致。
     * @throws Exception 测试邮箱初始化失败时抛出
     */
    @Test
    void snapshotsMultipleEmailDomainsWithTheSameKeywordAsSearch() throws Exception {
        execute("UPDATE users SET email = CASE id WHEN 80001 THEN 'admin@gmail.com' WHEN 80002 THEN 'user@gmail.com' WHEN 80003 THEN 'user@qq.com' END WHERE id IN (80001,80002,80003)");
        var filter = new EmailCampaignDtos.RecipientFilter("user@", List.of("gmail.com", "qq.com"));
        var search = run(service.listUsers(1, 20, filter.keyword(), filter.emailDomains()));
        var request = new EmailCampaignDtos.CreateRequest(UUID.randomUUID(), "多后缀全选", "<p>正文</p>", "selected", List.of(), 3, filter);
        var campaign = run(service.createCampaign(request));
        assertEquals(2, campaign.recipientCount());
        assertEquals(search.users().stream().map(EmailCampaignDtos.RecipientUser::id).toList(),
                run(service.listDeliveries(campaign.id(), 1, 20, null)).deliveries().stream().map(EmailCampaignDtos.Delivery::userId).toList());
        var keywordOnly = new EmailCampaignDtos.CreateRequest(UUID.randomUUID(), "关键字全选", "<p>正文</p>", "selected", List.of(), 3,
                new EmailCampaignDtos.RecipientFilter("admin@", List.of()));
        assertEquals(1, run(service.createCampaign(keywordOnly)).recipientCount());
    }

    /** 全选的空结果、非法条件、与手动名单及全部用户模式混用都必须拒绝，不能扩大收件范围。 */
    @Test
    void rejectsEmptyInvalidAndAmbiguousRecipientFilters() {
        for (var filter : List.of(new EmailCampaignDtos.RecipientFilter("", List.of("missing.example")),
                new EmailCampaignDtos.RecipientFilter("", List.of("*.example.com")),
                new EmailCampaignDtos.RecipientFilter("x".repeat(201), List.of()),
                new EmailCampaignDtos.RecipientFilter(null, List.of()),
                new EmailCampaignDtos.RecipientFilter("", null))) {
            var request = new EmailCampaignDtos.CreateRequest(UUID.randomUUID(), "非法筛选", "<p>正文</p>", "selected", List.of(), 3, filter);
            StepVerifier.create(scoped(service.createCampaign(request), 0, "admin")).expectError(BusinessException.class).verify();
        }
        var filter = new EmailCampaignDtos.RecipientFilter("", List.of("example.com"));
        for (var request : List.of(
                new EmailCampaignDtos.CreateRequest(UUID.randomUUID(), "混合范围", "<p>正文</p>", "all", List.of(), 3, filter),
                new EmailCampaignDtos.CreateRequest(UUID.randomUUID(), "混合范围", "<p>正文</p>", "selected", List.of(80002L), 3, filter))) {
            StepVerifier.create(scoped(service.createCampaign(request), 0, "admin")).expectError(BusinessException.class).verify();
        }
        assertEquals(0, run(repository.countCampaigns()));
        verify(sender, never()).send(any(MimeMessage.class));
    }

    /** 搜索未限制时返回全部候选，无匹配时返回空列表，非法后缀与越权查询被拒绝。 */
    @Test
    void handlesEmptyMissingAndInvalidEmailDomainFiltersExplicitly() {
        assertEquals(3, run(service.listUsers(1, 20, "", List.of())).total());
        assertEquals(3, run(service.listUsers(1, 20, "", null)).total());
        assertEquals(0, run(service.listUsers(1, 20, "", List.of("missing.example"))).total());
        for (String domain : List.of("", "*.qq.com", "%qq.com", "qq.com%", "user@qq.com", "qq.com' OR true --", "-qq.com")) {
            StepVerifier.create(scoped(service.listUsers(1, 20, "", List.of(domain)), 0, "admin")).expectError(BusinessException.class).verify();
        }
        assertEquals(0, run(repository.countCampaigns()));
        StepVerifier.create(scoped(service.listEmailDomains(), 0, "user")).expectError(BusinessException.class).verify();
        StepVerifier.create(scoped(service.listEmailDomains(), 9, "admin")).expectError(BusinessException.class).verify();
        verify(sender, never()).send(any(MimeMessage.class));
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
        doThrow(new org.springframework.mail.MailParseException("模拟内容无效")).when(sender).send(any(MimeMessage.class));
        run(dispatcher.dispatch());
        execute("UPDATE email_deliveries SET started_at = CURRENT_TIMESTAMP - INTERVAL '2 minutes' WHERE id = (SELECT MIN(id) FROM email_deliveries);");
        allowNextInterval();
        run(dispatcher.dispatch());
        verify(sender, times(1)).send(any(MimeMessage.class));
    }

    /**
     * 发件认证失败时只尝试当前一封，终止任务并取消后续收件人，保留已发送记录。
     * @throws Exception 调整模拟发送间隔失败时抛出
     */
    @Test
    void authenticationFailureCancelsRemainingRecipientsAndPreservesSentMail() throws Exception {
        var campaign = run(service.createCampaign(request("all", List.of(), "<p>认证失败停止整批</p>")));
        run(dispatcher.dispatch());
        doThrow(new MailAuthenticationException("认证被拒绝", new jakarta.mail.AuthenticationFailedException("535 Login fail")))
                .when(sender).send(any(MimeMessage.class));
        allowNextInterval();
        run(dispatcher.dispatch());
        assertEquals("cancelled", run(repository.getCampaign(campaign.id())).status());
        assertEquals(1, run(repository.countDeliveries(campaign.id(), "sent")));
        assertEquals(1, run(repository.countDeliveries(campaign.id(), "failed")));
        assertEquals(1, run(repository.countDeliveries(campaign.id(), "cancelled")));
        assertEquals(0, run(repository.countDeliveries(campaign.id(), "queued")));
        assertEquals(0, run(repository.countDeliveries(campaign.id(), "sending")));
        assertTrue(run(service.listDeliveries(campaign.id(), 1, 20, "failed")).deliveries().getFirst().errorMessage().contains("认证失败"));
        allowNextInterval();
        run(dispatcher.dispatch());
        var restartedDispatcher = new EmailCampaignDispatcher(repository, limits, sender, transactions);
        run(restartedDispatcher.dispatch());
        verify(sender, times(2)).send(any(MimeMessage.class));
    }

    /**
     * 原始邮件认证异常被包装后仍应停止整批，其他任务及普通内容错误沿用独立处理逻辑。
     * @throws Exception 调整模拟发送间隔失败时抛出
     */
    @Test
    void wrappedAuthenticationFailureCancelsOnlyTheAffectedCampaign() throws Exception {
        var campaign = run(service.createCampaign(request("selected", List.of(80001L, 80002L), "<p>包装认证失败</p>")));
        var anotherCampaign = run(service.createCampaign(request("selected", List.of(80003L), "<p>其他任务</p>")));
        doThrow(new MailSendException("发送连接失败", new jakarta.mail.AuthenticationFailedException("535 Login fail")))
                .when(sender).send(any(MimeMessage.class));
        run(dispatcher.dispatch());
        assertEquals("cancelled", run(repository.getCampaign(campaign.id())).status());
        assertEquals(1, run(repository.countDeliveries(campaign.id(), "failed")));
        assertEquals(1, run(repository.countDeliveries(campaign.id(), "cancelled")));
        assertEquals(1, run(repository.countDeliveries(anotherCampaign.id(), "queued")));
        doNothing().when(sender).send(any(MimeMessage.class));
        allowNextInterval();
        run(dispatcher.dispatch());
        assertEquals(1, run(repository.countDeliveries(anotherCampaign.id(), "sent")));
        verify(sender, times(2)).send(any(MimeMessage.class));
    }

    /**
     * 普通内容错误只失败当前邮件，不能误终止整批收件任务。
     * @throws Exception 调整模拟发送间隔失败时抛出
     */
    @Test
    void messageContentFailureDoesNotCancelRemainingRecipients() throws Exception {
        var campaign = run(service.createCampaign(request("selected", List.of(80002L, 80003L), "<p>内容错误继续下一封</p>")));
        doThrow(new org.springframework.mail.MailParseException("模拟内容错误")).when(sender).send(any(MimeMessage.class));
        run(dispatcher.dispatch());
        assertEquals("running", run(repository.getCampaign(campaign.id())).status());
        assertEquals(1, run(repository.countDeliveries(campaign.id(), "failed")));
        assertEquals(1, run(repository.countDeliveries(campaign.id(), "queued")));
        doNothing().when(sender).send(any(MimeMessage.class));
        allowNextInterval();
        run(dispatcher.dispatch());
        assertEquals("completed", run(repository.getCampaign(campaign.id())).status());
        assertEquals(1, run(repository.countDeliveries(campaign.id(), "sent")));
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
            assertFalse(validator.validate(new EmailCampaignDtos.CreateRequest(UUID.randomUUID(), "通知\r\nBcc: other@example.com", "<p>正文</p>", "selected", List.of(80002L), 3, null)).isEmpty());
            assertFalse(validator.validate(new EmailCampaignDtos.CreateRequest(UUID.randomUUID(), "通知", "<p>正文</p>", "invalid", List.of(80002L), 3, null)).isEmpty());
            assertFalse(validator.validate(new EmailCampaignDtos.CreateRequest(UUID.randomUUID(), "通知", "<p>正文</p>", "selected", List.of(), 3,
                    new EmailCampaignDtos.RecipientFilter(null, List.of()))).isEmpty());
            assertTrue(validator.validate(new EmailCampaignDtos.CreateRequest(UUID.randomUUID(), "通知", "<p>正文</p>", "selected", List.of(), 3,
                    new EmailCampaignDtos.RecipientFilter("", List.of("gmail.com")))).isEmpty());
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
        return new EmailCampaignDtos.CreateRequest(UUID.randomUUID(), "测试中文邮件", html, mode, userIds, 3, null);
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
