package com.novanovastudio.storage;

import com.novanovastudio.common.SystemMessage;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import org.springframework.util.StringUtils;

/**
 * 对象存储公开访问地址工具。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-07-19 00:00
 */
public final class ObjectStorageUrlBuilder {

    /**
     * 禁止实例化。
     */
    private ObjectStorageUrlBuilder() {
    }

    /**
     * 拼接对象公开访问地址。
     *
     * @param baseUrl String 公开访问基础地址
     * @param key String 对象键
     * @return String 对象公开访问地址
     */
    public static String buildPublicUrl(String baseUrl, String key) {
        return baseUrl.replaceAll("/+$", "") + "/" + encodeKeyPath(key);
    }

    /**
     * 校验HTTP或HTTPS地址。
     *
     * @param value String 待校验地址
     * @param fieldName SystemMessage 字段名称
     * @throws BusinessException 地址为空或不符合HTTP(S)格式时抛出
     */
    public static void requireHttpUrl(String value, SystemMessage fieldName) {
        if (!StringUtils.hasText(value)) {
            throw new BusinessException(ErrorCode.PARAM_MISSING, SystemMessage.of("business.isRequired", fieldName));
        }
        try {
            URI uri = URI.create(value.trim());
            boolean supportedScheme = "http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme());
            if (!supportedScheme || !StringUtils.hasText(uri.getHost())) {
                throw new IllegalArgumentException();
            }
        } catch (IllegalArgumentException exception) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.mustBeAnHTTPOrHTTPSURL", fieldName));
        }
    }

    /**
     * 校验文本字段不为空。
     *
     * @param value String 待校验文本
     * @param fieldName SystemMessage 字段名称
     * @throws BusinessException 文本为空时抛出
     */
    public static void requireText(String value, SystemMessage fieldName) {
        if (!StringUtils.hasText(value)) {
            throw new BusinessException(ErrorCode.PARAM_MISSING, SystemMessage.of("business.isRequired", fieldName));
        }
    }

    /**
     * 对对象键按路径片段编码。
     *
     * @param key String 对象键
     * @return String 编码后的对象键
     */
    private static String encodeKeyPath(String key) {
        return Arrays.stream(key.split("/"))
                .map(segment -> URLEncoder.encode(segment, StandardCharsets.UTF_8).replace("+", "%20"))
                .reduce((left, right) -> left + "/" + right)
                .orElse("");
    }

    /**
     * 对公开访问地址中的对象键按路径片段解码，用于把历史公开地址还原成对象键后重新签名。
     *
     * @param path String 地址路径中位于基础地址之后的部分
     * @return String 解码后的对象键
     */
    public static String decodeKeyPath(String path) {
        return Arrays.stream(path.split("/"))
                .map(segment -> java.net.URLDecoder.decode(segment.replace("+", "%2B"), StandardCharsets.UTF_8))
                .reduce((left, right) -> left + "/" + right)
                .orElse("");
    }
}
