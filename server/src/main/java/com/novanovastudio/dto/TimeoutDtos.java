package com.novanovastudio.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;

/**
 * 平台超时设置的请求和响应。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-10 01:50
 */
public final class TimeoutDtos {

    /** 以秒为单位的超时上限，24 小时。 */
    public static final int MAX_TIMEOUT_SECONDS = 86_400;

    /** 以毫秒为单位的超时上限，1 小时。 */
    public static final int MAX_TIMEOUT_MILLISECONDS = 3_600_000;

    private TimeoutDtos() {
    }

    /**
     * 全站超时设置。
     *
     * @param aiRequestBodyTimeoutSeconds AI构造请求体和提取媒体地址的超时秒数
     * @param storyboardAgentTimeoutSeconds 分镜 Agent 单次调用超时秒数
     * @param scriptAgentTimeoutSeconds 剧本 Agent 单次调用超时秒数
     * @param storyBibleAgentTimeoutSeconds 故事知识库 Agent 单次调用超时秒数
     * @param taskWaitTimeoutSeconds 图片等常规生成任务等待超时秒数
     * @param videoTaskWaitTimeoutSeconds 视频生成任务等待超时秒数
     * @param videoCompositionExecutionTimeoutSeconds 视频合成和音频裁剪执行超时秒数
     * @param tencentCosSocketTimeoutMilliseconds 腾讯云 COS 单次读取超时毫秒数
     */
    public record TimeoutSettings(
            @NotNull(message = "business.timeoutSecondsOutOfRange")
            @Min(value = 1, message = "business.timeoutSecondsOutOfRange")
            @Max(value = MAX_TIMEOUT_SECONDS, message = "business.timeoutSecondsOutOfRange")
            Integer aiRequestBodyTimeoutSeconds,
            @NotNull(message = "business.timeoutSecondsOutOfRange")
            @Min(value = 1, message = "business.timeoutSecondsOutOfRange")
            @Max(value = MAX_TIMEOUT_SECONDS, message = "business.timeoutSecondsOutOfRange")
            Integer storyboardAgentTimeoutSeconds,
            @NotNull(message = "business.timeoutSecondsOutOfRange")
            @Min(value = 1, message = "business.timeoutSecondsOutOfRange")
            @Max(value = MAX_TIMEOUT_SECONDS, message = "business.timeoutSecondsOutOfRange")
            Integer scriptAgentTimeoutSeconds,
            @NotNull(message = "business.timeoutSecondsOutOfRange")
            @Min(value = 1, message = "business.timeoutSecondsOutOfRange")
            @Max(value = MAX_TIMEOUT_SECONDS, message = "business.timeoutSecondsOutOfRange")
            Integer storyBibleAgentTimeoutSeconds,
            @NotNull(message = "business.timeoutSecondsOutOfRange")
            @Min(value = 1, message = "business.timeoutSecondsOutOfRange")
            @Max(value = MAX_TIMEOUT_SECONDS, message = "business.timeoutSecondsOutOfRange")
            Integer taskWaitTimeoutSeconds,
            @NotNull(message = "business.timeoutSecondsOutOfRange")
            @Min(value = 1, message = "business.timeoutSecondsOutOfRange")
            @Max(value = MAX_TIMEOUT_SECONDS, message = "business.timeoutSecondsOutOfRange")
            Integer videoTaskWaitTimeoutSeconds,
            @NotNull(message = "business.timeoutSecondsOutOfRange")
            @Min(value = 1, message = "business.timeoutSecondsOutOfRange")
            @Max(value = MAX_TIMEOUT_SECONDS, message = "business.timeoutSecondsOutOfRange")
            Integer videoCompositionExecutionTimeoutSeconds,
            @NotNull(message = "business.timeoutMillisecondsOutOfRange")
            @Min(value = 1, message = "business.timeoutMillisecondsOutOfRange")
            @Max(value = MAX_TIMEOUT_MILLISECONDS, message = "business.timeoutMillisecondsOutOfRange")
            Integer tencentCosSocketTimeoutMilliseconds) {
    }
}
