package com.novanovastudio.ai;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import java.io.IOException;
import java.net.http.HttpTimeoutException;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.TimeoutException;
import java.util.regex.Pattern;
import org.springframework.util.StringUtils;

/**
 * AI错误解析、分类和安全序列化工具。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-08-01 00:00
 */
public final class AiErrorSupport {

    /** 支持的错误类别 */
    private static final Set<String> ERROR_CATEGORIES = Set.of(
            "prompt_policy_violation", "invalid_parameter", "unsupported_capability", "rate_limited",
            "provider_unavailable", "authentication", "permission", "quota", "configuration", "timeout",
            "network", "canceled", "unknown");

    /** 允许由恢复校验器进一步判断的可重试类别 */
    private static final Set<String> RETRYABLE_CATEGORIES = Set.of(
            "prompt_policy_violation", "invalid_parameter", "rate_limited", "provider_unavailable");

    /** 支持的错误阶段 */
    private static final Set<String> ERROR_STAGES = Set.of(
            "submission", "polling", "download", "frontend_tool", "agent", "execution", "unknown");

    /** 支持的错误来源 */
    private static final Set<String> ERROR_SOURCES = Set.of(
            "provider", "task", "canvas", "agent", "system", "unknown");

    /** 提示词内容策略错误码白名单 */
    private static final Set<String> PROMPT_POLICY_CODES = Set.of(
            "content_policy_violation", "content_filter", "safety", "safety_violation", "prohibited_content");

    /** 额度错误码白名单 */
    private static final Set<String> QUOTA_CODES = Set.of(
            "insufficient_quota", "quota_exceeded", "billing_hard_limit_reached");

    /** 模型或渠道配置错误码白名单 */
    private static final Set<String> CONFIGURATION_CODES = Set.of(
            "model_not_found", "model_not_supported", "deployment_not_found", "invalid_model");

    /** 不支持能力错误码白名单 */
    private static final Set<String> UNSUPPORTED_CODES = Set.of(
            "unsupported_capability", "unsupported_parameter", "not_supported");

    /** 取消错误码白名单 */
    private static final Set<String> CANCELED_CODES = Set.of(
            "canceled", "cancelled", "request_canceled", "request_cancelled");

    /** 提示词内容策略消息白名单 */
    private static final List<String> PROMPT_POLICY_PHRASES = List.of(
            "unable to generate this content", "content policy", "safety policy",
            "prompt contains sensitive", "content policy violation", "提示词包含敏感",
            "内容安全策略", "内容审核未通过", "无法生成此内容");

    /** 本地配置错误消息白名单 */
    private static final List<String> CONFIGURATION_PHRASES = List.of(
            "服务端ai渠道未配置api key", "所选模型不可用", "未找到已选择的ai渠道",
            "未配置模型", "完整配置渠道");

    /** 本地不支持能力消息白名单 */
    private static final List<String> UNSUPPORTED_PHRASES = List.of(
            "任务系统暂不支持", "调用格式暂不支持");

    /** 本地额度错误消息白名单 */
    private static final List<String> QUOTA_PHRASES = List.of("积分不足");

    /** 单条安全错误消息最大长度 */
    private static final int MAXIMUM_MESSAGE_LENGTH = 1000;

    /** 单个供应商结构字段最大长度 */
    private static final int MAXIMUM_STRUCTURAL_FIELD_LENGTH = 200;

    /** 错误消息中的鉴权字段 */
    private static final Pattern SENSITIVE_ASSIGNMENT = Pattern.compile(
            "(?i)(api[_-]?key|authorization|access[_-]?token|password|secret)[\\\"']?\\s*[:=]\\s*[\\\"']?[^\\s,\\\"'}]+");

    /** 错误消息中的Bearer令牌 */
    private static final Pattern BEARER_TOKEN = Pattern.compile("(?i)bearer\\s+[a-z0-9._~+/-]+=*");

    /** 错误消息中的常见渠道密钥 */
    private static final Pattern CHANNEL_KEY = Pattern.compile("(?i)\\bsk-[a-z0-9_-]{8,}\\b");

