package com.novanovastudio.dto;

import com.alibaba.fastjson2.annotation.JSONField;
import com.novanovastudio.common.CreditAmountWriter;
import java.math.BigDecimal;

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
    public record InvitationRewardSettingsResponse(@jakarta.validation.constraints.Digits(integer = 18, fraction = 6) @JSONField(serializeUsing = CreditAmountWriter.class) BigDecimal invitationRewardCredits) {
    }

    /**
     * 更新邀请奖励设置请求。
     *
     * @param invitationRewardCredits 每名新用户注册后发给邀请人的积分
     */
    public record UpdateInvitationRewardSettingsRequest(
            @NotNull(message = "business.referralCreditsAreRequired")
            @Min(value = 0, message = "business.referralCreditsMustNotBeNegative") @jakarta.validation.constraints.Digits(integer = 18, fraction = 6) @JSONField(serializeUsing = CreditAmountWriter.class) BigDecimal invitationRewardCredits) {
    }
}
