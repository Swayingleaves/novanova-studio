package com.novanovastudio.repository;

import com.novanovastudio.dto.CreditDtos;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 积分商品和购买订单数据访问仓储。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-10-27 14:00
 */
@Repository
public class CreditPurchaseRepository {

    /** 数据库客户端。 */
    private final DatabaseClient databaseClient;

    /**
     * 构造积分购买仓储。
     *
     * @param databaseClient DatabaseClient 数据库客户端
     */
    public CreditPurchaseRepository(DatabaseClient databaseClient) {
        this.databaseClient = databaseClient;
    }

    /**
     * 查询启用的积分商品。
     *
     * @return Mono<List<Product>> 商品列表
     */
    public Mono<List<Product>> listEnabledProducts() {
        return databaseClient.sql("""
                SELECT id, credits, bonus_credits, price_amount, sort_order, enabled
                FROM credit_products
                WHERE enabled = TRUE
                ORDER BY sort_order ASC, id ASC
                """)
                .map((row, metadata) -> product(row.get("id", Long.class), row.get("credits", BigDecimal.class), row.get("bonus_credits", BigDecimal.class),
                        row.get("price_amount", BigDecimal.class), row.get("sort_order", Integer.class), row.get("enabled", Boolean.class)))
                .all().collectList();
    }

    /**
     * 查询全部积分商品。
     *
     * @return Mono<List<Product>> 商品列表
     */
    public Mono<List<Product>> listAllProducts() {
        return databaseClient.sql("""
                SELECT id, credits, bonus_credits, price_amount, sort_order, enabled
                FROM credit_products
                ORDER BY sort_order ASC, id ASC
                """)
                .map((row, metadata) -> product(row.get("id", Long.class), row.get("credits", BigDecimal.class), row.get("bonus_credits", BigDecimal.class),
                        row.get("price_amount", BigDecimal.class), row.get("sort_order", Integer.class), row.get("enabled", Boolean.class)))
                .all().collectList();
    }

    /**
     * 查询指定积分商品。
     *
     * @param productId Long 商品标识
     * @return Mono<Product> 商品，不存在时为空
     */
    public Mono<Product> findProduct(Long productId) {
        return databaseClient.sql("""
                SELECT id, credits, bonus_credits, price_amount, sort_order, enabled
                FROM credit_products
                WHERE id = :productId
                """)
                .bind("productId", productId)
                .map((row, metadata) -> product(row.get("id", Long.class), row.get("credits", BigDecimal.class), row.get("bonus_credits", BigDecimal.class),
                        row.get("price_amount", BigDecimal.class), row.get("sort_order", Integer.class), row.get("enabled", Boolean.class)))
                .one();
    }

    /**
     * 创建积分商品。
     *
     * @param credits BigDecimal 积分数量
     * @param bonusCredits BigDecimal 赠送积分数量
     * @param priceAmount BigDecimal 商品金额
     * @param sortOrder int 展示排序
     * @param enabled boolean 是否启用
     * @return Mono<Product> 创建后的商品
     */
    public Mono<Product> createProduct(BigDecimal credits, BigDecimal bonusCredits, BigDecimal priceAmount, int sortOrder, boolean enabled) {
        return databaseClient.sql("""
                INSERT INTO credit_products(credits, bonus_credits, price_amount, sort_order, enabled)
                VALUES (:credits, :bonusCredits, :priceAmount, :sortOrder, :enabled)
                RETURNING id, credits, bonus_credits, price_amount, sort_order, enabled
                """)
                .bind("credits", credits).bind("bonusCredits", bonusCredits).bind("priceAmount", priceAmount).bind("sortOrder", sortOrder).bind("enabled", enabled)
                .map((row, metadata) -> product(row.get("id", Long.class), row.get("credits", BigDecimal.class), row.get("bonus_credits", BigDecimal.class),
                        row.get("price_amount", BigDecimal.class), row.get("sort_order", Integer.class), row.get("enabled", Boolean.class)))
                .one();
    }

