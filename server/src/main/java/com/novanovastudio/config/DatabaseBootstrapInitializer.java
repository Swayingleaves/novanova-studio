package com.novanovastudio.config;

import java.net.URI;
import java.net.URISyntaxException;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationContextInitializer;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.Environment;
import org.springframework.util.StringUtils;

/**
 * PostgreSQL目标数据库启动前创建器。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-07-22 21:13:16
 */
public class DatabaseBootstrapInitializer implements ApplicationContextInitializer<ConfigurableApplicationContext> {

    /** PostgreSQL JDBC URL前缀。 */
    private static final String POSTGRESQL_JDBC_URL_PREFIX = "jdbc:postgresql://";

    /** 数据源连接地址配置键。 */
    private static final String DATASOURCE_URL_PROPERTY = "spring.datasource.url";

    /** 数据源用户名配置键。 */
    private static final String DATASOURCE_USERNAME_PROPERTY = "spring.datasource.username";

    /** 数据源密码配置键。 */
    private static final String DATASOURCE_PASSWORD_PROPERTY = "spring.datasource.password";

    /** PostgreSQL管理数据库配置键。 */
    private static final String ADMINISTRATOR_DATABASE_PROPERTY = "novanova.database.administrator-database";

    /** PostgreSQL数据库已存在的SQL状态码。 */
    private static final String DATABASE_ALREADY_EXISTS_SQL_STATE = "42P04";

    /** 日志记录器。 */
    private static final Logger log = LoggerFactory.getLogger(DatabaseBootstrapInitializer.class);

    /**
     * 在Spring Bean和Flyway初始化前创建缺失的目标数据库。
     *
     * @param applicationContext ConfigurableApplicationContext 已完成环境准备的应用上下文
     * @return void 无返回值
     */
    @Override
    public void initialize(ConfigurableApplicationContext applicationContext) {
        DatabaseConnectionSettings connectionSettings = null;
        try {
            connectionSettings = resolveConnectionSettings(applicationContext.getEnvironment());
            createDatabaseIfAbsent(connectionSettings);
        } catch (RuntimeException | SQLException exception) {
            String targetDatabaseName = connectionSettings == null ? "未解析" : connectionSettings.targetDatabaseName();
            log.error(
                "数据库自动创建失败，应用停止启动: database={}, exceptionType={}, sqlState={}",
                targetDatabaseName,
                exception.getClass().getSimpleName(),
                findSqlState(exception)
            );
            throw new IllegalStateException("数据库自动创建失败，请检查PostgreSQL管理数据库连接、配置和CREATEDB权限", exception);
        }
    }

    /**
     * 从已解析的Spring环境构建数据库连接参数。
     *
     * @param environment Environment Spring配置环境
     * @return DatabaseConnectionSettings 目标数据库和管理数据库连接参数
     */
    private DatabaseConnectionSettings resolveConnectionSettings(Environment environment) {
        String datasourceJdbcUrl = requireTextProperty(environment, DATASOURCE_URL_PROPERTY);
        String username = requireTextProperty(environment, DATASOURCE_USERNAME_PROPERTY);
        String password = requireProperty(environment, DATASOURCE_PASSWORD_PROPERTY);
        String administratorDatabaseName = requireTextProperty(environment, ADMINISTRATOR_DATABASE_PROPERTY);
        URI datasourceUri = parsePostgresqlJdbcUri(datasourceJdbcUrl);
        String targetDatabaseName = extractDatabaseName(datasourceUri);

        validateDatabaseName(targetDatabaseName, "目标数据库名称");
        validateDatabaseName(administratorDatabaseName, "管理数据库名称");
        return new DatabaseConnectionSettings(
            targetDatabaseName,
            createAdministratorJdbcUrl(datasourceUri, administratorDatabaseName),
            username,
            password
        );
    }

