package com.novanovastudio.config;

import java.io.IOException;
import java.net.ServerSocket;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import org.springframework.context.support.GenericApplicationContext;
import org.springframework.mock.env.MockEnvironment;

/**
 * 数据库启动前创建器单元测试。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-07-22 21:13:16
 */
class DatabaseBootstrapInitializerTest {

    /**
     * 测试非PostgreSQL JDBC地址会在建立连接前终止启动。
     *
     * @return void 无返回值
     */
    @Test
    void shouldStopForUnsupportedJdbcUrl() {
        String password = "unsupported-jdbc-password";

        IllegalStateException exception = Assertions.assertThrows(
            IllegalStateException.class,
            () -> initialize("jdbc:mysql://127.0.0.1:3306/novanova_studio", password)
        );

        Assertions.assertFalse(exception.getMessage().contains(password));
    }

    /**
     * 测试管理数据库不可达时会终止启动且异常信息不暴露密码。
     *
     * @return void 无返回值
     * @throws IOException 本地端口预留失败时抛出
     */
    @Test
    void shouldStopWhenAdministratorDatabaseCannotBeReached() throws IOException {
        String password = "unreachable-database-password";
        int unavailablePort = reserveUnavailablePort();

        IllegalStateException exception = Assertions.assertThrows(
            IllegalStateException.class,
            () -> initialize(
                "jdbc:postgresql://127.0.0.1:" + unavailablePort + "/novanova_studio?connectTimeout=1",
                password
            )
        );

        Assertions.assertFalse(exception.getMessage().contains(password));
    }

    /**
     * 使用指定数据源地址调用数据库启动前创建器。
     *
     * @param datasourceUrl String 数据源JDBC连接地址
     * @param password String PostgreSQL密码
     * @return void 无返回值
     */
    private void initialize(String datasourceUrl, String password) {
        GenericApplicationContext applicationContext = new GenericApplicationContext();
        MockEnvironment environment = new MockEnvironment()
            .withProperty("spring.datasource.url", datasourceUrl)
            .withProperty("spring.datasource.username", "postgres")
            .withProperty("spring.datasource.password", password)
            .withProperty("novanova.database.administrator-database", "postgres");
        applicationContext.setEnvironment(environment);
        new DatabaseBootstrapInitializer().initialize(applicationContext);
    }

    /**
     * 获取一个已释放的本地端口，用于构造不可达连接地址。
     *
     * @return int 已释放端口号
     * @throws IOException 本地端口预留失败时抛出
     */
    private int reserveUnavailablePort() throws IOException {
        try (ServerSocket serverSocket = new ServerSocket(0)) {
            return serverSocket.getLocalPort();
        }
    }
}
