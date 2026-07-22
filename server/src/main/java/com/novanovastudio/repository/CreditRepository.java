package com.novanovastudio.repository;

import com.novanovastudio.dto.CreditDtos;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * @title        CreditRepository.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  用户积分数据访问仓储
 * @createTime   2026-07-16 14:00:00
 */
@Repository
public class CreditRepository {

    /** 生成任务实际消耗的基础查询条件 */
    private static final String CONSUMPTION_QUERY = """
            FROM user_credit_transactions credit_transactions
            JOIN ai_generation_tasks tasks ON tasks.id = credit_transactions.task_id
            JOIN users users ON users.id = credit_transactions.user_id
            WHERE credit_transactions.transaction_type = 'task_charge'
              AND credit_transactions.created_at >= :startAt
              AND credit_transactions.created_at < :endAt
              AND NOT EXISTS (
                  SELECT 1
                  FROM user_credit_transactions refunded_transactions
                  WHERE refunded_transactions.task_id = credit_transactions.task_id
                    AND refunded_transactions.transaction_type = 'task_refund'
              )
            """;

    /** 数据库客户端 */
    private final DatabaseClient databaseClient;

    /**
     * 构造积分数据访问仓储。
     *
     * @param databaseClient DatabaseClient 数据库客户端
     */
    public CreditRepository(DatabaseClient databaseClient) {
        this.databaseClient = databaseClient;
    }

    /**
     * 查询新用户初始积分。
     *
     * @return Mono<Integer> 新用户初始积分
     */
    public Mono<Integer> getInitialCredits() {
        return databaseClient.sql("SELECT initial_credits FROM platform_credit_settings WHERE id = 1")
                .map((row, metadata) -> row.get("initial_credits", Integer.class))
                .one();
    }

    /**
     * 更新新用户初始积分。
     *
     * @param initialCredits int 新用户初始积分
     * @return Mono<Void> 操作完成信号
     */
    public Mono<Void> updateInitialCredits(int initialCredits) {
        return databaseClient.sql("UPDATE platform_credit_settings SET initial_credits = :initialCredits, updated_at = CURRENT_TIMESTAMP WHERE id = 1")
                .bind("initialCredits", initialCredits)
                .fetch()
                .rowsUpdated()
                .then();
    }

    /**
     * 创建用户积分账户。
     *
     * @param userId Long 用户ID
     * @param creditBalance int 初始余额
     * @return Mono<Void> 操作完成信号
     */
    public Mono<Void> createAccount(Long userId, int creditBalance) {
        return databaseClient.sql("INSERT INTO user_credit_accounts(user_id, credit_balance) VALUES (:userId, :creditBalance)")
                .bind("userId", userId)
                .bind("creditBalance", creditBalance)
                .fetch()
                .rowsUpdated()
                .then();
    }

    /**
     * 原子调整用户积分余额。
     *
     * @param userId Long 用户ID
     * @param changeAmount int 积分变动值
     * @return Mono<Integer> 调整后的余额，余额不足或账户不存在时为空
     */
    public Mono<Integer> changeBalance(Long userId, int changeAmount) {
        return databaseClient.sql("""
                UPDATE user_credit_accounts
                SET credit_balance = credit_balance + :changeAmount, updated_at = CURRENT_TIMESTAMP
                WHERE user_id = :userId AND credit_balance + :changeAmount >= 0
                RETURNING credit_balance
                """)
                .bind("userId", userId)
                .bind("changeAmount", changeAmount)
                .map((row, metadata) -> row.get("credit_balance", Integer.class))
                .one();
    }

