package com.novanovastudio.dto;

import com.alibaba.fastjson2.JSONWriter;
import com.alibaba.fastjson2.annotation.JSONField;
import java.math.BigDecimal;

import java.util.Map;

/**
 * 视频模型的模式分辨率分档计费配置。
 *
 * @param billingUnit String 计费方式，generation 按次或 second 按秒
 * @param minimumDurationSeconds Integer 最短可生成时长秒数
 * @param modePrices Map<String, Map<String, BigDecimal>> 模式到分辨率单价表，接口单价使用十进制字符串
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-08-18 00:00
 */
public record VideoBillingConfiguration(
        String billingUnit,
        Integer minimumDurationSeconds,
        @JSONField(serializeFeatures = {JSONWriter.Feature.WriteNonStringValueAsString, JSONWriter.Feature.WriteBigDecimalAsPlain})
        Map<String, Map<String, BigDecimal>> modePrices
) {
}