    /**
     * 禁止实例化工具类。
     */
    private AiErrorSupport() {
    }

    /**
     * 将供应商非成功响应转换为类型化异常。
     *
     * @param httpStatus int HTTP状态码
     * @param responseBody String 响应体
     * @param stage String 调用阶段
     * @return AiProviderException 类型化供应商异常
     */
    public static AiProviderException providerException(int httpStatus, String responseBody, String stage) {
        return new AiProviderException(classifyProviderResponse(httpStatus, responseBody, stage));
    }

    /**
     * 将已受理任务的供应商失败终态转换为类型化异常。
     * <p>
     * 这类响应的HTTP请求本身成功，因此不伪造HTTP状态码，并明确标记原生成任务已被受理。
     *
     * @param response JSONObject 供应商任务终态响应
     * @param fallbackMessage String 响应未携带错误说明时的安全文案
     * @return AiProviderException 不允许创建新任务的轮询阶段异常
     */
    public static AiProviderException providerTaskFailure(JSONObject response, String fallbackMessage) {
        JSONObject body = response == null ? new JSONObject() : JSON.parseObject(response.toJSONString());
        Object rawError = body.get("error");
        if (!StringUtils.hasText(body.getString("message")) && !StringUtils.hasText(body.getString("msg"))) {
            body.put("message", rawError instanceof String errorMessage && StringUtils.hasText(errorMessage)
                    ? errorMessage : fallbackMessage);
        }
        AiErrorDetails classified = classifyProviderResponse(400, body.toJSONString(), "polling");
        return new AiProviderException(new AiErrorDetails(classified.source(), classified.category(),
                "polling", null, classified.code(), classified.type(), classified.parameter(), classified.message(),
                true, false));
    }

    /**
     * 创建已受理供应商任务的轮询超时异常。
     *
     * @param message String 安全超时说明
     * @return AiProviderException 不允许创建新任务的超时异常
     */
    public static AiProviderException providerPollingTimeout(String message) {
        return new AiProviderException(new AiErrorDetails("provider", "timeout", "polling", null,
                null, null, null, safeMessage(message, null), true, false));
    }

    /**
     * 分类供应商错误响应。
     *
     * @param httpStatus int HTTP状态码
     * @param responseBody String 响应体
     * @param stage String 调用阶段
     * @return AiErrorDetails 安全结构化错误
     */
    public static AiErrorDetails classifyProviderResponse(int httpStatus, String responseBody, String stage) {
        JSONObject root = parseObject(responseBody);
        JSONObject error = childObject(root, "error");
        JSONObject fields = error == null ? root : error;
        String code = firstText(fields, root, "code", "error_code", "errorCode", "status");
        String type = firstText(fields, root, "type", "error_type", "errorType");
        String parameter = firstText(fields, root, "param", "parameter");
        String message = firstText(fields, root, "message", "msg", "error_message", "errorMessage");
        Boolean explicitRequestAccepted = firstBoolean(fields, root, "requestAccepted", "request_accepted");
        JSONObject promptFeedback = childObject(root, "promptFeedback");
        boolean promptFeedbackError = !StringUtils.hasText(message) && promptFeedback != null;
        if (promptFeedbackError) {
            message = promptFeedback.getString("blockReason");
            parameter = "prompt";
            code = firstNonEmpty(code, message);
        }
        String safeMessage = safeMessage(message, httpStatus);
        String category = classifyCategory(httpStatus, code, type, parameter, safeMessage);
        if (promptFeedbackError && "invalid_parameter".equals(category)) category = "unknown";
        boolean submission = "submission".equals(stage);
        Boolean requestAccepted;
        // 后续阶段已经创建供应商任务；提交阶段仅在响应能够明确证明时判断是否受理。
        if (!submission) {
            requestAccepted = Boolean.TRUE;
        } else if (explicitRequestAccepted != null) {
            requestAccepted = explicitRequestAccepted;
        } else {
            requestAccepted = httpStatus < 500 ? Boolean.FALSE : null;
        }
        boolean safeToRetry = submission && Boolean.FALSE.equals(requestAccepted)
                && RETRYABLE_CATEGORIES.contains(category);
        return new AiErrorDetails("provider", category, stage, httpStatus, safeStructuralField(code),
                safeStructuralField(type), safeStructuralField(parameter), safeMessage, requestAccepted, safeToRetry);
    }

