package com.novanovastudio.repository;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

/**
 * 积分仓储测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-19 14:45
 */
class CreditRepositoryTest {

    /**
     * 类型筛选条件后应与聚合子句保持分隔。
     */
    @Test
    void shouldSeparateGenerationTypeParameterFromGroupByClause() {
        CreditRepository.CreditConsumptionQuery query = new CreditRepository.CreditConsumptionQuery(
                1L,
                LocalDate.of(2026, 7, 1),
                LocalDate.of(2026, 7, 1),
                OffsetDateTime.of(2026, 7, 1, 0, 0, 0, 0, ZoneOffset.ofHours(8)),
                OffsetDateTime.of(2026, 7, 2, 0, 0, 0, 0, ZoneOffset.ofHours(8)),
                "image");

        String sql = CreditRepository.consumptionQuery(query) + "GROUP BY tasks.task_type";

        Assertions.assertTrue(sql.contains(":generationType\nGROUP BY"));
    }

    /**
     * 未指定用户时应构建全部用户查询条件。
     */
    @Test
    void shouldOmitUserConditionForAllUserConsumptionQuery() {
        CreditRepository.CreditConsumptionQuery query = new CreditRepository.CreditConsumptionQuery(
                null,
                LocalDate.of(2026, 7, 1),
                LocalDate.of(2026, 7, 1),
                OffsetDateTime.of(2026, 7, 1, 0, 0, 0, 0, ZoneOffset.ofHours(8)),
                OffsetDateTime.of(2026, 7, 2, 0, 0, 0, 0, ZoneOffset.ofHours(8)),
                null);

        String sql = CreditRepository.consumptionQuery(query);

        Assertions.assertFalse(sql.contains(":userId"));
        Assertions.assertTrue(sql.contains("credit_transactions.transaction_type = 'task_charge'"));
    }

    /**
     * 卡密库存筛选应组合批次、状态和兑换用户条件。
     */
    @Test
    void shouldBuildCreditCardInventoryFilters() {
        CreditCardRepository.CardListQuery query = new CreditCardRepository.CardListQuery(8L, "redeemed", "hash", null, "user@example.com");

        String sql = CreditCardRepository.cardFilters(query);

        Assertions.assertTrue(sql.contains("cards.batch_id = :batchId"));
        Assertions.assertTrue(sql.contains("cards.redeemed_at IS NOT NULL"));
        Assertions.assertTrue(sql.contains("cards.code_hash = :codeHash"));
        Assertions.assertTrue(sql.contains(":redeemedUserKeyword"));
        Assertions.assertTrue(sql.endsWith("\n"));
    }

    /**
     * 兑换记录筛选条件后应保留换行，避免与排序子句黏连。
     */
    @Test
    void shouldKeepLineBreakAfterRedemptionFilters() {
        CreditCardRepository.RedemptionQuery query = new CreditCardRepository.RedemptionQuery(1L, null, null, "hash", null);

        Assertions.assertTrue(CreditCardRepository.redemptionFilters(query).endsWith("\n"));
    }

    /**
     * 增加方向筛选应限定正数积分变动。
     */
    @Test
    void shouldFilterAddDirectionByPositiveChangeAmount() {
        CreditRepository.UserCreditQuery query = new CreditRepository.UserCreditQuery(
                1L,
                LocalDate.of(2026, 7, 1),
                LocalDate.of(2026, 7, 1),
                OffsetDateTime.of(2026, 7, 1, 0, 0, 0, 0, ZoneOffset.ofHours(8)),
                OffsetDateTime.of(2026, 7, 2, 0, 0, 0, 0, ZoneOffset.ofHours(8)),
                "add",
                null);

        String sql = CreditRepository.userTransactionQuery(query);

        Assertions.assertTrue(sql.contains("credit_transactions.change_amount > 0"));
    }

    /**
     * 消耗方向筛选应排除已退款的扣费流水。
     */
    @Test
    void shouldExcludeRefundedTaskChargeForSpendDirection() {
        CreditRepository.UserCreditQuery query = new CreditRepository.UserCreditQuery(
                1L,
                LocalDate.of(2026, 7, 1),
                LocalDate.of(2026, 7, 1),
                OffsetDateTime.of(2026, 7, 1, 0, 0, 0, 0, ZoneOffset.ofHours(8)),
                OffsetDateTime.of(2026, 7, 2, 0, 0, 0, 0, ZoneOffset.ofHours(8)),
                "spend",
                null);

        String sql = CreditRepository.userTransactionQuery(query);

        Assertions.assertTrue(sql.contains("credit_transactions.change_amount < 0"));
        Assertions.assertTrue(sql.contains("transaction_type = 'task_refund'"));
    }

    /**
     * 来源筛选为卡密兑换时限定流水类型。
     */
    @Test
    void shouldFilterSourceByTransactionType() {
        CreditRepository.UserCreditQuery query = new CreditRepository.UserCreditQuery(
                1L,
                LocalDate.of(2026, 7, 1),
                LocalDate.of(2026, 7, 1),
                OffsetDateTime.of(2026, 7, 1, 0, 0, 0, 0, ZoneOffset.ofHours(8)),
                OffsetDateTime.of(2026, 7, 2, 0, 0, 0, 0, ZoneOffset.ofHours(8)),
                null,
                "card_redeem");

        String sql = CreditRepository.userTransactionQuery(query);

        Assertions.assertTrue(sql.contains("credit_transactions.transaction_type = :source"));
        Assertions.assertFalse(sql.contains("tasks.task_type"));
    }

    /**
     * 来源筛选为图片生成时限定任务类型。
     */
    @Test
    void shouldFilterSourceByGenerationTaskType() {
        CreditRepository.UserCreditQuery query = new CreditRepository.UserCreditQuery(
                1L,
                LocalDate.of(2026, 7, 1),
                LocalDate.of(2026, 7, 1),
                OffsetDateTime.of(2026, 7, 1, 0, 0, 0, 0, ZoneOffset.ofHours(8)),
                OffsetDateTime.of(2026, 7, 2, 0, 0, 0, 0, ZoneOffset.ofHours(8)),
                null,
                "image");

        String sql = CreditRepository.userTransactionQuery(query);

        Assertions.assertTrue(sql.contains("tasks.task_type = :source"));
        Assertions.assertFalse(sql.contains("credit_transactions.transaction_type = :source"));
    }
}
