package com.novanovastudio.common;

import java.sql.SQLException;
import java.util.Arrays;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;
import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.r2dbc.spi.R2dbcException;
import org.springframework.context.MessageSource;
import org.springframework.context.support.ResourceBundleMessageSource;
import org.springframework.dao.DataAccessException;

/**
 * 与语言无关的系统消息，供异常、任务持久化和事件共用。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-16 00:00
 * @param key String 稳定消息键
 * @param arguments Object[] 插值参数，业务内容和第三方诊断保持原文
 */
public record SystemMessage(String key, Object[] arguments) {

    /** 只保存资源配置，不保存任何请求语言。 */
    private static final ResourceBundleMessageSource SOURCE = createMessageSource();

    /** 数据库或底层SQL异常收敛后的默认中文提示。 */
    private static final String INTERNAL_DATABASE_ERROR_ZH = "系统服务异常，请稍后重试";

    /** 数据库或底层SQL异常收敛后的默认英文提示。 */
    private static final String INTERNAL_DATABASE_ERROR_EN = "Internal service error, please try again later";

    /** 识别原始SQL与数据库底层诊断信息的匹配规则。 */
    private static final Pattern INTERNAL_DATABASE_ERROR_PATTERN = Pattern.compile(
            "(?is)(bad\\s+sql\\s+grammar|executemany;|r2dbc[a-z]*exception|psqlexception|preparedstatement|"
                    + "\\bselect\\b.+\\bfrom\\b|\\binsert\\s+into\\b|\\bupdate\\s+[a-z0-9_]+\\s+set\\b|\\bdelete\\s+from\\b)");

    /** 识别参考素材下载失败/链接失效的上游报错。 */
    private static final Pattern UPSTREAM_DOWNLOAD_ERROR_PATTERN = Pattern.compile(
            "(?is)(error\\s+while\\s+downloading\\s+(file|image|video|audio)|failed\\s+to\\s+download\\s+(file|image|video|audio|url)|upstream\\s+status\\s+code:\\s*(403|404|410)|cannot\\s+download\\s+(image|file|media))");

    /** 识别上游内容安全审核拦截。 */
    private static final Pattern CONTENT_POLICY_ERROR_PATTERN = Pattern.compile(
            "(?is)(content_policy_violation|content\\s+policy|safety\\s+(policy|system|filter)|prohibited_content|moderation\\s+blocked|sensitive\\s+content)");

    /** 识别上游限流报错。 */
    private static final Pattern RATE_LIMIT_ERROR_PATTERN = Pattern.compile(
            "(?is)(rate[_\\s-]?limit|too\\s+many\\s+requests|status\\s+code:\\s*429|\\b429\\b.*limit)");

    /** 识别上游超时报错。 */
    private static final Pattern TIMEOUT_ERROR_PATTERN = Pattern.compile(
            "(?is)(timed\\s*out|timeout\\s+exceeded|read\\s+timeout|connect\\s+timeout|gateway\\s+timeout|\\b504\\b)");

    /** 识别上游服务不可用或过载。 */
    private static final Pattern UPSTREAM_UNAVAILABLE_PATTERN = Pattern.compile(
            "(?is)(service\\s+unavailable|bad\\s+gateway|overloaded|server\\s+error|\\b(502|503)\\b)");

    /** 识别上游渠道鉴权或额度问题。 */
    private static final Pattern UPSTREAM_QUOTA_PATTERN = Pattern.compile(
            "(?is)(insufficient_quota|quota\\s+exceeded|insufficient\\s+balance|billing_hard_limit)");

    private static final Pattern UPSTREAM_AUTH_PATTERN = Pattern.compile(
            "(?is)(invalid_api_key|incorrect\\s+api\\s+key|invalid\\s+authentication|unauthorized)");

    /**
     * 创建系统消息。
     *
     * @param key String 消息键
     * @param arguments Object... 消息参数
     * @return SystemMessage 语言中立消息
     */
    public static SystemMessage of(String key, Object... arguments) {
        return new SystemMessage(key, arguments);
    }