    /**
     * 将任意异常转换为统一错误详情。
     *
     * @param exception Throwable 原始异常
     * @param source String 错误来源
     * @param stage String 错误阶段
     * @return AiErrorDetails 结构化错误详情
     */
    public static AiErrorDetails fromThrowable(Throwable exception, String source, String stage) {
        Throwable actual = unwrap(exception);
        if (actual instanceof AiProviderException providerException) {
            return providerException.getDetails();
        }
        String category = throwableCategory(actual);
        String message = safeMessage(actual == null ? null : actual.getMessage(), null);
        String code = actual instanceof BusinessException businessException
                ? String.valueOf(businessException.getCode()) : null;
        return new AiErrorDetails(source, category, stage, null, code, null, null, message,
                !"submission".equals(stage), false);
    }

    /**
     * 从任务或工具结果中读取结构化错误详情。
     *
     * @param value Object 错误对象
     * @return AiErrorDetails 错误详情，不存在时返回null
     */
    public static AiErrorDetails fromData(Object value) {
        if (value == null) return null;
        try {
            JSONObject object = value instanceof JSONObject jsonObject
                    ? jsonObject : JSON.parseObject(JSON.toJSONString(value));
            if (object == null || !StringUtils.hasText(object.getString("category"))) return null;
            String source = normalize(object.getString("source"));
            if (!ERROR_SOURCES.contains(source)) source = "unknown";
            String category = normalize(object.getString("category"));
            if (!ERROR_CATEGORIES.contains(category)) category = "unknown";
            String stage = normalize(object.getString("stage"));
            if (!ERROR_STAGES.contains(stage)) stage = "unknown";
            Integer httpStatus = integerValue(object.get("httpStatus"));
            if (httpStatus != null && (httpStatus < 100 || httpStatus > 599)) httpStatus = null;
            Boolean requestAccepted = booleanValue(object.get("requestAccepted"));
            boolean safeToRetry = Boolean.TRUE.equals(booleanValue(object.get("safeToRetry")))
                    && "submission".equals(stage) && Boolean.FALSE.equals(requestAccepted)
                    && RETRYABLE_CATEGORIES.contains(category);
            return new AiErrorDetails(
                    source, category, stage, httpStatus, safeStructuralField(object.getString("code")),
                    safeStructuralField(object.getString("type")), safeStructuralField(object.getString("parameter")),
                    safeMessage(object.getString("message"), httpStatus), requestAccepted, safeToRetry);
        } catch (RuntimeException exception) {
            return null;
        }
    }

    /**
     * 构造任务result_data中的错误对象。
     *
     * @param details AiErrorDetails 错误详情
     * @return Map<String, Object> 任务结果数据
     */
    public static Map<String, Object> errorData(AiErrorDetails details) {
        return Map.of("error", details.toMap());
    }

