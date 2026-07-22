package com.novanovastudio.config;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import org.springframework.context.support.GenericApplicationContext;
import org.springframework.mock.env.MockEnvironment;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * 数据库启动前自动创建集成测试。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-07-22 21:13:16
 */
@Testcontainers(disabledWithoutDocker = true)
class DatabaseBootstrapInitializerIntegrationTest {

    /** PostgreSQL管理数据库名称。 */
    private static final String ADMINISTRATOR_DATABASE_NAME = "administrator";

    /** PostgreSQL容器。 */
    @Container
    private static final PostgreSQLContainer<?> postgresqlContainer = new PostgreSQLContainer<>("postgres:17")
        .withDatabaseName(ADMINISTRATOR_DATABASE_NAME)
        .withUsername("postgres")
        .withPassword("postgres");

    /** 业务表名称集合。 */
    private static final Set<String> BUSINESS_TABLE_NAMES = Set.of(
        "agent_session",
        "ai_generation_tasks",
        "api_request_logs",
        "assets",
        "canvas_projects",
        "email_verification_codes",
        "generation_logs",
        "homepage_showcases",
        "media_files",
        "platform_ai_channels",
        "platform_ai_model_configs",
        "platform_credit_settings",
        "platform_object_storage_configs",
        "prompt_library",
        "system_notifications",
        "user_ai_channels",
        "user_ai_model_configs",
        "user_configs",
        "user_credit_accounts",
        "user_credit_transactions",
        "user_identity_bindings",
        "user_notification_reads",
        "user_object_storage_configs",
        "user_webdav_configs",
        "users"
    );

    /**
     * 测试缺失数据库可被创建、重复创建可安全跳过且单一初始化迁移完整生效。
     *
     * @return void 无返回值
     * @throws SQLException 数据库断言或清理失败时抛出
     */
    @Test
    void shouldCreateMissingDatabaseAndApplySingleInitialMigration() throws SQLException {
        String targetDatabaseName = newTargetDatabaseName();
        try {
            initializeDatabase(targetDatabaseName, postgresqlContainer.getUsername(), postgresqlContainer.getPassword());
            initializeDatabase(targetDatabaseName, postgresqlContainer.getUsername(), postgresqlContainer.getPassword());

            Assertions.assertTrue(databaseExists(targetDatabaseName));
            Flyway.configure()
                .dataSource(targetJdbcUrl(targetDatabaseName), postgresqlContainer.getUsername(), postgresqlContainer.getPassword())
                .locations("classpath:db/migration")
                .load()
                .migrate();

            Assertions.assertEquals(1, queryCount(targetDatabaseName, "flyway_schema_history"));
            Assertions.assertEquals("1", queryString(
                targetDatabaseName,
                "SELECT version FROM flyway_schema_history WHERE success = TRUE"
            ));
            Assertions.assertTrue(readBusinessTableNames(targetDatabaseName).containsAll(BUSINESS_TABLE_NAMES));
            Assertions.assertEquals(877, queryCount(targetDatabaseName, "prompt_library"));
            Assertions.assertEquals(1, queryCount(targetDatabaseName, "platform_credit_settings"));
            assertColumnExists(targetDatabaseName, "media_files", "object_storage_url");
            assertColumnExists(targetDatabaseName, "media_files", "object_storage_key");
            assertColumnExists(targetDatabaseName, "media_files", "object_storage_provider");
            assertColumnExists(targetDatabaseName, "user_object_storage_configs", "access_key_encrypted");
            assertColumnExists(targetDatabaseName, "user_object_storage_configs", "endpoint");
            assertColumnExists(targetDatabaseName, "platform_object_storage_configs", "access_key_encrypted");
            assertColumnExists(targetDatabaseName, "platform_object_storage_configs", "endpoint");
            assertIndexExists(targetDatabaseName, "idx_user_credit_transactions_charge_created");
        } finally {
            dropDatabaseIfExists(targetDatabaseName);
        }
    }

