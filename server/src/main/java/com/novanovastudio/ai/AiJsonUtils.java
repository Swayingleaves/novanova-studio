package com.novanovastudio.ai;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import org.springframework.util.StringUtils;

/**
 * @title        AiJsonUtils.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  AI适配器JSON工具
 * @createTime   2026-06-24 20:35:00
 */
public final class AiJsonUtils {

    /**
     * 禁止实例化
     */
    private AiJsonUtils() {
    }

    /**
     * 解析JSON字符串
     *
     * @param value String JSON字符串
     * @return JSONObject JSON节点
     */
    public static JSONObject parseJson(String value) {
        try {
            return JSON.parseObject(StringUtils.hasText(value) ? value : "{}");
        } catch (Exception exception) {
            return new JSONObject();
        }
    }

    /**
     * 序列化对象为JSON字符串
     *
     * @param value Object 待序列化对象
     * @return String JSON字符串
     */
    public static String toJson(Object value) {
        try {
            return JSON.toJSONString(value);
        } catch (Exception exception) {
            throw new BusinessException(ErrorCode.SYSTEM_ERROR, "序列化JSON失败: " + exception.getMessage());
        }
    }

    /**
     * 构建用于日志输出的AI响应副本。
     * <p>
     * 图片接口的b64_json字段或data URL可能包含大量图片内容，日志副本只保留省略标记和字符数，原始响应不受影响。
     *
     * @param response JSONObject 原始AI响应
     * @return JSONObject 可安全写入日志的响应副本
     */
    public static JSONObject formatResponseForLog(JSONObject response) {
        return response == null ? new JSONObject() : (JSONObject) omitBase64Content(response);
    }

    /**
     * 转换对象为JSON对象
     *
     * @param value Object 任意对象
     * @return JSONObject JSON对象
     */
    public static JSONObject jsonObject(Object value) {
        return JSON.parseObject(JSON.toJSONString(value));
    }

    /**
     * 兼容直接响应和统一响应包装
     *
     * @param response JSONObject 响应JSON
     * @return JSONObject 业务载荷
     */
    public static JSONObject responsePayload(JSONObject response) {
        if (response != null && response.containsKey("code") && response.containsKey("data")) {
            Object dataValue = response.get("data");
            JSONObject data = dataValue instanceof JSONObject jsonObject ? jsonObject : null;
            return data == null ? new JSONObject() : data;
        }
        return response == null ? new JSONObject() : response;
    }

    /**
     * 兼容直接响应和统一响应包装中的数组载荷
     *
     * @param response JSONObject 响应JSON
     * @param key String 数组字段名
     * @return JSONArray 数组载荷
     */
    public static JSONArray responseArrayPayload(JSONObject response, String key) {
        if (response == null) {
            return new JSONArray();
        }
        if (response.containsKey("code") && response.containsKey("data")) {
            Object dataValue = response.get("data");
            if (dataValue instanceof JSONArray jsonArray) {
                return jsonArray;
            }
            if (dataValue instanceof JSONObject jsonObject) {
                JSONArray nested = jsonObject.getJSONArray(key);
                return nested == null ? new JSONArray() : nested;
            }
            return new JSONArray();
        }
        JSONArray data = response.getJSONArray(key);
        return data == null ? new JSONArray() : data;
    }

    /**
     * 校验第三方统一响应包装中的错误码
     *
     * @param response JSONObject 响应JSON
     * @param stage String 调用阶段
     */
    public static void validateEnvelope(JSONObject response, String stage) {
        Integer providerCode = numericEnvelopeCode(response);
        if (providerCode != null && providerCode != 0) {
            int status = providerCode >= 400 && providerCode <= 599 ? providerCode : 400;
            throw AiErrorSupport.providerException(status, response.toJSONString(), stage);
        }
    }

    /**
     * 读取统一响应中的数值错误码。
     * <p>
     * 部分兼容OpenAI的渠道使用success等字符串表示调用结果，该字段不是数值错误码，不能按统一错误码处理。
     *
     * @param response JSONObject 响应JSON
     * @return Integer 数值错误码；不存在或不是数值时返回null
     */
    private static Integer numericEnvelopeCode(JSONObject response) {
        if (response == null || !response.containsKey("code")) return null;
        Object value = response.get("code");
        if (value instanceof Number number) return number.intValue();
        if (value instanceof String text) {
            try {
                return Integer.valueOf(text.trim());
            } catch (NumberFormatException exception) {
                return null;
            }
        }
        return null;
    }

    /**
     * 递归复制JSON值并省略图片Base64字段。
     *
     * @param value Object 原始JSON值
     * @return Object 可用于日志的JSON值
     */
    private static Object omitBase64Content(Object value) {
        if (value instanceof JSONObject jsonObject) {
            JSONObject result = new JSONObject();
            jsonObject.forEach((key, item) -> result.put(key, "b64_json".equals(key) ? abbreviatedBase64Content(item) : omitBase64Content(item)));
            return result;
        }
        if (value instanceof JSONArray jsonArray) {
            JSONArray result = new JSONArray();
            jsonArray.forEach(item -> result.add(omitBase64Content(item)));
            return result;
        }
        if (value instanceof String text && text.regionMatches(true, 0, "data:", 0, 5)) {
            return abbreviatedDataUrlContent(text);
        }
        return value;
    }

    /**
     * 生成Base64内容的日志省略标记。
     *
     * @param value Object Base64字段原始值
     * @return String 日志省略标记
     */
    private static String abbreviatedBase64Content(Object value) {
        int characterCount = value instanceof String text ? text.length() : 0;
        return "Base64内容已省略，字符数=" + characterCount;
    }

    /**
     * 生成data URL内容的日志省略标记。
     *
     * @param value String data URL原始值
     * @return String 日志省略标记
     */
    private static String abbreviatedDataUrlContent(String value) {
        return "data URL内容已省略，字符数=" + value.length();
    }

    /**
     * 读取嵌套字符串
     *
     * @param data JSONObject JSON对象
     * @param objectKey String 对象字段名
     * @param valueKey String 值字段名
     * @return String 字符串值
     */
    public static String nestedString(JSONObject data, String objectKey, String valueKey) {
        JSONObject object = data == null ? null : data.getJSONObject(objectKey);
        return object == null ? "" : AiTaskParameterReader.firstNonEmpty(object.getString(valueKey));
    }
}
