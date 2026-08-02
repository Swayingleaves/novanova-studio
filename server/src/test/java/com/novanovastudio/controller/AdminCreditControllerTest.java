package com.novanovastudio.controller;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.CreditCardDtos;
import com.novanovastudio.service.CreditCardService;
import com.novanovastudio.security.AdminGuard;
import com.novanovastudio.service.CreditService;
import java.time.LocalDate;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

/**
 * 管理员积分接口测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-19 15:45
 */
class AdminCreditControllerTest {

    /** 积分服务 */
    private CreditService creditService;

    /** 卡密管理服务 */
    private CreditCardService creditCardService;

    /** 管理员校验 */
    private AdminGuard adminGuard;

    /** 待测试控制器 */
    private AdminCreditController adminCreditController;

    /**
     * 初始化测试依赖。
     */
    @BeforeEach
    void setUp() {
        creditService = mock(CreditService.class);
        creditCardService = mock(CreditCardService.class);
        adminGuard = mock(AdminGuard.class);
        adminCreditController = new AdminCreditController(creditService, creditCardService, adminGuard);
    }

    /**
     * 权限校验失败时不应调用积分服务。
     */
    @Test
    void shouldRejectOverviewBeforeCallingCreditServiceWhenPermissionDenied() {
        when(adminGuard.requireAdmin()).thenReturn(Mono.error(new BusinessException(ErrorCode.PERMISSION_DENIED, "权限不足")));

        StepVerifier.create(adminCreditController.getCreditOverview(null, LocalDate.of(2026, 7, 1), LocalDate.of(2026, 7, 1), null, "day"))
                .expectError(BusinessException.class)
                .verify();

        verify(creditService, never()).getAdminCreditOverview(null, LocalDate.of(2026, 7, 1), LocalDate.of(2026, 7, 1), null, "day");
    }

    /**
     * 非管理员不能触发卡密生成服务。
     */
    @Test
    void shouldRejectCardGenerationBeforeCallingCardServiceWhenPermissionDenied() {
        when(adminGuard.requireAdmin()).thenReturn(Mono.error(new BusinessException(ErrorCode.PERMISSION_DENIED, "权限不足")));

        StepVerifier.create(adminCreditController.generateCreditCards(new CreditCardDtos.GenerateCreditCardsRequest(100, 10)))
                .expectError(BusinessException.class)
                .verify();

        verify(creditCardService, never()).generateCreditCards(org.mockito.ArgumentMatchers.any());
    }
}
