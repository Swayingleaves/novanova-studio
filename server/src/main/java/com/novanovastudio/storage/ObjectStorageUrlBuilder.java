package com.novanovastudio.storage;

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
     * @param fieldName String 字段名称
     * @throws BusinessException 地址为空或不符合HTTP(S)格式时抛出
     */
    public static void requireHttpUrl(String value, String fieldName) {
        if (!StringUtils.hasText(value)) {
            throw new BusinessException(ErrorCode.PARAM_MISSING, fieldName + "不能为空");
        }
        try {
            URI uri = URI.create(value.trim());
            boolean supportedScheme = "http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme());
            if (!supportedScheme || !StringUtils.hasText(uri.getHost())) {
                throw new IllegalArgumentException();
            }
        } catch (IllegalArgumentException exception) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, fieldName + "必须是HTTP或HTTPS地址");
        }
    }

    /**
     * 校验文本字段不为空。
     *
     * @param value String 待校验文本
     * @param fieldName String 字段名称
     * @throws BusinessException 文本为空时抛出
     */
    public static void requireText(String value, String fieldName) {
        if (!StringUtils.hasText(value)) {
            throw new BusinessException(ErrorCode.PARAM_MISSING, fieldName + "不能为空");
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
}
