package com.novanovastudio.repository;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.List;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.stereotype.Repository;
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
