package com.novanovastudio.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.util.List;

/**
 * 积分卡密兑换相关数据传输对象。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-08-02 12:30
 */
public final class CreditCardDtos {

    /** 默认卡密生成数量。 */
    public static final int DEFAULT_QUANTITY = 100;

    /** 卡密生成数量上限。 */
    public static final int MAX_QUANTITY = 1000;

    private CreditCardDtos() {
    }

    /**
     * 用户兑换卡密请求。
     *
     * @param cardCode String 卡密明文
     */
    public record RedeemCreditsRequest(@NotBlank(message = "卡密不能为空") String cardCode) {
    }

    /**
     * 用户兑换结果。
     *
     * @param cardId Long 卡密ID
     * @param cardMasked String 脱敏卡密
     * @param credits Integer 本次兑换积分
     * @param creditBalance Integer 兑换后的积分余额
     * @param redeemedAt String 兑换时间
     */
    public record RedeemCreditsResponse(Long cardId, String cardMasked, Integer credits, Integer creditBalance, String redeemedAt) {
    }

    /**
     * 用户兑换记录。
     *
     * @param id Long 卡密ID
     * @param transactionId Long 积分流水ID
     * @param cardCode String 完整卡密，仅返回当前用户自己的兑换记录
     * @param cardMasked String 脱敏卡密
     * @param cardSuffix String 卡密末四位
     * @param credits Integer 兑换积分
     * @param balanceAfter Integer 兑换后的余额
     * @param redeemedAt String 兑换时间
     */
    public record RedemptionRecord(Long id, Long transactionId, String cardCode, String cardMasked, String cardSuffix,
                                   Integer credits, Integer balanceAfter, String redeemedAt) {
    }

    /**
     * 用户兑换记录列表。
     *
     * @param records List<RedemptionRecord> 兑换记录
     * @param total Long 记录总数
     */
    public record RedemptionRecordListResponse(List<RedemptionRecord> records, Long total) {
    }

    /**
     * 管理员生成卡密请求。
     *
     * @param quantity Integer 生成数量，默认100，最大1000
     * @param creditsPerCard Integer 单卡兑换积分
     */
    public record GenerateCreditCardsRequest(@Min(value = 1, message = "生成数量必须大于0") @Max(value = MAX_QUANTITY, message = "生成数量不能超过1000") Integer quantity,
                                             @NotNull(message = "单卡积分不能为空") @Min(value = 1, message = "单卡积分必须为正整数") Integer creditsPerCard) {
    }

    /**
     * 管理员生成卡密结果。
     *
     * @param batchId Long 批次ID
     * @param quantity Integer 生成数量
     * @param creditsPerCard Integer 单卡积分
     * @param cardCodes List<String> 卡密明文，每行一个
     * @param createdAt String 创建时间
     */
    public record GenerateCreditCardsResponse(Long batchId, Integer quantity, Integer creditsPerCard, List<String> cardCodes, String createdAt) {
    }

    /**
     * 卡密批次列表项。
     *
     * @param id Long 批次ID
     * @param quantity Integer 生成数量
     * @param creditsPerCard Integer 单卡积分
     * @param redeemedCount Integer 已兑换数量
     * @param availableCount Integer 未兑换数量
     * @param createdByUserId Long 创建管理员ID
     * @param createdByName String 创建管理员名称
     * @param createdByEmail String 创建管理员邮箱
     * @param createdAt String 创建时间
     */
    public record CreditCardBatch(Long id, Integer quantity, Integer creditsPerCard, Integer redeemedCount, Integer availableCount,
                                  Long createdByUserId, String createdByName, String createdByEmail, String createdAt) {
    }

    /**
     * 卡密批次分页响应。
     *
     * @param batches List<CreditCardBatch> 批次列表
     * @param total Long 总数量
     */
    public record CreditCardBatchListResponse(List<CreditCardBatch> batches, Long total) {
    }

    /**
     * 管理员卡密列表项。
     *
     * @param id Long 卡密ID
     * @param batchId Long 批次ID
     * @param code String 卡密明文，仅管理员主动查看时返回
     * @param codeMasked String 脱敏卡密
     * @param codeSuffix String 卡密末四位
     * @param credits Integer 可兑换积分
     * @param status String 卡密状态：available或redeemed
     * @param redeemedByUserId Long 兑换用户ID
     * @param redeemedByUsername String 兑换用户名
     * @param redeemedByNickname String 兑换用户昵称
     * @param redeemedByEmail String 兑换用户邮箱
     * @param redeemedAt String 兑换时间
     * @param createdAt String 创建时间
     * @param transactionId Long 积分流水ID
     * @param balanceAfter Integer 流水后的积分余额
     */
    public record CreditCard(Long id, Long batchId, String code, String codeMasked, String codeSuffix, Integer credits, String status,
                             Long redeemedByUserId, String redeemedByUsername, String redeemedByNickname, String redeemedByEmail,
                             String redeemedAt, String createdAt, Long transactionId, Integer balanceAfter) {
    }

    /**
     * 卡密分页响应。
     *
     * @param cards List<CreditCard> 卡密列表
     * @param total Long 总数量
     */
    public record CreditCardListResponse(List<CreditCard> cards, Long total) {
    }
}
