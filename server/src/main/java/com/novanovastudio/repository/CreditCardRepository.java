package com.novanovastudio.repository;

import java.time.OffsetDateTime;
import lombok.RequiredArgsConstructor;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 积分卡密批次、库存和兑换记录数据访问仓储。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-08-02 12:40
 */
@Repository
@RequiredArgsConstructor
public class CreditCardRepository {

    /** 数据库客户端。 */
    private final DatabaseClient databaseClient;

    /**
     * 创建卡密批次并返回批次ID。
     *
     * @param quantity int 生成数量
     * @param creditsPerCard int 单卡积分
     * @param createdBy Long 创建管理员ID
     * @return Mono<Long> 批次ID
     */
    public Mono<Long> createBatch(int quantity, int creditsPerCard, Long createdBy) {
        return databaseClient.sql("""
                        INSERT INTO credit_card_batches(quantity, credits_per_card, created_by)
                        VALUES (:quantity, :creditsPerCard, :createdBy)
                        RETURNING id
                        """)
                .bind("quantity", quantity)
                .bind("creditsPerCard", creditsPerCard)
                .bind("createdBy", createdBy)
                .map((row, metadata) -> row.get("id", Long.class))
                .one();
    }

    /**
     * 写入单张卡密库存。
     *
     * @param batchId Long 批次ID
     * @param codeHash String 卡密摘要
     * @param codeEncrypted String 卡密密文
     * @param codeMasked String 脱敏卡密
     * @param codeSuffix String 卡密末四位
     * @param credits int 可兑换积分
     * @return Mono<Void> 写入结果
     */
    public Mono<Void> createCard(Long batchId, String codeHash, String codeEncrypted, String codeMasked, String codeSuffix, int credits) {
        return databaseClient.sql("""
                        INSERT INTO credit_cards(batch_id, code_hash, code_encrypted, code_masked, code_suffix, credits)
                        VALUES (:batchId, :codeHash, :codeEncrypted, :codeMasked, :codeSuffix, :credits)
                        """)
                .bind("batchId", batchId)
                .bind("codeHash", codeHash)
                .bind("codeEncrypted", codeEncrypted)
                .bind("codeMasked", codeMasked)
                .bind("codeSuffix", codeSuffix)
                .bind("credits", credits)
                .fetch()
                .rowsUpdated()
                .then();
    }

    /**
     * 原子抢占未兑换卡密。
     *
     * @param codeHash String 卡密摘要
     * @param userId Long 兑换用户ID
     * @return Mono<ClaimedCard> 成功抢占的卡密，已兑换或不存在时为空
     */
    public Mono<ClaimedCard> claimUnredeemedCard(String codeHash, Long userId) {
        return databaseClient.sql("""
                        UPDATE credit_cards
                        SET redeemed_by_user_id = :userId, redeemed_at = CURRENT_TIMESTAMP
                        WHERE code_hash = :codeHash AND redeemed_at IS NULL
                        RETURNING id, code_masked, code_suffix, credits, redeemed_at
                        """)
                .bind("codeHash", codeHash)
                .bind("userId", userId)
                .map((row, metadata) -> new ClaimedCard(
                        row.get("id", Long.class),
                        row.get("code_masked", String.class),
                        row.get("code_suffix", String.class),
                        row.get("credits", Integer.class),
                        row.get("redeemed_at", OffsetDateTime.class)))
                .one();
    }

    /**
     * 查询卡密是否存在及其兑换状态。
     *
     * @param codeHash String 卡密摘要
     * @return Mono<CardStatus> 卡密状态
     */
    public Mono<CardStatus> findCardStatus(String codeHash) {
        return databaseClient.sql("SELECT id, redeemed_at FROM credit_cards WHERE code_hash = :codeHash")
                .bind("codeHash", codeHash)
                .map((row, metadata) -> new CardStatus(row.get("id", Long.class), row.get("redeemed_at", OffsetDateTime.class)))
                .one();
    }

