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

    /** 邮件服务快照来自管理后台，默认白名单与迁移一致，日志不能带出授权码。 */
    @Test
    void shouldReplaceRuntimeEmailSettingsWithoutExposingPassword() {
        NovanovaProperties properties = new NovanovaProperties();
        Assertions.assertEquals(NovanovaProperties.RuntimeEmailSettings.DEFAULT_ALLOWED_SUFFIXES, properties.emailSettings().allowedSuffixes());
        Assertions.assertEquals(465, properties.emailSettings().smtpPort());
        Assertions.assertFalse(properties.emailSettings().configured());

        properties.replaceEmailSettings(properties.emailSettings().withSmtpHost("smtp.example.com").withFromEmail("noreply@example.com")
                .withAllowedSuffixes(""));
        NovanovaProperties.RuntimeEmailSettings settings = new NovanovaProperties.RuntimeEmailSettings("smtp.example.com", 465, "user", "secret-auth", "noreply@example.com", "");
        properties.replaceEmailSettings(settings);

        Assertions.assertEquals("", properties.emailSettings().allowedSuffixes());
        Assertions.assertTrue(properties.emailSettings().configured());
        Assertions.assertEquals("secret-auth", properties.emailSettings().smtpPassword());
        Assertions.assertFalse(properties.emailSettings().toString().contains("secret-auth"));
        properties.replaceEmailSettings(null);
        Assertions.assertEquals(NovanovaProperties.RuntimeEmailSettings.DEFAULT_ALLOWED_SUFFIXES, properties.emailSettings().allowedSuffixes());
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
