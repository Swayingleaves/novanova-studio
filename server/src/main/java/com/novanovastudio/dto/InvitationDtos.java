package com.novanovastudio.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;

/**
 * 邀请注册相关数据结构。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-09-09 00:00
 */
public final class InvitationDtos {

    /**
     * 禁止实例化。
     */
    private InvitationDtos() {
    }

    /**
     * 当前用户邀请信息。
     *
     * @param invitationCode 用户唯一邀请码
     */
    public record InvitationInfoResponse(String invitationCode) {
    }

    /**
     * 邀请奖励设置。
     *
     * @param invitationRewardCredits 每名新用户注册后发给邀请人的积分
     */
    public record InvitationRewardSettingsResponse(Integer invitationRewardCredits) {
    }

    /**
     * 更新邀请奖励设置请求。
     *
     * @param invitationRewardCredits 每名新用户注册后发给邀请人的积分
     */
    public record UpdateInvitationRewardSettingsRequest(
            @NotNull(message = "邀请奖励积分不能为空")
            @Min(value = 0, message = "邀请奖励积分不能小于0") Integer invitationRewardCredits) {
    }
}

