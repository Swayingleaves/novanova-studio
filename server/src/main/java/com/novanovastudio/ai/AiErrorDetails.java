package com.novanovastudio.ai;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * AI调用失败的安全结构化详情。
 *
 * @param source String 错误来源
 * @param category String 错误类别
 * @param stage String 错误阶段
 * @param httpStatus Integer HTTP状态码
 * @param code String 供应商错误码
 * @param type String 供应商错误类型
 * @param parameter String 错误参数
 * @param message String 安全错误说明
 * @param requestAccepted Boolean 请求是否已被供应商受理
 * @param safeToRetry Boolean 是否允许创建新的重试任务
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-08-01 00:00
 */
public record AiErrorDetails(
        String source,
        String category,
        String stage,
        Integer httpStatus,
        String code,
        String type,
        String parameter,
        String message,
        Boolean requestAccepted,
        Boolean safeToRetry
) {

    /**
     * 将错误详情转换为安全Map，requestAccepted为null时保留未确认语义。
     *
     * @return Map<String, Object> 可持久化和传递给Agent的错误数据
     */
    public Map<String, Object> toMap() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("source", source);
        result.put("category", category);
        result.put("stage", stage);
        if (httpStatus != null) result.put("httpStatus", httpStatus);
        if (code != null && !code.isBlank()) result.put("code", code);
        if (type != null && !type.isBlank()) result.put("type", type);
        if (parameter != null && !parameter.isBlank()) result.put("parameter", parameter);
        result.put("message", message);
        result.put("requestAccepted", requestAccepted);
        result.put("safeToRetry", Boolean.TRUE.equals(safeToRetry));
        return result;
    }
}
