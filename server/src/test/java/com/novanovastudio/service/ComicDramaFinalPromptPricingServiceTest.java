package com.novanovastudio.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.novanovastudio.agent.AgentScopeModelFactory;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.ComicDramaFinalPromptPricingDtos;
import com.novanovastudio.dto.PersistenceDtos;
import com.novanovastudio.repository.ComicDramaFinalPromptPricingRepository;
import com.novanovastudio.security.TeamScope;
import jakarta.validation.Validation;
import java.math.BigDecimal;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 独立定价的金额、空间归属和价格确认测试。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-28 15:00
 */
class ComicDramaFinalPromptPricingServiceTest {
    /** 模拟定价仓储。 */
    private ComicDramaFinalPromptPricingRepository repository;
    /** 模拟模型解析，不调用真实模型。 */
    private AgentScopeModelFactory modelFactory;
    /** 待测服务。 */
    private ComicDramaFinalPromptPricingService service;

    /** 初始化一个属于平台的可用文本模型。 */
    @BeforeEach
    void initialize() {
        repository = mock(ComicDramaFinalPromptPricingRepository.class);
        modelFactory = mock(AgentScopeModelFactory.class);
        PersistenceService persistence = mock(PersistenceService.class);
        PersistenceDtos.ModelConfig config = mock(PersistenceDtos.ModelConfig.class);
        when(config.id()).thenReturn("model-id");
        when(config.channelId()).thenReturn("channel");
        when(config.modelName()).thenReturn("text");
        when(config.modelType()).thenReturn("text");
        when(config.ownerTeamId()).thenReturn(0L);
        when(persistence.getPlatformModelConfigs()).thenReturn(Mono.just(List.of(config)));
        service = new ComicDramaFinalPromptPricingService(repository, persistence, modelFactory);
    }

    /** 未配置保持空值，拒绝启动，不能解析或调用模型。 */
    @Test
    void shouldRejectUnconfiguredBeforeResolvingModel() {
        when(repository.findPricing("model-id")).thenReturn(Mono.empty());
        var price = service.getUnitPrice("channel::text").block();
        assertNull(price.unitPrice());
        assertEquals(0, price.revision());
        assertThrows(BusinessException.class, () -> service.prepare("channel::text", 0L).block());
        verifyNoInteractions(modelFactory);
    }

    /** 过期或缺失价格修订号在模型解析前拒绝。 */
    @Test
    void shouldRejectStaleOrMissingRevision() {
        when(repository.findPricing("model-id")).thenReturn(Mono.just(pricing("1.234567", 2)));
        for (Long revision : new Long[]{1L, null}) {
            var error = assertThrows(BusinessException.class, () -> service.prepare("channel::text", revision).block());
            assertEquals(ErrorCode.DATA_CONFLICT, error.getCode());
        }
        verifyNoInteractions(modelFactory);
    }

    /** 免费与六位小数价格都保留精度，每次启动仅读取一次快照。 */
    @Test
    void shouldPrepareFreeAndFractionalPricesWithoutGeneralPriceFallback() {
        var model = new AgentScopeModelFactory.TextModelSelection(null, "model-id", "channel::text", "text", "渠道", BigDecimal.TEN, 0);
        when(modelFactory.resolveTextModel("channel::text")).thenReturn(Mono.just(model));
        when(repository.findPricing("model-id")).thenReturn(Mono.just(pricing("0", 1)), Mono.just(pricing("1.234567", 2)));
        assertEquals(0, service.prepare("channel::text", 1L).block().credits().signum());
        assertEquals(new BigDecimal("1.234567"), service.prepare("channel::text", 2L).block().credits());
        verify(repository, times(2)).findPricing("model-id");
    }

    /** 首次配置与修改返回本次原子保存的修订，并发冲突不会被覆盖。 */
    @Test
    void shouldSaveAndRejectConflictingRevision() {
        when(repository.savePricing(eq("model-id"), any(), eq(0L))).thenReturn(Mono.just(pricing("0", 1)));
        when(repository.savePricing(eq("model-id"), any(), eq(1L))).thenReturn(Mono.just(pricing("0.123456", 2)), Mono.empty());
        assertEquals(1, service.savePricing(new ComicDramaFinalPromptPricingDtos.SavePricingRequest("model-id", BigDecimal.ZERO, 0)).block().revision());
        var request = new ComicDramaFinalPromptPricingDtos.SavePricingRequest("model-id", new BigDecimal("0.123456"), 1);
        assertEquals(2, service.savePricing(request).block().revision());
        var error = assertThrows(BusinessException.class, () -> service.savePricing(request).block());
        assertEquals(ErrorCode.DATA_CONFLICT, error.getCode());
    }

    /** 授权团队可见平台价格但不能修改，平台仍可编辑。 */
    @Test
    void shouldMakeGrantedPlatformPriceReadOnly() {
        when(repository.listPricing()).thenReturn(Flux.just(pricing("3", 1)));
        assertTrue(service.getPricing().block().getFirst().editable());
        var team = new TeamScope(9, "administrator");
        var price = service.getPricing().contextWrite(team::apply).block().getFirst();
        assertFalse(price.editable());
        assertEquals(new BigDecimal("3"), price.credits());
        assertThrows(BusinessException.class, () -> service.savePricing(new ComicDramaFinalPromptPricingDtos.SavePricingRequest(
                "model-id", BigDecimal.ONE, 1)).contextWrite(team::apply).block());
        verify(repository, never()).savePricing(anyString(), any(), anyLong());
    }

    /** HTTP校验与服务内部校验均拒绝空值、负数和超过六位小数。 */
    @Test
    void shouldRejectInvalidAmounts() {
        try (var factory = Validation.buildDefaultValidatorFactory()) {
            for (BigDecimal amount : new BigDecimal[]{null, new BigDecimal("-0.000001"), new BigDecimal("0.1234567"), new BigDecimal("1000000000000000000")}) {
                var request = new ComicDramaFinalPromptPricingDtos.SavePricingRequest("model-id", amount, 0);
                assertFalse(factory.getValidator().validate(request).isEmpty());
                assertThrows(BusinessException.class, () -> service.savePricing(request).block());
            }
        }
        verifyNoInteractions(repository);
    }

    /**
     * 构造已保存价格。
     * @param amount 十进制单价
     * @param revision 修订号
     * @return 定价快照
     */
    private ComicDramaFinalPromptPricingRepository.Pricing pricing(String amount, long revision) {
        return new ComicDramaFinalPromptPricingRepository.Pricing("model-id", new BigDecimal(amount), revision);
    }
}
