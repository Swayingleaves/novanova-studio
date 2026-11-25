package com.novanovastudio.dto;

import com.alibaba.fastjson2.JSONWriter;
import com.alibaba.fastjson2.annotation.JSONField;
import com.novanovastudio.ai.VideoGenerationMode;
import java.math.BigDecimal;

import java.util.Map;

/**
 * 视频模型的模式分辨率分档计费配置。
 *
 * @param billingUnit String 计费方式，generation 按次或 second 按秒
 * @param minimumDurationSeconds Integer 最短可生成时长秒数
 * @param maximumDurationSeconds Integer 最长可生成时长秒数，-1 表示不限制，为空时默认 15 秒
 * @param modePrices Map<String, Map<String, BigDecimal>> 模式到分辨率单价表，接口单价使用十进制字符串；全能参考模式下表示无视频输入价格
 * @param referenceVideoInputPrices Map<String, BigDecimal> 全能参考模式下有视频输入时的分辨率单价表，未配置时沿用无视频输入价格
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-08-18 00:00
 */
public record VideoBillingConfiguration(
        String billingUnit,
        Integer minimumDurationSeconds,
        Integer maximumDurationSeconds,
        @JSONField(serializeFeatures = {JSONWriter.Feature.WriteNonStringValueAsString, JSONWriter.Feature.WriteBigDecimalAsPlain})
        Map<String, Map<String, BigDecimal>> modePrices,
        @JSONField(serializeFeatures = {JSONWriter.Feature.WriteNonStringValueAsString, JSONWriter.Feature.WriteBigDecimalAsPlain})
        Map<String, BigDecimal> referenceVideoInputPrices
) {
    /** 未填写最长时间时的默认上限秒数。 */
    public static final int DEFAULT_MAXIMUM_DURATION_SECONDS = 15;
    /** 最长时间为 -1 时表示不限制上限。 */
    public static final int UNLIMITED_MAXIMUM_DURATION_SECONDS = -1;

    /**
     * 兼容未配置全能参考视频输入独立价格的构造重载。
     *
     * @param billingUnit String 计费方式
     * @param minimumDurationSeconds Integer 最短可生成时长秒数
     * @param maximumDurationSeconds Integer 最长可生成时长秒数
     * @param modePrices Map<String, Map<String, BigDecimal>> 模式到分辨率单价表
     */
    public VideoBillingConfiguration(
            String billingUnit,
            Integer minimumDurationSeconds,
            Integer maximumDurationSeconds,
            Map<String, Map<String, BigDecimal>> modePrices
    ) {
        this(billingUnit, minimumDurationSeconds, maximumDurationSeconds, modePrices, null);
    }

    /**
     * 返回实际生效的最长可生成时长秒数。
     * <p>
     * 未配置时默认返回 15 秒，配置为 -1 时表示不限制并返回 null。
     *
     * @return Integer 生效的最长可生成时长秒数，不限制时返回 null
     */
    public Integer effectiveMaximumDurationSeconds() {
        if (maximumDurationSeconds == null) {
            return DEFAULT_MAXIMUM_DURATION_SECONDS;
        }
        return maximumDurationSeconds == UNLIMITED_MAXIMUM_DURATION_SECONDS ? null : maximumDurationSeconds;
    }

    /**
     * 根据生成模式、分辨率以及是否包含视频参考输入解析生效的积分单价。
     * <p>
     * 全能参考模式且包含视频输入时优先读取 {@link #referenceVideoInputPrices}，未配置对应分辨率时回退到无视频输入价格。
     *
     * @param mode String 视频生成模式
     * @param resolution String 规范化后的分辨率标识
     * @param hasVideoReference boolean 是否包含视频参考输入
     * @return BigDecimal 生效的积分单价，未配置时返回 null
     */
    public BigDecimal resolveUnitPrice(String mode, String resolution, boolean hasVideoReference) {
        if (VideoGenerationMode.REFERENCE_TO_VIDEO.equals(mode)
                && hasVideoReference
                && referenceVideoInputPrices != null
                && referenceVideoInputPrices.containsKey(resolution)) {
            return referenceVideoInputPrices.get(resolution);
        }
        Map<String, BigDecimal> prices = modePrices == null ? null : modePrices.get(mode);
        return prices == null ? null : prices.get(resolution);
    }

    /**
     * 判断指定模式与分辨率在当前视频输入条件下是否配置了价格。
     *
     * @param mode String 视频生成模式
     * @param resolution String 规范化后的分辨率标识
     * @param hasVideoReference boolean 是否包含视频参考输入
     * @return boolean 是否已配置价格
     */
    public boolean hasPrice(String mode, String resolution, boolean hasVideoReference) {
        return resolveUnitPrice(mode, resolution, hasVideoReference) != null;
    }
}