    /**
     * 修改积分商品。
     *
     * @param id Long 商品标识
     * @param credits BigDecimal 积分数量
     * @param bonusCredits BigDecimal 赠送积分数量
     * @param priceAmount BigDecimal 商品金额
     * @param sortOrder int 展示排序
     * @param enabled boolean 是否启用
     * @return Mono<Product> 修改后的商品
     */
    public Mono<Product> updateProduct(Long id, BigDecimal credits, BigDecimal bonusCredits, BigDecimal priceAmount, int sortOrder, boolean enabled) {
        return databaseClient.sql("""
                UPDATE credit_products
                SET credits = :credits, bonus_credits = :bonusCredits, price_amount = :priceAmount, sort_order = :sortOrder,
                    enabled = :enabled, updated_at = CURRENT_TIMESTAMP
                WHERE id = :id
                RETURNING id, credits, bonus_credits, price_amount, sort_order, enabled
                """)
                .bind("id", id).bind("credits", credits).bind("bonusCredits", bonusCredits).bind("priceAmount", priceAmount).bind("sortOrder", sortOrder).bind("enabled", enabled)
                .map((row, metadata) -> product(row.get("id", Long.class), row.get("credits", BigDecimal.class), row.get("bonus_credits", BigDecimal.class),
                        row.get("price_amount", BigDecimal.class), row.get("sort_order", Integer.class), row.get("enabled", Boolean.class)))
                .one();
    }

    /**
     * 修改积分商品启用状态。
     *
     * @param id Long 商品标识
     * @param enabled boolean 是否启用
     * @return Mono<Product> 修改后的商品
     */
    public Mono<Product> updateProductStatus(Long id, boolean enabled) {
        return databaseClient.sql("""
                UPDATE credit_products
                SET enabled = :enabled, updated_at = CURRENT_TIMESTAMP
                WHERE id = :id
                RETURNING id, credits, bonus_credits, price_amount, sort_order, enabled
                """)
                .bind("id", id).bind("enabled", enabled)
                .map((row, metadata) -> product(row.get("id", Long.class), row.get("credits", BigDecimal.class), row.get("bonus_credits", BigDecimal.class),
                        row.get("price_amount", BigDecimal.class), row.get("sort_order", Integer.class), row.get("enabled", Boolean.class)))
                .one();
    }

    /**
     * 创建待支付订单。
     *
     * @param orderNo String 平台订单号
     * @param userId Long 用户标识
     * @param productId Long 商品标识
     * @param baseCredits BigDecimal 商品基础积分快照
     * @param credits BigDecimal 积分数量快照
     * @param priceAmount BigDecimal 金额快照
     * @param paymentMethod String 支付方式
     * @param expiresAt OffsetDateTime 过期时间
     * @return Mono<Order> 创建后的订单
     */
    public Mono<Order> createOrder(String orderNo, Long userId, Long productId, BigDecimal baseCredits, BigDecimal credits,
                                   BigDecimal priceAmount, String paymentMethod, OffsetDateTime expiresAt) {
        return databaseClient.sql("""
                INSERT INTO credit_purchase_orders(order_no, user_id, product_id, base_credits, credits, price_amount,
                    wallet_team_id, payment_method, status, expires_at)
                VALUES (:orderNo, :userId, :productId, :baseCredits, :credits, :priceAmount, 0, :paymentMethod, 'pending', :expiresAt)
                RETURNING id, order_no, user_id, product_id, credits, price_amount, wallet_team_id, payment_method, status,
                    provider_trade_no, expires_at, paid_at, created_at, first_purchase_bonus_credits, base_credits
                """)
                .bind("orderNo", orderNo).bind("userId", userId).bind("productId", productId).bind("baseCredits", baseCredits)
                .bind("credits", credits).bind("priceAmount", priceAmount).bind("paymentMethod", paymentMethod).bind("expiresAt", expiresAt)
                .map((row, metadata) -> order(row)).one();
    }

