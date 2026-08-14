package com.novanovastudio.ai;

import com.novanovastudio.config.NovanovaProperties;
import java.time.Duration;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

/**
 * AI异步任务状态轮询支持测试。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-08-13 00:00
 */
class AiTaskPollingSupportTest {

    /**
     * 验证所有异步AI任务使用统一轮询间隔。
     *
     * @return void 无返回值
     */
    @Test
    void shouldUseConfiguredPollingInterval() {
        NovanovaProperties properties = new NovanovaProperties();
        properties.getAi().getTask().setPollingIntervalSeconds(8);

        Assertions.assertEquals(Duration.ofSeconds(8), AiTaskPollingSupport.pollingInterval(properties));
    }

    /**
     * 验证轮询间隔必须大于零。
     *
     * @return void 无返回值
     */
    @Test
    void shouldRejectNonPositivePollingInterval() {
        NovanovaProperties properties = new NovanovaProperties();
        properties.getAi().getTask().setPollingIntervalSeconds(0);

        Assertions.assertThrows(IllegalStateException.class, () -> AiTaskPollingSupport.pollingInterval(properties));
    }

    /**
     * 验证缺少配置对象时直接失败。
     *
     * @return void 无返回值
     */
    @Test
    void shouldRejectMissingPollingConfiguration() {
        Assertions.assertThrows(IllegalStateException.class, () -> AiTaskPollingSupport.pollingInterval(null));
    }

    /**
     * 验证所有异步任务状态查询可复用同一配置。
     *
     * @return void 无返回值
     */
    @Test
    void shouldExposeConfiguredPollingIntervalSeconds() {
        NovanovaProperties properties = new NovanovaProperties();
        properties.getAi().getTask().setPollingIntervalSeconds(6);

        Assertions.assertEquals(6, AiTaskPollingSupport.pollingIntervalSeconds(properties));
    }
}