    /**
     * 获取不能为空白的配置值。
     *
     * @param environment Environment Spring配置环境
     * @param propertyName String 配置键名称
     * @return String 去除首尾空白后的配置值
     */
    private String requireTextProperty(Environment environment, String propertyName) {
        String propertyValue = environment.getProperty(propertyName);
        if (!StringUtils.hasText(propertyValue)) {
            throw new IllegalArgumentException("缺少必填数据库配置: " + propertyName);
        }
        return propertyValue.trim();
    }

    /**
     * 获取允许为空字符串的配置值。
     *
     * @param environment Environment Spring配置环境
     * @param propertyName String 配置键名称
     * @return String 原始配置值
     */
    private String requireProperty(Environment environment, String propertyName) {
        String propertyValue = environment.getProperty(propertyName);
        if (propertyValue == null) {
            throw new IllegalArgumentException("缺少必填数据库配置: " + propertyName);
        }
        return propertyValue;
    }

    /**
     * 解析当前项目支持的PostgreSQL JDBC连接地址。
     *
     * @param jdbcUrl String JDBC连接地址
     * @return URI PostgreSQL连接地址对象
     */
    private URI parsePostgresqlJdbcUri(String jdbcUrl) {
        if (!jdbcUrl.startsWith(POSTGRESQL_JDBC_URL_PREFIX)) {
            throw new IllegalArgumentException("仅支持jdbc:postgresql://格式的数据源连接地址");
        }
        try {
            URI datasourceUri = new URI(jdbcUrl.substring("jdbc:".length()));
            if (!StringUtils.hasText(datasourceUri.getHost())) {
                throw new IllegalArgumentException("PostgreSQL数据源连接地址缺少主机名");
            }
            return datasourceUri;
        } catch (URISyntaxException exception) {
            throw new IllegalArgumentException("PostgreSQL数据源连接地址格式不合法", exception);
        }
    }

    /**
     * 从PostgreSQL连接地址提取目标数据库名称。
     *
     * @param datasourceUri URI PostgreSQL数据源连接地址
     * @return String 目标数据库名称
     */
    private String extractDatabaseName(URI datasourceUri) {
        String path = datasourceUri.getPath();
        if (!StringUtils.hasText(path) || "/".equals(path) || !path.startsWith("/") || path.indexOf('/', 1) >= 0) {
            throw new IllegalArgumentException("PostgreSQL数据源连接地址必须包含单个目标数据库名称");
        }
        return path.substring(1);
    }

    /**
     * 使用当前数据源的主机、端口和查询参数构造管理数据库连接地址。
     *
     * @param datasourceUri URI PostgreSQL数据源连接地址
     * @param administratorDatabaseName String PostgreSQL管理数据库名称
     * @return String 管理数据库JDBC连接地址
     */
    private String createAdministratorJdbcUrl(URI datasourceUri, String administratorDatabaseName) {
        try {
            URI administratorUri = new URI(
                datasourceUri.getScheme(),
                datasourceUri.getUserInfo(),
                datasourceUri.getHost(),
                datasourceUri.getPort(),
                "/" + administratorDatabaseName,
                datasourceUri.getQuery(),
                datasourceUri.getFragment()
            );
            return "jdbc:" + administratorUri;
        } catch (URISyntaxException exception) {
            throw new IllegalArgumentException("PostgreSQL管理数据库连接地址构建失败", exception);
        }
    }

    /**
     * 校验数据库名称可安全作为单个PostgreSQL标识符使用。
     *
     * @param databaseName String 数据库名称
     * @param description String 配置说明
     * @return void 无返回值
     */
    private void validateDatabaseName(String databaseName, String description) {
        if (!StringUtils.hasText(databaseName)
            || databaseName.indexOf('\0') >= 0
            || databaseName.indexOf('/') >= 0
            || databaseName.indexOf('?') >= 0
            || databaseName.indexOf('#') >= 0) {
            throw new IllegalArgumentException(description + "不合法");
        }
    }