    /**
     * 分页查询卡密批次统计。
     *
     * @param page int 页码
     * @param pageSize int 每页数量
     * @return Flux<BatchRecord> 批次统计
     */
    public Flux<BatchRecord> listBatches(int page, int pageSize) {
        return databaseClient.sql("""
                        SELECT batches.id,
                               batches.quantity,
                               batches.credits_per_card,
                               COUNT(cards.id) FILTER (WHERE cards.redeemed_at IS NOT NULL) AS redeemed_count,
                               batches.created_by,
                               creator.nickname AS created_by_nickname,
                               creator.username AS created_by_username,
                               creator.email AS created_by_email,
                               batches.created_at
                        FROM credit_card_batches batches
                        JOIN users creator ON creator.id = batches.created_by
                        LEFT JOIN credit_cards cards ON cards.batch_id = batches.id
                        GROUP BY batches.id, creator.nickname, creator.username, creator.email
                        ORDER BY batches.created_at DESC, batches.id DESC
                        LIMIT :limit OFFSET :offset
                        """)
                .bind("limit", pageSize)
                .bind("offset", (page - 1) * pageSize)
                .map((row, metadata) -> new BatchRecord(
                        row.get("id", Long.class),
                        row.get("quantity", Integer.class),
                        row.get("credits_per_card", Integer.class),
                        row.get("redeemed_count", Long.class),
                        row.get("created_by", Long.class),
                        row.get("created_by_nickname", String.class),
                        row.get("created_by_username", String.class),
                        row.get("created_by_email", String.class),
                        row.get("created_at", OffsetDateTime.class)))
                .all();
    }

    /**
     * 查询卡密批次总数。
     *
     * @return Mono<Long> 批次总数
     */
    public Mono<Long> countBatches() {
        return databaseClient.sql("SELECT COUNT(*) AS total FROM credit_card_batches")
                .map((row, metadata) -> row.get("total", Long.class))
                .one();
    }

    /**
     * 分页查询管理员卡密库存。
     *
     * @param query CardListQuery 筛选条件
     * @param page int 页码
     * @param pageSize int 每页数量
     * @return Flux<CardRecord> 当前页库存
     */
    public Flux<CardRecord> listCards(CardListQuery query, int page, int pageSize) {
        String sql = """
                SELECT cards.id,
                       cards.batch_id,
                       cards.code_encrypted,
                       cards.code_masked,
                       cards.code_suffix,
                       cards.credits,
                       cards.redeemed_by_user_id,
                       redeemed_user.username AS redeemed_by_username,
                       redeemed_user.nickname AS redeemed_by_nickname,
                       redeemed_user.email AS redeemed_by_email,
                       cards.redeemed_at,
                       cards.created_at,
                       transactions.id AS transaction_id,
                       transactions.balance_after
                FROM credit_cards cards
                JOIN credit_card_batches batches ON batches.id = cards.batch_id
                LEFT JOIN users redeemed_user ON redeemed_user.id = cards.redeemed_by_user_id
                LEFT JOIN user_credit_transactions transactions
                    ON transactions.credit_card_id = cards.id AND transactions.transaction_type = 'card_redeem'
                WHERE 1 = 1
                """ + cardFilters(query) + """
                ORDER BY cards.created_at DESC, cards.id DESC
                LIMIT :limit OFFSET :offset
                """;
        return bindCardQuery(databaseClient.sql(sql), query)
                .bind("limit", pageSize)
                .bind("offset", (page - 1) * pageSize)
                .map((row, metadata) -> new CardRecord(
                        row.get("id", Long.class),
                        row.get("batch_id", Long.class),
                        row.get("code_encrypted", String.class),
                        row.get("code_masked", String.class),
                        row.get("code_suffix", String.class),
                        row.get("credits", Integer.class),
                        row.get("redeemed_by_user_id", Long.class),
                        row.get("redeemed_by_username", String.class),
                        row.get("redeemed_by_nickname", String.class),
                        row.get("redeemed_by_email", String.class),
                        row.get("redeemed_at", OffsetDateTime.class),
                        row.get("created_at", OffsetDateTime.class),
                        row.get("transaction_id", Long.class),
                        row.get("balance_after", Integer.class)))
                .all();
    }

    /**
     * 查询管理员卡密库存总数。
     *
     * @param query CardListQuery 筛选条件
     * @return Mono<Long> 卡密总数
     */
    public Mono<Long> countCards(CardListQuery query) {
        return bindCardQuery(databaseClient.sql("SELECT COUNT(*) AS total FROM credit_cards cards JOIN credit_card_batches batches ON batches.id = cards.batch_id LEFT JOIN users redeemed_user ON redeemed_user.id = cards.redeemed_by_user_id WHERE 1 = 1 " + cardFilters(query)), query)
                .map((row, metadata) -> row.get("total", Long.class))
                .one();
    }

