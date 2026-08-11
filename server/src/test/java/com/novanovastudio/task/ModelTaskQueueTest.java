package com.novanovastudio.task;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

/**
 * @title        ModelTaskQueueTest.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  模型任务队列键测试
 * @createTime   2026-08-10 00:00:00
 */
class ModelTaskQueueTest {

    /**
     * 模型队列键应按模型配置ID隔离。
     */
    @Test
    void shouldBuildIsolatedModelQueueKeys() {
        Assertions.assertEquals("novanova:ai-task:model-queue:{model-1}:pending", ModelTaskQueue.pendingQueueKey("model-1"));
        Assertions.assertEquals("novanova:ai-task:model-queue:{model-1}:queued", ModelTaskQueue.queuedTaskKey("model-1"));
        Assertions.assertEquals("novanova:ai-task:model-queue:{model-1}:active", ModelTaskQueue.activeTaskKey("model-1"));
        Assertions.assertEquals("novanova:ai-task:model-queue:{model-1}:request-concurrency", ModelTaskQueue.requestConcurrencyKey("model-1"));
        Assertions.assertNotEquals(ModelTaskQueue.pendingQueueKey("model-1"), ModelTaskQueue.pendingQueueKey("model-2"));
    }
}
