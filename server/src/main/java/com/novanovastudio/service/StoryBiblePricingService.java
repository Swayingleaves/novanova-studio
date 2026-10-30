package com.novanovastudio.service;

import com.novanovastudio.ai.AiTaskTypes;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.PersistenceDtos;
import com.novanovastudio.dto.StoryBibleDtos;
import com.novanovastudio.repository.StoryBibleRepository;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Mono;

/**
 * 故事知识库分析按文本模型与字数分档的价格配置。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-09-27 00:00
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class StoryBiblePricingService {
    /** 知识库仓储。 */
    private final StoryBibleRepository repository;
    /** 模型配置服务。 */
    private final PersistenceService persistenceService;

    /**
     * 列出全部文本模型及其价格档位，未配置的模型档位为空。
     *
     * @return Mono&lt;List&lt;ModelPricing&gt;&gt; 价格配置
     */
    public Mono<List<StoryBibleDtos.ModelPricing>> getPricing() {
        return Mono.zip(persistenceService.getPlatformModelConfigs(),
                        repository.listPricing().collectMap(StoryBibleRepository.Pricing::modelConfigId, Function.identity()))
                .map(tuple -> tuple.getT1().stream()
                        .filter(config -> AiTaskTypes.TEXT.equals(config.modelType()))
                        .map(config -> toPricing(config, tuple.getT2()))
                        .toList());
    }

    /**
     * 保存单个文本模型的价格档位。
     *
     * @param request SavePricingRequest 保存请求
     * @return Mono&lt;ModelPricing&gt; 保存后的价格配置
     */
    public Mono<StoryBibleDtos.ModelPricing> savePricing(StoryBibleDtos.SavePricingRequest request) {
        if (!StringUtils.hasText(request.modelConfigId())) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_MISSING, "缺少模型配置标识"));
        }
        List<StoryBibleDtos.PricingTier> tiers = StoryBibleSupport.validateTiers(request.tiers());
        StoryBibleDtos.QuickConfiguration configuration = StoryBibleSupport.validateQuickConfiguration(request.quickConfiguration());
        return persistenceService.getPlatformModelConfigs()
                .flatMap(configs -> configs.stream()
                        .filter(config -> request.modelConfigId().equals(config.id()) && AiTaskTypes.TEXT.equals(config.modelType()))
                        .findFirst().map(Mono::just)
                        .orElseGet(() -> Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "文本模型不存在"))))
                .flatMap(config -> repository.savePricing(config.id(), tiers, request.expectedRevision(), configuration)
                        .flatMap(saved -> saved
                                ? repository.findPricing(config.id()).map(pricing -> toPricing(config, Map.of(config.id(), pricing)))
                                : Mono.<StoryBibleDtos.ModelPricing>error(new BusinessException(ErrorCode.DATA_CONFLICT, "价格已被其他管理员修改，请刷新后重试"))))
                .doOnNext(pricing -> log.info("保存故事知识库价格: modelConfigId={}, revision={}, tiers={}",
                        pricing.modelConfigId(), pricing.revision(), pricing.tiers()));
    }

    /**
     * 读取指定模型的价格配置。
     *
     * @param modelConfigId String 模型配置标识
     * @return Mono&lt;Pricing&gt; 价格配置，未配置时为空
     */
    public Mono<StoryBibleRepository.Pricing> find(String modelConfigId) {
        return repository.findPricing(modelConfigId);
    }

    /**
     * 组装价格配置响应。
     *
     * @param config ModelConfig 模型配置
     * @param pricing Map&lt;String, Pricing&gt; 已保存价格
     * @return ModelPricing 价格配置
     */
    private StoryBibleDtos.ModelPricing toPricing(PersistenceDtos.ModelConfig config, Map<String, StoryBibleRepository.Pricing> pricing) {
        StoryBibleRepository.Pricing saved = pricing.get(config.id());
        return new StoryBibleDtos.ModelPricing(config.id(), config.channelId() + "::" + config.modelName(),
                StringUtils.hasText(config.displayName()) ? config.displayName() : config.modelName(),
                saved == null ? List.of() : saved.tiers(), saved == null ? 0 : saved.revision(),
                saved == null ? null : saved.quickConfiguration());
    }
}
