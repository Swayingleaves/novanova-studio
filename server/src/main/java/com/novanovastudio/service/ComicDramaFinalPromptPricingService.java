package com.novanovastudio.service;

import com.novanovastudio.agent.AgentScopeModelFactory;
import com.novanovastudio.ai.AiTaskTypes;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.CreditAmounts;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.ComicDramaFinalPromptPricingDtos;
import com.novanovastudio.dto.PersistenceDtos;
import com.novanovastudio.repository.ComicDramaFinalPromptPricingRepository;
import com.novanovastudio.security.TeamScope;
import java.math.BigDecimal;
import java.util.List;
import java.util.Objects;
import java.util.function.Function;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Mono;

/**
 * 漫剧最终提示词独立定价及生成前价格确认。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-28 15:00
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ComicDramaFinalPromptPricingService {
    /** 专项定价仓储。 */
    private final ComicDramaFinalPromptPricingRepository repository;
    /** 当前空间可用模型配置。 */
    private final PersistenceService persistenceService;
    /** 模型解析与资源授权校验。 */
    private final AgentScopeModelFactory modelFactory;

    /**
     * 列出文本模型价格和当前空间的编辑权限。
     * @return 模型定价列表
     */
    public Mono<List<ComicDramaFinalPromptPricingDtos.ModelPricing>> getPricing() {
        return Mono.zip(persistenceService.getPlatformModelConfigs(), repository.listPricing()
                        .collectMap(ComicDramaFinalPromptPricingRepository.Pricing::modelConfigId, Function.identity()), TeamScope.current())
                .map(tuple -> tuple.getT1().stream().filter(config -> AiTaskTypes.TEXT.equals(config.modelType()))
                        .map(config -> toPricing(config, tuple.getT2().get(config.id()), tuple.getT3().teamId())).toList());
    }

    /**
     * 保存当前空间自有模型价格，严格拒绝无效金额与过期修订号。
     * @param request 模型价格与期望修订号
     * @return 本次保存后的价格
     * @throws BusinessException 金额无效、模型不属于当前空间或修订冲突时抛出
     */
    public Mono<ComicDramaFinalPromptPricingDtos.ModelPricing> savePricing(ComicDramaFinalPromptPricingDtos.SavePricingRequest request) {
        if (request.credits() == null || request.credits().signum() < 0 || request.credits().scale() > 6
                || request.expectedRevision() < 0 || !StringUtils.hasText(request.modelConfigId())) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "请填写模型、非负积分（最多六位小数）和有效价格修订号"));
        }
        BigDecimal credits = CreditAmounts.of(request.credits());
        return Mono.zip(findModel(request.modelConfigId(), false), TeamScope.current()).flatMap(tuple -> {
            PersistenceDtos.ModelConfig config = tuple.getT1();
            long teamId = tuple.getT2().teamId();
            if (!Objects.equals(config.ownerTeamId(), teamId)) {
                return Mono.error(new BusinessException(ErrorCode.PERMISSION_DENIED, "只能维护当前空间自有模型的价格，授权平台模型价格只读"));
            }
            return repository.savePricing(config.id(), credits, request.expectedRevision())
                    .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.DATA_CONFLICT, "价格已被其他管理员修改，请刷新后重试")))
                    .map(saved -> toPricing(config, saved, teamId));
        }).doOnNext(saved -> log.info("保存漫剧最终提示词价格: modelConfigId={}, revision={}, credits={}",
                saved.modelConfigId(), saved.revision(), saved.credits()));
    }

    /**
     * 查询所选模型单价，未配置保留空单价。
     * @param model 渠道与模型组合值
     * @return 单价与修订号
     */
    public Mono<ComicDramaFinalPromptPricingDtos.UnitPrice> getUnitPrice(String model) {
        return findModel(model, true).flatMap(config -> repository.findPricing(config.id())
                .map(saved -> new ComicDramaFinalPromptPricingDtos.UnitPrice(saved.credits(), saved.revision()))
                .defaultIfEmpty(new ComicDramaFinalPromptPricingDtos.UnitPrice(null, 0)));
    }

    /**
     * 每次请求只读取一次价格，并在解析模型、扣费和调用模型前确认修订号。
     * @param model 所选模型组合值
     * @param expectedRevision 用户确认的价格修订号
     * @return 本次全部镜头共用的模型与价格快照
     * @throws BusinessException 未定价或价格已变化时抛出
     */
    public Mono<PreparedPricing> prepare(String model, Long expectedRevision) {
        return getUnitPrice(model).flatMap(price -> {
            if (price.unitPrice() == null) {
                return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR,
                        "该模型未配置最终提示词价格，请到后台「创作定价 · 漫剧创作-生成最终提示词定价」配置"));
            }
            if (expectedRevision == null || expectedRevision != price.revision()) {
                return Mono.error(new BusinessException(ErrorCode.DATA_CONFLICT, "最终提示词价格已变化，请刷新价格后重试"));
            }
            return modelFactory.resolveTextModel(model).map(selection -> new PreparedPricing(selection, price.unitPrice(), price.revision()));
        });
    }

    /**
     * 从当前空间可用文本模型中匹配配置，不跨空间读取模型。
     * @param value 模型标识或组合值
     * @param composite 是否按组合值匹配
     * @return 可用文本模型
     */
    private Mono<PersistenceDtos.ModelConfig> findModel(String value, boolean composite) {
        return persistenceService.getPlatformModelConfigs().flatMap(configs -> Mono.justOrEmpty(configs.stream()
                        .filter(config -> AiTaskTypes.TEXT.equals(config.modelType())
                                && Objects.equals(composite ? config.channelId() + "::" + config.modelName() : config.id(), value))
                        .findFirst()))
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "所选文本模型不存在或不可用")));
    }

    /**
     * 组装配置，未配置的价格保留空值。
     * @param config 模型配置
     * @param saved 已保存价格或空值
     * @param teamId 当前空间
     * @return 模型价格及编辑权限
     */
    private ComicDramaFinalPromptPricingDtos.ModelPricing toPricing(PersistenceDtos.ModelConfig config,
            ComicDramaFinalPromptPricingRepository.Pricing saved, long teamId) {
        return new ComicDramaFinalPromptPricingDtos.ModelPricing(config.id(), config.channelId() + "::" + config.modelName(),
                StringUtils.hasText(config.displayName()) ? config.displayName() : config.modelName(),
                saved == null ? null : saved.credits(), saved == null ? 0 : saved.revision(), Objects.equals(config.ownerTeamId(), teamId));
    }

    /** 本次请求固定的模型、每镜头积分与价格修订号。 */
    public record PreparedPricing(AgentScopeModelFactory.TextModelSelection model, BigDecimal credits, long revision) { }
}