    /**
     * 查询当前用户订单。
     *
     * @param orderNo String 平台订单号
     * @param userId Long 用户标识
     * @return Mono<Order> 订单，不存在时为空
     */
    public Mono<Order> findOrder(String orderNo, Long userId) {
        return databaseClient.sql("""
                SELECT id, order_no, user_id, product_id, credits, price_amount, wallet_team_id, payment_method, status,
                    provider_trade_no, expires_at, paid_at, created_at, first_purchase_bonus_credits, base_credits
                FROM credit_purchase_orders
                WHERE order_no = :orderNo AND user_id = :userId
                """)
                .bind("orderNo", orderNo).bind("userId", userId)
                .map((row, metadata) -> order(row)).one();
    }

    /**
     * 查询回调对应的订单。
     *
     * @param orderNo String 平台订单号
     * @return Mono<Order> 订单，不存在时为空
     */
    public Mono<Order> findOrder(String orderNo) {
        return databaseClient.sql("""
                SELECT id, order_no, user_id, product_id, credits, price_amount, wallet_team_id, payment_method, status,
                    provider_trade_no, expires_at, paid_at, created_at, first_purchase_bonus_credits, base_credits
                FROM credit_purchase_orders
                WHERE order_no = :orderNo
                """)
                .bind("orderNo", orderNo)
                .map((row, metadata) -> order(row)).one();
    }

    /**
     * 按主键游标分页读取微信待支付订单，避免失败订单阻塞后续订单。
     * @param afterId 上一批最后一个订单标识，首批为零
     * @param scanBefore 本轮扫描开始时间，排除扫描中新增的订单
     * @param limit 每批订单数量
     * @return 本批待核对订单
     */
    public Mono<List<Order>> listPendingWechatOrders(long afterId, OffsetDateTime scanBefore, int limit) {
        return databaseClient.sql("""
                SELECT id, order_no, user_id, product_id, credits, price_amount, wallet_team_id, payment_method, status,
                    provider_trade_no, expires_at, paid_at, created_at, first_purchase_bonus_credits, base_credits
                FROM credit_purchase_orders
                WHERE status = 'pending' AND payment_method = 'wechat' AND wallet_team_id = 0
                    AND id > :afterId AND created_at <= :scanBefore
                ORDER BY id ASC
                LIMIT :limit
                """)
                .bind("afterId", afterId).bind("scanBefore", scanBefore).bind("limit", limit)
                .map((row, metadata) -> order(row)).all().collectList();
    }

    /**
     * 查询用户最近的积分购买订单。
     *
     * @param userId Long 用户标识
     * @param limit int 返回条数
     * @return Mono<List<Order>> 订单列表
     */
    public Mono<List<Order>> listOrders(Long userId, int limit) {
        return databaseClient.sql("""
                SELECT id, order_no, user_id, product_id, credits, price_amount, wallet_team_id, payment_method, status,
                    provider_trade_no, expires_at, paid_at, created_at, first_purchase_bonus_credits, base_credits
                FROM credit_purchase_orders
                WHERE user_id = :userId AND wallet_team_id = 0
                ORDER BY created_at DESC, id DESC
                LIMIT :limit
                """)
                .bind("userId", userId).bind("limit", limit)
                .map((row, metadata) -> order(row)).all().collectList();
    }

    /**
     * 查询范围内的收入合计、已支付订单数和售出积分。
     *
     * @param query RevenueQuery 收入统计条件
     * @return Mono<RevenueSummary> 收入汇总，无订单时各项为零
     */
    public Mono<RevenueSummary> getRevenueSummary(RevenueQuery query) {
        String sql = """
                SELECT COALESCE(SUM(purchase_orders.price_amount), 0) AS total_revenue,
                       COUNT(*) AS order_count,
                       COALESCE(SUM(purchase_orders.credits), 0) AS total_credits
                """ + revenueQuery(query);
        return bindRevenueQuery(databaseClient.sql(sql), query)
                .map((row, metadata) -> new RevenueSummary(
                        row.get("total_revenue", BigDecimal.class),
                        row.get("order_count", Long.class),
                        row.get("total_credits", BigDecimal.class)))
                .one()
                .defaultIfEmpty(new RevenueSummary(BigDecimal.ZERO, 0L, BigDecimal.ZERO));
    }

