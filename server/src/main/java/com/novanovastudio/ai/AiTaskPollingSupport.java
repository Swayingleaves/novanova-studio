package com.novanovastudio.ai;

import com.alibaba.fastjson2.JSONObject;
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

    /**
     * 按任务类型获取平台配置的等待超时时长。
     *
     * @param properties NovanovaProperties 服务配置
     * @param taskType String 任务类型
     * @return Duration 任务等待超时时长
     */
    public static Duration taskWaitTimeout(NovanovaProperties properties, String taskType) {
        if (properties == null || properties.timeoutSettings() == null) {
            throw new IllegalStateException("异步AI任务超时配置不能为空");
        }
        int timeoutSeconds = AiTaskTypes.VIDEO.equals(taskType)
                ? properties.timeoutSettings().videoTaskWaitTimeoutSeconds()
                : properties.timeoutSettings().taskWaitTimeoutSeconds();
        if (timeoutSeconds < 1) {
            throw new IllegalStateException("异步AI任务等待超时必须大于0秒");
        }
        return Duration.ofSeconds(timeoutSeconds);
    }

    /**
     * 根据平台任务等待超时和统一轮询间隔计算最大轮询次数，保证供应商轮询与等待超时一致。
     *
     * @param properties NovanovaProperties 服务配置
     * @param taskType String 任务类型
     * @return int 最大轮询次数
     */
    public static int maxPollingAttempts(NovanovaProperties properties, String taskType) {
        long timeoutSeconds = taskWaitTimeout(properties, taskType).toSeconds();
        int intervalSeconds = pollingIntervalSeconds(properties);
        return (int) Math.max(1L, (timeoutSeconds + intervalSeconds - 1) / intervalSeconds);
    }

    /**
     * 读取渠道响应中的进度字段，兼容数字、小数和带百分号的字符串，读取不到时返回兜底进度。
     *
     * @param response JSONObject 渠道查询响应
     * @param fallback int 兜底进度
     * @return int 规范化后的进度（0 到 99）
     */
    public static int readProgress(JSONObject response, int fallback) {
        Integer parsed = parseProgressValue(response == null ? null : response.get("progress"));
        if (parsed == null && response != null) {
            JSONObject data = response.getJSONObject("data");
            parsed = parseProgressValue(data == null ? null : data.get("progress"));
        }
        int value = parsed == null ? fallback : parsed;
        return Math.max(0, Math.min(99, value));
    }

    /**
     * 解析单个进度值。
     *
     * @param value Object 原始进度值
     * @return Integer 整数进度，无法解析时返回空
     */
    private static Integer parseProgressValue(Object value) {
        if (value instanceof Number number) {
            return (int) Math.round(number.doubleValue());
        }
        if (value instanceof String text) {
            String normalized = text.trim();
            if (normalized.endsWith("%")) {
                normalized = normalized.substring(0, normalized.length() - 1).trim();
            }
            if (normalized.isEmpty()) {
                return null;
            }
            try {
                return (int) Math.round(Double.parseDouble(normalized));
            } catch (NumberFormatException ignored) {
                return null;
            }
        }
        return null;
    }
}
