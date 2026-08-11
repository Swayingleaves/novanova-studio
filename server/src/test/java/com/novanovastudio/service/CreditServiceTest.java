package com.novanovastudio.service;

import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.dto.CreditDtos;
import com.novanovastudio.repository.CreditRepository;
import com.novanovastudio.security.CurrentUserProvider;
import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.reactive.TransactionalOperator;
import reactor.core.publisher.Mono;
import reactor.core.publisher.Flux;
import reactor.test.StepVerifier;

/**
 * 积分服务测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-16 14:00
 */
class CreditServiceTest {

    /** 积分仓储 */
    private CreditRepository creditRepository;

    /** 当前用户提供器 */
    private CurrentUserProvider currentUserProvider;

    /** 待测试积分服务 */
    private CreditService creditService;

    /**
     * 初始化测试依赖。
     */
    @BeforeEach
    void setUp() {
        creditRepository = mock(CreditRepository.class);
        currentUserProvider = mock(CurrentUserProvider.class);
        TransactionalOperator transactionalOperator = mock(TransactionalOperator.class);
        when(transactionalOperator.transactional(org.mockito.ArgumentMatchers.<Mono<Object>>any()))
                .thenAnswer(invocation -> invocation.getArgument(0));
        creditService = new CreditService(creditRepository, currentUserProvider, transactionalOperator);
    }

    /**
     * 积分不足时任务扣费应失败，且不写余额快照。
     */
    @Test
    void shouldRejectTaskChargeWhenBalanceIsInsufficient() {
        when(creditRepository.claimTaskTransaction(8L, "task-1", CreditService.TRANSACTION_TASK_CHARGE, -12, "图片生成任务扣费", "imagePage"))
                .thenReturn(Mono.just(9L));
        when(creditRepository.changeBalance(8L, -12)).thenReturn(Mono.empty());

        StepVerifier.create(creditService.chargeTask(8L, "task-1", 12, "image", "imagePage"))
                .expectError(BusinessException.class)
                .verify();

        verify(creditRepository, org.mockito.Mockito.never()).updateTransactionBalance(anyLong(), anyInt());
    }

    /**
     * 任务退款应使用原始扣费金额，并由任务流水唯一键保证幂等。
     */
    @Test
    void shouldRefundOriginalTaskChargeOnlyOnce() {
        when(creditRepository.getTaskChargeAmount("task-1")).thenReturn(Mono.just(12));
        when(creditRepository.claimTaskTransaction(8L, "task-1", CreditService.TRANSACTION_TASK_REFUND, 12, "图片生成任务退款", null))
                .thenReturn(Mono.just(10L));
        when(creditRepository.changeBalance(8L, 12)).thenReturn(Mono.just(100));
        when(creditRepository.updateTransactionBalance(10L, 100)).thenReturn(Mono.empty());

        StepVerifier.create(creditService.refundTask(8L, "task-1", "image")).verifyComplete();

        verify(creditRepository).updateTransactionBalance(10L, 100);
    }

    /**
     * 分镜首次生成应使用独立操作标识扣除一次文本模型积分。
     */
    @Test
    void shouldChargeStoryboardOperation() {
        String operationId = "storyboard-operation-1";
        String reason = "分镜首次生成扣费（操作ID：" + operationId + "）";
        when(creditRepository.claimOperationTransaction(8L, operationId, CreditService.TRANSACTION_TASK_CHARGE, -6, reason))
                .thenReturn(Mono.just(11L));
        when(creditRepository.changeBalance(8L, -6)).thenReturn(Mono.just(94));
        when(creditRepository.updateTransactionBalance(11L, 94)).thenReturn(Mono.empty());

        StepVerifier.create(creditService.chargeOperation(8L, operationId, 6, "分镜首次生成"))
                .verifyComplete();

        verify(creditRepository).updateTransactionBalance(11L, 94);
    }

    /**
     * 分镜操作余额不足时不得写入余额快照。
     */
    @Test
    void shouldRejectStoryboardOperationWhenBalanceIsInsufficient() {
        String operationId = "storyboard-operation-2";
        String reason = "分镜提示词合成扣费（操作ID：" + operationId + "）";
        when(creditRepository.claimOperationTransaction(8L, operationId, CreditService.TRANSACTION_TASK_CHARGE, -18, reason))
                .thenReturn(Mono.just(12L));
        when(creditRepository.changeBalance(8L, -18)).thenReturn(Mono.empty());

        StepVerifier.create(creditService.chargeOperation(8L, operationId, 18, "分镜提示词合成"))
                .expectError(BusinessException.class)
                .verify();

        verify(creditRepository, never()).updateTransactionBalance(anyLong(), anyInt());
    }

    /**
     * 分镜Agent失败后的退款必须读取原始扣费金额。
     */
    @Test
    void shouldRefundStoryboardOperationWithOriginalChargeAmount() {
        String operationId = "storyboard-operation-3";
        String chargeReason = "分镜提示词合成扣费（操作ID：" + operationId + "）";
        String refundReason = "分镜提示词合成退款（操作ID：" + operationId + "）";
        when(creditRepository.getOperationChargeAmount(8L, chargeReason)).thenReturn(Mono.just(18));
        when(creditRepository.claimOperationTransaction(8L, operationId, CreditService.TRANSACTION_TASK_REFUND, 18, refundReason))
                .thenReturn(Mono.just(13L));
        when(creditRepository.changeBalance(8L, 18)).thenReturn(Mono.just(100));
        when(creditRepository.updateTransactionBalance(13L, 100)).thenReturn(Mono.empty());

        StepVerifier.create(creditService.refundOperation(8L, operationId, "分镜提示词合成"))
                .verifyComplete();

        verify(creditRepository).updateTransactionBalance(13L, 100);
    }

