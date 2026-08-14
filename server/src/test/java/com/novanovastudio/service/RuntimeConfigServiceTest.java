package com.novanovastudio.service;

import com.novanovastudio.config.NovanovaProperties;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

/**
 * 服务端运行时配置服务测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-08-13 12:00:00
 */
class RuntimeConfigServiceTest {

    /**
     * 验证用户端读取的轮询间隔与服务端配置保持一致。
     *
     * @return void 无返回值
     */
    @Test
    void shouldReturnConfiguredAiTaskPollingInterval() {
        NovanovaProperties properties = new NovanovaProperties();
        properties.getAi().getTask().setPollingIntervalSeconds(7);

        Assertions.assertEquals(7, new RuntimeConfigService(properties).getRuntimeConfig().aiTaskPollingIntervalSeconds());
    }

    /**
     * 验证无效轮询间隔不会暴露给用户端。
     *
     * @return void 无返回值
     */
    @Test
    void shouldRejectInvalidAiTaskPollingInterval() {
        NovanovaProperties properties = new NovanovaProperties();
        properties.getAi().getTask().setPollingIntervalSeconds(0);

        Assertions.assertThrows(IllegalStateException.class, () -> new RuntimeConfigService(properties).getRuntimeConfig());
    }
}