    /**
     * 获取共享的只读消息资源。
     *
     * @return MessageSource 双语资源
     */
    public static MessageSource messageSource() {
        return SOURCE;
    }

    /**
     * 根据请求语言生成显示文案。
     *
     * @param locale Locale 请求语言
     * @return String 翻译后的文案
     */
    public String render(Locale locale) {
        Object[] values = arguments == null ? new Object[0] : Arrays.stream(arguments)
                .map(value -> {
                    SystemMessage nested = nestedMessage(value);
                    if (nested != null) {
                        return nested.render(locale);
                    }
                    String text = String.valueOf(value);
                    return friendlyErrorText(text, locale);
                })
                .toArray();
        return SOURCE.getMessage(key, values, locale);
    }

    /**
     * 生成适配任务诊断字段长度的中文记录，完整参数另行保存。
     * @return String 最多1000字符的中文诊断
     */
    public String diagnostic() {
        String message = render(Locale.SIMPLIFIED_CHINESE);
        return message.length() > 1000 ? message.substring(0, 1000) : message;
    }

    /**
     * 从异常保留系统消息和第三方原始诊断。
     *
     * @param exception Throwable 原始异常
     * @return SystemMessage 可持久化的消息
     */
    public static SystemMessage fromThrowable(Throwable exception) {
        Throwable actual = reactor.core.Exceptions.unwrap(exception);
        if (actual instanceof BusinessException businessException) return businessException.getSystemMessage();
        if (isInternalDatabaseException(actual)) {
            return of("system.executionFailed", INTERNAL_DATABASE_ERROR_ZH);
        }
        String rawMessage = actual.getMessage() == null ? actual.getClass().getSimpleName() : actual.getMessage();
        return of("system.executionFailed", friendlyErrorText(rawMessage, Locale.SIMPLIFIED_CHINESE));
    }

    /**
     * 判断异常链中是否包含数据库或 SQL 底层异常。
     *
     * @param throwable Throwable 异常对象
     * @return boolean 是否为数据库底层异常
     */
    private static boolean isInternalDatabaseException(Throwable throwable) {
        Throwable cursor = throwable;
        for (int depth = 0; cursor != null && depth < 10; depth++) {
            if (cursor instanceof DataAccessException || cursor instanceof R2dbcException || cursor instanceof SQLException) {
                return true;
            }
            cursor = cursor.getCause();
        }
        return false;
    }

    /**
     * 对直接读取的纯文本错误字段进行友好化与安全收敛，避免底层 SQL 或晦涩英文报错原文直接暴露到前端。
     *
     * @param raw String 原始错误文本
     * @return String 收敛后的用户可见错误文本
     */
    public static String sanitizeUserMessage(String raw) {
        if (raw == null || raw.isBlank()) {
            return "";
        }
        return friendlyErrorText(raw, Locale.SIMPLIFIED_CHINESE);
    }

