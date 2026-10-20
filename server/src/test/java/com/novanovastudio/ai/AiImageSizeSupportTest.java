package com.novanovastudio.ai;

import com.novanovastudio.common.BusinessException;
import java.util.Map;
import java.util.LinkedHashMap;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;

/**
 * 图片比例转换、默认值与参数校验测试。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-20 17:00
 */
class AiImageSizeSupportTest {

    /**
     * 页面全部比例应在三档清晰度下得到确定的像素尺寸。
     *
     * @param ratio String 页面比例
     * @param firstResolution String 1K像素尺寸
     * @param secondResolution String 2K像素尺寸
     * @param fourthResolution String 4K像素尺寸
     */
    @ParameterizedTest
    @CsvSource({
            "1:1,1024x1024,2048x2048,2880x2880",
            "1:2,512x1024,1024x2048,1648x3296",
            "2:1,1024x512,2048x1024,3296x1648",
            "9:16,720x1280,1152x2048,2160x3840",
            "16:9,1280x720,2048x1152,3840x2160",
            "3:4,864x1152,1536x2048,2448x3264",
            "4:3,1152x864,2048x1536,3264x2448",
            "3:2,1536x1024,2400x1600,3456x2304",
            "2:3,1024x1536,1600x2400,2304x3456",
            "5:4,1120x896,2240x1792,3200x2560",
            "4:5,896x1120,1792x2240,2560x3200",
            "21:9,1344x576,2016x864,3808x1632",
            "9:21,576x1344,864x2016,1632x3808"
    })
    void shouldResolveAllImageRatios(String ratio, String firstResolution, String secondResolution, String fourthResolution) {
        Assertions.assertEquals(firstResolution, AiImageSizeSupport.resolveSize(Map.of("size", ratio, "resolution", "1K"), true));
        Assertions.assertEquals(secondResolution, AiImageSizeSupport.resolveSize(Map.of("size", ratio, "resolution", "2K"), true));
        Assertions.assertEquals(fourthResolution, AiImageSizeSupport.resolveSize(Map.of("size", ratio, "resolution", "4K"), true));
        Assertions.assertEquals(ratio, AiImageSizeSupport.resolveSize(Map.of("size", ratio, "resolution", "unsupported"), false));
    }

    /** 默认清晰度、已给定像素和自动尺寸应保持约定，原始参数不能被修改。 */
    @Test
    void shouldKeepPixelSizesDefaultsAndOriginalParameters() {
        Map<String, Object> parameters = Map.of("size", "9:16");
        Assertions.assertEquals("1152x2048", AiImageSizeSupport.resolveSize(parameters, true));
        Assertions.assertEquals("9:16", parameters.get("size"));
        Assertions.assertEquals("1152x2048", AiImageSizeSupport.resolveSize(Map.of("size", "9:16", "resolution", ""), true));
        Assertions.assertEquals("1024x1024", AiImageSizeSupport.resolveSize(Map.of("size", "1024x1024", "resolution", "8K"), true));
        Assertions.assertEquals("", AiImageSizeSupport.resolveSize(null, true));
        Assertions.assertEquals("", AiImageSizeSupport.resolveSize(Map.of("size", "auto"), true));
        Assertions.assertEquals("", AiImageSizeSupport.resolveSize(Map.of("size", "auto"), false));
    }

    /**
     * 开启转换后非法比例必须明确失败。
     *
     * @param ratio String 不合法的比例
     */
    @ParameterizedTest
    @ValueSource(strings = {"9:0", "-1:2", "NaN:1", "Infinity:2", "9:16:", "9", "1:2:3", ":16"})
    void shouldRejectInvalidRatios(String ratio) {
        Assertions.assertThrows(BusinessException.class, () -> AiImageSizeSupport.resolveSize(Map.of("size", ratio), true));
    }

    /** 开启转换后不支持的清晰度不能被自动替换。 */
    @Test
    void shouldRejectUnsupportedResolution() {
        Assertions.assertThrows(BusinessException.class,
                () -> AiImageSizeSupport.resolveSize(Map.of("size", "9:16", "resolution", "8K"), true));
    }

    /** 自定义表只影响当前模型，缺失档位明确报错，不回退系统默认值。 */
    @Test
    void shouldUseCustomMappingsWithoutFillingMissingSizes() {
        Map<String, Map<String, String>> custom = AiImageSizeSupport.normalizeMappings(Map.of("1:1", Map.of("4K", "4096 × 4096")));
        Assertions.assertEquals("4096x4096", AiImageSizeSupport.resolveSize(Map.of("size", "1:1", "resolution", "4K"), true, custom));
        Assertions.assertEquals("2880x2880", AiImageSizeSupport.resolveSize(Map.of("size", "1:1", "resolution", "4K"), true));
        BusinessException exception = Assertions.assertThrows(BusinessException.class,
                () -> AiImageSizeSupport.resolveSize(Map.of("size", "1:1", "resolution", "2K"), true, custom));
        Assertions.assertEquals("business.imageSizeMappingNotConfigured", exception.getSystemMessage().key());
        Assertions.assertThrows(BusinessException.class,
                () -> AiImageSizeSupport.resolveSize(Map.of("size", "9:16", "resolution", "4K"), true, custom));
        Assertions.assertThrows(BusinessException.class,
                () -> AiImageSizeSupport.resolveSize(Map.of("size", "1:1"), true, Map.of()));
    }

    /**
     * 非法自定义尺寸不得保存，避免执行时把错误尺寸发送到供应商。
     *
     * @param pixels String 非法像素尺寸
     */
    @ParameterizedTest
    @ValueSource(strings = {"0x1024", "-1x1024", "1024", "1.5x1024", "1024x", "1024:1024", ""})
    void shouldRejectMalformedMappingPixels(String pixels) {
        Assertions.assertThrows(BusinessException.class,
                () -> AiImageSizeSupport.normalizeMappings(Map.of("1:1", Map.of("1K", pixels))));
    }

    /** 无效比例和档位应被拒绝，默认表不能被调用者修改。 */
    @Test
    void shouldValidateMappingKeysAndProtectDefaults() {
        Assertions.assertThrows(BusinessException.class,
                () -> AiImageSizeSupport.normalizeMappings(Map.of("0:1", Map.of("1K", "1024x1024"))));
        Assertions.assertThrows(BusinessException.class,
                () -> AiImageSizeSupport.normalizeMappings(Map.of("1:1", Map.of("8K", "1024x1024"))));
        Assertions.assertThrows(UnsupportedOperationException.class,
                () -> AiImageSizeSupport.defaultMappings().get("1:1").put("4K", "4096x4096"));
        Assertions.assertEquals(13, AiImageSizeSupport.defaultMappings().size());
        Assertions.assertEquals("1:1", new LinkedHashMap<>(AiImageSizeSupport.defaultMappings()).keySet().iterator().next());
    }
}
