package com.novanovastudio.repository;

import java.math.BigDecimal;
import com.novanovastudio.security.TeamScope;
import com.novanovastudio.common.CreditAmounts;

import com.novanovastudio.dto.CreditDtos;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
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
     * @return Mono<BigDecimal> 新用户初始积分
     */
    public Mono<BigDecimal> getInitialCredits() {
        return databaseClient.sql("SELECT initial_credits FROM platform_credit_settings WHERE id = 1")
                .map((row, metadata) -> row.get("initial_credits", BigDecimal.class))
                .one();
    }

    /**
     * 查询邀请注册奖励积分。
     *
     * @return 邀请奖励积分
     */
    public Mono<BigDecimal> getInvitationRewardCredits() {
        return databaseClient.sql("SELECT invitation_reward_credits FROM platform_credit_settings WHERE id = 1")
                .map((row, metadata) -> row.get("invitation_reward_credits", BigDecimal.class))
                .one();
    }

    /**
     * 更新邀请注册奖励积分。
     *
     * @param invitationRewardCredits 邀请奖励积分
     * @return 操作完成信号
     */
    public Mono<Void> updateInvitationRewardCredits(BigDecimal invitationRewardCredits) {
        return databaseClient.sql("UPDATE platform_credit_settings SET invitation_reward_credits = :credits, updated_at = CURRENT_TIMESTAMP WHERE id = 1")
                .bind("credits", invitationRewardCredits)
                .fetch().rowsUpdated().then();
    }

    /**
     * 查询每日签到积分。
     *
     * @return Mono<BigDecimal> 每日签到积分
     */
    public Mono<BigDecimal> getCheckInCredits() {
        return databaseClient.sql("SELECT check_in_credits FROM platform_credit_settings WHERE id = 1")
                .map((row, metadata) -> row.get("check_in_credits", BigDecimal.class))
                .one();
    }

    /**
     * 更新每日签到积分。
     *
     * @param checkInCredits int 每日签到积分
     * @return Mono<Void> 操作完成信号
     */
    public Mono<Void> updateCheckInCredits(BigDecimal checkInCredits) {
        return databaseClient.sql("UPDATE platform_credit_settings SET check_in_credits = :credits, updated_at = CURRENT_TIMESTAMP WHERE id = 1")
                .bind("credits", checkInCredits)
                .fetch().rowsUpdated().then();
    }

    /**
     * 查询用户可用积分余额。
     *
     * @param userId Long 用户ID
     * @return Mono<BigDecimal> 可用积分余额，账户不存在时为空
     */
    public Mono<BigDecimal> getCreditBalance(Long userId) {
        return Mono.deferContextual(context -> {
            long walletTeamId = context.getOrDefault(TeamScope.WALLET_KEY, 0L);
        return databaseClient.sql("SELECT credit_balance FROM user_credit_accounts WHERE user_id = :userId AND team_id = :walletTeamId").bind("walletTeamId", walletTeamId)
                .bind("userId", userId)
                .map((row, metadata) -> row.get("credit_balance", BigDecimal.class))
                .one();

        });
    }

    /**
     * 写入会过期的积分发放批次。
     *
     * @param userId Long 用户ID
     * @param sourceType String 发放来源流水类型
     * @param sourceRef String 来源业务ID，可为null
     * @param grantedAmount int 发放积分总数
     * @param expiresAt OffsetDateTime 过期时间
     * @return Mono<Long> 新批次ID
     */
    public Mono<Long> createExpiringGrant(Long userId, String sourceType, String sourceRef, BigDecimal grantedAmount, OffsetDateTime expiresAt) {
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                INSERT INTO user_credit_grants(user_id, source_type, source_ref, granted_amount, remaining_amount, expires_at)
                VALUES (:userId, :sourceType, :sourceRef, :grantedAmount, :grantedAmount, :expiresAt)
                RETURNING id
                """)
                .bind("userId", userId)
                .bind("sourceType", sourceType)
                .bind("grantedAmount", grantedAmount)
                .bind("expiresAt", expiresAt);
        return R2dbcBindings.bindNullable(spec, "sourceRef", sourceRef, String.class)
                .map((row, metadata) -> row.get("id", Long.class))
                .one();
    }

    /**
     * 加行锁查询用户所有仍有剩余额度的过期批次。
     * <p>
     * 必须由调用方在同一事务内使用，持有行锁后再按到期时间顺序扣减或清零。
     *
     * @param userId Long 用户ID
     * @return Flux<ExpiringGrant> 未耗尽的批次，按到期时间升序
     */
    public Flux<ExpiringGrant> listActiveGrantsForUpdate(Long userId) {
        return Flux.deferContextual(context -> {
            long walletTeamId = context.getOrDefault(TeamScope.WALLET_KEY, 0L);
        return databaseClient.sql("""
                SELECT id, remaining_amount, expires_at
                FROM user_credit_grants
                WHERE user_id = :userId AND team_id = :walletTeamId
                  AND remaining_amount > 0
                ORDER BY expires_at ASC, id ASC
                FOR UPDATE
                """).bind("walletTeamId", walletTeamId)
                .bind("userId", userId)
                .map((row, metadata) -> new ExpiringGrant(
                        row.get("id", Long.class),
                        row.get("remaining_amount", BigDecimal.class),
                        row.get("expires_at", OffsetDateTime.class)))
                .all();

        });
    }

    /**
     * 扣减指定过期批次的剩余额度。
     *
     * @param grantId Long 批次ID
     * @param amount int 本次扣减额度
     * @return Mono<Long> 生效行数，额度不足时为0
     */
    public Mono<Long> consumeGrant(Long grantId, BigDecimal amount) {
        return Mono.deferContextual(context -> {
            long walletTeamId = context.getOrDefault(TeamScope.WALLET_KEY, 0L);
        return databaseClient.sql("""
                UPDATE user_credit_grants
                SET remaining_amount = remaining_amount - :amount, updated_at = CURRENT_TIMESTAMP
                WHERE id = :grantId AND team_id = :walletTeamId AND remaining_amount >= :amount
                """).bind("walletTeamId", walletTeamId)
                .bind("grantId", grantId)
                .bind("amount", amount)
                .fetch().rowsUpdated();

        });
    }

    /**
     * 清零指定过期批次的剩余额度。
     *
     * @param grantId Long 批次ID
     * @return Mono<Long> 生效行数
     */
    public Mono<Long> clearGrant(Long grantId) {
        return Mono.deferContextual(context -> {
            long walletTeamId = context.getOrDefault(TeamScope.WALLET_KEY, 0L);
        return databaseClient.sql("""
                UPDATE user_credit_grants
                SET remaining_amount = 0, updated_at = CURRENT_TIMESTAMP
                WHERE id = :grantId AND team_id = :walletTeamId AND remaining_amount > 0
                """).bind("walletTeamId", walletTeamId)
                .bind("grantId", grantId)
                .fetch().rowsUpdated();

        });
    }

    /**
     * 查询存在已过期且未清零批次的用户ID。
     * <p>
     * 供每小时兜底清理使用，按用户维度逐个加锁处理。
     *
     * @param now OffsetDateTime 判定时刻
     * @param limit int 单次处理用户数上限
     * @return Flux<Long> 用户ID
     */
    public Flux<Long> listExpiredGrantUserIds(OffsetDateTime now, int limit) {
        return databaseClient.sql("""
                SELECT DISTINCT user_id
                FROM user_credit_grants
                WHERE remaining_amount > 0
                  AND expires_at <= :now
                ORDER BY user_id
                LIMIT :limit
                """)
                .bind("now", now)
                .bind("limit", limit)
                .map((row, metadata) -> row.get("user_id", Long.class))
                .all();
    }

    /**
     * 会过期的积分发放批次。
     *
     * @param id Long 批次ID
     * @param remainingAmount int 剩余可用额度
     * @param expiresAt OffsetDateTime 过期时间
     */
    public record ExpiringGrant(Long id, BigDecimal remainingAmount, OffsetDateTime expiresAt) {
    }

    /**
     * 更新新用户初始积分。
     *
     * @param initialCredits int 新用户初始积分
     * @return Mono<Void> 操作完成信号
     */
    public Mono<Void> updateInitialCredits(BigDecimal initialCredits) {
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
    public Mono<Void> createAccount(Long userId, BigDecimal creditBalance) {
        return Mono.deferContextual(context -> {
            long walletTeamId = context.getOrDefault(TeamScope.WALLET_KEY, 0L);
        return databaseClient.sql("INSERT INTO user_credit_accounts(team_id, user_id, credit_balance) VALUES (:walletTeamId, :userId, :creditBalance)").bind("walletTeamId", walletTeamId)
                .bind("userId", userId)
                .bind("creditBalance", creditBalance)
                .fetch()
                .rowsUpdated()
                .then();

        });
    }

    /**
     * 原子调整用户积分余额。
     *
     * @param userId Long 用户ID
     * @param changeAmount int 积分变动值
     * @return Mono<BigDecimal> 调整后的余额，余额不足或账户不存在时为空
     */
    public Mono<BigDecimal> changeBalance(Long userId, BigDecimal changeAmount) {
        return Mono.deferContextual(context -> {
            long walletTeamId = context.getOrDefault(TeamScope.WALLET_KEY, 0L);
        return databaseClient.sql("""
                UPDATE user_credit_accounts
                SET credit_balance = credit_balance + :changeAmount, updated_at = CURRENT_TIMESTAMP
                WHERE user_id = :userId AND team_id = :walletTeamId AND credit_balance + :changeAmount >= 0
                  AND (NOT frozen OR :changeAmount >= 0 OR :historical)
                RETURNING credit_balance
                """).bind("walletTeamId", walletTeamId)
                .bind("userId", userId)
                .bind("changeAmount", changeAmount)
                .bind("historical", context.getOrDefault(TeamScope.HISTORICAL_KEY, false))
                .map((row, metadata) -> row.get("credit_balance", BigDecimal.class))
                .one();

        });
    }

    /**
     * 固定先锁钱包再锁发放批次，保证模型扣费与存储结算锁顺序一致。
     * @param userId 钱包用户
     * @return 账户是否存在
     */
    public Mono<Boolean> lockWallet(Long userId) {
        return Mono.deferContextual(context -> databaseClient.sql("SELECT user_id FROM user_credit_accounts WHERE user_id = :user AND team_id = :wallet FOR UPDATE")
                .bind("user", userId).bind("wallet", context.getOrDefault(TeamScope.WALLET_KEY, 0L))
                .map((row, metadata) -> true).one().defaultIfEmpty(false));
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
    public Mono<Void> createTransaction(Long userId, String transactionType, Long operatorUserId, BigDecimal changeAmount, BigDecimal balanceAfter, String reason) {
        return Mono.deferContextual(context -> {
            long walletTeamId = context.getOrDefault(TeamScope.WALLET_KEY, 0L);
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                INSERT INTO user_credit_transactions(wallet_team_id, beneficiary_team_id, user_id, transaction_type, operator_user_id, change_amount, balance_after, reason)
                VALUES (:walletTeamId, :walletTeamId, :userId, :transactionType, :operatorUserId, :changeAmount, :balanceAfter, :reason)
                """).bind("walletTeamId", walletTeamId)
                .bind("userId", userId)
                .bind("transactionType", transactionType)
                .bind("changeAmount", changeAmount)
                .bind("balanceAfter", balanceAfter)
                .bind("reason", reason);
        return R2dbcBindings.bindNullable(spec, "operatorUserId", operatorUserId, Long.class).fetch().rowsUpdated().then();

        });
    }

    /**
     * 写入积分购买流水并使用订单号抢占幂等键。
     *
     * @param userId Long 购买用户标识
     * @param orderNo String 平台订单号
     * @param changeAmount BigDecimal 本次到账积分
     * @param balanceAfter BigDecimal 入账后的平台钱包余额
     * @param reason String 流水原因
     * @return Mono<Long> 新流水标识，订单已入账时为空
     */
    public Mono<Long> createCreditPurchaseTransaction(Long userId, String orderNo, BigDecimal changeAmount,
                                                      BigDecimal balanceAfter, String reason) {
        return databaseClient.sql("""
                INSERT INTO user_credit_transactions(team_id, wallet_team_id, beneficiary_team_id, user_id,
                    transaction_type, change_amount, balance_after, reason, billing_reference)
                VALUES (0, 0, 0, :userId, 'credit_purchase', :changeAmount, :balanceAfter, :reason, :orderNo)
                ON CONFLICT (billing_reference) WHERE billing_reference IS NOT NULL DO NOTHING
                RETURNING id
                """)
                .bind("userId", userId)
                .bind("changeAmount", changeAmount)
                .bind("balanceAfter", balanceAfter)
                .bind("reason", reason)
                .bind("orderNo", orderNo)
                .map((row, metadata) -> row.get("id", Long.class))
                .one();
    }

    /**
     * 创建邀请奖励流水并抢占被邀请用户幂等键。
     *
     * @param inviterUserId 邀请人用户ID
     * @param invitedUserId 被邀请新用户ID
     * @param changeAmount 奖励积分
     * @param reason 奖励原因
     * @return 新流水ID，已经发放时为空
     */
    public Mono<Long> claimInvitationRewardTransaction(Long inviterUserId, Long invitedUserId, BigDecimal changeAmount, String reason) {
        return databaseClient.sql("""
                INSERT INTO user_credit_transactions(user_id, transaction_type, invited_user_id, change_amount, balance_after, reason)
                VALUES (:inviterUserId, 'invitation_reward', :invitedUserId, :changeAmount, 0, :reason)
                ON CONFLICT (invited_user_id) WHERE transaction_type = 'invitation_reward' DO NOTHING
                RETURNING id
                """)
                .bind("inviterUserId", inviterUserId)
                .bind("invitedUserId", invitedUserId)
                .bind("changeAmount", changeAmount)
                .bind("reason", reason)
                .map((row, metadata) -> row.get("id", Long.class))
                .one();
    }

    /**
     * 写入卡密兑换积分流水。
     *
     * @param userId Long 兑换用户ID
     * @param cardId Long 兑换卡密ID
     * @param changeAmount int 积分变动值
     * @param balanceAfter int 变动后余额
     * @param reason String 变动原因
     * @return Mono<Long> 新建流水ID
     */
    public Mono<Long> createCardRedeemTransaction(Long userId, Long cardId, BigDecimal changeAmount, BigDecimal balanceAfter, String reason) {
        return databaseClient.sql("""
                        INSERT INTO user_credit_transactions(user_id, transaction_type, credit_card_id, change_amount, balance_after, reason)
                        VALUES (:userId, 'card_redeem', :cardId, :changeAmount, :balanceAfter, :reason)
                        RETURNING id
                        """)
                .bind("userId", userId)
                .bind("cardId", cardId)
                .bind("changeAmount", changeAmount)
                .bind("balanceAfter", balanceAfter)
                .bind("reason", reason)
                .map((row, metadata) -> row.get("id", Long.class))
                .one();
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
    public Mono<Long> claimTaskTransaction(Long userId, String taskId, String transactionType, BigDecimal changeAmount, String reason, String generationSource) {
        return Mono.deferContextual(context -> {
            long walletTeamId = context.getOrDefault(TeamScope.WALLET_KEY, 0L);
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                INSERT INTO user_credit_transactions(team_id, wallet_team_id, beneficiary_team_id, user_id, transaction_type, task_id, generation_source, change_amount, balance_after, reason, resource_id)
                VALUES ((SELECT team_id FROM ai_generation_tasks WHERE id = :taskId), :walletTeamId, :walletTeamId, :userId, :transactionType, :taskId, :generationSource, :changeAmount, 0, :reason, (SELECT model_config_id FROM ai_generation_tasks WHERE id = :taskId))
                ON CONFLICT (task_id, transaction_type) DO NOTHING
                RETURNING id
                """).bind("walletTeamId", walletTeamId)
                .bind("userId", userId)
                .bind("transactionType", transactionType)
                .bind("taskId", taskId)
                .bind("changeAmount", changeAmount)
                .bind("reason", reason);
        return R2dbcBindings.bindNullable(spec, "generationSource", generationSource, String.class)
                .map((row, metadata) -> row.get("id", Long.class))
                .one();

        });
    }

    /**
     * 创建不关联生成任务的业务积分流水并抢占幂等键。
     * <p>
     * 分镜等同步 Agent 操作没有独立任务表，使用稳定操作标识写入原因字段，并在同一事务中取得 PostgreSQL 事务级咨询锁，
     * 避免重复扣费或退款。此方法不会修改普通生成任务的流水语义。
     *
     * @param userId Long 用户ID
     * @param operationId String 稳定操作标识
     * @param transactionType String 流水类型
     * @param changeAmount int 积分变动值
     * @param reason String 变动原因
     * @return Mono<Long> 新流水ID，幂等键已存在时为空
     */
    public Mono<Long> claimOperationTransaction(Long userId, String operationId, String transactionType, BigDecimal changeAmount, String reason) {
        return Mono.deferContextual(context -> {
            long walletTeamId = context.getOrDefault(TeamScope.WALLET_KEY, 0L);
        String lockKey = "credit-operation:" + operationId + ":" + transactionType;
        return databaseClient.sql("SELECT pg_advisory_xact_lock(hashtext(:lockKey))")
                .bind("lockKey", lockKey)
                .fetch()
                .all()
                .then(databaseClient.sql("""
                        INSERT INTO user_credit_transactions(team_id, wallet_team_id, beneficiary_team_id, user_id, transaction_type, change_amount, balance_after, reason, resource_id)
                        SELECT CASE WHEN :transactionType = 'task_refund' THEN (SELECT team_id FROM user_credit_transactions original
                            WHERE original.user_id = :userId AND original.transaction_type = 'task_charge'
                              AND original.reason = replace(:reason, '退款（操作ID：', '扣费（操作ID：')) ELSE current_team_id() END,
                            :walletTeamId, :walletTeamId, :userId, :transactionType, :changeAmount, 0, :reason,
                            CASE WHEN :transactionType = 'task_refund' THEN (SELECT resource_id FROM user_credit_transactions original
                                WHERE original.user_id = :userId AND original.transaction_type = 'task_charge'
                                  AND original.reason = replace(:reason, '退款（操作ID：', '扣费（操作ID：')) ELSE :resourceId END
                        WHERE NOT EXISTS (
                            SELECT 1
                            FROM user_credit_transactions
                            WHERE user_id = :userId
                              AND task_id IS NULL
                              AND transaction_type = :transactionType
                              AND reason = :reason
                        )
                        RETURNING id
                        """).bind("walletTeamId", walletTeamId).bind("resourceId", context.getOrDefault(TeamScope.RESOURCE_KEY, ""))
                        .bind("userId", userId)
                        .bind("transactionType", transactionType)
                        .bind("changeAmount", changeAmount)
                        .bind("reason", reason)
                        .map((row, metadata) -> row.get("id", Long.class))
                        .one());

        });
    }

    /**
     * 更新任务积分流水的余额快照。
     *
     * @param transactionId Long 流水ID
     * @param balanceAfter int 变动后余额
     * @return Mono<Void> 操作完成信号
     */
    public Mono<Void> updateTransactionBalance(Long transactionId, BigDecimal balanceAfter) {
        return databaseClient.sql("UPDATE user_credit_transactions SET balance_after = :balanceAfter WHERE id = :transactionId")
                .bind("transactionId", transactionId)
                .bind("balanceAfter", balanceAfter)
                .fetch()
                .rowsUpdated()
                .then();
    }

    /**
     * 读取原扣费的钱包，退款不能依据当前空间重新选择。
     * @param taskId 任务标识，空串表示同步操作
     * @param userId 用户标识
     * @param reason 原扣费原因
     * @return 原钱包团队标识
     */
    public Mono<Long> originalWallet(String taskId, Long userId, String reason) {
        return databaseClient.sql("SELECT wallet_team_id FROM user_credit_transactions WHERE user_id = :userId AND transaction_type = 'task_charge' AND ((:taskId <> '' AND task_id = :taskId) OR (:taskId = '' AND task_id IS NULL AND reason = :reason))")
                .bind("userId", userId).bind("taskId", taskId).bind("reason", reason)
                .map((row, metadata) -> row.get("wallet_team_id", Long.class)).one();
    }

    /**
     * 查询任务原始扣费金额。
     *
     * @param taskId String AI任务ID
     * @return Mono<BigDecimal> 任务扣除的积分绝对值
     */
    public Mono<BigDecimal> getTaskChargeAmount(String taskId) {
        return databaseClient.sql("SELECT -change_amount AS credit_amount FROM user_credit_transactions WHERE task_id = :taskId AND transaction_type = 'task_charge'")
                .bind("taskId", taskId)
                .map((row, metadata) -> row.get("credit_amount", BigDecimal.class))
                .one();
    }

    /**
     * 查询业务操作的原始扣费金额。
     *
     * @param userId Long 用户ID
     * @param chargeReason String 扣费流水原因
     * @return Mono<BigDecimal> 原始扣费的积分绝对值
     */
    public Mono<BigDecimal> getOperationChargeAmount(Long userId, String chargeReason) {
        return databaseClient.sql("""
                SELECT -change_amount AS credit_amount
                FROM user_credit_transactions
                WHERE user_id = :userId
                  AND task_id IS NULL
                  AND transaction_type = 'task_charge'
                  AND reason = :chargeReason
                """)
                .bind("userId", userId)
                .bind("chargeReason", chargeReason)
                .map((row, metadata) -> row.get("credit_amount", BigDecimal.class))
                .one();
    }

    /**
     * 查询业务操作已退积分，未生成退款流水时返回空结果。
     *
     * @param userId Long 用户标识
     * @param refundReason String 退款流水原因
     * @return Mono&lt;Integer&gt; 已退款的积分
     */
    public Mono<BigDecimal> getOperationRefundAmount(Long userId, String refundReason) {
        return databaseClient.sql("""
                SELECT change_amount
                FROM user_credit_transactions
                WHERE user_id = :userId AND task_id IS NULL
                  AND transaction_type = 'task_refund' AND reason = :reason
                """).bind("userId", userId).bind("reason", refundReason)
                .map((row, metadata) -> row.get("change_amount", BigDecimal.class)).one();
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
                        row.get("name", String.class), row.get("consumed_credits", BigDecimal.class)))
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
                        row.get("name", String.class), row.get("consumed_credits", BigDecimal.class)))
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
                        row.get("period", String.class), row.get("consumed_credits", BigDecimal.class)))
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
                        row.get("consumed_credits", BigDecimal.class),
                        row.get("created_at", OffsetDateTime.class).toString()))
                .all();
    }

    /**
     * 分页查询管理员可见的统一积分流水明细（含增加与消耗）。
     *
     * @param query UserCreditQuery 查询条件，用户ID为空表示全部用户
     * @param page int 页码
     * @param pageSize int 每页数量
     * @return Flux<AdminCreditTransactionItem> 当前页积分明细
     */
    public Flux<CreditDtos.AdminCreditTransactionItem> listAdminCreditTransactions(UserCreditQuery query, int page, int pageSize) {
        String sql = """
                SELECT credit_transactions.id,
                       credit_transactions.user_id,
                       users.username,
                       users.nickname,
                       users.email,
                       credit_transactions.transaction_type,
                       credit_transactions.generation_source,
                       credit_transactions.change_amount,
                       credit_transactions.balance_after,
                       credit_transactions.reason,
                       credit_transactions.invited_user_id,
                       credit_transactions.created_at,
                       tasks.task_type AS generation_type,
                       tasks.model AS model
                """ + adminTransactionQuery(query) + """
                ORDER BY credit_transactions.created_at DESC, credit_transactions.id DESC
                LIMIT :limit OFFSET :offset
                """;
        return bindUserTransactionQuery(databaseClient.sql(sql), query)
                .bind("limit", pageSize)
                .bind("offset", (page - 1) * pageSize)
                .map((row, metadata) -> {
                    BigDecimal changeAmount = row.get("change_amount", BigDecimal.class);
                    return new CreditDtos.AdminCreditTransactionItem(
                            row.get("id", Long.class),
                            row.get("user_id", Long.class),
                            row.get("username", String.class),
                            row.get("nickname", String.class),
                            row.get("email", String.class),
                            row.get("transaction_type", String.class),
                            CreditAmounts.of(changeAmount).compareTo(CreditAmounts.of(0)) > 0 ? "add" : "spend",
                            row.get("generation_type", String.class),
                            row.get("model", String.class),
                            row.get("generation_source", String.class),
                            changeAmount,
                            row.get("reason", String.class),
                            row.get("balance_after", BigDecimal.class),
                            row.get("invited_user_id", Long.class),
                            row.get("created_at", OffsetDateTime.class).toString());
                })
                .all();
    }

    /**
     * 查询管理员可见的统一积分流水明细总数。
     *
     * @param query UserCreditQuery 查询条件，用户ID为空表示全部用户
     * @return Mono<Long> 符合条件的明细总数
     */
    public Mono<Long> countAdminTransactions(UserCreditQuery query) {
        String sql = "SELECT COUNT(*) AS total " + adminTransactionQuery(query);
        return bindUserTransactionQuery(databaseClient.sql(sql), query)
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

    /** 用户统一积分明细查询条件。 */
    public record UserCreditQuery(Long userId,
                                  LocalDate startDate,
                                  LocalDate endDate,
                                  OffsetDateTime startAt,
                                  OffsetDateTime endAt,
                                  String direction,
                                  String source) {
    }

    /** 用户统一积分明细基础查询条件。 */
    private static final String USER_TRANSACTION_QUERY = """
            FROM user_credit_transactions credit_transactions
            LEFT JOIN ai_generation_tasks tasks ON tasks.id = credit_transactions.task_id
            WHERE credit_transactions.user_id = :userId
              AND credit_transactions.created_at >= :startAt
              AND credit_transactions.created_at < :endAt
            """;

    /** 管理员统一积分明细基础查询条件，关联用户信息且不强制指定用户。 */
    private static final String ADMIN_TRANSACTION_QUERY = """
            FROM user_credit_transactions credit_transactions
            LEFT JOIN ai_generation_tasks tasks ON tasks.id = credit_transactions.task_id
            JOIN users users ON users.id = credit_transactions.user_id
            WHERE credit_transactions.created_at >= :startAt
              AND credit_transactions.created_at < :endAt
            """;

    /**
     * 生成用户统一积分明细查询SQL。
     *
     * @param query UserCreditQuery 查询条件
     * @return String 固定字段与受控筛选组成的SQL
     */
    static String userTransactionQuery(UserCreditQuery query) {
        return transactionQuery(new StringBuilder(USER_TRANSACTION_QUERY), query);
    }

    /**
     * 生成管理员统一积分明细查询SQL。
     *
     * @param query UserCreditQuery 查询条件，用户ID为空表示全部用户
     * @return String 固定字段与受控筛选组成的SQL
     */
    static String adminTransactionQuery(UserCreditQuery query) {
        StringBuilder sql = new StringBuilder(ADMIN_TRANSACTION_QUERY);
        if (query.userId() != null) {
            sql.append(" AND credit_transactions.user_id = :userId\n");
        }
        return transactionQuery(sql, query);
    }

    /**
     * 追加统一积分明细的公共筛选条件。
     *
     * @param sql StringBuilder 已包含基础查询条件的SQL
     * @param query UserCreditQuery 查询条件
     * @return String 追加筛选后的SQL
     */
    private static String transactionQuery(StringBuilder sql, UserCreditQuery query) {
        if ("add".equals(query.direction())) {
            sql.append(" AND credit_transactions.change_amount > 0\n");
        } else if ("spend".equals(query.direction())) {
            sql.append(" AND credit_transactions.change_amount < 0")
                    .append(" AND NOT (credit_transactions.transaction_type = 'task_charge' AND EXISTS (")
                    .append("SELECT 1 FROM user_credit_transactions refunded_transactions ")
                    .append("WHERE refunded_transactions.task_id = credit_transactions.task_id ")
                    .append("AND refunded_transactions.transaction_type = 'task_refund'))\n");
        }
        if (query.source() != null) {
            if ("image".equals(query.source()) || "video".equals(query.source())) {
                sql.append(" AND tasks.task_type = :source\n");
            } else {
                sql.append(" AND credit_transactions.transaction_type = :source\n");
            }
        }
        return sql.toString();
    }

    /**
     * 绑定用户统一积分明细查询参数。
     *
     * @param spec GenericExecuteSpec 待绑定的SQL执行器
     * @param query UserCreditQuery 查询条件
     * @return GenericExecuteSpec 已绑定参数的SQL执行器
     */
    private DatabaseClient.GenericExecuteSpec bindUserTransactionQuery(DatabaseClient.GenericExecuteSpec spec, UserCreditQuery query) {
        DatabaseClient.GenericExecuteSpec boundSpec = spec
                .bind("startAt", query.startAt())
                .bind("endAt", query.endAt());
        if (query.userId() != null) {
            boundSpec = boundSpec.bind("userId", query.userId());
        }
        return query.source() == null ? boundSpec : boundSpec.bind("source", query.source());
    }

    /**
     * 分页查询用户统一积分流水明细（含增加与消耗）。
     *
     * @param query UserCreditQuery 查询条件
     * @param page int 页码
     * @param pageSize int 每页数量
     * @return Flux<UserCreditTransactionItem> 当前页明细
     */
    public Flux<CreditDtos.UserCreditTransactionItem> listUserTransactions(UserCreditQuery query, int page, int pageSize) {
        String sql = """
                SELECT credit_transactions.id,
                       credit_transactions.transaction_type,
                       credit_transactions.generation_source,
                       credit_transactions.change_amount,
                       credit_transactions.balance_after,
                       credit_transactions.reason,
                       credit_transactions.invited_user_id,
                       credit_transactions.created_at,
                       tasks.task_type AS generation_type,
                       tasks.model AS model
                """ + userTransactionQuery(query) + """
                ORDER BY credit_transactions.created_at DESC, credit_transactions.id DESC
                LIMIT :limit OFFSET :offset
                """;
        return bindUserTransactionQuery(databaseClient.sql(sql), query)
                .bind("limit", pageSize)
                .bind("offset", (page - 1) * pageSize)
                .map((row, metadata) -> {
                    BigDecimal changeAmount = row.get("change_amount", BigDecimal.class);
                    return new CreditDtos.UserCreditTransactionItem(
                            row.get("id", Long.class),
                            row.get("transaction_type", String.class),
                            CreditAmounts.of(changeAmount).compareTo(CreditAmounts.of(0)) > 0 ? "add" : "spend",
                            row.get("generation_type", String.class),
                            row.get("model", String.class),
                            row.get("generation_source", String.class),
                            changeAmount,
                            row.get("reason", String.class),
                            row.get("balance_after", BigDecimal.class),
                            row.get("invited_user_id", Long.class),
                            row.get("created_at", OffsetDateTime.class).toString());
                })
                .all();
    }

    /**
     * 查询用户统一积分流水明细总数。
     *
     * @param query UserCreditQuery 查询条件
     * @return Mono<Long> 符合条件的明细总数
     */
    public Mono<Long> countUserTransactions(UserCreditQuery query) {
        String sql = "SELECT COUNT(*) AS total " + userTransactionQuery(query);
        return bindUserTransactionQuery(databaseClient.sql(sql), query)
                .map((row, metadata) -> row.get("total", Long.class))
                .one();
    }

    /** 用户生成任务记录查询条件。 */
    public record TaskRecordQuery(Long userId,
                                  OffsetDateTime startAt,
                                  OffsetDateTime endAt,
                                  String taskType,
                                  String keyword) {
    }

    /** 用户生成任务记录基础查询条件，只保留已扣费的图片与视频任务。 */
    private static final String TASK_RECORD_QUERY = """
            FROM ai_generation_tasks tasks
            WHERE tasks.user_id = :userId
              AND tasks.task_type IN ('image', 'video')
              AND tasks.data_purged = FALSE
              AND tasks.created_at >= :startAt
              AND tasks.created_at < :endAt
            """;

    /**
     * 生成用户生成任务记录查询SQL。
     *
     * @param query TaskRecordQuery 查询条件
     * @return String 固定字段与受控筛选组成的SQL
     */
    static String taskRecordQuery(TaskRecordQuery query) {
        StringBuilder sql = new StringBuilder(TASK_RECORD_QUERY);
        if (query.taskType() != null) {
            sql.append(" AND tasks.task_type = :taskType\n");
        }
        if (query.keyword() != null) {
            sql.append(" AND (tasks.request_data ->> 'prompt' ILIKE :keyword OR tasks.model ILIKE :keyword)\n");
        }
        return sql.toString();
    }

    /**
     * 分页查询用户图片与视频生成任务记录。
     *
     * @param query TaskRecordQuery 查询条件
     * @param page int 页码
     * @param pageSize int 每页数量
     * @return Flux<TaskRecordItem> 当前页任务记录
     */
    public Flux<CreditDtos.TaskRecordItem> listTaskRecords(TaskRecordQuery query, int page, int pageSize) {
        String sql = """
                SELECT tasks.id AS task_id,
                       tasks.task_type,
                       tasks.model,
                       tasks.status,
                       tasks.error_message,
                       tasks.request_data ->> 'prompt' AS prompt,
                       tasks.request_data -> 'parameters' ->> 'resolution' AS resolution,
                       tasks.request_data -> 'parameters' ->> 'size' AS size,
                       tasks.request_data -> 'parameters' ->> 'seconds' AS seconds,
                       COALESCE((SELECT -SUM(task_transactions.change_amount) FROM user_credit_transactions task_transactions
                                 WHERE task_transactions.task_id = tasks.id
                                   AND task_transactions.transaction_type IN ('task_charge', 'task_refund')), 0) AS consumed_credits,
                       CASE WHEN jsonb_typeof(tasks.result_data -> 'items') = 'array'
                                 THEN COALESCE(jsonb_path_query_array(tasks.result_data, '$.items[*].url'), '[]'::jsonb)
                            WHEN jsonb_typeof(tasks.result_data -> 'item') = 'object'
                                 THEN COALESCE(jsonb_path_query_array(tasks.result_data, '$.item.url'), '[]'::jsonb)
                            ELSE '[]'::jsonb END::text AS result_urls,
                       tasks.created_at,
                       tasks.completed_at
                """ + taskRecordQuery(query) + """
                ORDER BY tasks.created_at DESC, tasks.id DESC
                LIMIT :limit OFFSET :offset
                """;
        return bindTaskRecordQuery(databaseClient.sql(sql), query)
                .bind("limit", pageSize)
                .bind("offset", (page - 1) * pageSize)
                .map((row, metadata) -> {
                    OffsetDateTime completedAt = row.get("completed_at", OffsetDateTime.class);
                    return new CreditDtos.TaskRecordItem(
                            row.get("task_id", String.class),
                            row.get("task_type", String.class),
                            row.get("model", String.class),
                            row.get("status", String.class),
                            row.get("prompt", String.class),
                            row.get("resolution", String.class),
                            row.get("size", String.class),
                            row.get("seconds", String.class),
                            row.get("consumed_credits", BigDecimal.class),
                            parseStringArray(RowMappers.jsonText(row, "result_urls")),
                            row.get("error_message", String.class),
                            row.get("created_at", OffsetDateTime.class).toString(),
                            completedAt == null ? null : completedAt.toString());
                })
                .all();
    }

    /**
     * 查询用户图片与视频生成任务记录总数。
     *
     * @param query TaskRecordQuery 查询条件
     * @return Mono<Long> 符合条件的任务总数
     */
    public Mono<Long> countTaskRecords(TaskRecordQuery query) {
        return bindTaskRecordQuery(databaseClient.sql("SELECT COUNT(*) AS total " + taskRecordQuery(query)), query)
                .map((row, metadata) -> row.get("total", Long.class))
                .one();
    }

    /**
     * 绑定生成任务记录查询参数。
     *
     * @param spec DatabaseClient.GenericExecuteSpec 待绑定的SQL执行器
     * @param query TaskRecordQuery 查询条件
     * @return DatabaseClient.GenericExecuteSpec 已绑定参数的SQL执行器
     */
    private DatabaseClient.GenericExecuteSpec bindTaskRecordQuery(DatabaseClient.GenericExecuteSpec spec, TaskRecordQuery query) {
        DatabaseClient.GenericExecuteSpec boundSpec = spec
                .bind("userId", query.userId())
                .bind("startAt", query.startAt())
                .bind("endAt", query.endAt());
        if (query.taskType() != null) {
            boundSpec = boundSpec.bind("taskType", query.taskType());
        }
        return query.keyword() == null ? boundSpec : boundSpec.bind("keyword", "%" + query.keyword() + "%");
    }

    /**
     * 解析数据库返回的JSON字符串数组。
     *
     * @param json String JSON数组文本
     * @return List<String> 解析结果，文本为空时返回空列表
     */
    private static List<String> parseStringArray(String json) {
        if (json == null || json.isBlank()) {
            return List.of();
        }
        List<String> values = com.alibaba.fastjson2.JSON.parseArray(json, String.class);
        return values == null ? List.of() : values.stream().filter(value -> value != null && !value.isBlank()).toList();
    }
}
