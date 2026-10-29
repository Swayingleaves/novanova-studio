package com.novanovastudio.dto;

import com.alibaba.fastjson2.annotation.JSONField;
import com.novanovastudio.common.CreditAmountWriter;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.util.List;

/**
 * 剧本 AI 助手动作定价契约：按文本模型维护每个动作每次调用的积分。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-29 10:30
 */
public final class ScriptAiActionPricingDtos {

    /** 禁止实例化契约容器。 */
    private ScriptAiActionPricingDtos() { }

    /** 单个动作的价格，未定价时积分为空。 */
    public record ActionPricing(String actionType,
                                @Digits(integer = 18, fraction = 6) @JSONField(serializeUsing = CreditAmountWriter.class) BigDecimal credits) { }

    /** 单个文本模型的全部动作价格，未定价的动作同样列出，方便后台补齐。 */
    public record ModelPricing(String modelConfigId, String model, String displayName,
                               List<ActionPricing> actions, long revision) { }

    /** 保存某个文本模型的整份动作价格。 */
    public record SavePricingRequest(@NotBlank @Size(max = 64) String modelConfigId, @Min(0) long expectedRevision,
                                     @NotNull @Size(max = 64) List<@Valid Entry> actions) { }

    /** 保存请求中的单条动作价格。 */
    public record Entry(@NotBlank @Size(max = 48) String actionType,
                        @NotNull @DecimalMin("0") @Digits(integer = 18, fraction = 6) @JSONField(serializeUsing = CreditAmountWriter.class) BigDecimal credits) { }
}
