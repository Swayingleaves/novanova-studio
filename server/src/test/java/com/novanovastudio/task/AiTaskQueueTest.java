package com.novanovastudio.task;

import io.lettuce.core.RedisBusyException;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.RedisSystemException;

/**
 * @title        AiTaskQueueTest.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  AI任务队列测试
 * @createTime   2026-06-29 13:15:00
 */
class AiTaskQueueTest {

    /**
     * 测试识别Spring包装后的消费组已存在异常。
     *
     * @return void 无返回值
     */
    @Test
    void shouldDetectWrappedBusyGroupException() {
        // Lettuce的BUSYGROUP会被Spring包装，必须递归读取cause才能识别重启场景。
        RedisBusyException busyException = new RedisBusyException("BUSYGROUP Consumer Group name already exists");
        RedisSystemException exception = new RedisSystemException("Error in execution", busyException);

        Assertions.assertTrue(AiTaskQueue.isConsumerGroupExistsException(exception));
    }
}
