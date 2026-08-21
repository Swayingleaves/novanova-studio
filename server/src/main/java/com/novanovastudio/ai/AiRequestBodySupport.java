package com.novanovastudio.ai;

import com.alibaba.fastjson2.JSONObject;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * AI请求体参数工具。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-08-17 00:00
 */
public final class AiRequestBodySupport {

    private AiRequestBodySupport() {
    }

    /**
     * 合并模型自定义JSON参数，自定义字段覆盖系统字段。
     *
     * @param payload Map<String, Object> 系统生成的JSON请求体
     * @param customBodyParameters JSONObject 模型自定义JSON请求体参数
     * @return Map<String, Object> 合并后的JSON请求体
     */
    public static Map<String, Object> mergeCustomBodyParameters(Map<String, Object> payload, JSONObject customBodyParameters) {
        Map<String, Object> merged = new LinkedHashMap<>(payload == null ? Map.of() : payload);
        if (customBodyParameters != null) merged.putAll(customBodyParameters);
        return merged;
    }
}
