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

    /**
     * 验证最大轮询次数按任务类型对应的平台超时配置和轮询间隔向上取整计算。
     */
    @Test
    void shouldCalculateMaxPollingAttemptsFromTimeoutSettings() {
        NovanovaProperties properties = new NovanovaProperties();
        properties.getAi().getTask().setPollingIntervalSeconds(10);
        properties.replaceTimeoutSettings(new NovanovaProperties.RuntimeTimeouts(
                60, 600, 600, 600, 305, 900, 1800, 120_000));

        Assertions.assertEquals(Duration.ofSeconds(900),
                AiTaskPollingSupport.taskWaitTimeout(properties, AiTaskTypes.VIDEO));
        Assertions.assertEquals(90,
                AiTaskPollingSupport.maxPollingAttempts(properties, AiTaskTypes.VIDEO));
        Assertions.assertEquals(Duration.ofSeconds(305),
                AiTaskPollingSupport.taskWaitTimeout(properties, AiTaskTypes.IMAGE));
        Assertions.assertEquals(31,
                AiTaskPollingSupport.maxPollingAttempts(properties, AiTaskTypes.IMAGE));
    }
}
