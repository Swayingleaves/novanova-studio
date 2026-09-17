package com.novanovastudio.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import java.util.List;

/**
 * 每日签到相关数据结构。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-09-17 10:30
 */
public final class CheckInDtos {

    /**
     * 禁止实例化。
     */
    private CheckInDtos() {
    }

    /**
     * 当前用户签到状态。
     *
     * @param today 服务端今天日期（Asia/Shanghai）
     * @param checkedInToday 今天是否已签到
     * @param monthCheckedCount 查询月份已签到天数
     * @param monthCheckedDates 查询月份已签到日期，格式 yyyy-MM-dd
     * @param dailyCredits 当前配置的每日签到积分
     * @param todayCredits 今天实际获得的积分，今天未签到时为0
     */
    public record CheckInStatusResponse(String today,
                                        boolean checkedInToday,
                                        int monthCheckedCount,
                                        List<String> monthCheckedDates,
                                        int dailyCredits,
                                        int todayCredits) {
    }

    /**
     * 签到结果。
     *
     * @param checkInDate 签到日期，格式 yyyy-MM-dd
     * @param earnedCredits 本次签到获得的积分
     * @param creditBalance 签到后的可用积分余额
     */
    public record CheckInResultResponse(String checkInDate,
                                        int earnedCredits,
                                        int creditBalance) {
    }

    /**
     * 签到积分设置。
     *
     * @param checkInCredits 每日签到积分
     */
    public record CheckInRewardSettingsResponse(int checkInCredits) {
    }

    /**
     * 更新签到积分设置请求。
     *
     * @param checkInCredits 每日签到积分
     */
    public record UpdateCheckInRewardSettingsRequest(
            @NotNull(message = "每日签到积分不能为空")
            @Min(value = 0, message = "每日签到积分不能小于0") Integer checkInCredits) {
    }
}