    /**
     * 按明确字段和状态码识别错误类别。
     *
     * @param httpStatus int HTTP状态码
     * @param code String 错误码
     * @param type String 错误类型
     * @param parameter String 错误参数
     * @param message String 错误消息
     * @return String 错误类别
     */
    private static String classifyCategory(int httpStatus, String code, String type, String parameter, String message) {
        String normalizedCode = normalize(code);
        String normalizedType = normalize(type);
        String normalizedParameter = normalize(parameter);
        String normalizedMessage = normalize(message);
        if (PROMPT_POLICY_CODES.contains(normalizedCode) || PROMPT_POLICY_CODES.contains(normalizedType)
                || PROMPT_POLICY_PHRASES.stream().anyMatch(normalizedMessage::contains)) {
            return "prompt_policy_violation";
        }
        if (QUOTA_CODES.contains(normalizedCode) || QUOTA_CODES.contains(normalizedType)) return "quota";
        if (CONFIGURATION_CODES.contains(normalizedCode) || CONFIGURATION_CODES.contains(normalizedType)) return "configuration";
        if (UNSUPPORTED_CODES.contains(normalizedCode) || UNSUPPORTED_CODES.contains(normalizedType)) return "unsupported_capability";
        if (CANCELED_CODES.contains(normalizedCode) || CANCELED_CODES.contains(normalizedType) || httpStatus == 499) return "canceled";
        if (httpStatus == 401) return "authentication";
        if (httpStatus == 403) return "permission";
        if (httpStatus == 429) return "rate_limited";
        if (httpStatus >= 500) return "provider_unavailable";
        if ((httpStatus == 400 || httpStatus == 422) && StringUtils.hasText(normalizedParameter)) return "invalid_parameter";
        if (Set.of("invalid_parameter", "parameter_invalid").contains(normalizedCode)) return "invalid_parameter";
        return "unknown";
    }

    /**
     * 按异常类型和业务错误码识别非供应商错误。
     *
     * @param exception Throwable 原始异常
     * @return String 错误类别
     */
    private static String throwableCategory(Throwable exception) {
        if (exception instanceof HttpTimeoutException || exception instanceof TimeoutException) return "timeout";
        if (exception instanceof IOException) return "network";
        if (exception instanceof java.util.concurrent.CancellationException) return "canceled";
        String message = normalize(exception == null ? null : exception.getMessage());
        if (CONFIGURATION_PHRASES.stream().anyMatch(message::contains)) return "configuration";
        if (UNSUPPORTED_PHRASES.stream().anyMatch(message::contains)) return "unsupported_capability";
        if (QUOTA_PHRASES.stream().anyMatch(message::contains)) return "quota";
        if (exception instanceof BusinessException businessException) {
            return switch (businessException.getCode()) {
                case ErrorCode.PARAM_ERROR, ErrorCode.PARAM_INVALID, ErrorCode.PARAM_MISSING -> "invalid_parameter";
                case ErrorCode.AUTH_ERROR, ErrorCode.TOKEN_INVALID, ErrorCode.TOKEN_EXPIRED -> "authentication";
                case ErrorCode.PERMISSION_DENIED -> "permission";
                case ErrorCode.NETWORK_ERROR -> "network";
                default -> "unknown";
            };
        }
        return "unknown";
    }

    /**
     * 解析JSON对象，非JSON响应不做猜测。
     *
     * @param responseBody String 响应体
     * @return JSONObject JSON对象，无法解析时返回null
     */
    private static JSONObject parseObject(String responseBody) {
        if (!StringUtils.hasText(responseBody)) return null;
        try {
            return JSON.parseObject(responseBody);
        } catch (RuntimeException exception) {
            return null;
        }
    }

    /**
     * 安全读取JSON子对象，非对象字段不做类型强制转换。
     *
     * @param parent JSONObject 父对象
     * @param name String 字段名
     * @return JSONObject 子对象，不存在或类型不符时返回null
     */
    private static JSONObject childObject(JSONObject parent, String name) {
        if (parent == null) return null;
        Object value = parent.get(name);
        if (value instanceof JSONObject object) return object;
        return null;
    }

    /**
     * 从优先对象和根对象读取首个非空字段。
     *
     * @param preferred JSONObject 优先对象
     * @param root JSONObject 根对象
     * @param names String[] 字段名
     * @return String 字段文本
     */
    private static String firstText(JSONObject preferred, JSONObject root, String... names) {
        for (String name : names) {
            Object preferredValue = preferred == null ? null : preferred.get(name);
            if (preferredValue != null && StringUtils.hasText(String.valueOf(preferredValue))) return String.valueOf(preferredValue);
            Object rootValue = root == null ? null : root.get(name);
            if (rootValue != null && StringUtils.hasText(String.valueOf(rootValue))) return String.valueOf(rootValue);
        }
        return null;
    }

