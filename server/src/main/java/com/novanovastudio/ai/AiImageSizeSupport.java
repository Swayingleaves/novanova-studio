package com.novanovastudio.ai;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.common.SystemMessage;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.util.StringUtils;

/**
 * 图像模型的比例与像素尺寸映射。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-20 17:00
 */
public final class AiImageSizeSupport {

    /** 可配置的图片分辨率档位。 */
    public static final List<String> RESOLUTIONS = List.of("1K", "2K", "4K");

    /** 像素尺寸允许使用x或乘号，并统一输出小写x。 */
    private static final Pattern PIXEL_SIZE = Pattern.compile("([1-9]\\d*)\\s*[xX×]\\s*([1-9]\\d*)");

    /** 系统默认尺寸表，未配置模型映射时使用。 */
    private static final Map<String, Map<String, String>> DEFAULT_MAPPINGS = createDefaultMappings();

    /** 禁止实例化尺寸工具。 */
    private AiImageSizeSupport() {
    }

    /**
     * 获取只读默认映射，不包含未经配置的表外比例。
     *
     * @return Map<String, Map<String, String>> 比例、分辨率与像素尺寸的对应表
     */
    public static Map<String, Map<String, String>> defaultMappings() {
        return DEFAULT_MAPPINGS;
    }

    /**
     * 校验并规范化模型尺寸表，空配置表示明确使用系统默认表。
     *
     * @param mappings Map<String, Map<String, String>> 模型完整配置，null使用系统默认表
     * @return Map<String, Map<String, String>> 已校验的配置，缺失档位保持缺失
     * @throws BusinessException 比例、档位或像素尺寸不合法时抛出
     */
    public static Map<String, Map<String, String>> normalizeMappings(Map<String, Map<String, String>> mappings) {
        if (mappings == null) return DEFAULT_MAPPINGS;
        Map<String, Map<String, String>> result = new LinkedHashMap<>();
        mappings.forEach((ratio, sizes) -> {
            if (ratio == null || !ratio.matches("[1-9]\\d*:[1-9]\\d*") || sizes == null) {
                throw new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.invalidImageSizeMappings"));
            }
            Map<String, String> normalized = new LinkedHashMap<>();
            sizes.forEach((resolution, size) -> {
                if (!RESOLUTIONS.contains(resolution) || size == null) {
                    throw new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.invalidImageSizeMappings"));
                }
                Matcher matcher = PIXEL_SIZE.matcher(size.trim());
                if (!matcher.matches()) {
                    throw new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.invalidImageSizeMappings"));
                }
                normalized.put(resolution, matcher.group(1) + "x" + matcher.group(2));
            });
            result.put(ratio, Collections.unmodifiableMap(normalized));
        });
        return Collections.unmodifiableMap(result);
    }

    /**
     * 按系统默认表解析图片尺寸。
     *
     * @param parameters Map<String, Object> 图片生成参数
     * @param convertImageSizeToPixels boolean 是否将比例转换为像素尺寸
     * @return String 原始比例或像素尺寸
     * @throws BusinessException 分辨率不合法或尺寸未配置时抛出
     */
    public static String resolveSize(Map<String, Object> parameters, boolean convertImageSizeToPixels) {
        return resolveSize(parameters, convertImageSizeToPixels, null);
    }

    /**
     * 根据模型开关与映射表解析尺寸，不修改原始请求，也不推算未配置档位。
     *
     * @param parameters Map<String, Object> 图片生成参数
     * @param convertImageSizeToPixels boolean 是否将比例转换为像素尺寸
     * @param mappings Map<String, Map<String, String>> 模型尺寸表，null使用默认表
     * @return String 比例或宽x高像素尺寸；空值和auto返回空字符串
     * @throws BusinessException 分辨率不合法或尺寸未配置时抛出
     */
    public static String resolveSize(Map<String, Object> parameters, boolean convertImageSizeToPixels,
                                     Map<String, Map<String, String>> mappings) {
        String size = AiTaskParameterReader.parameterText(parameters, "size", "");
        if (!StringUtils.hasText(size) || "auto".equalsIgnoreCase(size)) return "";
        if (!convertImageSizeToPixels || size.matches("^\\d+x\\d+$")) return size;
        String resolution = AiTaskParameterReader.stringParameter(parameters, "resolution", "2K").toUpperCase(Locale.ROOT);
        if (!RESOLUTIONS.contains(resolution)) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.imageResolutionMustBe1K2KOr4K"));
        }
        Map<String, String> sizes = (mappings == null ? DEFAULT_MAPPINGS : mappings).get(size);
        String pixels = sizes == null ? null : sizes.get(resolution);
        if (!StringUtils.hasText(pixels)) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.imageSizeMappingNotConfigured", size, resolution));
        }
        return pixels;
    }

    /**
     * 建立系统默认尺寸表，严格使用产品约定的像素值。
     *
     * @return Map<String, Map<String, String>> 只读默认映射
     */
    private static Map<String, Map<String, String>> createDefaultMappings() {
        Map<String, Map<String, String>> mappings = new LinkedHashMap<>();
        mappings.put("1:1", Map.of("1K", "1024x1024", "2K", "2048x2048", "4K", "2880x2880"));
        mappings.put("1:2", Map.of("1K", "512x1024", "2K", "1024x2048", "4K", "1648x3296"));
        mappings.put("2:1", Map.of("1K", "1024x512", "2K", "2048x1024", "4K", "3296x1648"));
        mappings.put("9:16", Map.of("1K", "720x1280", "2K", "1152x2048", "4K", "2160x3840"));
        mappings.put("16:9", Map.of("1K", "1280x720", "2K", "2048x1152", "4K", "3840x2160"));
        mappings.put("3:4", Map.of("1K", "864x1152", "2K", "1536x2048", "4K", "2448x3264"));
        mappings.put("4:3", Map.of("1K", "1152x864", "2K", "2048x1536", "4K", "3264x2448"));
        mappings.put("3:2", Map.of("1K", "1536x1024", "2K", "2400x1600", "4K", "3456x2304"));
        mappings.put("2:3", Map.of("1K", "1024x1536", "2K", "1600x2400", "4K", "2304x3456"));
        mappings.put("5:4", Map.of("1K", "1120x896", "2K", "2240x1792", "4K", "3200x2560"));
        mappings.put("4:5", Map.of("1K", "896x1120", "2K", "1792x2240", "4K", "2560x3200"));
        mappings.put("21:9", Map.of("1K", "1344x576", "2K", "2016x864", "4K", "3808x1632"));
        mappings.put("9:21", Map.of("1K", "576x1344", "2K", "864x2016", "4K", "1632x3808"));
        return Collections.unmodifiableMap(mappings);
    }
}
