package com.novanovastudio.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * @title        CreditDtos.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  积分相关DTO
 * @createTime   2026-07-16 14:00:00
 */
public final class CreditDtos {

    /**
     * 禁止实例化
     */
    private CreditDtos() {
    }

    /**
     * 积分设置响应。
     *
     * @param initialCredits Integer 新用户初始积分
     */
    public record CreditSettingsResponse(Integer initialCredits) {
    }

    /**
     * 修改积分设置请求。
     *
     * @param initialCredits Integer 新用户初始积分
     */
    public record UpdateCreditSettingsRequest(@NotNull(message = "初始积分不能为空") @Min(value = 0, message = "初始积分不能小于0") Integer initialCredits) {
    }

    /**
     * 管理员调整用户积分请求。
     *
     * @param userId Long 用户ID
     * @param changeAmount Integer 积分变动值，正数增加、负数扣减
     * @param reason String 调整原因
     */
    public record AdjustUserCreditsRequest(@NotNull(message = "用户ID不能为空") Long userId,
                                           @NotNull(message = "积分变动值不能为空") Integer changeAmount,
                                           @NotBlank(message = "调整原因不能为空") @Size(max = 200, message = "调整原因不能超过200个字符") String reason) {
    }

    /**
     * 用户积分余额响应。
     *
     * @param userId Long 用户ID
     * @param creditBalance Integer 可用积分
     */
    public record CreditBalanceResponse(Long userId, Integer creditBalance) {
    }

    /**
     * 积分消耗分布项。
     *
     * @param name String 分组名称
     * @param consumedCredits Long 消耗积分
     */
    public record CreditDistributionItem(String name, Long consumedCredits) {
    }

    /**
     * 积分消耗趋势项。
     *
     * @param period String 日或月周期
     * @param consumedCredits Long 消耗积分
     */
    public record CreditTrendItem(String period, Long consumedCredits) {
    }

    /**
     * 用户积分消耗概览响应。
     *
     * @param generationTypeDistribution List<CreditDistributionItem> 图片与视频消耗分布
     * @param modelDistribution List<CreditDistributionItem> 模型消耗分布
     * @param trend List<CreditTrendItem> 日或月消耗趋势
     */
    public record CreditOverviewResponse(List<CreditDistributionItem> generationTypeDistribution,
                                         List<CreditDistributionItem> modelDistribution,
                                         List<CreditTrendItem> trend) {
    }

    /**
     * 用户积分消耗明细项。
     *
     * @param id Long 流水ID
     * @param generationType String 图片或视频任务类型
     * @param model String 实际使用模型
     * @param generationSource String 发起生成的页面来源，可为空
     * @param consumedCredits Long 实际扣除积分
     * @param createdAt String 扣费时间
     */
    public record CreditTransactionItem(Long id,
                                        String generationType,
                                        String model,
                                        String generationSource,
                                        Long consumedCredits,
                                        String createdAt) {
    }

    /**
     * 用户积分消耗明细列表响应。
     *
     * @param transactions List<CreditTransactionItem> 当前页明细
     * @param total Long 符合筛选条件的总数
     */
    public record CreditTransactionListResponse(List<CreditTransactionItem> transactions, Long total) {
    }

    /**
     * 管理员积分消耗明细项。
     *
     * @param id Long 流水ID
     * @param userId Long 用户ID
     * @param username String 用户名
     * @param nickname String 用户昵称，可为空
     * @param email String 用户邮箱
     * @param generationType String 图片或视频任务类型
     * @param model String 实际使用模型
     * @param generationSource String 发起生成的页面来源，可为空
     * @param consumedCredits Long 实际扣除积分
     * @param createdAt String 扣费时间
     */
    public record AdminCreditTransactionItem(Long id,
                                             Long userId,
                                             String username,
                                             String nickname,
                                             String email,
                                             String generationType,
                                             String model,
                                             String generationSource,
                                             Long consumedCredits,
                                             String createdAt) {
    }

    /**
     * 管理员积分消耗明细列表响应。
     *
     * @param transactions List<AdminCreditTransactionItem> 当前页明细
     * @param total Long 符合筛选条件的总数
     */
    public record AdminCreditTransactionListResponse(List<AdminCreditTransactionItem> transactions, Long total) {
    }
}
