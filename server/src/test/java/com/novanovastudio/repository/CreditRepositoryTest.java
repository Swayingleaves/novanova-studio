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
}
