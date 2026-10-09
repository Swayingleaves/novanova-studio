package com.novanovastudio.service;

import com.novanovastudio.ai.AiTaskTypes;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.EpisodeBodiesDtos;
import com.novanovastudio.dto.PersistenceDtos;
import com.novanovastudio.repository.EpisodeBodiesPricingRepository;
import java.util.List;
import java.util.function.Function;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Mono;

/**
 * 分集正文生成按文本模型维护的每集积分定价。
 * <p>
 * 报价与启动共用这里的单价：未配置的模型不允许发起生成，避免拿到一个无人维护的兜底价格。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-09 09:25
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class EpisodeBodiesPricingService {

    /** 定价仓储。 */
    private final EpisodeBodiesPricingRepository repository;

    /** 模型配置服务。 */
    private final PersistenceService persistenceService;

    /**
     * 列出全部文本模型及其每集积分，未配置的模型积分为空。
     *
     * @return Mono&lt;List&lt;ModelPricing&gt;&gt; 定价配置
     */
    public Mono<List<EpisodeBodiesDtos.ModelPricing>> getPricing() {
        return Mono.zip(persistenceService.getPlatformModelConfigs(),
                        repository.listPricing().collectMap(EpisodeBodiesPricingRepository.Pricing::modelConfigId,
                                Function.identity()))
                .map(tuple -> tuple.getT1().stream()
                        .filter(config -> AiTaskTypes.TEXT.equals(config.modelType()))
                        .map(config -> toPricing(config, tuple.getT2().get(config.id())))
                        .toList());
    }

    /**
     * 保存单个文本模型的每集积分。
     *
     * @param request SavePricingRequest 保存请求
     * @return Mono&lt;ModelPricing&gt; 保存后的定价
     */
    public Mono<EpisodeBodiesDtos.ModelPricing> savePricing(EpisodeBodiesDtos.SavePricingRequest request) {
        if (!StringUtils.hasText(request.modelConfigId())) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_MISSING, "缺少模型配置标识"));
        }
        return persistenceService.getPlatformModelConfigs()
                .flatMap(configs -> configs.stream()
                        .filter(config -> request.modelConfigId().equals(config.id())
                                && AiTaskTypes.TEXT.equals(config.modelType()))
                        .findFirst().map(Mono::just)
                        .orElseGet(() -> Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "文本模型不存在"))))
                .flatMap(config -> repository
                        .savePricing(config.id(), request.credits(), request.expectedRevision())
                        .flatMap(saved -> saved
                                ? repository.findPricing(config.id())
                                        .map(pricing -> toPricing(config, pricing))
                                : Mono.error(new BusinessException(ErrorCode.DATA_CONFLICT,
                                        "价格已被其他管理员修改，请刷新后重试"))))
                .doOnNext(pricing -> log.info("保存分集正文价格: modelConfigId={}, revision={}, credits={}",
                        pricing.modelConfigId(), pricing.revision(), pricing.credits()));
    }

    /**
     * 读取单个模型的每集积分，未配置时返回空。
     *
     * @param modelConfigId String 模型配置标识
     * @return Mono&lt;Integer&gt; 每集积分
     */
    public Mono<Integer> findCredits(String modelConfigId) {
        return repository.findPricing(modelConfigId).map(EpisodeBodiesPricingRepository.Pricing::credits);
    }

    /**
     * 组装定价响应，未配置时积分为 0。
     *
     * @param config ModelConfig 模型配置
     * @param saved Pricing 已保存定价，未配置时为空
     * @return ModelPricing 定价配置
     */
    private EpisodeBodiesDtos.ModelPricing toPricing(PersistenceDtos.ModelConfig config,
                                                     EpisodeBodiesPricingRepository.Pricing saved) {
        return new EpisodeBodiesDtos.ModelPricing(config.id(), config.channelId() + "::" + config.modelName(),
                StringUtils.hasText(config.displayName()) ? config.displayName() : config.modelName(),
                saved == null ? 0 : saved.credits(), saved == null ? 0 : saved.revision());
    }
}