    /**
     * 分镜退款未成功更新余额时必须向上游报错，避免把未退款误判为完成。
     */
    @Test
    void shouldFailWhenStoryboardRefundCannotUpdateBalance() {
        String operationId = "storyboard-operation-4";
        String chargeReason = "分镜提示词合成扣费（操作ID：" + operationId + "）";
        String refundReason = "分镜提示词合成退款（操作ID：" + operationId + "）";
        when(creditRepository.getOperationChargeAmount(8L, chargeReason)).thenReturn(Mono.just(18));
        when(creditRepository.claimOperationTransaction(8L, operationId, CreditService.TRANSACTION_TASK_REFUND, 18, refundReason))
                .thenReturn(Mono.just(14L));
        when(creditRepository.changeBalance(8L, 18)).thenReturn(Mono.empty());

        StepVerifier.create(creditService.refundOperation(8L, operationId, "分镜提示词合成"))
                .expectErrorMatches(error -> error instanceof BusinessException && "分镜提示词合成退款失败".equals(error.getMessage()))
                .verify();

        verify(creditRepository, never()).updateTransactionBalance(anyLong(), anyInt());
    }

    /**
     * 管理员零金额调整应直接拒绝。
     */
    @Test
    void shouldRejectZeroCreditAdjustment() {
        BusinessException exception = Assertions.assertThrows(BusinessException.class,
                () -> creditService.adjustUserCredits(8L, 1L, 0, "测试调整").block());

        Assertions.assertEquals("积分变动值不能为0", exception.getMessage());
    }

    /**
     * 按日统计应补齐没有消耗记录的日期。
     */
    @Test
    void shouldCompleteDailyCreditTrend() {
        when(currentUserProvider.currentUserId()).thenReturn(Mono.just(8L));
        when(creditRepository.listGenerationTypeDistribution(org.mockito.ArgumentMatchers.any()))
                .thenReturn(Flux.just(new CreditDtos.CreditDistributionItem("image", 12L)));
        when(creditRepository.listModelDistribution(org.mockito.ArgumentMatchers.any()))
                .thenReturn(Flux.just(new CreditDtos.CreditDistributionItem("模型一", 12L)));
        when(creditRepository.listTrend(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.eq("day")))
                .thenReturn(Flux.just(new CreditDtos.CreditTrendItem("2026-07-02", 12L)));

        StepVerifier.create(creditService.getCreditOverview(LocalDate.of(2026, 7, 1), LocalDate.of(2026, 7, 3), null, "day"))
                .assertNext(overview -> {
                    Assertions.assertEquals(List.of(0L, 12L, 0L), overview.trend().stream().map(CreditDtos.CreditTrendItem::consumedCredits).toList());
                    Assertions.assertEquals("模型一", overview.modelDistribution().getFirst().name());
                })
                .verifyComplete();
    }

    /**
     * 管理员查询全部用户概览时不应读取当前用户。
     */
    @Test
    void shouldQueryAllUsersCreditOverviewForAdministrator() {
        when(creditRepository.listGenerationTypeDistribution(org.mockito.ArgumentMatchers.any()))
                .thenReturn(Flux.just(new CreditDtos.CreditDistributionItem("image", 12L)));
        when(creditRepository.listModelDistribution(org.mockito.ArgumentMatchers.any()))
                .thenReturn(Flux.just(new CreditDtos.CreditDistributionItem("模型一", 12L)));
        when(creditRepository.listTrend(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.eq("day")))
                .thenReturn(Flux.just(new CreditDtos.CreditTrendItem("2026-07-01", 12L)));

        StepVerifier.create(creditService.getAdminCreditOverview(null, LocalDate.of(2026, 7, 1), LocalDate.of(2026, 7, 1), null, "day"))
                .assertNext(overview -> Assertions.assertEquals(12L, overview.trend().getFirst().consumedCredits()))
                .verifyComplete();

        verify(currentUserProvider, never()).currentUserId();
    }

    /**
     * 管理员查询指定用户明细时应保留用户信息。
     */
    @Test
    void shouldListSelectedUserCreditTransactionsForAdministrator() {
        CreditDtos.AdminCreditTransactionItem transaction = new CreditDtos.AdminCreditTransactionItem(
                10L, 8L, "user-8", "用户八", "user8@example.com", "image", "模型一", "imagePage", 12L, "2026-07-01T08:00:00+08:00");
        when(creditRepository.listAdminCreditTransactions(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.eq(1), org.mockito.ArgumentMatchers.eq(20)))
                .thenReturn(Flux.just(transaction));
        when(creditRepository.countCreditTransactions(org.mockito.ArgumentMatchers.any())).thenReturn(Mono.just(1L));

        StepVerifier.create(creditService.listAdminCreditTransactions(8L, LocalDate.of(2026, 7, 1), LocalDate.of(2026, 7, 1), "image", 1, 20))
                .assertNext(result -> {
                    Assertions.assertEquals(1L, result.total());
                    Assertions.assertEquals("user8@example.com", result.transactions().getFirst().email());
                })
                .verifyComplete();
    }
}
