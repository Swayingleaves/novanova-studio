package com.novanovastudio.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;

/**
 * 平台模型调用成功率统计配置与展示数据传输对象。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-24 09:25:00
 */
public final class ModelStatsDtos {

    /**
     * 禁止实例化。
     */
    private ModelStatsDtos() {
    }

    /**
     * 模型成功率统计配置响应。
     *
     * @param successRateWindowDays 模型成功率统计天数（1 至 365 天）
     */
    public record ModelStatsSettings(int successRateWindowDays) {
    }

    /**
     * 保存模型成功率统计配置请求。
     *
     * @param successRateWindowDays 模型成功率统计天数（1 至 365 天）
     */
    public record SaveModelStatsSettingsRequest(
            @NotNull(message = "统计天数不能为空")
            @Min(value = 1, message = "统计天数不能小于1天")
            @Max(value = 365, message = "统计天数不能大于365天")
            Integer successRateWindowDays) {
    }

    /**
     * 单个模型在最近统计窗口内的调用成功率快照。
     *
     * @param successRate 调用成功率百分比（0 至 100 的整数）
     * @param succeededCount 统计窗口内成功调用次数
     * @param totalCount 统计窗口内总调用次数（成功 + 失败）
     * @param windowDays 当前生效的统计天数窗口
     */
    public record ModelSuccessRateStats(int successRate, long succeededCount, long totalCount, int windowDays) {
    }
}