    /**
     * 按支付方式汇总收入。
     *
     * @param query RevenueQuery 收入统计条件
     * @return Flux<RevenueDistributionItem> 支付方式收入分布
     */
    public Flux<CreditDtos.RevenueDistributionItem> listRevenueByPaymentMethod(RevenueQuery query) {
        String sql = """
                SELECT purchase_orders.payment_method AS name,
                       COALESCE(SUM(purchase_orders.price_amount), 0) AS revenue_amount,
                       COUNT(*) AS order_count
                """ + revenueQuery(query) + """
                GROUP BY purchase_orders.payment_method
                ORDER BY revenue_amount DESC, name ASC
                """;
        return bindRevenueQuery(databaseClient.sql(sql), query)
                .map((row, metadata) -> new CreditDtos.RevenueDistributionItem(
                        row.get("name", String.class),
                        amountText(row.get("revenue_amount", BigDecimal.class)),
                        row.get("order_count", Long.class)))
                .all();
    }

    /**
     * 按月汇总收入。
     *
     * @param query RevenueQuery 收入统计条件
     * @return Flux<RevenueTrendItem> 已产生收入的月份
     */
    public Flux<CreditDtos.RevenueTrendItem> listMonthlyRevenue(RevenueQuery query) {
        String sql = """
                SELECT TO_CHAR(DATE_TRUNC('month', COALESCE(purchase_orders.paid_at, purchase_orders.created_at) AT TIME ZONE 'Asia/Shanghai'), 'YYYY-MM') AS period,
                       COALESCE(SUM(purchase_orders.price_amount), 0) AS revenue_amount
                """ + revenueQuery(query) + """
                GROUP BY period
                ORDER BY period ASC
                """;
        return bindRevenueQuery(databaseClient.sql(sql), query)
                .map((row, metadata) -> new CreditDtos.RevenueTrendItem(
                        row.get("period", String.class),
                        amountText(row.get("revenue_amount", BigDecimal.class))))
                .all();
    }

    /**
     * 分页查询已支付订单的收入明细。
     *
     * @param query RevenueQuery 收入统计条件
     * @param page int 页码
     * @param pageSize int 每页数量
     * @return Flux<AdminRevenueRecordItem> 当前页收入明细
     */
    public Flux<CreditDtos.AdminRevenueRecordItem> listRevenueRecords(RevenueQuery query, int page, int pageSize) {
        String sql = """
                SELECT purchase_orders.id,
                       purchase_orders.order_no,
                       purchase_orders.user_id,
                       users.username,
                       users.nickname,
                       users.email,
                       CASE WHEN purchase_orders.base_credits > 0 THEN purchase_orders.base_credits ELSE purchase_orders.credits END AS base_credits,
                       purchase_orders.credits,
                       (purchase_orders.credits - CASE WHEN purchase_orders.base_credits > 0 THEN purchase_orders.base_credits ELSE purchase_orders.credits END) AS bonus_credits,
                       (purchase_orders.credits + purchase_orders.first_purchase_bonus_credits) AS change_amount,
                       purchase_orders.price_amount,
                       purchase_orders.payment_method,
                       COALESCE(purchase_orders.paid_at, purchase_orders.created_at) AS paid_at,
                       CASE WHEN transactions.balance_after IS NULL THEN NULL
                            ELSE transactions.balance_after + purchase_orders.first_purchase_bonus_credits END AS balance_after
                """ + revenueQuery(query) + """
                ORDER BY COALESCE(purchase_orders.paid_at, purchase_orders.created_at) DESC, purchase_orders.id DESC
                LIMIT :limit OFFSET :offset
                """;
        return bindRevenueQuery(databaseClient.sql(sql), query)
                .bind("limit", pageSize)
                .bind("offset", (page - 1) * pageSize)
                .map((row, metadata) -> new CreditDtos.AdminRevenueRecordItem(
                        row.get("id", Long.class),
                        row.get("order_no", String.class),
                        row.get("user_id", Long.class),
                        row.get("username", String.class),
                        row.get("nickname", String.class),
                        row.get("email", String.class),
                        row.get("base_credits", BigDecimal.class),
                        row.get("credits", BigDecimal.class),
                        row.get("bonus_credits", BigDecimal.class),
                        row.get("change_amount", BigDecimal.class),
                        amountText(row.get("price_amount", BigDecimal.class)),
                        row.get("payment_method", String.class),
                        row.get("balance_after", BigDecimal.class),
                        row.get("paid_at", OffsetDateTime.class).toString()))
                .all();
    }

