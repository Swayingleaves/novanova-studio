package com.novanovastudio.config;

import com.alibaba.fastjson2.JSONWriter;
import com.alibaba.fastjson2.support.config.FastJsonConfig;
import com.alibaba.fastjson2.support.spring6.codec.Fastjson2Decoder;
import com.alibaba.fastjson2.support.spring6.codec.Fastjson2Encoder;
import com.novanovastudio.common.JsonData;
import java.nio.charset.StandardCharsets;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.web.codec.CodecCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.MediaType;
import org.springframework.data.redis.connection.ReactiveRedisConnectionFactory;
import org.springframework.data.redis.core.ReactiveStringRedisTemplate;
import org.springframework.data.redis.listener.ReactiveRedisMessageListenerContainer;
import org.springframework.data.redis.serializer.RedisSerializationContext;
import org.springframework.data.redis.serializer.StringRedisSerializer;
import org.springframework.r2dbc.connection.R2dbcTransactionManager;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.ReactiveTransactionManager;
import org.springframework.transaction.reactive.TransactionalOperator;
import org.springframework.web.reactive.function.client.WebClient;

/**
 * @title        ApplicationConfiguration.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  应用基础Bean配置
 * @createTime   2026-06-24 10:42:00
 */
@Configuration
@EnableConfigurationProperties(NovanovaProperties.class)
public class ApplicationConfiguration {

    /**
     * 创建BCrypt密码编码器
     *
     * @return PasswordEncoder 密码编码器
     */
    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    /**
     * 创建JSON工具
     *
     * @return JsonData JSON工具
     */
    @Bean
    public JsonData jsonData() {
        return new JsonData();
    }

    /**
     * 创建响应式事务管理器
     *
     * @param connectionFactory io.r2dbc.spi.ConnectionFactory R2DBC连接工厂
     * @return ReactiveTransactionManager 响应式事务管理器
     */
    @Bean
    public ReactiveTransactionManager reactiveTransactionManager(io.r2dbc.spi.ConnectionFactory connectionFactory) {
        // R2DBC仓储使用该事务管理器处理注册等需要原子性的业务。
        return new R2dbcTransactionManager(connectionFactory);
    }

    /**
     * 创建响应式事务操作器
     *
     * @param transactionManager ReactiveTransactionManager 响应式事务管理器
     * @return TransactionalOperator 响应式事务操作器
     */
    @Bean
    public TransactionalOperator transactionalOperator(ReactiveTransactionManager transactionManager) {
        // 在仓储和服务中通过TransactionalOperator包裹响应式事务。
        return TransactionalOperator.create(transactionManager);
    }

    /**
     * 创建Fastjson2响应式编解码配置
     *
     * @return CodecCustomizer 编解码自定义器
     */
    @Bean
    public CodecCustomizer fastjson2CodecCustomizer() {
        // 将Fastjson2编解码器注册到WebFlux，保证请求和响应优先使用Fastjson2序列化。
        return configurer -> {
            FastJsonConfig fastJsonConfig = new FastJsonConfig();
            fastJsonConfig.setCharset(StandardCharsets.UTF_8);
            fastJsonConfig.setWriterFeatures(JSONWriter.Feature.WriteMapNullValue);
            configurer.customCodecs().registerWithDefaultConfig(new Fastjson2Encoder(fastJsonConfig, MediaType.APPLICATION_JSON, new MediaType("application", "*+json")));
            configurer.customCodecs().registerWithDefaultConfig(new Fastjson2Decoder(fastJsonConfig, MediaType.APPLICATION_JSON, new MediaType("application", "*+json")));
        };
    }

    /**
     * 创建响应式字符串Redis模板
     *
     * @param connectionFactory ReactiveRedisConnectionFactory Redis连接工厂
     * @return ReactiveStringRedisTemplate 字符串Redis模板
     */
    @Bean
    public ReactiveStringRedisTemplate reactiveStringRedisTemplate(ReactiveRedisConnectionFactory connectionFactory) {
        // AI任务队列和事件分发使用统一的字符串序列化策略。
        RedisSerializationContext<String, String> context = RedisSerializationContext.<String, String>newSerializationContext(new StringRedisSerializer())
                .key(new StringRedisSerializer())
                .value(new StringRedisSerializer())
                .hashKey(new StringRedisSerializer())
                .hashValue(new StringRedisSerializer())
                .build();
        return new ReactiveStringRedisTemplate(connectionFactory, context);
    }

    /**
     * 创建响应式Redis消息监听容器
     *
     * @param connectionFactory ReactiveRedisConnectionFactory Redis连接工厂
     * @return ReactiveRedisMessageListenerContainer Redis消息监听容器
     */
    @Bean
    public ReactiveRedisMessageListenerContainer reactiveRedisMessageListenerContainer(ReactiveRedisConnectionFactory connectionFactory) {
        // 通过响应式监听容器订阅AI任务Pub/Sub消息。
        return new ReactiveRedisMessageListenerContainer(connectionFactory);
    }

    /**
     * 创建WebClient构建器
     *
     * @return WebClient.Builder WebClient构建器
     */
    @Bean
    public WebClient.Builder webClientBuilder() {
        // 统一为外部HTTP调用提供可复用的WebClient构建器。
        return WebClient.builder();
    }
}
