package com.novanovastudio.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.config.TeamDatabaseConfiguration;
import com.novanovastudio.payment.PaymentProvider;
import com.novanovastudio.payment.PaymentProviderRegistry;
import com.novanovastudio.repository.CreditPurchaseRepository;
import com.novanovastudio.repository.CreditRepository;
import com.novanovastudio.repository.UserRepository;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.task.AiTaskEventPublisher;
import io.r2dbc.spi.ConnectionFactories;
import java.math.BigDecimal;
import java.sql.DriverManager;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.Map;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.ReactiveStringRedisTemplate;
import org.springframework.r2dbc.connection.R2dbcTransactionManager;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.transaction.reactive.TransactionalOperator;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 在独立 PostgreSQL 中验证微信积分结算的并发、回滚及后台分页；渠道使用模拟对象。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-05 14:30
 */
@Testcontainers
class WechatCreditSettlementIntegrationTest {
    /** 与项目运行数据库隔离的测试容器。 */
    @Container
    private static final PostgreSQLContainer<?> database = new PostgreSQLContainer<>("postgres:17")
            .withDatabaseName("wechat_credit_test").withUsername("postgres").withPassword("postgres");
    /** 被测真实业务服务。 */
    private CreditPurchaseService service;
    /** 微信外部调用边界。 */
    private PaymentProvider provider;

    /** 在测试容器内执行完整数据库迁移。 */
    @BeforeAll
    static void migrate() {
        Flyway.configure().dataSource(database.getJdbcUrl(), database.getUsername(), database.getPassword()).load().migrate();
    }

    /**
     * 初始化独立测试用户、平台钱包和真实事务依赖。
     * @throws Exception 测试数据初始化失败时抛出
     */
    @BeforeEach
    void initialize() throws Exception {
        execute("DELETE FROM user_credit_transactions WHERE user_id=80001; DELETE FROM credit_purchase_orders WHERE user_id=80001; "
                + "INSERT INTO users(id,username,email,invitation_code) VALUES(80001,'wechat-test','wechat-test@example.com','WECHATTEST') ON CONFLICT(id) DO NOTHING; "
                + "INSERT INTO user_credit_accounts(team_id,user_id,credit_balance) VALUES(0,80001,0) ON CONFLICT(team_id,user_id) DO UPDATE SET credit_balance=0; "
                + "UPDATE platform_credit_settings SET first_purchase_bonus_percent=50 WHERE id=1");
        var original = ConnectionFactories.get("r2dbc:postgresql://postgres:postgres@" + database.getHost() + ":"
                + database.getMappedPort(5432) + "/" + database.getDatabaseName());
        var connections = new TeamDatabaseConfiguration.ScopedConnectionFactory(original);
        var client = DatabaseClient.create(connections);
        var registry = mock(PaymentProviderRegistry.class);
        provider = mock(PaymentProvider.class);
        when(registry.require("wechat")).thenReturn(provider);
        when(provider.applicationId()).thenReturn("test-app");
        when(provider.verifyNotification(any())).thenAnswer(call -> Mono.just(notification(((Map<?, ?>) call.getArgument(0)).get("orderNo").toString(), "SUCCESS")));
        when(provider.queryOrder(anyString())).thenAnswer(call -> Mono.just(notification(call.getArgument(0), "NOTPAY")));
        when(provider.closePayment(anyString())).thenReturn(Mono.empty());
        var events = mock(AiTaskEventPublisher.class);
        when(events.publish(anyLong(), any())).thenReturn(Mono.empty());
        service = new CreditPurchaseService(new CreditPurchaseRepository(client), new CreditRepository(client), mock(UserRepository.class),
                mock(CurrentUserProvider.class), registry, TransactionalOperator.create(new R2dbcTransactionManager(connections)),
                events, new NovanovaProperties(), mock(ReactiveStringRedisTemplate.class));
    }

    /**
     * 同单并发通知及后续重复通知只能增加一次主积分和一次首充赠送。
     * @throws Exception 测试数据库操作失败时抛出
     */
    @Test
    void shouldSettleConcurrentDuplicateNotificationsOnlyOnce() throws Exception {
        createOrders(1);
        String orderNo = "0".repeat(31) + "1";
        // 竞争失败的通知由渠道重试；先等待每次调用结束，再验证重试幂等结果。
        Flux.range(0, 8).flatMap(index -> service.handleWechatNotification(Map.of("orderNo", orderNo)).materialize())
                .collectList().block(Duration.ofSeconds(30));
        service.handleWechatNotification(Map.of("orderNo", orderNo)).block(Duration.ofSeconds(10));
        assertEquals("30.000000", value("SELECT credit_balance::text FROM user_credit_accounts WHERE user_id=80001 AND team_id=0"));
        assertEquals("2", value("SELECT count(*)::text FROM user_credit_transactions WHERE user_id=80001"));
        assertEquals("paid", value("SELECT status FROM credit_purchase_orders WHERE user_id=80001"));
    }