    /**
     * 测试没有CREATEDB权限的账号会让应用初始化失败且异常信息不暴露密码。
     *
     * @return void 无返回值
     * @throws SQLException 测试账号创建或清理失败时抛出
     */
    @Test
    void shouldStopWhenAccountCannotCreateDatabase() throws SQLException {
        String targetDatabaseName = newTargetDatabaseName();
        String restrictedUsername = "database_bootstrap_" + UUID.randomUUID().toString().replace("-", "");
        String restrictedPassword = "restricted-password";
        createRestrictedUser(restrictedUsername, restrictedPassword);
        try {
            IllegalStateException exception = Assertions.assertThrows(
                IllegalStateException.class,
                () -> initializeDatabase(targetDatabaseName, restrictedUsername, restrictedPassword)
            );

            Assertions.assertFalse(exception.getMessage().contains(restrictedPassword));
            Assertions.assertFalse(databaseExists(targetDatabaseName));
        } finally {
            try {
                dropDatabaseIfExists(targetDatabaseName);
            } finally {
                dropUserIfExists(restrictedUsername);
            }
        }
    }

    /**
     * 使用数据库启动前初始化器创建目标数据库。
     *
     * @param targetDatabaseName String 目标数据库名称
     * @param username String PostgreSQL用户名
     * @param password String PostgreSQL密码
     * @return void 无返回值
     */
    private void initializeDatabase(String targetDatabaseName, String username, String password) {
        GenericApplicationContext applicationContext = new GenericApplicationContext();
        MockEnvironment environment = new MockEnvironment()
            .withProperty("spring.datasource.url", targetJdbcUrl(targetDatabaseName))
            .withProperty("spring.datasource.username", username)
            .withProperty("spring.datasource.password", password)
            .withProperty("novanova.database.administrator-database", ADMINISTRATOR_DATABASE_NAME);
        applicationContext.setEnvironment(environment);
        new DatabaseBootstrapInitializer().initialize(applicationContext);
    }

    /**
     * 生成一个不会与其他测试冲突的目标数据库名称。
     *
     * @return String 目标数据库名称
     */
    private String newTargetDatabaseName() {
        return "novanova_initialization_" + UUID.randomUUID().toString().replace("-", "");
    }

    /**
     * 构造目标数据库的JDBC连接地址。
     *
     * @param targetDatabaseName String 目标数据库名称
     * @return String JDBC连接地址
     */
    private String targetJdbcUrl(String targetDatabaseName) {
        return "jdbc:postgresql://%s:%s/%s".formatted(
            postgresqlContainer.getHost(),
            postgresqlContainer.getMappedPort(5432),
            targetDatabaseName
        );
    }

    /**
     * 判断目标数据库是否存在。
     *
     * @param targetDatabaseName String 目标数据库名称
     * @return boolean 数据库存在时返回true
     * @throws SQLException 查询失败时抛出
     */
    private boolean databaseExists(String targetDatabaseName) throws SQLException {
        try (Connection connection = administratorConnection();
             PreparedStatement statement = connection.prepareStatement(
                 "SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = ?)"
             )) {
            statement.setString(1, targetDatabaseName);
            try (ResultSet resultSet = statement.executeQuery()) {
                resultSet.next();
                return resultSet.getBoolean(1);
            }
        }
    }

    /**
     * 删除测试目标数据库。
     *
     * @param targetDatabaseName String 目标数据库名称
     * @return void 无返回值
     * @throws SQLException 数据库清理失败时抛出
     */
    private void dropDatabaseIfExists(String targetDatabaseName) throws SQLException {
        try (Connection connection = administratorConnection()) {
            if (!databaseExists(targetDatabaseName)) {
                return;
            }
            try (Statement statement = connection.createStatement()) {
                statement.execute("DROP DATABASE " + quoteIdentifier(targetDatabaseName) + " WITH (FORCE)");
            }
        }
    }

    /**
     * 创建没有CREATEDB权限的测试账号。
     *
     * @param username String 测试账号名称
     * @param password String 测试账号密码
     * @return void 无返回值
     * @throws SQLException 账号创建失败时抛出
     */
    private void createRestrictedUser(String username, String password) throws SQLException {
        try (Connection connection = administratorConnection(); Statement statement = connection.createStatement()) {
            statement.execute("CREATE ROLE " + quoteIdentifier(username) + " LOGIN PASSWORD '" + password + "'");
        }
    }

    /**
     * 删除测试账号。
     *
     * @param username String 测试账号名称
     * @return void 无返回值
     * @throws SQLException 账号清理失败时抛出
     */
    private void dropUserIfExists(String username) throws SQLException {
        try (Connection connection = administratorConnection(); Statement statement = connection.createStatement()) {
            statement.execute("DROP ROLE IF EXISTS " + quoteIdentifier(username));
        }
    }

