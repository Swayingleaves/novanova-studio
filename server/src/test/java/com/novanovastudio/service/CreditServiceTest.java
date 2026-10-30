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
import com.novanovastudio.dto.InvitationDtos;
import com.novanovastudio.repository.CreditRepository;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.security.TeamScope;
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

    /** 会过期的积分发放批次服务 */
    private CreditGrantService creditGrantService;

    /** 当前用户提供器 */
    private CurrentUserProvider currentUserProvider;

    /** 持久化服务 */
    private PersistenceService persistenceService;

    /** 待测试积分服务 */
    private CreditService creditService;

    /**
     * 初始化测试依赖。
     */
    @BeforeEach
    void setUp() {
        creditRepository = mock(CreditRepository.class);
        when(creditRepository.originalWallet(anyString(), anyLong(), anyString())).thenReturn(Mono.just(0L));
        creditGrantService = mock(CreditGrantService.class);
        currentUserProvider = mock(CurrentUserProvider.class);
        persistenceService = mock(PersistenceService.class);
        when(persistenceService.getPlatformModelConfigs()).thenReturn(Mono.just(List.of()));
        TransactionalOperator transactionalOperator = mock(TransactionalOperator.class);
        when(transactionalOperator.transactional(org.mockito.ArgumentMatchers.<Mono<Object>>any()))
                .thenAnswer(invocation -> invocation.getArgument(0));
        creditService = new CreditService(creditRepository, creditGrantService, persistenceService, currentUserProvider, transactionalOperator, com.novanovastudio.TeamTestSupport.taskScope());
    }

    /**
     * 管理员任务查询应跨团队覆盖所有用户并保留筛选与用户信息。
     */
    @Test
    void shouldListAllUsersTaskRecordsInSystemScope() {
        LocalDate startDate = LocalDate.of(2026, 7, 1);
        LocalDate endDate = LocalDate.of(2026, 7, 31);
        CreditDtos.AdminTaskRecordItem firstTask = new CreditDtos.AdminTaskRecordItem(
                "task-1", "image", "model-id", "success", "提示词", null, null, null,
                java.math.BigDecimal.TEN, List.of(), null, "2026-07-02T12:00:00+08:00", null,
                8L, "creator", "创作者", "creator@example.com");
        CreditDtos.AdminTaskRecordItem secondTask = new CreditDtos.AdminTaskRecordItem(
                "task-2", "image", "model-id", "success", "提示词", null, null, null,
                java.math.BigDecimal.ONE, List.of(), null, "2026-07-03T12:00:00+08:00", null,
                9L, "another-creator", null, "another@example.com");
        when(creditRepository.listAdminTaskRecords(org.mockito.ArgumentMatchers.any(CreditRepository.TaskRecordQuery.class), anyInt(), anyInt()))
                .thenAnswer(invocation -> {
                    CreditRepository.TaskRecordQuery query = invocation.getArgument(0);
                    Assertions.assertNull(query.userId());
                    Assertions.assertEquals(startDate.atStartOfDay(java.time.ZoneId.of("Asia/Shanghai")).toOffsetDateTime(), query.startAt());
                    Assertions.assertEquals(endDate.plusDays(1).atStartOfDay(java.time.ZoneId.of("Asia/Shanghai")).toOffsetDateTime(), query.endAt());
                    Assertions.assertEquals("image", query.taskType());
                    Assertions.assertEquals("提示词", query.keyword());
                    Assertions.assertEquals(2, (int) invocation.<Integer>getArgument(1));
                    Assertions.assertEquals(10, (int) invocation.<Integer>getArgument(2));
                    return Flux.deferContextual(context -> {
                        Assertions.assertTrue(context.getOrDefault(TeamScope.SYSTEM_KEY, false));
                        return Flux.just(firstTask, secondTask);
                    });
                });
        when(creditRepository.countTaskRecords(org.mockito.ArgumentMatchers.any(CreditRepository.TaskRecordQuery.class))).thenReturn(Mono.just(2L));

        StepVerifier.create(creditService.listAdminTaskRecords(startDate, endDate, "image", " 提示词 ", 2, 10))
                .expectNextMatches(response -> response.total() == 2
                        && response.records().size() == 2
                        && response.records().getFirst().userId() == 8L
                        && response.records().getFirst().nickname().equals("创作者")
                        && response.records().get(1).userId() == 9L
                        && response.records().get(1).email().equals("another@example.com"))
                .verifyComplete();
    }

    /**
     * 管理员任务查询应覆盖所有用户并保留筛选与用户信息。
     */
    @Test
    void shouldListAllUsersTaskRecordsInSystemScope() {
        LocalDate startDate = LocalDate.of(2026, 7, 1);
        LocalDate endDate = LocalDate.of(2026, 7, 31);
        CreditDtos.AdminTaskRecordItem firstTask = new CreditDtos.AdminTaskRecordItem(
                "task-1", "image", "model-id", "success", "提示词", null, null, null,
                10L, List.of(), null, "2026-07-02T12:00:00+08:00", null,
                8L, "creator", "创作者", "creator@example.com");
        CreditDtos.AdminTaskRecordItem secondTask = new CreditDtos.AdminTaskRecordItem(
                "task-2", "image", "model-id", "success", "提示词", null, null, null,
                1L, List.of(), null, "2026-07-03T12:00:00+08:00", null,
                9L, "another-creator", null, "another@example.com");
        when(creditRepository.listAdminTaskRecords(org.mockito.ArgumentMatchers.any(CreditRepository.TaskRecordQuery.class), anyInt(), anyInt()))
                .thenAnswer(invocation -> {
                    CreditRepository.TaskRecordQuery query = invocation.getArgument(0);
                    Assertions.assertNull(query.userId());
                    Assertions.assertEquals(startDate.atStartOfDay(java.time.ZoneId.of("Asia/Shanghai")).toOffsetDateTime(), query.startAt());
                    Assertions.assertEquals(endDate.plusDays(1).atStartOfDay(java.time.ZoneId.of("Asia/Shanghai")).toOffsetDateTime(), query.endAt());
                    Assertions.assertEquals("image", query.taskType());
                    Assertions.assertEquals("提示词", query.keyword());
                    Assertions.assertEquals(2, (int) invocation.<Integer>getArgument(1));
                    Assertions.assertEquals(10, (int) invocation.<Integer>getArgument(2));
                    return Flux.just(firstTask, secondTask);
                });
        when(creditRepository.countTaskRecords(org.mockito.ArgumentMatchers.any(CreditRepository.TaskRecordQuery.class))).thenReturn(Mono.just(2L));

        StepVerifier.create(creditService.listAdminTaskRecords(startDate, endDate, "image", " 提示词 ", 2, 10))
                .expectNextMatches(response -> response.total() == 2
                        && response.records().size() == 2
                        && response.records().getFirst().userId() == 8L
                        && response.records().getFirst().nickname().equals("创作者")
                        && response.records().get(1).userId() == 9L
                        && response.records().get(1).email().equals("another@example.com"))
                .verifyComplete();
    }

    /**
     * 积分不足时任务扣费应失败，且不写余额快照。
     */
    @Test
    void shouldRejectTaskChargeWhenBalanceIsInsufficient() {
        when(creditRepository.claimTaskTransaction(8L, "task-1", CreditService.TRANSACTION_TASK_CHARGE, java.math.BigDecimal.valueOf(-12), "图片生成任务扣费", "imagePage"))
                .thenReturn(Mono.just(9L));
        when(creditGrantService.consumeCredits(8L, java.math.BigDecimal.valueOf(12))).thenReturn(Mono.empty());

        StepVerifier.create(creditService.chargeTask(8L, "task-1", java.math.BigDecimal.valueOf(12), "image", "imagePage"))
                .expectError(BusinessException.class)
                .verify();

        verify(creditRepository, org.mockito.Mockito.never()).updateTransactionBalance(anyLong(), org.mockito.ArgumentMatchers.any(java.math.BigDecimal.class));
    }

    /**
     * 正数邀请奖励应增加邀请人余额并回填唯一流水余额快照。
     */
    @Test
    void shouldGrantPositiveInvitationReward() {
        when(creditRepository.getInvitationRewardCredits()).thenReturn(Mono.just(java.math.BigDecimal.valueOf(20)));
        when(creditRepository.claimInvitationRewardTransaction(5L, 8L, java.math.BigDecimal.valueOf(20), "邀请新用户注册奖励")).thenReturn(Mono.just(30L));
        when(creditRepository.changeBalance(5L, java.math.BigDecimal.valueOf(20))).thenReturn(Mono.just(java.math.BigDecimal.valueOf(120)));
        when(creditRepository.updateTransactionBalance(30L, java.math.BigDecimal.valueOf(120))).thenReturn(Mono.empty());

        StepVerifier.create(creditService.grantInvitationReward(5L, 8L)).verifyComplete();

        verify(creditRepository).changeBalance(5L, java.math.BigDecimal.valueOf(20));
        verify(creditRepository).updateTransactionBalance(30L, java.math.BigDecimal.valueOf(120));
    }

    /**
     * 邀请奖励为0时只由注册流程保留邀请关系，不写积分流水。
     */
    @Test
    void shouldSkipZeroInvitationRewardTransaction() {
        when(creditRepository.getInvitationRewardCredits()).thenReturn(Mono.just(java.math.BigDecimal.valueOf(0)));

        StepVerifier.create(creditService.grantInvitationReward(5L, 8L)).verifyComplete();

        verify(creditRepository, never()).claimInvitationRewardTransaction(anyLong(), anyLong(), org.mockito.ArgumentMatchers.any(java.math.BigDecimal.class), anyString());
        verify(creditRepository, never()).changeBalance(anyLong(), org.mockito.ArgumentMatchers.any(java.math.BigDecimal.class));
    }

    /**
     * 邀请奖励设置应通过独立字段更新，不修改新用户初始积分。
     */
    @Test
    void shouldUpdateInvitationRewardSettingsIndependently() {
        when(creditRepository.updateInvitationRewardCredits(java.math.BigDecimal.valueOf(30))).thenReturn(Mono.empty());

        StepVerifier.create(creditService.updateInvitationRewardSettings(
                        new InvitationDtos.UpdateInvitationRewardSettingsRequest(java.math.BigDecimal.valueOf(30))))
                .expectNextMatches(settings -> settings.invitationRewardCredits().compareTo(java.math.BigDecimal.valueOf(30)) == 0)
                .verifyComplete();

        verify(creditRepository).updateInvitationRewardCredits(java.math.BigDecimal.valueOf(30));
        verify(creditRepository, never()).updateInitialCredits(org.mockito.ArgumentMatchers.any(java.math.BigDecimal.class));
    }

    /**
     * 被邀请用户奖励流水已存在时不得再次增加邀请人余额。
     */
    @Test
    void shouldNotGrantDuplicateInvitationReward() {
        when(creditRepository.getInvitationRewardCredits()).thenReturn(Mono.just(java.math.BigDecimal.valueOf(20)));
        when(creditRepository.claimInvitationRewardTransaction(5L, 8L, java.math.BigDecimal.valueOf(20), "邀请新用户注册奖励")).thenReturn(Mono.empty());

        StepVerifier.create(creditService.grantInvitationReward(5L, 8L)).verifyComplete();

        verify(creditRepository, never()).changeBalance(anyLong(), org.mockito.ArgumentMatchers.any(java.math.BigDecimal.class));
    }

    /**
     * 任务退款应使用原始扣费金额，并由任务流水唯一键保证幂等。
     */
    @Test
    void shouldRefundOriginalTaskChargeOnlyOnce() {
        when(creditRepository.getTaskChargeAmount("task-1")).thenReturn(Mono.just(java.math.BigDecimal.valueOf(12)));
        when(creditRepository.claimTaskTransaction(8L, "task-1", CreditService.TRANSACTION_TASK_REFUND, java.math.BigDecimal.valueOf(12), "图片生成任务退款", null))
                .thenReturn(Mono.just(10L));
        when(creditRepository.changeBalance(8L, java.math.BigDecimal.valueOf(12))).thenReturn(Mono.just(java.math.BigDecimal.valueOf(100)));
        when(creditRepository.updateTransactionBalance(10L, java.math.BigDecimal.valueOf(100))).thenReturn(Mono.empty());

        StepVerifier.create(creditService.refundTask(8L, "task-1", "image")).verifyComplete();

        verify(creditRepository).updateTransactionBalance(10L, java.math.BigDecimal.valueOf(100));
    }

    /** 混用平台模型与团队空间时，精确退款必须返回原平台钱包。 */
    @Test
    void shouldRefundFractionalChargeToOriginalWallet() {
        var amount = new java.math.BigDecimal("0.123456");
        when(creditRepository.originalWallet("shared-task", 8L, "")).thenReturn(Mono.just(0L));
        when(creditRepository.getTaskChargeAmount("shared-task")).thenReturn(Mono.just(amount));
        when(creditRepository.claimTaskTransaction(8L, "shared-task", CreditService.TRANSACTION_TASK_REFUND, amount, "图片生成任务退款", null))
                .thenReturn(Mono.just(22L));
        when(creditRepository.changeBalance(8L, amount)).thenReturn(Mono.deferContextual(context -> {
            Assertions.assertEquals(0L, context.<Long>get(com.novanovastudio.security.TeamScope.WALLET_KEY).longValue());
            return Mono.just(new java.math.BigDecimal("9.123456"));
        }));
        when(creditRepository.updateTransactionBalance(22L, new java.math.BigDecimal("9.123456"))).thenReturn(Mono.empty());
        StepVerifier.create(creditService.refundTask(8L, "shared-task", "image")
                .contextWrite(context -> new com.novanovastudio.security.TeamScope(101, "member").apply(context)
                        .put(com.novanovastudio.security.TeamScope.WALLET_KEY, 101L))).verifyComplete();
    }

    /**
     * 分镜首次生成应使用独立操作标识扣除一次文本模型积分。
     */
    @Test
    void shouldChargeStoryboardOperation() {
        String operationId = "storyboard-operation-1";
        String reason = "分镜首次生成扣费（操作ID：" + operationId + "）";
        when(creditRepository.claimOperationTransaction(8L, operationId, CreditService.TRANSACTION_TASK_CHARGE, java.math.BigDecimal.valueOf(-6), reason))
                .thenReturn(Mono.just(11L));
        when(creditGrantService.consumeCredits(8L, java.math.BigDecimal.valueOf(6))).thenReturn(Mono.just(java.math.BigDecimal.valueOf(94)));
        when(creditRepository.updateTransactionBalance(11L, java.math.BigDecimal.valueOf(94))).thenReturn(Mono.empty());

        StepVerifier.create(creditService.chargeOperation(8L, operationId, java.math.BigDecimal.valueOf(6), "分镜首次生成"))
                .verifyComplete();

        verify(creditRepository).updateTransactionBalance(11L, java.math.BigDecimal.valueOf(94));
    }

    /**
     * 分镜操作余额不足时不得写入余额快照。
     */
    @Test
    void shouldRejectStoryboardOperationWhenBalanceIsInsufficient() {
        String operationId = "storyboard-operation-2";
        String reason = "分镜提示词合成扣费（操作ID：" + operationId + "）";
        when(creditRepository.claimOperationTransaction(8L, operationId, CreditService.TRANSACTION_TASK_CHARGE, java.math.BigDecimal.valueOf(-18), reason))
                .thenReturn(Mono.just(12L));
        when(creditGrantService.consumeCredits(8L, java.math.BigDecimal.valueOf(18))).thenReturn(Mono.empty());

        StepVerifier.create(creditService.chargeOperation(8L, operationId, java.math.BigDecimal.valueOf(18), "分镜提示词合成"))
                .expectError(BusinessException.class)
                .verify();

        verify(creditRepository, never()).updateTransactionBalance(anyLong(), org.mockito.ArgumentMatchers.any(java.math.BigDecimal.class));
    }

    /**
     * 分镜Agent失败后的退款必须读取原始扣费金额。
     */
    @Test
    void shouldRefundStoryboardOperationWithOriginalChargeAmount() {
        String operationId = "storyboard-operation-3";
        String chargeReason = "分镜提示词合成扣费（操作ID：" + operationId + "）";
        String refundReason = "分镜提示词合成退款（操作ID：" + operationId + "）";
        when(creditRepository.getOperationChargeAmount(8L, chargeReason)).thenReturn(Mono.just(java.math.BigDecimal.valueOf(18)));
        when(creditRepository.claimOperationTransaction(8L, operationId, CreditService.TRANSACTION_TASK_REFUND, java.math.BigDecimal.valueOf(18), refundReason))
                .thenReturn(Mono.just(13L));
        when(creditRepository.changeBalance(8L, java.math.BigDecimal.valueOf(18))).thenReturn(Mono.just(java.math.BigDecimal.valueOf(100)));
        when(creditRepository.updateTransactionBalance(13L, java.math.BigDecimal.valueOf(100))).thenReturn(Mono.empty());

        StepVerifier.create(creditService.refundOperation(8L, operationId, "分镜提示词合成"))
                .verifyComplete();

        verify(creditRepository).updateTransactionBalance(13L, java.math.BigDecimal.valueOf(100));
    }

    /**
     * 分镜退款未成功更新余额时必须向上游报错，避免把未退款误判为完成。
     */
    @Test
    void shouldFailWhenStoryboardRefundCannotUpdateBalance() {
        String operationId = "storyboard-operation-4";
        String chargeReason = "分镜提示词合成扣费（操作ID：" + operationId + "）";
        String refundReason = "分镜提示词合成退款（操作ID：" + operationId + "）";
        when(creditRepository.getOperationChargeAmount(8L, chargeReason)).thenReturn(Mono.just(java.math.BigDecimal.valueOf(18)));
        when(creditRepository.claimOperationTransaction(8L, operationId, CreditService.TRANSACTION_TASK_REFUND, java.math.BigDecimal.valueOf(18), refundReason))
                .thenReturn(Mono.just(14L));
        when(creditRepository.changeBalance(8L, java.math.BigDecimal.valueOf(18))).thenReturn(Mono.empty());

        StepVerifier.create(creditService.refundOperation(8L, operationId, "分镜提示词合成"))
                .expectErrorMatches(error -> error instanceof BusinessException && "分镜提示词合成退款失败".equals(error.getMessage()))
                .verify();

        verify(creditRepository, never()).updateTransactionBalance(anyLong(), org.mockito.ArgumentMatchers.any(java.math.BigDecimal.class));
    }

    /**
     * 管理员零金额调整应直接拒绝。
     */
    @Test
    void shouldRejectZeroCreditAdjustment() {
        BusinessException exception = Assertions.assertThrows(BusinessException.class,
                () -> creditService.adjustUserCredits(8L, 1L, java.math.BigDecimal.valueOf(0), "测试调整").block());

        Assertions.assertEquals("积分变动值不能为0", exception.getMessage());
    }

    /**
     * 按日统计应补齐没有消耗记录的日期。
     */
    @Test
    void shouldCompleteDailyCreditTrend() {
        when(currentUserProvider.currentUserId()).thenReturn(Mono.just(8L));
        when(creditRepository.listGenerationTypeDistribution(org.mockito.ArgumentMatchers.any()))
                .thenReturn(Flux.just(new CreditDtos.CreditDistributionItem("image", java.math.BigDecimal.valueOf(12L))));
        when(creditRepository.listModelDistribution(org.mockito.ArgumentMatchers.any()))
                .thenReturn(Flux.just(new CreditDtos.CreditDistributionItem("模型一", java.math.BigDecimal.valueOf(12L))));
        when(creditRepository.listTrend(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.eq("day")))
                .thenReturn(Flux.just(new CreditDtos.CreditTrendItem("2026-07-02", java.math.BigDecimal.valueOf(12L))));

        StepVerifier.create(creditService.getCreditOverview(LocalDate.of(2026, 7, 1), LocalDate.of(2026, 7, 3), null, "day"))
                .assertNext(overview -> {
                    Assertions.assertEquals(List.of("0", "12", "0"), overview.trend().stream().map(item -> item.consumedCredits().stripTrailingZeros().toPlainString()).toList());
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
                .thenReturn(Flux.just(new CreditDtos.CreditDistributionItem("image", java.math.BigDecimal.valueOf(12L))));
        when(creditRepository.listModelDistribution(org.mockito.ArgumentMatchers.any()))
                .thenReturn(Flux.just(new CreditDtos.CreditDistributionItem("模型一", java.math.BigDecimal.valueOf(12L))));
        when(creditRepository.listTrend(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.eq("day")))
                .thenReturn(Flux.just(new CreditDtos.CreditTrendItem("2026-07-01", java.math.BigDecimal.valueOf(12L))));

        StepVerifier.create(creditService.getAdminCreditOverview(null, LocalDate.of(2026, 7, 1), LocalDate.of(2026, 7, 1), null, "day"))
                .assertNext(overview -> Assertions.assertEquals(0, java.math.BigDecimal.valueOf(12).compareTo(overview.trend().getFirst().consumedCredits())))
                .verifyComplete();

        verify(currentUserProvider, never()).currentUserId();
    }

    /**
     * 管理员查询指定用户明细时应保留用户信息与积分变动方向。
     */
    @Test
    void shouldListSelectedUserCreditTransactionsForAdministrator() {
        CreditDtos.AdminCreditTransactionItem transaction = new CreditDtos.AdminCreditTransactionItem(
                10L, 8L, "user-8", "用户八", "user8@example.com", CreditService.TRANSACTION_TASK_CHARGE, "spend",
                "image", "模型一", "imagePage", java.math.BigDecimal.valueOf(-12L), "图片生成任务扣费", java.math.BigDecimal.valueOf(88L), null, "2026-07-01T08:00:00+08:00");
        when(creditRepository.listAdminCreditTransactions(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.eq(1), org.mockito.ArgumentMatchers.eq(20)))
                .thenReturn(Flux.just(transaction));
        when(creditRepository.countAdminTransactions(org.mockito.ArgumentMatchers.any())).thenReturn(Mono.just(1L));

        StepVerifier.create(creditService.listAdminCreditTransactions(8L, LocalDate.of(2026, 7, 1), LocalDate.of(2026, 7, 1), "image", 1, 20))
                .assertNext(result -> {
                    Assertions.assertEquals(1L, result.total());
                    Assertions.assertEquals("user8@example.com", result.transactions().getFirst().email());
                    Assertions.assertEquals(0, java.math.BigDecimal.valueOf(-12).compareTo(result.transactions().getFirst().changeAmount()));
                })
                .verifyComplete();
    }
}
