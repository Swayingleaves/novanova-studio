package com.novanovastudio.common;

import java.util.Arrays;
import java.util.Locale;
import java.util.Map;
import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import org.springframework.context.MessageSource;
import org.springframework.context.support.ResourceBundleMessageSource;

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
                    return nested == null ? String.valueOf(value) : nested.render(locale);
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
        return of("system.executionFailed", actual.getMessage() == null ? actual.getClass().getSimpleName() : actual.getMessage());
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
