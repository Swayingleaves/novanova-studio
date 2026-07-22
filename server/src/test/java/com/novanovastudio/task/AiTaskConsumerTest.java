package com.novanovastudio.task;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

/**
 * @title        AiTaskConsumerTest.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  AI任务消费者测试
 * @createTime   2026-06-29 11:08:00
 */
class AiTaskConsumerTest {

    /**
     * 测试消费者名称包含实例前缀。
     *
     * @return void 无返回值
     */
    @Test
    void shouldBuildConsumerNameWithPrefix() {
        // 消费者名称必须可区分不同实例，方便Redis消费组追踪。
        String consumerName = AiTaskConsumer.buildConsumerName("host", 1234L, "abc");

        Assertions.assertEquals("host-1234-abc", consumerName);
    }
}
