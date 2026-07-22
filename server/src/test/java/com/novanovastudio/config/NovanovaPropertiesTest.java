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
        Assertions.assertEquals(300, task.getLockTtlSeconds());
        Assertions.assertEquals(60, task.getLockRenewSeconds());
        Assertions.assertEquals(300, task.getPendingClaimIdleSeconds());
        Assertions.assertEquals(900, task.getRunningRecoverSeconds());
    }
}
