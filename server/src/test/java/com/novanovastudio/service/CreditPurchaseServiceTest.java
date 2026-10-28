package com.novanovastudio.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.novanovastudio.common.BusinessException;
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
import java.time.OffsetDateTime;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.redis.core.ReactiveStringRedisTemplate;
import org.springframework.transaction.reactive.TransactionalOperator;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

/**
 * 积分商品和支付订单业务测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-10-27 20:30
 */
class CreditPurchaseServiceTest {

    /** 商品订单仓储。 */
    private CreditPurchaseRepository purchaseRepository;
    /** 积分仓储。 */
    private CreditRepository creditRepository;
    /** 当前用户提供器。 */
    private CurrentUserProvider currentUserProvider;
    /** 支付提供方注册表。 */
    private PaymentProviderRegistry providerRegistry;
    /** 支付宝提供方。 */
    private PaymentProvider provider;
    /** 事务操作器。 */
    private TransactionalOperator transactionalOperator;
    /** 余额事件发布器。 */
    private AiTaskEventPublisher eventPublisher;
    /** 应用配置。 */
    private NovanovaProperties properties;
    /** Redis模板。 */
    private ReactiveStringRedisTemplate redisTemplate;
    /** 积分购买服务。 */
    private CreditPurchaseService purchaseService;

    /** 初始化测试依赖。 */
    @BeforeEach
    void setUp() {
        purchaseRepository = mock(CreditPurchaseRepository.class);
        creditRepository = mock(CreditRepository.class);
        currentUserProvider = mock(CurrentUserProvider.class);
        providerRegistry = mock(PaymentProviderRegistry.class);
        provider = mock(PaymentProvider.class);
        transactionalOperator = mock(TransactionalOperator.class);
        eventPublisher = mock(AiTaskEventPublisher.class);
        properties = new NovanovaProperties();
        properties.getAlipay().setAppId("app-id");
        redisTemplate = mock(ReactiveStringRedisTemplate.class);
        when(providerRegistry.require("alipay")).thenReturn(provider);
        when(currentUserProvider.currentUserId()).thenReturn(Mono.just(42L));
        when(transactionalOperator.transactional(org.mockito.ArgumentMatchers.<Mono<Object>>any()))
                .thenAnswer(invocation -> invocation.getArgument(0));
        when(eventPublisher.publish(anyLong(), any())).thenReturn(Mono.empty());
        purchaseService = new CreditPurchaseService(purchaseRepository, creditRepository, currentUserProvider,
                providerRegistry, transactionalOperator, eventPublisher, properties, redisTemplate);
    }

    /** 商品积分数量和金额必须为正数且金额最多保留两位小数。 */
    @Test
    void shouldRejectInvalidProductValues() {
        assertThrows(BusinessException.class, () -> purchaseService.createProduct(
                new PaymentDtos.CreateCreditProductRequest(BigDecimal.ZERO, BigDecimal.ZERO, new BigDecimal("1.00"), 10, true)));
        assertThrows(BusinessException.class, () -> purchaseService.createProduct(
                new PaymentDtos.CreateCreditProductRequest(new BigDecimal("10"), BigDecimal.ZERO, new BigDecimal("1.001"), 10, true)));
        assertThrows(BusinessException.class, () -> purchaseService.createProduct(
                new PaymentDtos.CreateCreditProductRequest(new BigDecimal("10"), BigDecimal.ZERO, new BigDecimal("1.00"), -1, true)));
    }

    /** 创建订单必须使用服务端商品快照生成支付金额，不能使用客户端覆盖值。 */
    @Test
    void shouldCreateOrderWithProductSnapshotAmount() {
        CreditPurchaseRepository.Product product = product(7L, "20", "5", "2.00", true);
        CreditPurchaseRepository.Order order = order("order-1", "pending", "25", "2.00", null);
        when(purchaseRepository.findProduct(7L)).thenReturn(Mono.just(product));
        when(purchaseRepository.createOrder(anyString(), eq(42L), eq(7L), eq(product.totalCredits()), eq(product.priceAmount()),
                eq("alipay"), any(OffsetDateTime.class))).thenReturn(Mono.just(order));
        when(provider.createPayment(any())).thenReturn(Mono.just("https://openapi.alipay.com/gateway.do?sign=1"));

        StepVerifier.create(purchaseService.createOrder(new PaymentDtos.CreateCreditOrderRequest(7L, "alipay")))
                .assertNext(response -> {
                    assertEquals("order-1", response.orderNo());
                    assertEquals("https://openapi.alipay.com/gateway.do?sign=1", response.paymentUrl());
                    assertEquals("2.00", response.priceAmount());
                })
                .verifyComplete();

        ArgumentCaptor<PaymentProvider.PaymentOrder> paymentOrder = ArgumentCaptor.forClass(PaymentProvider.PaymentOrder.class);
        verify(provider).createPayment(paymentOrder.capture());
        assertEquals("order-1", paymentOrder.getValue().orderNo());
        assertEquals("购买25积分", paymentOrder.getValue().subject());
        assertEquals(new BigDecimal("2.00"), paymentOrder.getValue().amount());
        assertEquals(order.expiresAt(), paymentOrder.getValue().expiresAt());
        verify(purchaseRepository).createOrder(anyString(), eq(42L), eq(7L), eq(new BigDecimal("25")),
                eq(new BigDecimal("2.00")), eq("alipay"), any(OffsetDateTime.class));
    }