    /**
     * 读取目标数据库中的业务表名称。
     *
     * @param targetDatabaseName String 目标数据库名称
     * @return Set<String> 业务表名称集合
     * @throws SQLException 查询失败时抛出
     */
    private Set<String> readBusinessTableNames(String targetDatabaseName) throws SQLException {
        Set<String> tableNames = new LinkedHashSet<>();
        try (Connection connection = targetConnection(targetDatabaseName);
             PreparedStatement statement = connection.prepareStatement(
                 "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
             );
             ResultSet resultSet = statement.executeQuery()) {
            while (resultSet.next()) {
                tableNames.add(resultSet.getString(1));
            }
        }
        return tableNames;
    }

    /**
     * 查询指定表的记录数量。
     *
     * @param targetDatabaseName String 目标数据库名称
     * @param tableName String 已知测试表名称
     * @return int 表记录数量
     * @throws SQLException 查询失败时抛出
     */
    private int queryCount(String targetDatabaseName, String tableName) throws SQLException {
        try (Connection connection = targetConnection(targetDatabaseName);
             Statement statement = connection.createStatement();
             ResultSet resultSet = statement.executeQuery("SELECT COUNT(*) FROM " + quoteIdentifier(tableName))) {
            resultSet.next();
            return resultSet.getInt(1);
        }
    }

    /**
     * 查询单个文本结果。
     *
     * @param targetDatabaseName String 目标数据库名称
     * @param sql String 固定测试查询SQL
     * @return String 查询结果
     * @throws SQLException 查询失败时抛出
     */
    private String queryString(String targetDatabaseName, String sql) throws SQLException {
        try (Connection connection = targetConnection(targetDatabaseName);
             Statement statement = connection.createStatement();
             ResultSet resultSet = statement.executeQuery(sql)) {
            resultSet.next();
            return resultSet.getString(1);
        }
    }

    /**
     * 验证指定列存在。
     *
     * @param targetDatabaseName String 目标数据库名称
     * @param tableName String 表名称
     * @param columnName String 列名称
     * @return void 无返回值
     * @throws SQLException 查询失败时抛出
     */
    private void assertColumnExists(String targetDatabaseName, String tableName, String columnName) throws SQLException {
        try (Connection connection = targetConnection(targetDatabaseName);
             PreparedStatement statement = connection.prepareStatement(
                 "SELECT EXISTS (SELECT 1 FROM information_schema.columns "
                     + "WHERE table_schema = 'public' AND table_name = ? AND column_name = ?)"
             )) {
            statement.setString(1, tableName);
            statement.setString(2, columnName);
            try (ResultSet resultSet = statement.executeQuery()) {
                resultSet.next();
                Assertions.assertTrue(resultSet.getBoolean(1), "缺少列: " + tableName + "." + columnName);
            }
        }
    }

    /**
     * 验证指定索引存在。
     *
     * @param targetDatabaseName String 目标数据库名称
     * @param indexName String 索引名称
     * @return void 无返回值
     * @throws SQLException 查询失败时抛出
     */
    private void assertIndexExists(String targetDatabaseName, String indexName) throws SQLException {
        try (Connection connection = targetConnection(targetDatabaseName);
             PreparedStatement statement = connection.prepareStatement(
                 "SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = ?)"
             )) {
            statement.setString(1, indexName);
            try (ResultSet resultSet = statement.executeQuery()) {
                resultSet.next();
                Assertions.assertTrue(resultSet.getBoolean(1), "缺少索引: " + indexName);
            }
        }
    }

    /**
     * 创建连接到PostgreSQL管理数据库的JDBC连接。
     *
     * @return Connection PostgreSQL管理数据库连接
     * @throws SQLException 连接创建失败时抛出
     */
    private Connection administratorConnection() throws SQLException {
        return DriverManager.getConnection(
            postgresqlContainer.getJdbcUrl(),
            postgresqlContainer.getUsername(),
            postgresqlContainer.getPassword()
        );
    }

    /**
     * 创建连接到目标数据库的JDBC连接。
     *
     * @param targetDatabaseName String 目标数据库名称
     * @return Connection 目标数据库连接
     * @throws SQLException 连接创建失败时抛出
     */
    private Connection targetConnection(String targetDatabaseName) throws SQLException {
        return DriverManager.getConnection(
            targetJdbcUrl(targetDatabaseName),
            postgresqlContainer.getUsername(),
            postgresqlContainer.getPassword()
        );
    }

    /**
     * 转义PostgreSQL标识符。
     *
     * @param identifier String PostgreSQL标识符
     * @return String 转义后的标识符
     */
    private String quoteIdentifier(String identifier) {
        return '"' + identifier.replace("\"", "\"\"") + '"';
    }
}