    /**
     * 连接管理数据库并在目标数据库不存在时创建它。
     *
     * @param connectionSettings DatabaseConnectionSettings 数据库连接参数
     * @return void 无返回值
     * @throws SQLException 建库查询或创建执行失败时抛出
     */
    private void createDatabaseIfAbsent(DatabaseConnectionSettings connectionSettings) throws SQLException {
        try (Connection connection = DriverManager.getConnection(
            connectionSettings.administratorJdbcUrl(),
            connectionSettings.username(),
            connectionSettings.password()
        )) {
            // PostgreSQL不允许在事务中执行CREATE DATABASE，确保连接使用自动提交模式。
            if (!connection.getAutoCommit()) {
                connection.setAutoCommit(true);
            }
            if (databaseExists(connection, connectionSettings.targetDatabaseName())) {
                log.info("目标数据库已存在，无需创建: database={}", connectionSettings.targetDatabaseName());
                return;
            }
            try {
                createDatabase(connection, connectionSettings.targetDatabaseName());
                log.info("已自动创建目标数据库: database={}", connectionSettings.targetDatabaseName());
            } catch (SQLException exception) {
                if (!isDatabaseAlreadyExists(exception)) {
                    throw exception;
                }
                // 多实例同时启动时，允许其他实例先完成同一个目标数据库创建。
                log.info("目标数据库已由其他实例创建: database={}", connectionSettings.targetDatabaseName());
            }
        }
    }

    /**
     * 查询目标数据库是否存在。
     *
     * @param connection Connection 管理数据库连接
     * @param targetDatabaseName String 目标数据库名称
     * @return boolean 目标数据库存在时返回true
     * @throws SQLException 查询执行失败时抛出
     */
    private boolean databaseExists(Connection connection, String targetDatabaseName) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement(
            "SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = ?)"
        )) {
            statement.setString(1, targetDatabaseName);
            try (ResultSet resultSet = statement.executeQuery()) {
                if (!resultSet.next()) {
                    throw new SQLException("PostgreSQL数据库存在性查询未返回结果");
                }
                return resultSet.getBoolean(1);
            }
        }
    }

    /**
     * 创建目标数据库。
     *
     * @param connection Connection 管理数据库连接
     * @param targetDatabaseName String 目标数据库名称
     * @return void 无返回值
     * @throws SQLException 建库执行失败时抛出
     */
    private void createDatabase(Connection connection, String targetDatabaseName) throws SQLException {
        try (Statement statement = connection.createStatement()) {
            statement.execute("CREATE DATABASE " + quoteIdentifier(targetDatabaseName));
        }
    }

    /**
     * 判断异常是否表示目标数据库已被其他实例创建。
     *
     * @param exception SQLException 数据库异常
     * @return boolean 数据库已存在时返回true
     */
    private boolean isDatabaseAlreadyExists(SQLException exception) {
        return DATABASE_ALREADY_EXISTS_SQL_STATE.equals(exception.getSQLState());
    }

    /**
     * 转义PostgreSQL标识符，避免数据库名称参与SQL拼接时改变语义。
     *
     * @param identifier String PostgreSQL标识符
     * @return String 双引号包裹且完成转义的标识符
     */
    private String quoteIdentifier(String identifier) {
        return '"' + identifier.replace("\"", "\"\"") + '"';
    }

    /**
     * 从异常链中提取最接近的SQL状态码。
     *
     * @param exception Throwable 原始异常
     * @return String SQL状态码；不存在时返回未知
     */
    private String findSqlState(Throwable exception) {
        Throwable currentException = exception;
        while (currentException != null) {
            if (currentException instanceof SQLException sqlException) {
                return sqlException.getSQLState() == null ? "未知" : sqlException.getSQLState();
            }
            currentException = currentException.getCause();
        }
        return "未知";
    }

    /**
     * 数据库创建所需的已解析连接参数。
     *
     * @param targetDatabaseName String 目标数据库名称
     * @param administratorJdbcUrl String 管理数据库JDBC连接地址
     * @param username String PostgreSQL用户名
     * @param password String PostgreSQL密码
     */
    private record DatabaseConnectionSettings(
        String targetDatabaseName,
        String administratorJdbcUrl,
        String username,
        String password
    ) {
    }
}