    /**
     * 写入普通积分流水。
     *
     * @param userId Long 用户ID
     * @param transactionType String 流水类型
     * @param operatorUserId Long 操作管理员ID，可为null
     * @param changeAmount int 积分变动值
     * @param balanceAfter int 变动后余额
     * @param reason String 变动原因
     * @return Mono<Void> 操作完成信号
     */
    public Mono<Void> createTransaction(Long userId, String transactionType, Long operatorUserId, int changeAmount, int balanceAfter, String reason) {
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                INSERT INTO user_credit_transactions(user_id, transaction_type, operator_user_id, change_amount, balance_after, reason)
                VALUES (:userId, :transactionType, :operatorUserId, :changeAmount, :balanceAfter, :reason)
                """)
                .bind("userId", userId)
                .bind("transactionType", transactionType)
                .bind("changeAmount", changeAmount)
                .bind("balanceAfter", balanceAfter)
                .bind("reason", reason);
        return R2dbcBindings.bindNullable(spec, "operatorUserId", operatorUserId, Long.class).fetch().rowsUpdated().then();
    }

    /**
     * 创建任务关联积分流水并抢占幂等键。
     *
     * @param userId Long 用户ID
     * @param taskId String AI任务ID
     * @param transactionType String 流水类型
     * @param changeAmount int 积分变动值
     * @param reason String 变动原因
     * @param generationSource String 生成来源，仅任务扣费时记录
     * @return Mono<Long> 新流水ID，幂等键已存在时为空
     */
    public Mono<Long> claimTaskTransaction(Long userId, String taskId, String transactionType, int changeAmount, String reason, String generationSource) {
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                INSERT INTO user_credit_transactions(user_id, transaction_type, task_id, generation_source, change_amount, balance_after, reason)
                VALUES (:userId, :transactionType, :taskId, :generationSource, :changeAmount, 0, :reason)
                ON CONFLICT (task_id, transaction_type) DO NOTHING
                RETURNING id
                """)
                .bind("userId", userId)
                .bind("transactionType", transactionType)
                .bind("taskId", taskId)
                .bind("changeAmount", changeAmount)
                .bind("reason", reason);
        return R2dbcBindings.bindNullable(spec, "generationSource", generationSource, String.class)
                .map((row, metadata) -> row.get("id", Long.class))
                .one();
    }

    /**
     * 更新任务积分流水的余额快照。
     *
     * @param transactionId Long 流水ID
     * @param balanceAfter int 变动后余额
     * @return Mono<Void> 操作完成信号
     */
    public Mono<Void> updateTransactionBalance(Long transactionId, int balanceAfter) {
        return databaseClient.sql("UPDATE user_credit_transactions SET balance_after = :balanceAfter WHERE id = :transactionId")
                .bind("transactionId", transactionId)
                .bind("balanceAfter", balanceAfter)
                .fetch()
                .rowsUpdated()
                .then();
    }

    /**
     * 查询任务原始扣费金额。
     *
     * @param taskId String AI任务ID
     * @return Mono<Integer> 任务扣除的积分绝对值
     */
    public Mono<Integer> getTaskChargeAmount(String taskId) {
        return databaseClient.sql("SELECT -change_amount AS credit_amount FROM user_credit_transactions WHERE task_id = :taskId AND transaction_type = 'task_charge'")
                .bind("taskId", taskId)
                .map((row, metadata) -> row.get("credit_amount", Integer.class))
                .one();
    }

    /**
     * 查询任务类型维度的实际积分消耗。
     *
     * @param query CreditConsumptionQuery 消耗查询条件
     * @return Flux<CreditDistributionItem> 任务类型消耗分布
     */
    public Flux<CreditDtos.CreditDistributionItem> listGenerationTypeDistribution(CreditConsumptionQuery query) {
        String sql = """
                SELECT tasks.task_type AS name, SUM(-credit_transactions.change_amount) AS consumed_credits
                """ + consumptionQuery(query) + """
                GROUP BY tasks.task_type
                ORDER BY consumed_credits DESC, name ASC
                """;
        return bindConsumptionQuery(databaseClient.sql(sql), query)
                .map((row, metadata) -> new CreditDtos.CreditDistributionItem(
                        row.get("name", String.class), row.get("consumed_credits", Long.class)))
                .all();
    }

    /**
     * 查询模型维度的实际积分消耗。
     *
     * @param query CreditConsumptionQuery 消耗查询条件
     * @return Flux<CreditDistributionItem> 模型消耗分布
     */
    public Flux<CreditDtos.CreditDistributionItem> listModelDistribution(CreditConsumptionQuery query) {
        String sql = """
                SELECT COALESCE(NULLIF(tasks.model, ''), '未记录模型') AS name, SUM(-credit_transactions.change_amount) AS consumed_credits
                """ + consumptionQuery(query) + """
                GROUP BY COALESCE(NULLIF(tasks.model, ''), '未记录模型')
                ORDER BY consumed_credits DESC, name ASC
                """;
        return bindConsumptionQuery(databaseClient.sql(sql), query)
                .map((row, metadata) -> new CreditDtos.CreditDistributionItem(
                        row.get("name", String.class), row.get("consumed_credits", Long.class)))
                .all();
    }

    /**
     * 查询日或月维度的实际积分消耗。
     *
     * @param query CreditConsumptionQuery 消耗查询条件
     * @param trendUnit String 趋势聚合单位
     * @return Flux<CreditTrendItem> 已产生消耗的趋势点
     */
    public Flux<CreditDtos.CreditTrendItem> listTrend(CreditConsumptionQuery query, String trendUnit) {
        String periodExpression = "day".equals(trendUnit)
                ? "TO_CHAR(DATE_TRUNC('day', credit_transactions.created_at AT TIME ZONE 'Asia/Shanghai'), 'YYYY-MM-DD')"
                : "TO_CHAR(DATE_TRUNC('month', credit_transactions.created_at AT TIME ZONE 'Asia/Shanghai'), 'YYYY-MM')";
        String sql = "SELECT " + periodExpression + " AS period, SUM(-credit_transactions.change_amount) AS consumed_credits "
                + consumptionQuery(query) + " GROUP BY " + periodExpression + " ORDER BY period ASC";
        return bindConsumptionQuery(databaseClient.sql(sql), query)
                .map((row, metadata) -> new CreditDtos.CreditTrendItem(
                        row.get("period", String.class), row.get("consumed_credits", Long.class)))
                .all();
    }

    /**
     * 分页查询实际积分消耗明细。
     *
     * @param query CreditConsumptionQuery 消耗查询条件
     * @param page int 页码
     * @param pageSize int 每页数量
     * @return Flux<CreditTransactionItem> 当前页积分消耗明细
     */
    public Flux<CreditDtos.CreditTransactionItem> listCreditTransactions(CreditConsumptionQuery query, int page, int pageSize) {
        String sql = """
                SELECT credit_transactions.id,
                       tasks.task_type AS generation_type,
                       COALESCE(NULLIF(tasks.model, ''), '未记录模型') AS model,
                       credit_transactions.generation_source,
                       -credit_transactions.change_amount AS consumed_credits,
                       credit_transactions.created_at
                """ + consumptionQuery(query) + """
                ORDER BY credit_transactions.created_at DESC, credit_transactions.id DESC
                LIMIT :limit OFFSET :offset
                """;
        return bindConsumptionQuery(databaseClient.sql(sql), query)
                .bind("limit", pageSize)
                .bind("offset", (page - 1) * pageSize)
                .map((row, metadata) -> new CreditDtos.CreditTransactionItem(
                        row.get("id", Long.class),
                        row.get("generation_type", String.class),
                        row.get("model", String.class),
                        row.get("generation_source", String.class),
                        row.get("consumed_credits", Long.class),
                        row.get("created_at", OffsetDateTime.class).toString()))
                .all();
    }

    /**
     * 分页查询管理员可见的实际积分消耗明细。
     *
     * @param query CreditConsumptionQuery 消耗查询条件
     * @param page int 页码
     * @param pageSize int 每页数量
     * @return Flux<AdminCreditTransactionItem> 当前页积分消耗明细
     */
    public Flux<CreditDtos.AdminCreditTransactionItem> listAdminCreditTransactions(CreditConsumptionQuery query, int page, int pageSize) {
        String sql = """
                SELECT credit_transactions.id,
                       credit_transactions.user_id,
                       users.username,
                       users.nickname,
                       users.email,
                       tasks.task_type AS generation_type,
                       COALESCE(NULLIF(tasks.model, ''), '未记录模型') AS model,
                       credit_transactions.generation_source,
                       -credit_transactions.change_amount AS consumed_credits,
                       credit_transactions.created_at
                """ + consumptionQuery(query) + """
                ORDER BY credit_transactions.created_at DESC, credit_transactions.id DESC
                LIMIT :limit OFFSET :offset
                """;
        return bindConsumptionQuery(databaseClient.sql(sql), query)
                .bind("limit", pageSize)
                .bind("offset", (page - 1) * pageSize)
                .map((row, metadata) -> new CreditDtos.AdminCreditTransactionItem(
                        row.get("id", Long.class),
                        row.get("user_id", Long.class),
                        row.get("username", String.class),
                        row.get("nickname", String.class),
                        row.get("email", String.class),
                        row.get("generation_type", String.class),
                        row.get("model", String.class),
                        row.get("generation_source", String.class),
                        row.get("consumed_credits", Long.class),
                        row.get("created_at", OffsetDateTime.class).toString()))
                .all();
    }

    /**
     * 查询实际积分消耗明细总数。
     *
     * @param query CreditConsumptionQuery 消耗查询条件
     * @return Mono<Long> 符合条件的明细总数
     */
    public Mono<Long> countCreditTransactions(CreditConsumptionQuery query) {
        String sql = "SELECT COUNT(*) AS total " + consumptionQuery(query);
        return bindConsumptionQuery(databaseClient.sql(sql), query)
                .map((row, metadata) -> row.get("total", Long.class))
                .one();
    }

    /**
     * 生成实际积分消耗查询SQL。
     *
     * @param query CreditConsumptionQuery 消耗查询条件
     * @return String 固定字段与受控筛选组成的SQL
     */
    static String consumptionQuery(CreditConsumptionQuery query) {
        StringBuilder sql = new StringBuilder(CONSUMPTION_QUERY);
        if (query.userId() != null) {
            sql.append(" AND credit_transactions.user_id = :userId\n");
        }
        if (query.generationType() != null) {
            sql.append(" AND tasks.task_type = :generationType\n");
        }
        return sql.toString();
    }

    /**
     * 绑定实际积分消耗查询参数。
     *
     * @param spec GenericExecuteSpec 待绑定的SQL执行器
     * @param query CreditConsumptionQuery 消耗查询条件
     * @return GenericExecuteSpec 已绑定参数的SQL执行器
     */
    private DatabaseClient.GenericExecuteSpec bindConsumptionQuery(DatabaseClient.GenericExecuteSpec spec, CreditConsumptionQuery query) {
        DatabaseClient.GenericExecuteSpec boundSpec = spec
                .bind("startAt", query.startAt())
                .bind("endAt", query.endAt());
        if (query.userId() != null) {
            boundSpec = boundSpec.bind("userId", query.userId());
        }
        return query.generationType() == null ? boundSpec : boundSpec.bind("generationType", query.generationType());
    }

    /**
     * 用户积分消耗查询条件。
     *
     * @param userId Long 用户ID，可为空表示全部用户
     * @param startDate LocalDate 筛选起始日期
     * @param endDate LocalDate 筛选结束日期
     * @param startAt OffsetDateTime 筛选起始时间
     * @param endAt OffsetDateTime 筛选结束时间的次日零点
     * @param generationType String 图片或视频任务类型，可为空
     */
    public record CreditConsumptionQuery(Long userId,
                                         LocalDate startDate,
                                         LocalDate endDate,
                                         OffsetDateTime startAt,
                                         OffsetDateTime endAt,
                                         String generationType) {
    }
}
