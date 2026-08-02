package com.novanovastudio.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.SensitiveDataCrypto;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.dto.AiTaskDtos;
import com.novanovastudio.repository.CreditCardRepository;
import com.novanovastudio.repository.CreditRepository;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.task.AiTaskEventPublisher;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.transaction.reactive.TransactionalOperator;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

/**
 * 积分卡密规则测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-08-02 13:10
 */
class CreditCardServiceTest {

    /** 测试卡密。 */
    private static final String CARD_CODE = "ABCDEFGHJKLMNPQRSTUV";

    /** 卡密仓储。 */
    private CreditCardRepository creditCardRepository;

    /** 积分仓储。 */
    private CreditRepository creditRepository;

    /** 当前用户提供器。 */
    private CurrentUserProvider currentUserProvider;

    /** 积分卡密服务。 */
    private CreditCardService creditCardService;

    /** 用户事件发布器。 */
    private AiTaskEventPublisher eventPublisher;

    /**
     * 初始化兑换服务测试依赖。
     */
    @BeforeEach
    void setUp() {
        creditCardRepository = mock(CreditCardRepository.class);
        creditRepository = mock(CreditRepository.class);
        currentUserProvider = mock(CurrentUserProvider.class);
        TransactionalOperator transactionalOperator = mock(TransactionalOperator.class);
        eventPublisher = mock(AiTaskEventPublisher.class);
        NovanovaProperties properties = mock(NovanovaProperties.class);
        when(currentUserProvider.currentUserId()).thenReturn(Mono.just(42L));
        when(transactionalOperator.transactional(org.mockito.ArgumentMatchers.<Mono<Object>>any()))
                .thenAnswer(invocation -> invocation.getArgument(0));
        when(eventPublisher.publish(anyLong(), any())).thenReturn(Mono.empty());
        creditCardService = new CreditCardService(creditCardRepository, creditRepository, currentUserProvider,
                transactionalOperator, eventPublisher, properties);
    }

    /**
     * 批量生成的卡密应满足固定长度、字符集和唯一性。
     */
    @Test
    void shouldGenerateUniqueTwentyCharacterCodes() {
        List<String> codes = CreditCardService.generateUniqueCodes(100);

        assertEquals(100, codes.size());
        assertEquals(100, Set.copyOf(codes).size());
        assertTrue(codes.stream().allMatch(code -> CreditCardService.CARD_CODE_PATTERN.matcher(code).matches()));
        assertTrue(codes.stream().allMatch(code -> code.chars().allMatch(character -> CreditCardService.CARD_CODE_ALPHABET.indexOf(character) >= 0)));
    }

    /**
     * 生成数量和单卡积分必须为有效正数。
     */
    @Test
    void shouldValidateGenerationLimits() {
        assertThrows(BusinessException.class, () -> CreditCardService.validateGeneration(0, 10));
        assertThrows(BusinessException.class, () -> CreditCardService.validateGeneration(1001, 10));
        assertThrows(BusinessException.class, () -> CreditCardService.validateGeneration(100, 0));
    }

    /**
     * 卡密规范化应支持用户复制时带入的空白和分隔符。
     */
    @Test
    void shouldNormalizeAndMaskCardCode() {
        String code = "abcdefgh-jklm-npqr-stuv";

        assertEquals("ABCDEFGHJKLMNPQRSTUV", CreditCardService.normalizeCardCode(code));
        assertEquals("****-****-****-****-STUV", CreditCardService.maskCardCode("ABCDEFGHJKLMNPQRSTUV"));
    }

    /**
     * 无效卡密应在访问数据库前被拒绝。
     */
    @Test
    void shouldRejectInvalidCardCodeBeforeLookup() {
        assertThrows(BusinessException.class, () -> creditCardService.redeemCredits("ABCDEFGHJKLMNPQRSTUIV"));

        verify(currentUserProvider, never()).currentUserId();
        verifyNoCardLookup();
    }

    /**
     * 有效卡密应原子增加余额并写入兑换流水。
     */
    @Test
    void shouldRedeemCardAndPublishUpdatedBalance() {
        OffsetDateTime redeemedAt = OffsetDateTime.parse("2026-08-02T14:00:00+08:00");
        when(creditCardRepository.claimUnredeemedCard(SensitiveDataCrypto.sha256Hex(CARD_CODE), 42L))
                .thenReturn(Mono.just(new CreditCardRepository.ClaimedCard(7L, "****-****-****-****-STUV", "STUV", 50, redeemedAt)));
        when(creditRepository.changeBalance(42L, 50)).thenReturn(Mono.just(150));
        when(creditRepository.createCardRedeemTransaction(42L, 7L, 50, 150, "兑换积分卡密"))
                .thenReturn(Mono.just(99L));

        StepVerifier.create(creditCardService.redeemCredits(CARD_CODE))
                .assertNext(response -> {
                    assertEquals(7L, response.cardId());
                    assertEquals(50, response.credits());
                    assertEquals(150, response.creditBalance());
                    assertEquals("****-****-****-****-STUV", response.cardMasked());
                })
                .verifyComplete();

        verify(eventPublisher).publish(eq(42L), argThat(event -> "credit-balance".equals(event.type()) && Integer.valueOf(150).equals(event.creditBalance())));
    }

