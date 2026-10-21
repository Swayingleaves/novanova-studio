package com.novanovastudio.dto;

import com.alibaba.fastjson2.JSONWriter;
import com.alibaba.fastjson2.annotation.JSONField;
import java.math.BigDecimal;
import java.util.Map;

/**
 * 图片模型的分辨率分档计费配置。
 *
 * @param resolutionPrices Map<String, BigDecimal> 1K、2K、4K 到积分单价的映射，接口单价使用十进制字符串
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-21 00:00
 */
public record ImageBillingConfiguration(
        @JSONField(serializeFeatures = {JSONWriter.Feature.WriteNonStringValueAsString, JSONWriter.Feature.WriteBigDecimalAsPlain})
        Map<String, BigDecimal> resolutionPrices
) {
}
