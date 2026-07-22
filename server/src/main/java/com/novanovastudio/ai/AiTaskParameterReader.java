package com.novanovastudio.ai;

import com.novanovastudio.dto.AiTaskDtos;
import java.util.List;
import java.util.Map;
import org.springframework.util.StringUtils;

/**
 * @title        AiTaskParameterReader.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  AI任务参数读取工具
 * @createTime   2026-06-24 20:35:00
 */
public final class AiTaskParameterReader {

    /**
     * 禁止实例化
     */
    private AiTaskParameterReader() {
    }

    /**
     * 读取整数参数并限制范围
     *
     * @param parameters Map<String, Object> 参数集合
     * @param key String 参数名
     * @param defaultValue int 默认值
     * @param min int 最小值
     * @param max int 最大值
     * @return int 参数值
     */
    public static int intParameter(Map<String, Object> parameters, String key, int defaultValue, int min, int max) {
        Object value = parameters == null ? null : parameters.get(key);
        int parsed = value instanceof Number number ? number.intValue() : defaultValue;
        return Math.max(min, Math.min(max, parsed));
    }

    /**
     * 读取浮点参数
     *
     * @param parameters Map<String, Object> 参数集合
     * @param key String 参数名
     * @param defaultValue double 默认值
     * @return double 参数值
     */
    public static double floatParameter(Map<String, Object> parameters, String key, double defaultValue) {
        Object value = parameters == null ? null : parameters.get(key);
        return value instanceof Number number ? number.doubleValue() : defaultValue;
    }

    /**
     * 读取字符串参数
     *
     * @param parameters Map<String, Object> 参数集合
     * @param key String 参数名
     * @param defaultValue String 默认值
     * @return String 参数值
     */
    public static String stringParameter(Map<String, Object> parameters, String key, String defaultValue) {
        Object value = parameters == null ? null : parameters.get(key);
        return value instanceof String string && StringUtils.hasText(string) ? string.trim() : defaultValue;
    }

    /**
     * 读取字符串化参数
     *
     * @param parameters Map<String, Object> 参数集合
     * @param key String 参数名
     * @param defaultValue String 默认值
     * @return String 参数文本
     */
    public static String parameterText(Map<String, Object> parameters, String key, String defaultValue) {
        Object value = parameters == null ? null : parameters.get(key);
        return value == null ? defaultValue : String.valueOf(value).trim();
    }

    /**
     * 将非auto字符串参数放入请求体
     *
     * @param payload Map<String, Object> 请求体
     * @param parameters Map<String, Object> 参数集合
     * @param key String 参数名
     */
    public static void putNonAuto(Map<String, Object> payload, Map<String, Object> parameters, String key) {
        String value = stringParameter(parameters, key, "");
        if (StringUtils.hasText(value) && !"auto".equals(value)) {
            payload.put(key, value);
        }
    }

    /**
     * 获取非空参考媒体列表
     *
     * @param references List<AiTaskMediaReference> 原始列表
     * @return List<AiTaskMediaReference> 参考媒体列表
     */
    public static List<AiTaskDtos.AiTaskMediaReference> safeReferences(List<AiTaskDtos.AiTaskMediaReference> references) {
        return references == null ? List.of() : references;
    }

    /**
     * 取第一个非空字符串
     *
     * @param values String[] 候选字符串
     * @return String 第一个非空字符串
     */
    public static String firstNonEmpty(String... values) {
        for (String value : values) {
            if (StringUtils.hasText(value)) {
                return value.trim();
            }
        }
        return "";
    }
}
