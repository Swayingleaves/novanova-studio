package com.novanovastudio.task;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

/**
 * @title        RedisTaskLockTest.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  Redis任务锁测试
 * @createTime   2026-06-29 11:02:00
 */
class RedisTaskLockTest {

    /**
     * 测试任务锁键格式。
     *
     * @return void 无返回值
     */
    @Test
    void shouldBuildTaskLockKey() {
        // 锁键必须稳定，便于多实例对同一任务竞争同一把锁。
        Assertions.assertEquals("novanova:ai-task:lock:task-1", RedisTaskLock.lockKey("task-1"));
    }
}