    /**
     * 已兑换卡密不得再次增加积分。
     */
    @Test
    void shouldRejectRedeemedCard() {
        when(creditCardRepository.claimUnredeemedCard(SensitiveDataCrypto.sha256Hex(CARD_CODE), 42L)).thenReturn(Mono.empty());
        when(creditCardRepository.findCardStatus(SensitiveDataCrypto.sha256Hex(CARD_CODE)))
                .thenReturn(Mono.just(new CreditCardRepository.CardStatus(7L, OffsetDateTime.now())));

        StepVerifier.create(creditCardService.redeemCredits(CARD_CODE))
                .expectErrorSatisfies(error -> assertEquals("卡密已兑换", error.getMessage()))
                .verify();

        verify(creditRepository, never()).changeBalance(anyLong(), org.mockito.ArgumentMatchers.anyInt());
        verify(eventPublisher, never()).publish(anyLong(), any());
    }

    /**
     * 余额不足时应回滚兑换流程且不写入兑换流水。
     */
    @Test
    void shouldRejectRedeemWhenCreditAccountCannotBeUpdated() {
        when(creditCardRepository.claimUnredeemedCard(SensitiveDataCrypto.sha256Hex(CARD_CODE), 42L))
                .thenReturn(Mono.just(new CreditCardRepository.ClaimedCard(7L, "****-****-****-****-STUV", "STUV", 50, OffsetDateTime.now())));
        when(creditRepository.changeBalance(42L, 50)).thenReturn(Mono.empty());

        StepVerifier.create(creditCardService.redeemCredits(CARD_CODE))
                .expectErrorSatisfies(error -> assertEquals("积分账户不存在，无法兑换卡密", error.getMessage()))
                .verify();

        verify(creditRepository, never()).createCardRedeemTransaction(anyLong(), anyLong(), org.mockito.ArgumentMatchers.anyInt(), org.mockito.ArgumentMatchers.anyInt(), any(String.class));
        verify(eventPublisher, never()).publish(anyLong(), any());
    }

    /**
     * 流水写入失败时不得向客户端发布已完成的余额事件。
     */
    @Test
    void shouldNotPublishBalanceEventWhenTransactionFails() {
        when(creditCardRepository.claimUnredeemedCard(SensitiveDataCrypto.sha256Hex(CARD_CODE), 42L))
                .thenReturn(Mono.just(new CreditCardRepository.ClaimedCard(7L, "****-****-****-****-STUV", "STUV", 50, OffsetDateTime.now())));
        when(creditRepository.changeBalance(42L, 50)).thenReturn(Mono.just(150));
        when(creditRepository.createCardRedeemTransaction(42L, 7L, 50, 150, "兑换积分卡密"))
                .thenReturn(Mono.error(new IllegalStateException("流水写入失败")));

        StepVerifier.create(creditCardService.redeemCredits(CARD_CODE))
                .expectErrorMessage("流水写入失败")
                .verify();

        verify(eventPublisher, never()).publish(anyLong(), any());
    }

    /**
     * 流水仓储异常完成为空时也必须视为失败。
     */
    @Test
    void shouldRejectEmptyRedeemTransactionResult() {
        when(creditCardRepository.claimUnredeemedCard(SensitiveDataCrypto.sha256Hex(CARD_CODE), 42L))
                .thenReturn(Mono.just(new CreditCardRepository.ClaimedCard(7L, "****-****-****-****-STUV", "STUV", 50, OffsetDateTime.now())));
        when(creditRepository.changeBalance(42L, 50)).thenReturn(Mono.just(150));
        when(creditRepository.createCardRedeemTransaction(42L, 7L, 50, 150, "兑换积分卡密"))
                .thenReturn(Mono.empty());

        StepVerifier.create(creditCardService.redeemCredits(CARD_CODE))
                .expectErrorSatisfies(error -> assertEquals("积分兑换流水写入失败", error.getMessage()))
                .verify();

        verify(eventPublisher, never()).publish(anyLong(), any());
    }

    /**
     * 验证无效卡密不会触发库存查询。
     */
    private void verifyNoCardLookup() {
        verify(creditCardRepository, never()).claimUnredeemedCard(any(String.class), anyLong());
        verify(creditCardRepository, never()).findCardStatus(any(String.class));
    }
}