    /**
     * 分页查询当前用户兑换记录。
     *
     * @param query RedemptionQuery 筛选条件
     * @param page int 页码
     * @param pageSize int 每页数量
     * @return Flux<RedemptionRecord> 兑换记录
     */
    public Flux<RedemptionRecord> listRedemptions(RedemptionQuery query, int page, int pageSize) {
        String sql = """
                SELECT cards.id,
                       transactions.id AS transaction_id,
                       cards.code_encrypted,
                       cards.code_masked,
                       cards.code_suffix,
                       cards.credits,
                       transactions.balance_after,
                       cards.redeemed_at
                FROM credit_cards cards
                JOIN user_credit_transactions transactions
                    ON transactions.credit_card_id = cards.id AND transactions.transaction_type = 'card_redeem'
                WHERE cards.redeemed_by_user_id = :userId
                  AND cards.redeemed_at >= :startAt
                  AND cards.redeemed_at < :endAt
                """ + redemptionFilters(query) + """
                ORDER BY cards.redeemed_at DESC, cards.id DESC
                LIMIT :limit OFFSET :offset
                """;
        return bindRedemptionQuery(databaseClient.sql(sql), query)
                .bind("limit", pageSize)
                .bind("offset", (page - 1) * pageSize)
                .map((row, metadata) -> new RedemptionRecord(
                        row.get("id", Long.class),
                        row.get("transaction_id", Long.class),
                        row.get("code_encrypted", String.class),
                        row.get("code_masked", String.class),
                        row.get("code_suffix", String.class),
                        row.get("credits", Integer.class),
                        row.get("balance_after", Integer.class),
                        row.get("redeemed_at", OffsetDateTime.class)))
                .all();
    }

    /**
     * 查询当前用户兑换记录总数。
     *
     * @param query RedemptionQuery 筛选条件
     * @return Mono<Long> 记录总数
     */
    public Mono<Long> countRedemptions(RedemptionQuery query) {
        String sql = """
                SELECT COUNT(*) AS total
                FROM credit_cards cards
                WHERE cards.redeemed_by_user_id = :userId
                  AND cards.redeemed_at >= :startAt
                  AND cards.redeemed_at < :endAt
                """ + redemptionFilters(query);
        return bindRedemptionQuery(databaseClient.sql(sql), query)
                .map((row, metadata) -> row.get("total", Long.class))
                .one();
    }

    /**
     * 构建卡密筛选SQL。
     *
     * @param query CardListQuery 筛选条件
     * @return String 固定字段筛选片段
     */
    static String cardFilters(CardListQuery query) {
        StringBuilder sql = new StringBuilder();
        if (query.batchId() != null) sql.append(" AND cards.batch_id = :batchId\n");
        if ("available".equals(query.status())) sql.append(" AND cards.redeemed_at IS NULL\n");
        if ("redeemed".equals(query.status())) sql.append(" AND cards.redeemed_at IS NOT NULL\n");
        if (query.codeHash() != null) sql.append(" AND cards.code_hash = :codeHash\n");
        if (query.codeSuffix() != null) sql.append(" AND cards.code_suffix = :codeSuffix\n");
        if (query.redeemedUserKeyword() != null) {
            sql.append(" AND (LOWER(COALESCE(redeemed_user.email, '')) LIKE :redeemedUserKeyword OR LOWER(COALESCE(redeemed_user.username, '')) LIKE :redeemedUserKeyword OR LOWER(COALESCE(redeemed_user.nickname, '')) LIKE :redeemedUserKeyword)\n");
        }
        return sql.toString();
    }

    /**
     * 构建兑换记录卡密筛选SQL。
     *
     * @param query RedemptionQuery 筛选条件
     * @return String 固定字段筛选片段
     */
    static String redemptionFilters(RedemptionQuery query) {
        StringBuilder sql = new StringBuilder();
        if (query.codeHash() != null) sql.append(" AND cards.code_hash = :codeHash\n");
        if (query.codeSuffix() != null) sql.append(" AND cards.code_suffix = :codeSuffix\n");
        return sql.toString();
    }

    /**
     * 绑定卡密查询参数。
     *
     * @param spec DatabaseClient.GenericExecuteSpec SQL执行器
     * @param query CardListQuery 筛选条件
     * @return DatabaseClient.GenericExecuteSpec 已绑定SQL执行器
     */
    private DatabaseClient.GenericExecuteSpec bindCardQuery(DatabaseClient.GenericExecuteSpec spec, CardListQuery query) {
        DatabaseClient.GenericExecuteSpec bound = spec;
        if (query.batchId() != null) bound = bound.bind("batchId", query.batchId());
        if (query.codeHash() != null) bound = bound.bind("codeHash", query.codeHash());
        if (query.codeSuffix() != null) bound = bound.bind("codeSuffix", query.codeSuffix());
        if (query.redeemedUserKeyword() != null) bound = bound.bind("redeemedUserKeyword", "%" + query.redeemedUserKeyword() + "%");
        return bound;
    }