    /** 已支付或已关闭的订单不得重新签发支付地址。 */
    @Test
    void shouldRejectReissuingPaymentForUnpaidClosedOrder() {
        when(purchaseRepository.findOrder("order-1", 42L)).thenReturn(Mono.just(order("order-1", "paid", "20", "2.00", "trade-1")));

        StepVerifier.create(purchaseService.getOrderPayment("order-1"))
                .expectErrorSatisfies(error -> assertEquals(ErrorCode.BUSINESS_ERROR, ((BusinessException) error).getCode()))
                .verify();

        verify(provider, never()).createPayment(any());
    }

    /** 团队空间不得读取平台积分商品。 */
    @Test
    void shouldRejectTeamScopeBeforeListingProducts() {
        StepVerifier.create(purchaseService.listProducts()
                        .contextWrite(context -> new TeamScope(9L, "member").apply(context)))
                .expectErrorSatisfies(error -> assertEquals(ErrorCode.PERMISSION_DENIED, ((BusinessException) error).getCode()))
                .verify();

        verify(purchaseRepository, never()).listEnabledProducts();
    }

    /** 支付宝两种成功交易状态都应完成入账。 */
    @Test
    void shouldSettleSuccessAndFinishedNotifications() {
        for (String tradeStatus : new String[]{"TRADE_SUCCESS", "TRADE_FINISHED"}) {
            resetSettlementMocks();
            CreditPurchaseRepository.Order pending = order("order-1", "pending", "20", "2.00", null);
            CreditPurchaseRepository.Order processing = order("order-1", "processing", "20", "2.00", "trade-1");
            when(provider.verifyNotification(any())).thenReturn(Mono.just(notification("app-id", "order-1", "2.00", "trade-1", tradeStatus)));
            when(purchaseRepository.findOrder("order-1")).thenReturn(Mono.just(pending));
            when(purchaseRepository.claimOrderForSettlement("order-1", "trade-1")).thenReturn(Mono.just(processing));
            when(creditRepository.changeBalance(42L, new BigDecimal("20"))).thenReturn(Mono.just(new BigDecimal("120")));
            when(creditRepository.createCreditPurchaseTransaction(42L, "order-1", new BigDecimal("20"), new BigDecimal("120"), "购买积分订单：order-1"))
                    .thenReturn(Mono.just(99L));
            when(purchaseRepository.markOrderPaid(eq("order-1"), any(OffsetDateTime.class))).thenReturn(Mono.empty());

            StepVerifier.create(purchaseService.handleAlipayNotification(Map.of("out_trade_no", "order-1")))
                    .verifyComplete();
            verify(creditRepository).changeBalance(42L, new BigDecimal("20"));
            verify(eventPublisher).publish(eq(42L), any(AiTaskDtos.AiTaskEvent.class));
        }
    }

    /** 已支付订单收到重复通知时不得再次改余额或写流水。 */
    @Test
    void shouldIgnoreDuplicatePaidNotification() {
        CreditPurchaseRepository.Order paid = order("order-1", "paid", "20", "2.00", "trade-1");
        when(provider.verifyNotification(any())).thenReturn(Mono.just(notification("app-id", "order-1", "2.00", "trade-1", "TRADE_SUCCESS")));
        when(purchaseRepository.findOrder("order-1")).thenReturn(Mono.just(paid));

        StepVerifier.create(purchaseService.handleAlipayNotification(Map.of("out_trade_no", "order-1")))
                .verifyComplete();

        verify(creditRepository, never()).changeBalance(anyLong(), any(BigDecimal.class));
        verify(creditRepository, never()).createCreditPurchaseTransaction(anyLong(), anyString(), any(BigDecimal.class), any(BigDecimal.class), anyString());
        verify(eventPublisher, never()).publish(anyLong(), any());
    }