    /**
     * 统计已支付订单的收入明细总数。
     *
     * @param query RevenueQuery 收入统计条件
     * @return Mono<Long> 符合条件的订单总数
     */
    public Mono<Long> countRevenueRecords(RevenueQuery query) {
        return bindRevenueQuery(databaseClient.sql("SELECT COUNT(*) AS total " + revenueQuery(query)), query)
                .map((row, metadata) -> row.get("total", Long.class))
                .one();
    }

    /**
     * 生成已支付收入订单的公共查询条件。
     *
     * @param query RevenueQuery 收入统计条件
     * @return String 固定字段与受控筛选组成的SQL
     */
    private static String revenueQuery(RevenueQuery query) {
        StringBuilder sql = new StringBuilder(REVENUE_ORDER_QUERY);
        if (query.userId() != null) {
            sql.append(" AND purchase_orders.user_id = :userId\n");
        }
        return sql.toString();
    }

    /**
     * 绑定收入统计查询参数。
     *
     * @param spec GenericExecuteSpec 待绑定的SQL执行器
     * @param query RevenueQuery 收入统计条件
     * @return GenericExecuteSpec 已绑定参数的SQL执行器
     */
    private DatabaseClient.GenericExecuteSpec bindRevenueQuery(DatabaseClient.GenericExecuteSpec spec, RevenueQuery query) {
        DatabaseClient.GenericExecuteSpec boundSpec = spec.bind("startAt", query.startAt()).bind("endAt", query.endAt());
        return query.userId() == null ? boundSpec : boundSpec.bind("userId", query.userId());
    }

    /**
     * 将金额格式化为两位小数的普通文本。
     *
     * @param amount BigDecimal 金额
     * @return String 两位小数金额文本
     */
    private static String amountText(BigDecimal amount) {
        return amount == null ? "0.00" : amount.setScale(2).toPlainString();
    }

    /**
     * 抢占待支付订单进入处理中状态，防止重复回调重复发放积分。
     *
     * <p>已关闭、已取消的订单同样可以抢占：渠道确认收款就说明钱已经到账，此时本地是否过期或被用户取消
     * 只是"不能再发起支付"，不能成为拒绝入账的理由，否则用户付了钱却拿不到积分。</p>
     *
     * @param orderNo String 平台订单号
     * @param providerTradeNo String 渠道交易号
     * @return Mono<Order> 抢占成功的订单，已被其他请求处理时为空
     */
    public Mono<Order> claimOrderForSettlement(String orderNo, String providerTradeNo) {
        return databaseClient.sql("""
                UPDATE credit_purchase_orders
                SET status = 'processing', provider_trade_no = :providerTradeNo, updated_at = CURRENT_TIMESTAMP
                WHERE order_no = :orderNo AND status IN ('pending', 'closed', 'cancelled')
                RETURNING id, order_no, user_id, product_id, credits, price_amount, wallet_team_id, payment_method, status,
                    provider_trade_no, expires_at, paid_at, created_at, first_purchase_bonus_credits, base_credits
                """)
                .bind("orderNo", orderNo).bind("providerTradeNo", providerTradeNo)
                .map((row, metadata) -> order(row)).one();
    }

    /**
     * 将订单标记为已支付。
     *
     * @param orderNo String 平台订单号
     * @param paidAt OffsetDateTime 支付完成时间
     * @return Mono<Void> 更新完成信号
     */
    public Mono<Void> markOrderPaid(String orderNo, OffsetDateTime paidAt) {
        return databaseClient.sql("""
                UPDATE credit_purchase_orders
                SET status = 'paid', paid_at = :paidAt, updated_at = CURRENT_TIMESTAMP
                WHERE order_no = :orderNo AND status = 'processing'
                """)
                .bind("orderNo", orderNo).bind("paidAt", paidAt)
                .fetch().rowsUpdated().then();
    }

