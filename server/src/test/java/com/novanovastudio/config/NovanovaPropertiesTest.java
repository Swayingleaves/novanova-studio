package com.novanovastudio.config;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

/**
 * @title        NovanovaPropertiesTest.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  Novanova配置属性测试
 * @createTime   2026-06-29 10:55:00
 */
class NovanovaPropertiesTest {

    /** 验证邮箱白名单配置可以绑定，显式空值保留不限注册的语义。 */
    @Test
    void shouldBindEmailRegistrationWhitelist() {
        var source = new org.springframework.boot.context.properties.source.MapConfigurationPropertySource(
                java.util.Map.of("novanova.email.allowed-suffixes", "@qq.com,gmail.com"));
        var binder = new org.springframework.boot.context.properties.bind.Binder(source);
        NovanovaProperties properties = binder.bind("novanova", NovanovaProperties.class).get();
        Assertions.assertEquals("@qq.com,gmail.com", properties.getEmail().getAllowedSuffixes());
        source.put("novanova.email.allowed-suffixes", "");
        Assertions.assertEquals("", binder.bind("novanova", NovanovaProperties.class).get().getEmail().getAllowedSuffixes());
    }

    /**
     * 测试AI任务队列配置默认值。
     *
     * @return void 无返回值
     */
    @Test
    void shouldProvideAiTaskQueueDefaults() {
        // 默认配置必须可直接启动本地任务消费者。
        NovanovaProperties properties = new NovanovaProperties();
        NovanovaProperties.Ai.Task task = properties.getAi().getTask();

        Assertions.assertEquals("novanova:ai-task:stream", task.getStreamKey());
        Assertions.assertEquals("novanova-ai-task-consumer", task.getConsumerGroup());
        Assertions.assertEquals(4, task.getConsumerConcurrency());
        Assertions.assertEquals(4, task.getReadBatchSize());
        Assertions.assertEquals(5, task.getReadBlockSeconds());
        Assertions.assertEquals(3, task.getPollingIntervalSeconds());
        Assertions.assertEquals(300, task.getLockTtlSeconds());
        Assertions.assertEquals(60, task.getLockRenewSeconds());
        Assertions.assertEquals(300, task.getPendingClaimIdleSeconds());
        Assertions.assertEquals(900, task.getRunningRecoverSeconds());
    }

    /**
     * 测试腾讯云COS重试与读取超时配置默认值和修改能力。
     */
    @Test
    void shouldConfigureTencentCosRetryAndSocketTimeout() {
        NovanovaProperties properties = new NovanovaProperties();
        NovanovaProperties.ObjectStorage.TencentCos tencentCos = properties.getObjectStorage().getTencentCos();

        Assertions.assertEquals(3, tencentCos.getMaxErrorRetry());

        tencentCos.setMaxErrorRetry(5);

        Assertions.assertEquals(5, tencentCos.getMaxErrorRetry());
    }

    /**
     * 测试运行时超时快照的默认值，以及被平台设置覆盖后的读取结果。
     */
    @Test
    void shouldReplaceRuntimeTimeoutSettings() {
        NovanovaProperties properties = new NovanovaProperties();
        NovanovaProperties.RuntimeTimeouts defaults = properties.timeoutSettings();

        Assertions.assertEquals(60, defaults.aiRequestBodyTimeoutSeconds());
        Assertions.assertEquals(600, defaults.storyboardAgentTimeoutSeconds());
        Assertions.assertEquals(600, defaults.scriptAgentTimeoutSeconds());
        Assertions.assertEquals(600, defaults.storyBibleAgentTimeoutSeconds());
        Assertions.assertEquals(300, defaults.taskWaitTimeoutSeconds());
        Assertions.assertEquals(900, defaults.videoTaskWaitTimeoutSeconds());
        Assertions.assertEquals(1800, defaults.videoCompositionExecutionTimeoutSeconds());
        Assertions.assertEquals(120_000, defaults.tencentCosSocketTimeoutMilliseconds());

        properties.replaceTimeoutSettings(new NovanovaProperties.RuntimeTimeouts(30, 180, 180, 180, 120, 600, 900, 60_000));

        Assertions.assertEquals(30, properties.timeoutSettings().aiRequestBodyTimeoutSeconds());
        Assertions.assertEquals(60_000, properties.timeoutSettings().tencentCosSocketTimeoutMilliseconds());
    }
}