    /** 支付宝应用标识、订单号或金额不匹配时必须拒绝通知。 */
    @Test
    void shouldRejectNotificationWhenCriticalFieldsDoNotMatch() {
        CreditPurchaseRepository.Order pending = order("order-1", "pending", "20", "2.00", null);
        when(purchaseRepository.findOrder(anyString())).thenReturn(Mono.just(pending));

        assertNotificationRejected(notification("other-app", "order-1", "2.00", "trade-1", "TRADE_SUCCESS"));
        assertNotificationRejected(notification("app-id", "other-order", "2.00", "trade-1", "TRADE_SUCCESS"));
        assertNotificationRejected(notification("app-id", "order-1", "3.00", "trade-1", "TRADE_SUCCESS"));

        verify(purchaseRepository, never()).claimOrderForSettlement(anyString(), anyString());
        verify(creditRepository, never()).changeBalance(anyLong(), any(BigDecimal.class));
    }

    /** 支付宝明确关闭交易时应关闭待支付订单且不发放积分。 */
    @Test
    void shouldCloseTradeClosedNotification() {
        CreditPurchaseRepository.Order pending = order("order-1", "pending", "20", "2.00", null);
        when(provider.verifyNotification(any())).thenReturn(Mono.just(notification("app-id", "order-1", "2.00", "trade-1", "TRADE_CLOSED")));
        when(purchaseRepository.findOrder("order-1")).thenReturn(Mono.just(pending));
        when(purchaseRepository.closeOrder("order-1")).thenReturn(Mono.empty());

        StepVerifier.create(purchaseService.handleAlipayNotification(Map.of("out_trade_no", "order-1")))
                .verifyComplete();

        verify(purchaseRepository).closeOrder("order-1");
        verify(creditRepository, never()).changeBalance(anyLong(), any(BigDecimal.class));
    }

    /** 未配置前端公开地址时不得构造未经确认的同步回跳地址。 */
    @Test
    void shouldRejectMissingFrontendReturnUrl() {
        properties.getApp().setFrontendBaseUrl("");

        assertThrows(BusinessException.class, () -> purchaseService.frontendReturnUrl("order-1"));
    }

    /** 同步回跳地址必须是没有附加路径、查询参数和片段的HTTP(S)根地址。 */
    @Test
    void shouldRejectUnsafeFrontendReturnUrl() {
        for (String baseUrl : new String[]{"javascript:alert(1)", "file:///tmp/frontend", "https://example.com/app", "https://example.com?next=evil"}) {
            properties.getApp().setFrontendBaseUrl(baseUrl);
            assertThrows(BusinessException.class, () -> purchaseService.frontendReturnUrl("order-1"));
        }
    }

    /** 有效前端根地址应生成购买页同步回跳地址。 */
    @Test
    void shouldBuildFrontendReturnUrl() {
        properties.getApp().setFrontendBaseUrl("https://example.com/");

        assertEquals("https://example.com/credits/purchase?orderNo=order-1", purchaseService.frontendReturnUrl("order-1"));
    }

    /** 构造测试商品。 */
    private CreditPurchaseRepository.Product product(Long id, String credits, String priceAmount, boolean enabled) {
        return product(id, credits, "0", priceAmount, enabled);
    }

    /** 构造带赠送积分的测试商品。 */
    private CreditPurchaseRepository.Product product(Long id, String credits, String bonusCredits, String priceAmount, boolean enabled) {
        return new CreditPurchaseRepository.Product(id, new BigDecimal(credits), new BigDecimal(bonusCredits), new BigDecimal(priceAmount), 10, enabled);
    }

    /** 构造测试订单。 */
    private CreditPurchaseRepository.Order order(String orderNo, String status, String credits, String priceAmount, String providerTradeNo) {
        return new CreditPurchaseRepository.Order(1L, orderNo, 42L, 7L, new BigDecimal(credits), new BigDecimal(priceAmount),
                0L, "alipay", status, providerTradeNo, OffsetDateTime.now().plusMinutes(10),
                "paid".equals(status) ? OffsetDateTime.now() : null, OffsetDateTime.now());
    }

    /** 构造已验签的支付宝通知。 */
    private PaymentProvider.PaymentNotification notification(String appId, String orderNo, String amount,
                                                             String tradeNo, String tradeStatus) {
        return new PaymentProvider.PaymentNotification(appId, orderNo, new BigDecimal(amount), tradeNo, tradeStatus, OffsetDateTime.now());
    }

    /** 断言通知被服务端拒绝。 */
    private void assertNotificationRejected(PaymentProvider.PaymentNotification paymentNotification) {
        when(provider.verifyNotification(any())).thenReturn(Mono.just(paymentNotification));
        StepVerifier.create(purchaseService.handleAlipayNotification(Map.of("out_trade_no", paymentNotification.orderNo())))
                .expectError(BusinessException.class)
                .verify();
    }

    /** 清理循环测试中每次结算的 Mockito 交互和桩。 */
    private void resetSettlementMocks() {
        org.mockito.Mockito.clearInvocations(provider, purchaseRepository, creditRepository, eventPublisher);
    }
}