    /**
     * 判定并记录首充赠送：仅当该用户没有其他已支付订单时写入赠送积分。
     *
     * @param userId Long 下单用户标识
     * @param orderNo String 当前结算的订单号
     * @param bonusCredits BigDecimal 计算出的赠送积分，为 0 时不发放
     * @return Mono<BigDecimal> 实际写入的赠送积分，未获得时为空
     */
    public Mono<BigDecimal> claimFirstPurchaseBonus(Long userId, String orderNo, BigDecimal bonusCredits) {
        return databaseClient.sql("""
                UPDATE credit_purchase_orders
                SET first_purchase_bonus_credits = :bonus, updated_at = CURRENT_TIMESTAMP
                WHERE order_no = :orderNo
                  AND :bonus > 0
                  AND NOT EXISTS (
                      SELECT 1 FROM credit_purchase_orders prior
                      WHERE prior.user_id = :userId AND prior.status = 'paid' AND prior.order_no <> :orderNo)
                RETURNING first_purchase_bonus_credits
                """)
                .bind("bonus", bonusCredits)
                .bind("orderNo", orderNo)
                .bind("userId", userId)
                .map((row, metadata) -> row.get("first_purchase_bonus_credits", BigDecimal.class))
                .one();
    }

    /**
     * 判断用户是否已有已支付订单。
     *
     * @param userId Long 用户标识
     * @return Mono<Boolean> 是否存在已支付订单
     */
    public Mono<Boolean> hasPaidPurchaseOrder(Long userId) {
        return databaseClient.sql("""
                SELECT EXISTS(SELECT 1 FROM credit_purchase_orders
                    WHERE user_id = :userId AND wallet_team_id = 0 AND status = 'paid') AS purchased
                """)
                .bind("userId", userId)
                .map((row, metadata) -> Boolean.TRUE.equals(row.get("purchased", Boolean.class)))
                .one();
    }

    /**
     * 将用户主动取消的待支付订单标记为已取消。
     *
     * @param orderNo String 平台订单号
     * @param userId Long 用户标识
     * @return Mono<Order> 取消后的订单，订单不再是待支付状态时为空
     */
    public Mono<Order> cancelOrder(String orderNo, Long userId) {
        return databaseClient.sql("""
                UPDATE credit_purchase_orders
                SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
                WHERE order_no = :orderNo AND user_id = :userId AND status = 'pending'
                RETURNING id, order_no, user_id, product_id, credits, price_amount, wallet_team_id, payment_method, status,
                    provider_trade_no, expires_at, paid_at, created_at, first_purchase_bonus_credits, base_credits
                """)
                .bind("orderNo", orderNo).bind("userId", userId)
                .map((row, metadata) -> order(row)).one();
    }

    /**
     * 将已过期订单标记为关闭。
     *
     * @param orderNo String 平台订单号
     * @return Mono<Void> 更新完成信号
     */
    public Mono<Void> closeExpiredOrder(String orderNo) {
        return databaseClient.sql("""
                UPDATE credit_purchase_orders
                SET status = 'closed', updated_at = CURRENT_TIMESTAMP
                WHERE order_no = :orderNo AND status = 'pending' AND expires_at <= CURRENT_TIMESTAMP
                """)
                .bind("orderNo", orderNo).fetch().rowsUpdated().then();
    }

    /**
     * 将支付宝明确关闭的待支付订单标记为关闭。
     *
     * @param orderNo String 平台订单号
     * @return Mono<Void> 更新完成信号
     */
    public Mono<Void> closeOrder(String orderNo) {
        return databaseClient.sql("""
                UPDATE credit_purchase_orders
                SET status = 'closed', updated_at = CURRENT_TIMESTAMP
                WHERE order_no = :orderNo AND status = 'pending'
                """)
                .bind("orderNo", orderNo).fetch().rowsUpdated().then();
    }

