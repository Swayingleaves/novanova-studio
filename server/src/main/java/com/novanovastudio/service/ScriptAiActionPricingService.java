package com.novanovastudio.service;

import com.novanovastudio.ai.AiTaskTypes;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.common.SystemMessage;
import com.novanovastudio.dto.PersistenceDtos;
import com.novanovastudio.dto.ScriptAiActionPricingDtos;
import com.novanovastudio.repository.ScriptAiActionPricingRepository;
import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Mono;

/**
 * 剧本 AI 助手按「文本模型 × 动作」维护的每次调用积分。
 * <p>
 * 报价与扣费共用这份价格：未定价的动作不允许发起生成，避免回落到模型自身的 creditCost
 * 让「润色一段」和「生成整集」同价。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-29 10:30
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ScriptAiActionPricingService {

    /** 动作定价仓储。 */
    private final ScriptAiActionPricingRepository repository;

    /** 模型配置服务。 */
    private final PersistenceService persistenceService;

    /**
     * 列出全部文本模型及其动作价格，未定价的动作同样返回。
     *
     * @return Mono&lt;List&lt;ModelPricing&gt;&gt; 定价配置
     */
    public Mono<List<ScriptAiActionPricingDtos.ModelPricing>> getPricing() {
        return Mono.zip(persistenceService.getPlatformModelConfigs(),
                        repository.listPricing().collectList())
                .map(tuple -> {
                    Map<String, List<ScriptAiActionPricingRepository.Pricing>> grouped = tuple.getT2().stream()
                            .collect(Collectors.groupingBy(ScriptAiActionPricingRepository.Pricing::modelConfigId));
                    return tuple.getT1().stream()
                            .filter(config -> AiTaskTypes.TEXT.equals(config.modelType()))
                            .map(config -> toModelPricing(config, grouped.getOrDefault(config.id(), List.of())))
                            .toList();
                });
    }

    /**
     * 保存单个文本模型的整份动作价格。
     *
     * @param request SavePricingRequest 保存请求
     * @return Mono&lt;ModelPricing&gt; 保存后的定价
     */
    public Mono<ScriptAiActionPricingDtos.ModelPricing> savePricing(ScriptAiActionPricingDtos.SavePricingRequest request) {
        if (!StringUtils.hasText(request.modelConfigId())) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_MISSING, "缺少模型配置标识"));
        }
        Map<String, BigDecimal> deduplicated = new LinkedHashMap<>();
        for (ScriptAiActionPricingDtos.Entry entry : request.actions()) {
            if (!ScriptAiActions.ALL_SET.contains(entry.actionType())) {
                return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "不支持的剧本AI动作"));
            }
            if (deduplicated.put(entry.actionType(), entry.credits()) != null) {
                return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "同一个AI动作不能重复定价"));
            }
        }
        List<ScriptAiActionPricingRepository.Entry> entries = deduplicated.entrySet().stream()
                .map(item -> new ScriptAiActionPricingRepository.Entry(item.getKey(), item.getValue())).toList();
        return textModelConfig(request.modelConfigId())
                .flatMap(config -> repository.savePricing(config.id(), entries, request.expectedRevision())
                        .flatMap(saved -> saved
                                ? repository.findPricing(config.id()).collectList()
                                        .map(rows -> toModelPricing(config, rows))
                                : Mono.<ScriptAiActionPricingDtos.ModelPricing>error(new BusinessException(
                                        ErrorCode.DATA_CONFLICT, "价格已被其他管理员修改，请刷新后重试"))))
                .doOnNext(pricing -> log.info("保存剧本AI动作价格: modelConfigId={}, revision={}, actions={}",
                        pricing.modelConfigId(), pricing.revision(), pricing.actions()));
    }

    /**
     * 读取某个模型下全部动作的价格，未定价的动作为空，供剧本助手面板在发起前展示。
     *
     * @param model String 前端选择的模型值，形如 channelId::modelName
     * @return Mono&lt;List&lt;ActionPricing&gt;&gt; 动作价格
     */
    public Mono<List<ScriptAiActionPricingDtos.ActionPricing>> findActions(String model) {
        return modelConfigId(model).flatMap(id -> repository.findPricing(id).collectList()
                .map(rows -> toActions(rows)));
    }

    /**
     * 读取动作单价，未定价时直接拒绝发起，避免静默使用其他价格。
     *
     * @param modelConfigId String 模型配置标识
     * @param actionType String 动作标识
     * @return Mono&lt;BigDecimal&gt; 该动作的积分
     */
    public Mono<BigDecimal> requireCredits(String modelConfigId, String actionType) {
        return repository.findPricing(modelConfigId)
                .filter(pricing -> pricing.actionType().equals(actionType))
                .next()
                .map(ScriptAiActionPricingRepository.Pricing::credits)
                .switchIfEmpty(Mono.<BigDecimal>error(new BusinessException(ErrorCode.BUSINESS_ERROR,
                        SystemMessage.of("business.thisAiActionHasNoPriceAskTheAdministratorToSetItUnderCreationPricing"))));
    }

    /**
     * 校验模型存在且为文本模型。
     *
     * @param modelConfigId String 模型配置标识
     * @return Mono&lt;ModelConfig&gt; 文本模型配置
     */
    private Mono<PersistenceDtos.ModelConfig> textModelConfig(String modelConfigId) {
        return persistenceService.getPlatformModelConfigs()
                .flatMap(configs -> configs.stream()
                        .filter(config -> modelConfigId.equals(config.id()) && AiTaskTypes.TEXT.equals(config.modelType()))
                        .findFirst().map(Mono::just)
                        .orElseGet(() -> Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "文本模型不存在"))));
    }

    /**
     * 把前端模型值解析为模型配置标识。
     *
     * @param model String 形如 channelId::modelName 的模型值
     * @return Mono&lt;String&gt; 模型配置标识
     */
    private Mono<String> modelConfigId(String model) {
        String value = model == null ? "" : model.trim();
        int separator = value.indexOf("::");
        if (separator <= 0) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "所选文本模型格式不合法"));
        }
        String channelId = value.substring(0, separator);
        String modelName = value.substring(separator + 2);
        return persistenceService.getPlatformModelConfigs().flatMap(configs -> configs.stream()
                .filter(config -> AiTaskTypes.TEXT.equals(config.modelType()) && channelId.equals(config.channelId())
                        && modelName.equals(config.modelName()))
                .findFirst().map(config -> Mono.just(config.id()))
                .orElseGet(() -> Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "所选文本模型不可用"))));
    }

    /**
     * 组装单个模型的定价响应，未定价的动作保留为空值。
     *
     * @param config ModelConfig 文本模型配置
     * @param rows List&lt;Pricing&gt; 已保存的价格行
     * @return ModelPricing 定价配置
     */
    private ScriptAiActionPricingDtos.ModelPricing toModelPricing(PersistenceDtos.ModelConfig config,
                                                                  List<ScriptAiActionPricingRepository.Pricing> rows) {
        long revision = rows.stream().mapToLong(ScriptAiActionPricingRepository.Pricing::revision).max().orElse(0L);
        return new ScriptAiActionPricingDtos.ModelPricing(config.id(), config.channelId() + "::" + config.modelName(),
                StringUtils.hasText(config.displayName()) ? config.displayName() : config.modelName(),
                toActions(rows), revision);
    }

    /**
     * 按动作目录顺序排列价格，未定价的动作为空。
     *
     * @param rows List&lt;Pricing&gt; 已保存的价格行
     * @return List&lt;ActionPricing&gt; 动作价格
     */
    private List<ScriptAiActionPricingDtos.ActionPricing> toActions(List<ScriptAiActionPricingRepository.Pricing> rows) {
        Map<String, BigDecimal> creditsByAction = rows.stream()
                .collect(Collectors.toMap(ScriptAiActionPricingRepository.Pricing::actionType,
                        ScriptAiActionPricingRepository.Pricing::credits, (left, right) -> left, LinkedHashMap::new));
        return ScriptAiActions.ALL.stream()
                .map(action -> new ScriptAiActionPricingDtos.ActionPricing(action, creditsByAction.get(action)))
                .toList();
    }
}