    /**
     * 将常见的底层数据库异常和上游英文技术报错映射为清晰、可操作的用户提示，其他正常业务文案保持原样。
     *
     * @param text String 原始错误文案
     * @param locale Locale 目标语言
     * @return String 友好化后的错误文案
     */
    private static String friendlyErrorText(String text, Locale locale) {
        if (text == null || text.isBlank()) {
            return "";
        }
        boolean english = locale != null && Locale.ENGLISH.getLanguage().equals(locale.getLanguage());
        if (looksLikeInternalDatabaseError(text)) {
            return english ? INTERNAL_DATABASE_ERROR_EN : INTERNAL_DATABASE_ERROR_ZH;
        }
        if (UPSTREAM_DOWNLOAD_ERROR_PATTERN.matcher(text).find()) {
            return english
                    ? "Reference media link has expired or could not be downloaded. Please regenerate or re-upload the reference and try again."
                    : "参考图片或素材链接已失效，请重新生成或重新上传参考素材后再试";
        }
        if (CONTENT_POLICY_ERROR_PATTERN.matcher(text).find()) {
            return english
                    ? "Content did not pass safety moderation. Please adjust the prompt or reference media and try again."
                    : "提示词或参考素材未通过内容安全审核，请调整后再试";
        }
        if (RATE_LIMIT_ERROR_PATTERN.matcher(text).find()) {
            return english
                    ? "Too many requests to the model service. Please try again shortly."
                    : "模型请求过于频繁，请稍后重试";
        }
        if (TIMEOUT_ERROR_PATTERN.matcher(text).find()) {
            return english
                    ? "Model request timed out. Please try again later."
                    : "模型响应超时，请稍后重试";
        }
        if (UPSTREAM_QUOTA_PATTERN.matcher(text).find()) {
            return english
                    ? "Model channel quota is insufficient. Please contact an administrator."
                    : "模型渠道额度不足，请联系管理员检查渠道余额";
        }
        if (UPSTREAM_AUTH_PATTERN.matcher(text).find()) {
            return english
                    ? "Model channel authentication failed. Please contact an administrator."
                    : "模型渠道鉴权失败，请联系管理员检查渠道配置";
        }
        if (UPSTREAM_UNAVAILABLE_PATTERN.matcher(text).find()) {
            return english
                    ? "Model service is temporarily busy. Please try again later."
                    : "模型服务暂时繁忙，请稍后重试";
        }
        return text;
    }

    /**
     * 判断文本是否包含原始 SQL 语句或数据库底层报错信息，避免直接暴露到前端界面。
     *
     * @param text String 待检查文本
     * @return boolean 是否命中内部数据库错误特征
     */
    static boolean looksLikeInternalDatabaseError(String text) {
        return text != null && !text.isBlank() && INTERNAL_DATABASE_ERROR_PATTERN.matcher(text).find();
    }

    /**
     * 读取持久化消息，空键表示没有系统提示。
     *
     * @param key String 消息键
     * @param argumentsJson String 参数JSON
     * @return SystemMessage 消息；没有提示时返回null
     */
    public static SystemMessage stored(String key, String argumentsJson) {
        if (key == null || key.isBlank()) return null;
        JSONArray values = JSON.parseArray(argumentsJson == null ? "[]" : argumentsJson);
        return of(key, values.toArray());
    }

    /**
     * 将消息及原始中文诊断加入任务更新字段。
     *
     * @param fields Map<String, Object> 数据库更新字段
     * @param message SystemMessage 系统消息；null表示清除提示
     */
    public static void putTaskFields(Map<String, Object> fields, SystemMessage message) {
        fields.put("error_message", message == null ? "" : message.diagnostic());
        fields.put("error_message_key", message == null ? "" : message.key());
        fields.put("error_message_arguments", JSON.toJSONString(message == null ? new Object[0] : message.arguments()));
    }

    /**
     * 恢复JSON持久化后的嵌套系统消息，字符串业务内容保持原文。
     * @param value Object 插值参数
     * @return SystemMessage 嵌套系统消息；普通参数返回null
     */
    private static SystemMessage nestedMessage(Object value) {
        if (value instanceof SystemMessage message) return message;
        if (value instanceof JSONObject object && object.containsKey("key") && object.containsKey("arguments")) {
            JSONArray values = object.getJSONArray("arguments");
            return of(object.getString("key"), values == null ? new Object[0] : values.toArray());
        }
        return null;
    }

    /**
     * 创建严格使用完整双语资源的消息源。
     *
     * @return ResourceBundleMessageSource 消息源
     */
    private static ResourceBundleMessageSource createMessageSource() {
        ResourceBundleMessageSource source = new ResourceBundleMessageSource();
        source.setBasename("messages/system");
        source.setDefaultEncoding("UTF-8");
        source.setFallbackToSystemLocale(false);
        source.setAlwaysUseMessageFormat(true);
        return source;
    }
}
