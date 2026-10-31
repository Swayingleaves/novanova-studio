package com.novanovastudio.dto;

import com.alibaba.fastjson2.annotation.JSONField;
import com.novanovastudio.common.CreditAmountWriter;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;

/**
 * 漫剧最终提示词的模型定价与报价数据。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-28 15:00
 */
public final class ComicDramaFinalPromptPricingDtos {
    /** 禁止实例化数据结构容器。 */
    private ComicDramaFinalPromptPricingDtos() { }

    /** 模型定价；未配置时积分为空、修订号为零，授权平台模型在团队内只读。 */
    public record ModelPricing(String modelConfigId, String model, String displayName,
                               @JSONField(serializeUsing = CreditAmountWriter.class) BigDecimal credits,
                               long revision, boolean editable) { }

    /** 管理员保存请求，零积分表示明确免费。 */
    public record SavePricingRequest(@NotBlank String modelConfigId,
                                     @NotNull @DecimalMin("0") @Digits(integer = 18, fraction = 6) BigDecimal credits,
                                     @Min(0) long expectedRevision) { }

    /** 所选文本模型的单价查询请求。 */
    public record UnitPriceRequest(@NotBlank String model) { }

    /** 每镜头积分与价格修订号，未配置时单价为空、修订号为零。 */
    public record UnitPrice(@JSONField(serializeUsing = CreditAmountWriter.class) BigDecimal unitPrice,
                            long revision) { }
}