    /**
     * 绑定兑换记录查询参数。
     *
     * @param spec DatabaseClient.GenericExecuteSpec SQL执行器
     * @param query RedemptionQuery 筛选条件
     * @return DatabaseClient.GenericExecuteSpec 已绑定SQL执行器
     */
    private DatabaseClient.GenericExecuteSpec bindRedemptionQuery(DatabaseClient.GenericExecuteSpec spec, RedemptionQuery query) {
        DatabaseClient.GenericExecuteSpec bound = spec
                .bind("userId", query.userId())
                .bind("startAt", query.startAt())
                .bind("endAt", query.endAt());
        if (query.codeHash() != null) bound = bound.bind("codeHash", query.codeHash());
        if (query.codeSuffix() != null) bound = bound.bind("codeSuffix", query.codeSuffix());
        return bound;
    }

    /**
     * 已抢占的卡密记录。
     *
     * @param id Long 卡密ID
     * @param codeMasked String 脱敏卡密
     * @param codeSuffix String 末四位
     * @param credits Integer 积分
     * @param redeemedAt OffsetDateTime 兑换时间
     */
    public record ClaimedCard(Long id, String codeMasked, String codeSuffix, Integer credits, OffsetDateTime redeemedAt) {
    }

    /**
     * 卡密状态记录。
     *
     * @param id Long 卡密ID
     * @param redeemedAt OffsetDateTime 兑换时间
     */
    public record CardStatus(Long id, OffsetDateTime redeemedAt) {
    }

    /**
     * 卡密批次记录。
     *
     * @param id Long 批次ID
     * @param quantity Integer 生成数量
     * @param creditsPerCard Integer 单卡积分
     * @param redeemedCount Long 已兑换数量
     * @param createdByUserId Long 创建管理员ID
     * @param createdByNickname String 创建管理员昵称
     * @param createdByUsername String 创建管理员用户名
     * @param createdByEmail String 创建管理员邮箱
     * @param createdAt OffsetDateTime 创建时间
     */
    public record BatchRecord(Long id, Integer quantity, Integer creditsPerCard, Long redeemedCount, Long createdByUserId,
                              String createdByNickname, String createdByUsername, String createdByEmail, OffsetDateTime createdAt) {
    }

    /**
     * 管理员卡密记录。
     *
     * @param id Long 卡密ID
     * @param batchId Long 批次ID
     * @param codeEncrypted String 加密卡密
     * @param codeMasked String 脱敏卡密
     * @param codeSuffix String 末四位
     * @param credits Integer 积分
     * @param redeemedByUserId Long 兑换用户ID
     * @param redeemedByUsername String 兑换用户名
     * @param redeemedByNickname String 兑换昵称
     * @param redeemedByEmail String 兑换邮箱
     * @param redeemedAt OffsetDateTime 兑换时间
     * @param createdAt OffsetDateTime 创建时间
     * @param transactionId Long 积分流水ID
     * @param balanceAfter Integer 流水余额
     */
    public record CardRecord(Long id, Long batchId, String codeEncrypted, String codeMasked, String codeSuffix, Integer credits,
                             Long redeemedByUserId, String redeemedByUsername, String redeemedByNickname, String redeemedByEmail,
                             OffsetDateTime redeemedAt, OffsetDateTime createdAt, Long transactionId, Integer balanceAfter) {
    }

    /**
     * 管理员卡密查询条件。
     *
     * @param batchId Long 批次ID
     * @param status String 状态
     * @param codeHash String 卡密摘要
     * @param codeSuffix String 卡密末四位
     * @param redeemedUserKeyword String 兑换用户关键词
     */
    public record CardListQuery(Long batchId, String status, String codeHash, String codeSuffix, String redeemedUserKeyword) {
    }

    /**
     * 当前用户兑换记录查询条件。
     *
     * @param userId Long 用户ID
     * @param startAt OffsetDateTime 起始时间
     * @param endAt OffsetDateTime 结束时间
     * @param codeHash String 卡密摘要
     * @param codeSuffix String 卡密末四位
     */
    public record RedemptionQuery(Long userId, OffsetDateTime startAt, OffsetDateTime endAt, String codeHash, String codeSuffix) {
    }

    /**
     * 当前用户兑换记录。
     *
     * @param id Long 卡密ID
     * @param transactionId Long 积分流水ID
     * @param codeEncrypted String 加密卡密
     * @param codeMasked String 脱敏卡密
     * @param codeSuffix String 末四位
     * @param credits Integer 积分
     * @param balanceAfter Integer 流水余额
     * @param redeemedAt OffsetDateTime 兑换时间
     */
    public record RedemptionRecord(Long id, Long transactionId, String codeEncrypted, String codeMasked, String codeSuffix, Integer credits,
                                   Integer balanceAfter, OffsetDateTime redeemedAt) {
    }
}
