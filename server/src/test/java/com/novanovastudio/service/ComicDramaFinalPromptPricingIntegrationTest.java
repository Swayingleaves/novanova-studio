package com.novanovastudio.service;

import static org.junit.jupiter.api.Assertions.*;

import com.novanovastudio.config.TeamDatabaseConfiguration;
import com.novanovastudio.repository.ComicDramaFinalPromptPricingRepository;
import com.novanovastudio.security.TeamScope;
import io.r2dbc.spi.ConnectionFactories;
import java.math.BigDecimal;
import java.sql.DriverManager;
import java.time.Duration;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.r2dbc.core.DatabaseClient;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 独立数据库验证最终提示词价格的迁移、并发保存及空间权限。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-28 17:30
 */
@Testcontainers
class ComicDramaFinalPromptPricingIntegrationTest {
    /** 独立测试数据库，不访问运行中服务的数据。 */
    @Container
    private static final PostgreSQLContainer<?> database = new PostgreSQLContainer<>("postgres:17")
            .withDatabaseName("novanova_pro_prompt_pricing_test").withUsername("postgres").withPassword("postgres");
    /** 真实价格仓储，连接强制切换为受行级权限约束的业务角色。 */
    private static ComicDramaFinalPromptPricingRepository repository;

    /**
     * 执行完整迁移并初始化平台及两个团队的模型。
     * @throws Exception 初始化数据库失败时抛出
     */
    @BeforeAll
    static void initialize() throws Exception {
        Flyway.configure().dataSource(database.getJdbcUrl(), database.getUsername(), database.getPassword()).load().migrate();
        try (var connection = DriverManager.getConnection(database.getJdbcUrl(), "postgres", "postgres");
             var statement = connection.createStatement()) {
            statement.execute("INSERT INTO teams(id,team_slug,name,member_limit) VALUES (801,'pricing-a','价格团队甲',5),(802,'pricing-b','价格团队乙',5)");
            for (long teamId : new long[]{0, 801, 802}) {
                statement.execute("INSERT INTO platform_ai_channels(channel_id,name,team_id) VALUES ('pricing-channel-" + teamId + "','测试渠道'," + teamId + ")");
                statement.execute("INSERT INTO platform_ai_model_configs(model_config_id,channel_id,model_name,model_type,team_id) VALUES ('pricing-model-" + teamId + "','pricing-channel-" + teamId + "','文本模型','text'," + teamId + ")");
            }
            statement.execute("INSERT INTO platform_ai_model_configs(model_config_id,channel_id,model_name,model_type,team_id) VALUES ('pricing-granted','pricing-channel-0','授权模型','text',0)");
            statement.execute("INSERT INTO team_resource_grants(team_id,resource_type,resource_id) VALUES (801,'model','pricing-granted')");
        }
        var connections = new TeamDatabaseConfiguration.ScopedConnectionFactory(ConnectionFactories.get(
                "r2dbc:postgresql://postgres:postgres@" + database.getHost() + ":" + database.getMappedPort(5432) + "/" + database.getDatabaseName()));
        repository = new ComicDramaFinalPromptPricingRepository(DatabaseClient.create(connections));
    }

    /** 首次部署为空，首次并发保存和后续修订更新只能各有一个成功者。 */
    @Test
    void shouldSaveAtomicallyWithRevisionConflicts() {
        assertNull(run(repository.findPricing("pricing-model-0"), 0));
        var first = Flux.range(0, 8).flatMap(index -> scope(repository.savePricing("pricing-model-0", BigDecimal.ZERO, 0), 0), 8)
                .collectList().block(Duration.ofSeconds(30));
        assertEquals(1, first.size());
        assertEquals(1, first.getFirst().revision());
        assertEquals(0, first.getFirst().credits().signum());
        var updates = Flux.range(0, 8).flatMap(index -> scope(repository.savePricing("pricing-model-0", new BigDecimal("1.234567"), 1), 0), 8)
                .collectList().block(Duration.ofSeconds(30));
        assertEquals(1, updates.size());
        assertEquals(2, updates.getFirst().revision());
        assertEquals(new BigDecimal("1.234567"), run(repository.findPricing("pricing-model-0"), 0).credits());
    }

    /** 授权团队只能读取平台价格，自有模型可维护，其他团队完全隔离且不能伪造归属。 */
    @Test
    void shouldEnforceGrantedReadOnlyAndOwnedWriteAccess() {
        run(repository.savePricing("pricing-model-801", BigDecimal.ONE, 0), 801);
        run(repository.savePricing("pricing-model-802", BigDecimal.TEN, 0), 802);
        // 平台模型只有所属空间能建立和修改价格。
        run(repository.savePricing("pricing-granted", BigDecimal.ZERO, 0), 0);
        assertNotNull(run(repository.findPricing("pricing-granted"), 801));
        assertNull(run(repository.findPricing("pricing-granted"), 802));
        assertNull(run(repository.findPricing("pricing-model-802"), 801));
        assertNull(run(repository.savePricing("pricing-granted", BigDecimal.TEN, run(repository.findPricing("pricing-granted"), 801).revision()), 801));
        assertThrows(RuntimeException.class, () -> run(repository.savePricing("pricing-granted", BigDecimal.ONE, 0), 801));
        assertThrows(RuntimeException.class, () -> run(repository.savePricing("pricing-model-802", BigDecimal.ONE, 0), 801));
        assertEquals(new BigDecimal("1.000000"), run(repository.findPricing("pricing-model-801"), 801).credits());
    }

    /**
     * 将数据库操作绑定到指定空间。
     * @param operation 数据库操作
     * @param teamId 空间标识
     * @param <T> 结果类型
     * @return 已限定空间的操作
     */
    private static <T> Mono<T> scope(Mono<T> operation, long teamId) {
        return operation.contextWrite(new TeamScope(teamId, "administrator")::apply);
    }

    /**
     * 有界等待数据库操作完成。
     * @param operation 数据库操作
     * @param teamId 空间标识
     * @param <T> 结果类型
     * @return 数据库结果，未命中时为空
     */
    private static <T> T run(Mono<T> operation, long teamId) {
        return scope(operation, teamId).block(Duration.ofSeconds(30));
    }
}
