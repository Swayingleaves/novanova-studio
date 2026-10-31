package com.novanovastudio.config;

import java.nio.charset.StandardCharsets;
import java.sql.DriverManager;
import java.util.ArrayList;
import java.util.List;
import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.FlywayException;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * 使用独立数据库验证企业版与开源版迁移历史不可混用，升级不改写已执行记录。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-31 20:00
 */
@Testcontainers
class DatabaseMigrationHistoryIntegrationTest {

    /** 每个测试使用独立容器，不连接本地或线上业务数据库。 */
    @Container
    private final PostgreSQLContainer<?> database = new PostgreSQLContainer<>("postgres:17")
            .withDatabaseName("novanova_migration_test").withUsername("postgres").withPassword("postgres");

    /**
     * 企业版 V76 与线上只读快照逐项一致，重新启动时无待执行迁移且保留业务数据。
     *
     * @throws Exception 读取快照或访问测试数据库失败时抛出
     */
    @Test
    void shouldPreserveOnlineEnterpriseHistory() throws Exception {
        Flyway enterprise = migration("classpath:db/migration", "76");
        Assertions.assertEquals(76, enterprise.migrate().migrationsExecuted);
        insertUser();
        List<String> history = readHistory(76);

        try (var input = new ClassPathResource("db/enterprise-v76-history.txt").getInputStream()) {
            List<String> expected = new String(input.readAllBytes(), StandardCharsets.UTF_8).lines().toList();
            List<String> actual = java.util.Arrays.stream(enterprise.info().applied())
                    .map(item -> item.getVersion() + "|" + item.getDescription() + "|" + item.getChecksum() + "|t")
                    .toList();
            Assertions.assertEquals(expected, actual, "已发布迁移必须与线上 V76 的描述及校验和一致");
        }

        Flyway restarted = migration("classpath:db/migration", "latest");
        restarted.validate();
        Assertions.assertEquals(0, restarted.info().pending().length);
        Assertions.assertEquals(0, restarted.migrate().migrationsExecuted);
        Assertions.assertEquals(history, readHistory(76));
        assertUserPreserved();
        Assertions.assertThrows(FlywayException.class, () -> migration("classpath:db/migration-community", "latest").validate());
    }

    /**
     * 开源版从 V38 升至 V77，仅追加迁移并保留原历史与用户，禁止切换企业版目录。
     *
     * @throws Exception 访问测试数据库失败时抛出
     */
    @Test
    void shouldUpgradeCommunityDatabaseWithoutRewritingHistory() throws Exception {
        Assertions.assertEquals(38, migration("classpath:db/migration-community", "38").migrate().migrationsExecuted);
        insertUser();
        List<String> history = readHistory(38);

        Flyway upgraded = migration("classpath:db/migration-community", "latest");
        Assertions.assertEquals(39, upgraded.migrate().migrationsExecuted);
        Assertions.assertEquals(77, upgraded.info().applied().length);
        Assertions.assertEquals(history, readHistory(38));
        assertUserPreserved();

        Flyway restarted = migration("classpath:db/migration-community", "latest");
        restarted.validate();
        Assertions.assertEquals(0, restarted.migrate().migrationsExecuted);
        Assertions.assertEquals(history, readHistory(38));
        assertUserPreserved();
        Assertions.assertThrows(FlywayException.class, () -> migration("classpath:db/migration", "latest").validate());
    }

    /**
     * 按指定历史构造迁移入口，配置错误时立即停止。
     *
     * @param location 迁移目录
     * @param target 目标版本，latest 表示目录中的最新版本
     * @return 绑定当前测试容器的迁移入口
     */
    private Flyway migration(String location, String target) {
        return Flyway.configure().dataSource(database.getJdbcUrl(), database.getUsername(), database.getPassword())
                .locations(location).failOnMissingLocations(true).target(target).load();
    }

    /**
     * 记录完整历史行，包含安装时间及顺序，避免只验证最终版本而漏掉历史改写。
     *
     * @param maximumVersion 需要保留的最高历史版本
     * @return 按安装顺序排列的原始历史记录
     * @throws Exception 查询失败时抛出
     */
    private List<String> readHistory(int maximumVersion) throws Exception {
        List<String> history = new ArrayList<>();
        try (var connection = DriverManager.getConnection(database.getJdbcUrl(), database.getUsername(), database.getPassword());
             var statement = connection.prepareStatement("SELECT row_to_json(history)::text FROM flyway_schema_history history "
                     + "WHERE version::integer <= ? ORDER BY installed_rank")) {
            statement.setInt(1, maximumVersion);
            try (var rows = statement.executeQuery()) {
                while (rows.next()) {
                    history.add(rows.getString(1));
                }
            }
        }
        return history;
    }

    /**
     * 写入升级前的用户，验证企业版新增约束与数据调整保留原账号。
     *
     * @throws Exception 插入失败时抛出
     */
    private void insertUser() throws Exception {
        try (var connection = DriverManager.getConnection(database.getJdbcUrl(), database.getUsername(), database.getPassword());
             var statement = connection.createStatement()) {
            statement.executeUpdate("INSERT INTO users (id, username, email, nickname, invitation_code) "
                    + "VALUES (900001, 'migration_history_user', 'migration@example.com', '迁移前用户', 'MERGETEST900001')");
        }
    }

    /**
     * 确认迁移及重复启动均保留原用户内容。
     *
     * @throws Exception 查询失败时抛出
     */
    private void assertUserPreserved() throws Exception {
        try (var connection = DriverManager.getConnection(database.getJdbcUrl(), database.getUsername(), database.getPassword());
             var statement = connection.createStatement();
             var rows = statement.executeQuery("SELECT username, email, nickname FROM users WHERE id = 900001")) {
            Assertions.assertTrue(rows.next());
            Assertions.assertEquals("migration_history_user", rows.getString("username"));
            Assertions.assertEquals("migration@example.com", rows.getString("email"));
            Assertions.assertEquals("迁移前用户", rows.getString("nickname"));
            Assertions.assertFalse(rows.next());
        }
    }
}
