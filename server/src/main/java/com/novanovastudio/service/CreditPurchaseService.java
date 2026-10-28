package com.novanovastudio.service;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.CreditAmounts;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.dto.AiTaskDtos;
import com.novanovastudio.dto.PaymentDtos;
import com.novanovastudio.payment.PaymentProvider;
import com.novanovastudio.payment.PaymentProviderRegistry;
import com.novanovastudio.repository.CreditPurchaseRepository;
import com.novanovastudio.repository.CreditRepository;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.security.TeamScope;
import com.novanovastudio.task.AiTaskEventPublisher;
import java.math.BigDecimal;
import java.net.URI;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.ReactiveStringRedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.reactive.TransactionalOperator;
import reactor.core.publisher.Mono;

/**
 * 平台积分商品、购买订单和支付结算服务。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-10-27 14:30
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class CreditPurchaseService {

    /** 允许的支付宝成功状态。 */
    private static final List<String> SUCCESS_STATUSES = List.of("TRADE_SUCCESS", "TRADE_FINISHED");
    /** 支付宝关闭交易状态。 */
    private static final String CLOSED_STATUS = "TRADE_CLOSED";
    /** 订单号时间格式。 */
    private static final DateTimeFormatter ORDER_TIME_FORMAT = DateTimeFormatter.ofPattern("yyyyMMddHHmmss");
    /** 购买订单有效期。 */
    private static final long ORDER_EXPIRATION_MINUTES = 15;
    /** 支付宝查单节流键前缀。 */
    private static final String QUERY_THROTTLE_KEY_PREFIX = "credit:order-query:";
    /** 同一订单最短查单间隔。 */
    private static final Duration QUERY_THROTTLE_WINDOW = Duration.ofSeconds(5);
    /** 订单列表单次最多返回条数。 */
    private static final int MAX_ORDER_PAGE_SIZE = 100;

    /** 商品订单仓储。 */
    private final CreditPurchaseRepository purchaseRepository;
    /** 积分仓储。 */
    private final CreditRepository creditRepository;
    /** 当前用户提供器。 */
    private final CurrentUserProvider currentUserProvider;
    /** 支付提供方注册表。 */
    private final PaymentProviderRegistry providerRegistry;
    /** 响应式事务操作器。 */
    private final TransactionalOperator transactionalOperator;
    /** 积分余额事件发布器。 */
    private final AiTaskEventPublisher eventPublisher;
    /** 应用支付配置。 */
    private final NovanovaProperties properties;
    /** Redis模板。 */
    private final ReactiveStringRedisTemplate redisTemplate;

    /**
     * 查询当前启用的积分商品。
     *
     * @return Mono<CreditProductListResponse> 商品列表
     */
    public Mono<PaymentDtos.CreditProductListResponse> listProducts() {
        return requirePlatform().then(Mono.defer(() -> purchaseRepository.listEnabledProducts().map(products ->
                new PaymentDtos.CreditProductListResponse(products.stream().map(this::productResponse).toList()))));
    }

    /**
     * 查询管理员可配置的全部积分商品。
     *
     * @return Mono<List<CreditProductResponse>> 商品列表
     */
    public Mono<List<PaymentDtos.CreditProductResponse>> listAllProducts() {
        return requirePlatform().then(Mono.defer(() -> purchaseRepository.listAllProducts().map(products -> products.stream().map(this::productResponse).toList())));
    }

    /**
     * 创建积分商品。
     *
     * @param request CreateCreditProductRequest 商品参数
     * @return Mono<CreditProductResponse> 创建后的商品
     */
    public Mono<PaymentDtos.CreditProductResponse> createProduct(PaymentDtos.CreateCreditProductRequest request) {
        validateProduct(request.credits(), request.priceAmount(), request.sortOrder());
        validateEnabled(request.enabled());
        return requirePlatform().then(Mono.defer(() -> purchaseRepository.createProduct(request.credits(), request.priceAmount(), request.sortOrder(), request.enabled())
                .map(this::productResponse)));
    }

    /**
     * 修改积分商品配置。
     *
     * @param request UpdateCreditProductRequest 商品参数
     * @return Mono<CreditProductResponse> 修改后的商品
     */
    public Mono<PaymentDtos.CreditProductResponse> updateProduct(PaymentDtos.UpdateCreditProductRequest request) {
        validateProduct(request.credits(), request.priceAmount(), request.sortOrder());
        validateEnabled(request.enabled());
        return requirePlatform().then(Mono.defer(() -> purchaseRepository.updateProduct(request.id(), request.credits(), request.priceAmount(), request.sortOrder(), request.enabled())
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "积分商品不存在")))
                .map(this::productResponse)));
    }

    /**
     * 修改积分商品启用状态。
     *
     * @param request UpdateCreditProductStatusRequest 商品状态参数
     * @return Mono<CreditProductResponse> 修改后的商品
     */
    public Mono<PaymentDtos.CreditProductResponse> updateProductStatus(PaymentDtos.UpdateCreditProductStatusRequest request) {
        validateEnabled(request.enabled());
        return requirePlatform().then(Mono.defer(() -> purchaseRepository.updateProductStatus(request.id(), request.enabled())
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "积分商品不存在")))
                .map(this::productResponse)));
    }

    /**
     * 创建当前用户的积分支付订单并生成支付表单。
     *
     * @param request CreateCreditOrderRequest 商品和支付方式
     * @return Mono<CreateCreditOrderResponse> 平台订单和支付表单
     */
    public Mono<PaymentDtos.CreateCreditOrderResponse> createOrder(PaymentDtos.CreateCreditOrderRequest request) {
        String paymentMethod = normalizePaymentMethod(request.paymentMethod());
        return requirePlatform().then(Mono.defer(() -> currentUserProvider.currentUserId().zipWith(
                        purchaseRepository.findProduct(request.productId())
                                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "积分商品不存在"))))))
                .flatMap(tuple -> {
                    PaymentProvider provider = providerRegistry.require(paymentMethod);
                    Long userId = tuple.getT1();
                    CreditPurchaseRepository.Product product = tuple.getT2();
                    if (!product.enabled()) throw new BusinessException(ErrorCode.BUSINESS_ERROR, "积分商品已停用");
                    String orderNo = createOrderNo();
                    OffsetDateTime expiresAt = OffsetDateTime.now().plusMinutes(ORDER_EXPIRATION_MINUTES);
                    return purchaseRepository.createOrder(orderNo, userId, product.id(), product.credits(), product.priceAmount(), paymentMethod, expiresAt)
                            .flatMap(order -> provider.createPayment(new PaymentProvider.PaymentOrder(order.orderNo(),
                                            orderSubject(order.credits()), order.priceAmount(), order.expiresAt()))
                                    .map(paymentUrl -> orderResponse(order, paymentUrl)));
                })
                .doOnSuccess(response -> log.info("创建积分购买订单成功: orderNo={}, paymentMethod={}", response.orderNo(), response.paymentMethod()));
    }

    /**
     * 查询当前用户订单状态，并对待支付订单执行支付宝补偿查询。
     *
     * @param orderNo String 平台订单号
     * @return Mono<CreditOrderStatusResponse> 订单状态
     */
    public Mono<PaymentDtos.CreditOrderStatusResponse> getOrderStatus(String orderNo) {
        if (orderNo == null || orderNo.isBlank() || orderNo.length() > 64) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "订单号无效"));
        }
        return requirePlatform().then(Mono.defer(() -> currentUserProvider.currentUserId().flatMap(userId -> purchaseRepository.findOrder(orderNo, userId)
                        .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "积分购买订单不存在")))
                        .flatMap(this::refreshOrderStatus))));
    }

    /**
     * 查询当前用户最近的积分购买订单。
     *
     * @param limit int 返回条数
     * @return Mono<CreditOrderListResponse> 订单列表
     */
    public Mono<PaymentDtos.CreditOrderListResponse> listOrders(int limit) {
        int pageSize = Math.min(Math.max(limit, 1), MAX_ORDER_PAGE_SIZE);
        return requirePlatform().then(Mono.defer(() -> currentUserProvider.currentUserId()
                .flatMap(userId -> purchaseRepository.listOrders(userId, pageSize))
                .map(orders -> new PaymentDtos.CreditOrderListResponse(orders.stream().map(this::orderItem).toList()))));
    }

    /**
     * 取消用户主动放弃支付的订单。
     *
     * @param orderNo String 平台订单号
     * @return Mono<CreditOrderStatusResponse> 取消后的订单状态
     */
    public Mono<PaymentDtos.CreditOrderStatusResponse> cancelOrder(String orderNo) {
        if (orderNo == null || orderNo.isBlank() || orderNo.length() > 64) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "订单号无效"));
        }
        return requirePlatform().then(Mono.defer(() -> currentUserProvider.currentUserId().flatMap(userId ->
                purchaseRepository.findOrder(orderNo, userId)
                        .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "积分购买订单不存在")))
                        .flatMap(order -> cancelPendingOrder(order, userId)))));
    }

    /**
     * 关闭渠道交易并把待支付订单置为已取消。
     *
     * @param order Order 当前订单
     * @param userId Long 用户标识
     * @return Mono<CreditOrderStatusResponse> 取消后的订单状态
     */
    private Mono<PaymentDtos.CreditOrderStatusResponse> cancelPendingOrder(CreditPurchaseRepository.Order order, Long userId) {
        if ("paid".equals(order.status())) {
            return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "订单已支付，无法取消"));
        }
        if ("processing".equals(order.status())) {
            return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "订单正在确认支付，无法取消"));
        }
        // 已关闭或已取消的订单直接返回当前状态，取消操作保持幂等。
        if (!"pending".equals(order.status())) return Mono.just(orderStatus(order));
        // 先关掉渠道交易让二维码失效，关单失败也继续本地取消，避免用户卡在无法取消的状态。
        return providerRegistry.require(order.paymentMethod()).closePayment(order.orderNo())
                .then(purchaseRepository.cancelOrder(order.orderNo(), userId))
                .map(this::orderStatus)
                .switchIfEmpty(Mono.defer(() -> purchaseRepository.findOrder(order.orderNo(), userId)
                        .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "订单状态已变化，请刷新后重试")))
                        .map(this::orderStatus)));
    }

    /**
     * 为待支付订单重新签发支付页面地址。
     *
     * @param orderNo String 平台订单号
     * @return Mono<CreateCreditOrderResponse> 订单和支付页面地址
     */
    public Mono<PaymentDtos.CreateCreditOrderResponse> getOrderPayment(String orderNo) {
        if (orderNo == null || orderNo.isBlank() || orderNo.length() > 64) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "订单号无效"));
        }
        return requirePlatform().then(Mono.defer(() -> currentUserProvider.currentUserId().flatMap(userId -> purchaseRepository.findOrder(orderNo, userId)
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "积分购买订单不存在")))
                .flatMap(this::recreatePayment))));
    }

    /**
     * 处理支付宝异步通知。
     *
     * @param parameters Map<String, String> 支付宝通知参数
     * @return Mono<Void> 通知处理完成
     */
    public Mono<Void> handleAlipayNotification(Map<String, String> parameters) {
        PaymentProvider provider = providerRegistry.require("alipay");
        return provider.verifyNotification(parameters)
                .flatMap(notification -> {
                    if (SUCCESS_STATUSES.contains(notification.tradeStatus())) return settleNotification(notification).then();
                    if (CLOSED_STATUS.equals(notification.tradeStatus())) return closeNotification(notification);
                    log.info("忽略未完成的支付宝交易通知: orderNo={}, tradeStatus={}", notification.orderNo(), notification.tradeStatus());
                    return Mono.empty();
                })
                .then();
    }

    /**
     * 构造支付宝同步返回地址。
     *
     * @param orderNo String 支付宝回传的平台订单号
     * @return String 前端购买页地址
     */
    public String frontendReturnUrl(String orderNo) {
        String baseUrl = validatedFrontendBaseUrl();
        String location = baseUrl.replaceAll("/+$", "") + "/credits/purchase";
        if (orderNo != null && !orderNo.isBlank()) location += "?orderNo=" + encodeQueryValue(orderNo);
        return location;
    }

    /**
     * 校验前端公开地址，避免把不受信任的协议、路径或查询参数拼入同步回跳地址。
     *
     * @return String 已校验的前端根地址
     */
    private String validatedFrontendBaseUrl() {
        String baseUrl = properties.getApp().getFrontendBaseUrl();
        if (baseUrl == null || baseUrl.isBlank()) {
            throw new BusinessException(ErrorCode.BUSINESS_ERROR, "未配置前端公开地址，无法处理支付宝同步回跳");
        }
        try {
            URI uri = URI.create(baseUrl.trim());
            String scheme = uri.getScheme();
            String path = uri.getPath();
            if (!("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme))
                    || uri.getHost() == null || uri.getUserInfo() != null
                    || uri.getQuery() != null || uri.getFragment() != null
                    || (path != null && !path.isEmpty() && !"/".equals(path))) {
                throw new IllegalArgumentException();
            }
            return uri.toString();
        } catch (IllegalArgumentException exception) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "前端公开地址必须是没有路径、查询参数和片段的HTTP(S)地址");
        }
    }

    /**
     * 刷新订单状态。
     *
     * @param order Order 当前订单
     * @return Mono<CreditOrderStatusResponse> 订单状态
     */
    private Mono<PaymentDtos.CreditOrderStatusResponse> refreshOrderStatus(CreditPurchaseRepository.Order order) {
        if ("pending".equals(order.status()) && !order.expiresAt().isAfter(OffsetDateTime.now())) {
            // 过期前一刻可能刚好付完款，先向渠道确认一次，确认未支付才关单，避免钱付了单却关了。
            return providerRegistry.require(order.paymentMethod()).queryOrder(order.orderNo())
                    .onErrorResume(error -> Mono.empty())
                    .flatMap(notification -> SUCCESS_STATUSES.contains(notification.tradeStatus())
                            ? settleNotification(notification).map(result -> orderStatus(result.order()))
                            : Mono.<PaymentDtos.CreditOrderStatusResponse>empty())
                    .switchIfEmpty(purchaseRepository.closeExpiredOrder(order.orderNo())
                            .then(purchaseRepository.findOrder(order.orderNo(), order.userId()))
                            .map(this::orderStatus));
        }
        if (!"pending".equals(order.status())) return Mono.just(orderStatus(order));
        // 前端轮询远快于支付宝查单的合理频率，按订单节流，避免每次轮询都打一次渠道接口。
        return claimQuerySlot(order.orderNo())
                .flatMap(claimed -> Boolean.TRUE.equals(claimed) ? queryAndSettle(order) : Mono.just(orderStatus(order)));
    }

    /**
     * 为仍可支付的订单重新生成支付页面地址。
     *
     * @param order Order 当前订单
     * @return Mono<CreateCreditOrderResponse> 订单和支付页面地址
     */
    private Mono<PaymentDtos.CreateCreditOrderResponse> recreatePayment(CreditPurchaseRepository.Order order) {
        if (!"pending".equals(order.status())) {
            return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "订单已支付、已关闭或已取消，无法重新支付"));
        }
        if (!order.expiresAt().isAfter(OffsetDateTime.now())) {
            return purchaseRepository.closeExpiredOrder(order.orderNo())
                    .then(Mono.<PaymentDtos.CreateCreditOrderResponse>error(new BusinessException(ErrorCode.BUSINESS_ERROR, "订单已超时关闭，请重新下单")));
        }
        return providerRegistry.require(order.paymentMethod())
                .createPayment(new PaymentProvider.PaymentOrder(order.orderNo(), orderSubject(order.credits()), order.priceAmount(), order.expiresAt()))
                .map(paymentUrl -> orderResponse(order, paymentUrl));
    }

    /**
     * 占用一次支付宝查单机会。
     *
     * @param orderNo String 平台订单号
     * @return Mono<Boolean> 是否允许本次查单，Redis 不可用时放行
     */
    private Mono<Boolean> claimQuerySlot(String orderNo) {
        return redisTemplate.opsForValue()
                .setIfAbsent(QUERY_THROTTLE_KEY_PREFIX + orderNo, "1", QUERY_THROTTLE_WINDOW)
                .defaultIfEmpty(false)
                .onErrorResume(error -> {
                    log.warn("支付宝查单节流键写入失败，本次直接查单: orderNo={}", orderNo, error);
                    return Mono.just(true);
                });
    }

    /**
     * 主动查询支付宝订单并结算。
     *
     * @param order Order 当前订单
     * @return Mono<CreditOrderStatusResponse> 订单状态
     */
    private Mono<PaymentDtos.CreditOrderStatusResponse> queryAndSettle(CreditPurchaseRepository.Order order) {
        PaymentProvider provider = providerRegistry.require(order.paymentMethod());
        return provider.queryOrder(order.orderNo())
                .flatMap(notification -> SUCCESS_STATUSES.contains(notification.tradeStatus())
                        ? settleNotification(notification).map(result -> orderStatus(result.order()))
                        : CLOSED_STATUS.equals(notification.tradeStatus())
                                ? closeNotification(notification).then(purchaseRepository.findOrder(order.orderNo(), order.userId()).map(this::orderStatus))
                                : Mono.just(orderStatus(order)))
                .defaultIfEmpty(orderStatus(order));
    }

    /**
     * 处理支付宝明确关闭的交易。
     *
     * @param notification PaymentNotification 已验签的关闭通知
     * @return Mono<Void> 关闭处理完成信号
     */
    private Mono<Void> closeNotification(PaymentProvider.PaymentNotification notification) {
        return purchaseRepository.findOrder(notification.orderNo())
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "支付订单不存在")))
                .flatMap(order -> {
                    validateNotification(order, notification);
                    if ("paid".equals(order.status())) return Mono.empty();
                    return purchaseRepository.closeOrder(order.orderNo());
                });
    }

    /**
     * 校验并结算一笔支付通知。
     *
     * @param notification PaymentNotification 已验签通知
     * @return Mono<SettlementResult> 结算结果
     */
    private Mono<SettlementResult> settleNotification(PaymentProvider.PaymentNotification notification) {
        if (!SUCCESS_STATUSES.contains(notification.tradeStatus())) {
            return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "支付宝订单尚未支付成功"));
        }
        return purchaseRepository.findOrder(notification.orderNo())
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "支付订单不存在")))
                .flatMap(order -> {
                    validateNotification(order, notification);
                    if ("paid".equals(order.status())) return Mono.just(new SettlementResult(order, false, null));
                    return transactionalOperator.transactional(
                                    purchaseRepository.claimOrderForSettlement(order.orderNo(), notification.providerTradeNo())
                                            .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "支付订单正在处理中或已关闭")))
                                            .flatMap(claimed -> creditRepository.changeBalance(claimed.userId(), claimed.credits())
                                                    .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "平台积分账户不存在")))
                                                    .flatMap(balance -> creditRepository.createCreditPurchaseTransaction(claimed.userId(), claimed.orderNo(), claimed.credits(), balance,
                                                                    "购买积分订单：" + claimed.orderNo())
                                                            .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "积分购买流水已存在")))
                                                            .then(purchaseRepository.markOrderPaid(claimed.orderNo(), notification.paidAt()))
                                                            .thenReturn(new SettlementResult(claimed, true, balance)))))
                            .flatMap(result -> result.newlyPaid()
                                    ? eventPublisher.publish(result.order().userId(), new AiTaskDtos.AiTaskEvent("credit-balance", null, null, result.balanceAfter())).thenReturn(result)
                                    : Mono.just(result));
                });
    }

    /**
     * 校验通知中的应用、订单和金额快照。
     *
     * @param order Order 平台订单
     * @param notification PaymentNotification 支付通知
     */
    private void validateNotification(CreditPurchaseRepository.Order order, PaymentProvider.PaymentNotification notification) {
        if (!"alipay".equals(order.paymentMethod())) throw new BusinessException(ErrorCode.BUSINESS_ERROR, "订单支付方式不匹配");
        if (order.walletTeamId() == null || order.walletTeamId() != 0L) throw new BusinessException(ErrorCode.BUSINESS_ERROR, "订单钱包作用域无效");
        if (!properties.getAlipay().getAppId().equals(notification.appId())) throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "支付宝应用标识不匹配");
        if (!order.orderNo().equals(notification.orderNo())) throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "支付宝订单号不匹配");
        if (order.priceAmount().compareTo(notification.amount()) != 0) throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "支付宝支付金额不匹配");
        if ("paid".equals(order.status()) && order.providerTradeNo() != null && !order.providerTradeNo().equals(notification.providerTradeNo())) {
            throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "支付宝交易号不匹配");
        }
    }

    /**
     * 校验商品参数。
     *
     * @param credits BigDecimal 积分数量
     * @param priceAmount BigDecimal 商品金额
     * @param sortOrder int 展示排序
     */
    private void validateProduct(BigDecimal credits, BigDecimal priceAmount, int sortOrder) {
        if (credits == null || CreditAmounts.of(credits).signum() <= 0) throw new BusinessException(ErrorCode.PARAM_INVALID, "积分数量必须大于零");
        if (priceAmount == null || priceAmount.signum() <= 0 || priceAmount.scale() > 2) throw new BusinessException(ErrorCode.PARAM_INVALID, "商品金额必须为两位小数以内的正数");
        if (sortOrder < 0) throw new BusinessException(ErrorCode.PARAM_INVALID, "排序不能小于零");
    }

    /**
     * 校验商品启用状态。
     *
     * @param enabled Boolean 商品是否启用
     */
    private void validateEnabled(Boolean enabled) {
        if (enabled == null) throw new BusinessException(ErrorCode.PARAM_INVALID, "商品启用状态不能为空");
    }

    /**
     * 规范化支付方式。
     *
     * @param paymentMethod String 支付方式
     * @return String 小写支付方式
     */
    private String normalizePaymentMethod(String paymentMethod) {
        if (paymentMethod == null || paymentMethod.isBlank()) throw new BusinessException(ErrorCode.PARAM_MISSING, "支付方式不能为空");
        return paymentMethod.trim().toLowerCase(Locale.ROOT);
    }

    /**
     * 要求当前响应式请求处于平台空间。
     *
     * @return Mono<Void> 平台作用域校验结果
     */
    private Mono<Void> requirePlatform() {
        return TeamScope.current().flatMap(scope -> scope.teamId() == 0 ? Mono.empty() : Mono.error(new BusinessException(ErrorCode.PERMISSION_DENIED, "团队空间不能操作平台积分商品和支付订单")));
    }

    /**
     * 将商品转换为接口响应。
     *
     * @param product Product 商品
     * @return CreditProductResponse 商品响应
     */
    private PaymentDtos.CreditProductResponse productResponse(CreditPurchaseRepository.Product product) {
        return new PaymentDtos.CreditProductResponse(product.id(), product.credits(), product.priceAmount().setScale(2).toPlainString(), product.sortOrder(), product.enabled());
    }

    /**
     * 将订单转换为接口响应。
     *
     * @param order Order 订单
     * @return CreditOrderStatusResponse 订单状态响应
     */
    private PaymentDtos.CreditOrderStatusResponse orderStatus(CreditPurchaseRepository.Order order) {
        return new PaymentDtos.CreditOrderStatusResponse(order.orderNo(), order.credits(), order.priceAmount().setScale(2).toPlainString(), order.paymentMethod(), order.status(), order.paidAt() == null ? null : order.paidAt().toString());
    }

    /**
     * 将订单转换为列表项。
     *
     * @param order Order 订单
     * @return CreditOrderItem 订单列表项
     */
    private PaymentDtos.CreditOrderItem orderItem(CreditPurchaseRepository.Order order) {
        return new PaymentDtos.CreditOrderItem(order.orderNo(), order.credits(), order.priceAmount().setScale(2).toPlainString(),
                order.paymentMethod(), order.status(), order.createdAt(), order.expiresAt(), order.paidAt());
    }

    /**
     * 将订单和支付页面地址转换为接口响应。
     *
     * @param order Order 订单
     * @param paymentUrl String 支付页面地址
     * @return CreateCreditOrderResponse 订单和支付页面地址
     */
    private PaymentDtos.CreateCreditOrderResponse orderResponse(CreditPurchaseRepository.Order order, String paymentUrl) {
        return new PaymentDtos.CreateCreditOrderResponse(order.orderNo(), order.paymentMethod(), order.status(), paymentUrl,
                order.priceAmount().setScale(2).toPlainString(), order.expiresAt());
    }

    /**
     * 构造支付页面标题。
     *
     * @param credits BigDecimal 积分数量
     * @return String 支付页面标题
     */
    private String orderSubject(BigDecimal credits) {
        return "购买" + amountText(credits) + "积分";
    }

    /**
     * 生成平台订单号。
     *
     * @return String 平台订单号
     */
    private String createOrderNo() {
        return "CREDIT" + OffsetDateTime.now().format(ORDER_TIME_FORMAT) + UUID.randomUUID().toString().replace("-", "");
    }

    /**
     * 格式化积分数量用于支付标题。
     *
     * @param credits BigDecimal 积分数量
     * @return String 积分数量文本
     */
    private String amountText(BigDecimal credits) {
        return credits.stripTrailingZeros().toPlainString();
    }

    /**
     * 编码同步返回地址中的订单号。
     *
     * @param value String 原始订单号
     * @return String 编码后的订单号
     */
    private String encodeQueryValue(String value) {
        return java.net.URLEncoder.encode(value, java.nio.charset.StandardCharsets.UTF_8);
    }

    /** 支付结算结果。 */
    private record SettlementResult(CreditPurchaseRepository.Order order, boolean newlyPaid, BigDecimal balanceAfter) {
    }
}
