package com.novanovastudio.config;

import com.novanovastudio.security.TeamScope;
import io.r2dbc.spi.Connection;
import io.r2dbc.spi.ConnectionFactory;
import io.r2dbc.spi.ConnectionFactoryMetadata;
import io.r2dbc.spi.Wrapped;
import org.reactivestreams.Publisher;
import org.springframework.beans.factory.config.BeanPostProcessor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 在连接借出时绑定团队上下文，数据库行级策略同时保护查询和写入。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-18 10:00
 */
@Configuration(proxyBeanMethods = false)
public class TeamDatabaseConfiguration {
    /**
     * 装饰连接工厂，事务管理器与仓储始终使用同一个连接资源。
     * @return 连接工厂后置处理器
     */
    @Bean
    public static BeanPostProcessor teamConnectionFactoryProcessor() {
        return new BeanPostProcessor() {
            /**
             * 为应用连接工厂安装团队隔离。
             * @param bean 已初始化组件
             * @param beanName 组件名称
             * @return 已隔离的组件
             */
            @Override
            public Object postProcessAfterInitialization(Object bean, String beanName) {
                return bean instanceof ConnectionFactory factory && !(bean instanceof ScopedConnectionFactory)
                        ? new ScopedConnectionFactory(factory) : bean;
            }
        };
    }

    /**
     * 借出连接时覆盖所有作用域参数，连接池复用不会继承上一次请求的权限。
     * @param delegate 原始连接工厂
     */
    public record ScopedConnectionFactory(ConnectionFactory delegate) implements ConnectionFactory, Wrapped<ConnectionFactory>, AutoCloseable {
        /**
         * 创建已经完成作用域初始化的连接。
         * @return 数据库连接
         */
        @Override
        public Publisher<? extends Connection> create() {
            return Mono.deferContextual(context -> Mono.from(delegate.create()).flatMap(connection -> {
                long filter = context.getOrDefault(TeamScope.FILTER_KEY, -1L);
                TeamScope scope = filter >= 0 ? new TeamScope(filter, "") : TeamScope.from(context);
                long wallet = context.getOrDefault(TeamScope.WALLET_KEY, 0L);
                boolean system = filter < 0 && context.getOrDefault(TeamScope.SYSTEM_KEY, false);
                // 应用登录用户即使是数据库超级用户，业务查询也切换到无绕过权限的角色。
                return execute(connection, "SET ROLE novanova_pro_runtime")
                        .then(Flux.from(connection.createStatement("SELECT set_config('novanova.team_id', $1, false), set_config('novanova.wallet_team_id', $2, false), set_config('novanova.system_access', $3, false), set_config('novanova.filter_team_id', $4, false), set_config('novanova.storage_snapshot', $5, false)")
                                .bind(0, Long.toString(scope.teamId())).bind(1, Long.toString(wallet)).bind(2, Boolean.toString(system)).bind(3, Long.toString(filter)).bind(4, context.getOrDefault(TeamScope.STORAGE_KEY, "")).execute())
                                .flatMap(result -> result.map((row, metadata) -> 1)).then())
                        .thenReturn(connection)
                        .onErrorResume(error -> Mono.from(connection.close()).then(Mono.error(error)));
            }));
        }

        /**
         * 消费初始化语句的全部结果。
         * @param connection 数据库连接
         * @param sql 初始化语句
         * @return 完成信号
         */
        private Mono<Void> execute(Connection connection, String sql) {
            return Flux.from(connection.createStatement(sql).execute()).flatMap(result -> result.getRowsUpdated()).then();
        }

        /** @return 原始连接工厂元数据 */
        @Override
        public ConnectionFactoryMetadata getMetadata() { return delegate.getMetadata(); }

        /** @return 原始连接工厂 */
        @Override
        public ConnectionFactory unwrap() { return delegate; }

        /**
         * 应用关闭时释放原始连接池。
         * @throws Exception 连接池关闭失败时抛出
         */
        @Override
        public void close() throws Exception {
            if (delegate instanceof AutoCloseable closeable) closeable.close();
            else if (delegate instanceof io.r2dbc.pool.ConnectionPool pool) pool.dispose();
        }
    }
}