    /** 已支付收入订单的基础查询条件，收入口径只统计平台钱包中真实付款的订单。 */
    private static final String REVENUE_ORDER_QUERY = """
            FROM credit_purchase_orders purchase_orders
            JOIN users users ON users.id = purchase_orders.user_id
            LEFT JOIN user_credit_transactions transactions
                   ON transactions.billing_reference = purchase_orders.order_no
                  AND transactions.transaction_type = 'credit_purchase'
            WHERE purchase_orders.status = 'paid'
              AND purchase_orders.wallet_team_id = 0
              AND COALESCE(purchase_orders.paid_at, purchase_orders.created_at) >= :startAt
              AND COALESCE(purchase_orders.paid_at, purchase_orders.created_at) < :endAt
            """;

    /**
     * 收入统计查询条件。
     *
     * @param userId Long 用户ID，可为空表示全部用户
     * @param startDate LocalDate 筛选起始日期
     * @param endDate LocalDate 筛选结束日期
     * @param startAt OffsetDateTime 筛选起始时间
     * @param endAt OffsetDateTime 筛选结束时间的次日零点
     */
    public record RevenueQuery(Long userId, LocalDate startDate, LocalDate endDate, OffsetDateTime startAt, OffsetDateTime endAt) {
    }

    /**
     * 收入汇总。
     *
     * @param totalRevenue BigDecimal 收入合计
     * @param orderCount Long 已支付订单数
     * @param totalCredits BigDecimal 售出积分合计
     */
    public record RevenueSummary(BigDecimal totalRevenue, Long orderCount, BigDecimal totalCredits) {
    }

    /**
     * 将数据库行映射为商品。
     *
     * @param id Long 商品标识
     * @param credits BigDecimal 积分数量
     * @param bonusCredits BigDecimal 赠送积分数量
     * @param priceAmount BigDecimal 商品金额
     * @param sortOrder Integer 展示排序
     * @param enabled Boolean 是否启用
     * @return Product 商品
     */
    private Product product(Long id, BigDecimal credits, BigDecimal bonusCredits, BigDecimal priceAmount, Integer sortOrder, Boolean enabled) {
        return new Product(id, credits, bonusCredits == null ? BigDecimal.ZERO : bonusCredits, priceAmount, sortOrder == null ? 0 : sortOrder, Boolean.TRUE.equals(enabled));
    }

    /**
     * 将数据库行映射为订单。
     *
     * @param row Row 数据库行
     * @return Order 订单
     */
    private Order order(io.r2dbc.spi.Row row) {
        return new Order(row.get("id", Long.class), row.get("order_no", String.class), row.get("user_id", Long.class),
                row.get("product_id", Long.class), row.get("credits", BigDecimal.class), row.get("price_amount", BigDecimal.class),
                row.get("wallet_team_id", Long.class), row.get("payment_method", String.class), row.get("status", String.class), row.get("provider_trade_no", String.class),
                row.get("expires_at", OffsetDateTime.class), row.get("paid_at", OffsetDateTime.class), row.get("created_at", OffsetDateTime.class),
                row.get("first_purchase_bonus_credits", BigDecimal.class), row.get("base_credits", BigDecimal.class));
    }

    /** 积分商品。 */
    public record Product(Long id, BigDecimal credits, BigDecimal bonusCredits, BigDecimal priceAmount, int sortOrder, boolean enabled) {
        /**
         * 计算商品实际到账积分。
         *
         * @return BigDecimal 基础积分与赠送积分之和
         */
        public BigDecimal totalCredits() {
            return credits.add(bonusCredits);
        }
    }

    /** 积分购买订单。 */
    public record Order(Long id, String orderNo, Long userId, Long productId, BigDecimal credits, BigDecimal priceAmount,
                        Long walletTeamId, String paymentMethod, String status, String providerTradeNo, OffsetDateTime expiresAt,
                        OffsetDateTime paidAt, OffsetDateTime createdAt, BigDecimal firstPurchaseBonusCredits, BigDecimal baseCredits) {
    }
}
