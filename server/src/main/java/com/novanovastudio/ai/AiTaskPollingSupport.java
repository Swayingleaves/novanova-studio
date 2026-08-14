package com.novanovastudio.ai;

import com.novanovastudio.config.NovanovaProperties;
import java.time.Duration;

/**
 * AI异步任务状态轮询支持。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-08-13 00:00
 */
public final class AiTaskPollingSupport {

    /**
     * 创建AI异步任务状态轮询支持工具。
     */
    private AiTaskPollingSupport() {
    }

    /**
     * 获取统一的异步AI任务状态轮询间隔。
     *
     * @param properties NovanovaProperties 服务配置
     * @return Duration 轮询间隔
     */
    public static Duration pollingInterval(NovanovaProperties properties) {
        return Duration.ofSeconds(pollingIntervalSeconds(properties));
    }

    /**
     * 获取统一的异步AI任务状态轮询间隔秒数。
     *
     * @param properties NovanovaProperties 服务配置
     * @return int 轮询间隔秒数
     */
    public static int pollingIntervalSeconds(NovanovaProperties properties) {
        if (properties == null || properties.getAi() == null || properties.getAi().getTask() == null) {
            throw new IllegalStateException("异步AI任务状态轮询配置不能为空");
        }
        int intervalSeconds = properties.getAi().getTask().getPollingIntervalSeconds();
        if (intervalSeconds < 1) {
            throw new IllegalStateException("异步AI任务状态轮询间隔必须大于0秒");
        }
        return intervalSeconds;
    }
}