    /**
     * 从优先对象和根对象读取首个布尔字段。
     *
     * @param preferred JSONObject 优先对象
     * @param root JSONObject 根对象
     * @param names String[] 字段名
     * @return Boolean 布尔值，不存在时返回null
     */
    private static Boolean firstBoolean(JSONObject preferred, JSONObject root, String... names) {
        for (String name : names) {
            Boolean preferredValue = preferred == null ? null : booleanValue(preferred.get(name));
            if (preferredValue != null) return preferredValue;
            Boolean rootValue = root == null ? null : booleanValue(root.get(name));
            if (rootValue != null) return rootValue;
        }
        return null;
    }

    /**
     * 只接受明确布尔值，非法供应商字段保持未确认语义。
     *
     * @param value Object 原始字段值
     * @return Boolean 布尔值，类型不符时返回null
     */
    private static Boolean booleanValue(Object value) {
        return value instanceof Boolean booleanValue ? booleanValue : null;
    }

    /**
     * 只接受明确整数，非法状态码字段不影响其他错误信息解析。
     *
     * @param value Object 原始字段值
     * @return Integer 整数值，类型不符或越界时返回null
     */
    private static Integer integerValue(Object value) {
        if (!(value instanceof Byte || value instanceof Short || value instanceof Integer || value instanceof Long)) {
            return null;
        }
        Number number = (Number) value;
        long longValue = number.longValue();
        return longValue >= Integer.MIN_VALUE && longValue <= Integer.MAX_VALUE ? (int) longValue : null;
    }

    /**
     * 生成长度受限且不包含响应包装的安全消息。
     *
     * @param message String 原始消息
     * @param httpStatus Integer HTTP状态码
     * @return String 安全消息
     */
    private static String safeMessage(String message, Integer httpStatus) {
        String value = StringUtils.hasText(message) ? message.replace('\r', ' ').replace('\n', ' ').trim()
                : httpStatus == null ? "AI调用失败" : "AI供应商请求失败（HTTP " + httpStatus + "）";
        value = BEARER_TOKEN.matcher(value).replaceAll("Bearer [已过滤]");
        value = SENSITIVE_ASSIGNMENT.matcher(value).replaceAll("$1=[已过滤]");
        value = CHANNEL_KEY.matcher(value).replaceAll("[渠道密钥已过滤]");
        return value.length() <= MAXIMUM_MESSAGE_LENGTH ? value : value.substring(0, MAXIMUM_MESSAGE_LENGTH);
    }

    /**
     * 过滤并限制供应商错误码、类型和参数名等结构字段。
     *
     * @param value String 原始字段
     * @return String 安全字段，空值返回null
     */
    private static String safeStructuralField(String value) {
        if (!StringUtils.hasText(value)) return null;
        String safeValue = safeMessage(value, null);
        return safeValue.length() <= MAXIMUM_STRUCTURAL_FIELD_LENGTH
                ? safeValue : safeValue.substring(0, MAXIMUM_STRUCTURAL_FIELD_LENGTH);
    }

    /**
     * 获取首个非空字符串。
     *
     * @param values String[] 候选值
     * @return String 首个非空值
     */
    private static String firstNonEmpty(String... values) {
        for (String value : values) if (StringUtils.hasText(value)) return value;
        return null;
    }

    /**
     * 将文本规范化为小写分类键。
     *
     * @param value String 原始文本
     * @return String 规范化文本
     */
    private static String normalize(String value) {
        return value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
    }

    /**
     * 展开常见异步包装异常。
     *
     * @param exception Throwable 原始异常
     * @return Throwable 实际异常
     */
    private static Throwable unwrap(Throwable exception) {
        Throwable current = exception;
        while (current != null && current.getCause() != null
                && (current instanceof java.util.concurrent.CompletionException
                || current instanceof java.util.concurrent.ExecutionException)) {
            current = current.getCause();
        }
        return current;
    }
}