    /**
     * 同一用户的两笔并发成功订单通过钱包锁保证只发一次首充赠送。
     * @throws Exception 测试数据库操作失败时抛出
     */
    @Test
    void shouldGrantFirstPurchaseBonusOnceAcrossConcurrentOrders() throws Exception {
        createOrders(2);
        Mono.when(service.handleWechatNotification(Map.of("orderNo", "0".repeat(31) + "1")),
                service.handleWechatNotification(Map.of("orderNo", "0".repeat(31) + "2"))).block(Duration.ofSeconds(30));
        assertEquals("50.000000", value("SELECT credit_balance::text FROM user_credit_accounts WHERE user_id=80001 AND team_id=0"));
        assertEquals("1", value("SELECT count(*)::text FROM user_credit_transactions WHERE user_id=80001 AND transaction_type='first_purchase_bonus'"));
        assertEquals("2", value("SELECT count(*)::text FROM credit_purchase_orders WHERE user_id=80001 AND status='paid'"));
    }

    /**
     * 首充流水写入失败时主积分、订单抢占与赠送快照必须整体回滚，恢复后可重试。
     * @throws Exception 测试数据库操作失败时抛出
     */
    @Test
    void shouldRollBackAllSettlementWritesAndAllowRetry() throws Exception {
        createOrders(1);
        execute("ALTER TABLE user_credit_transactions ADD CONSTRAINT test_reject_bonus CHECK(transaction_type <> 'first_purchase_bonus')");
        try {
            assertThrows(RuntimeException.class, () -> service.handleWechatNotification(Map.of("orderNo", "0".repeat(31) + "1")).block(Duration.ofSeconds(10)));
            assertEquals("0.000000", value("SELECT credit_balance::text FROM user_credit_accounts WHERE user_id=80001 AND team_id=0"));
            assertEquals("pending", value("SELECT status FROM credit_purchase_orders WHERE user_id=80001"));
            assertEquals("0", value("SELECT count(*)::text FROM user_credit_transactions WHERE user_id=80001"));
            assertEquals("0.000000", value("SELECT first_purchase_bonus_credits::text FROM credit_purchase_orders WHERE user_id=80001"));
        } finally {
            execute("ALTER TABLE user_credit_transactions DROP CONSTRAINT test_reject_bonus");
        }
        service.handleWechatNotification(Map.of("orderNo", "0".repeat(31) + "1")).block(Duration.ofSeconds(10));
        assertEquals("30.000000", value("SELECT credit_balance::text FROM user_credit_accounts WHERE user_id=80001 AND team_id=0"));
    }

    /**
     * 超过一页的订单中首笔失败不能阻塞下一页，失败订单保留给下一轮。
     * @throws Exception 测试数据库操作失败时抛出
     */
    @Test
    void shouldScanPastFailedOrderAndAcrossPageBoundary() throws Exception {
        createOrders(102);
        when(provider.queryOrder("0".repeat(31) + "1")).thenReturn(Mono.error(new IllegalStateException("模拟单笔查单失败")));
        service.reconcileWechatOrders().block(Duration.ofSeconds(30));
        assertEquals("101", value("SELECT count(*)::text FROM credit_purchase_orders WHERE user_id=80001 AND status='closed'"));
        assertEquals("1", value("SELECT count(*)::text FROM credit_purchase_orders WHERE user_id=80001 AND status='pending'"));
    }

    /**
     * 仅在测试容器中批量创建固定快照的过期微信订单。
     * @param count 测试订单数
     * @throws Exception 写入测试数据库失败时抛出
     */
    private void createOrders(int count) throws Exception {
        execute("INSERT INTO credit_purchase_orders(order_no,user_id,product_id,base_credits,credits,price_amount,wallet_team_id,payment_method,expires_at) "
                + "SELECT lpad(number::text,32,'0'),80001,(SELECT min(id) FROM credit_products),20,20,2,0,'wechat',CURRENT_TIMESTAMP-INTERVAL '1 minute' FROM generate_series(1," + count + ") number");
    }

    /**
     * 构造由模拟渠道确认的交易结果。
     * @param orderNo 测试订单号
     * @param status 微信交易状态
     * @return 已确认的测试交易
     */
    private PaymentProvider.PaymentNotification notification(String orderNo, String status) {
        return new PaymentProvider.PaymentNotification("wechat", "test-app", orderNo, new BigDecimal("2.00"),
                "trade-" + orderNo, status, OffsetDateTime.now());
    }

    /**
     * 执行只作用于测试容器的 SQL。
     * @param sql 固定测试语句
     * @throws Exception 数据库执行失败时抛出
     */
    private void execute(String sql) throws Exception {
        try (var connection = DriverManager.getConnection(database.getJdbcUrl(), database.getUsername(), database.getPassword());
                var statement = connection.createStatement()) {
            statement.execute(sql);
        }
    }

    /**
     * 读取测试数据库中的单值断言结果。
     * @param sql 固定查询语句
     * @return 查询的第一列文本
     * @throws Exception 数据库查询失败时抛出
     */
    private String value(String sql) throws Exception {
        try (var connection = DriverManager.getConnection(database.getJdbcUrl(), database.getUsername(), database.getPassword());
                var statement = connection.createStatement(); var result = statement.executeQuery(sql)) {
            result.next();
            return result.getString(1);
        }
    }
}
