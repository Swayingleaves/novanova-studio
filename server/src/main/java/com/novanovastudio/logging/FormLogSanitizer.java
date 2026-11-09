package com.novanovastudio.logging;

import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Set;

/**
 * 表单日志脱敏。令牌接口使用 application/x-www-form-urlencoded，密钥不能原样写入日志。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-09 18:40
 */
final class FormLogSanitizer {

    /**
     * 禁止实例化。
     */
    private FormLogSanitizer() {
    }

    /**
     * 按字段名打码表单正文，保留字段顺序。
     *
     * @param body String 原始表单正文
     * @param sensitiveFields Set<String> 需要打码的小写字段名
     * @param maskedValue String 打码后的占位文本
     * @return String 脱敏后的表单正文
     */
    static String sanitize(String body, Set<String> sensitiveFields, String maskedValue) {
        if (body == null || body.isEmpty()) {
            return body;
        }
        String[] pairs = body.split("&", -1);
        StringBuilder builder = new StringBuilder();
        for (int index = 0; index < pairs.length; index++) {
            if (index > 0) {
                builder.append('&');
            }
            String pair = pairs[index];
            int separator = pair.indexOf('=');
            String rawName = separator >= 0 ? pair.substring(0, separator) : pair;
            String rawValue = separator >= 0 ? pair.substring(separator + 1) : "";
            builder.append(rawName);
            if (separator < 0) {
                continue;
            }
            builder.append('=');
            builder.append(sensitiveFields.contains(decodeName(rawName)) ? maskedValue : rawValue);
        }
        return builder.toString();
    }

    /**
     * 解码表单字段名，解码失败时按原文小写比较。
     *
     * @param rawName String 原始字段名
     * @return String 小写字段名
     */
    private static String decodeName(String rawName) {
        try {
            return URLDecoder.decode(rawName, StandardCharsets.UTF_8).toLowerCase(java.util.Locale.ROOT);
        } catch (IllegalArgumentException exception) {
            return rawName.toLowerCase(java.util.Locale.ROOT);
        }
    }
}
