package com.novanovastudio.security.oauthserver;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.common.SystemMessage;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.util.StringUtils;
import org.springframework.web.util.UriComponentsBuilder;

/**
 * 对外 OAuth2 授权码协议中可独立校验的规则。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-09 18:40
 */
public final class OAuthServerProtocol {

    /** 未传授权范围时默认接受的范围 */
    public static final String DEFAULT_SCOPE = "profile email";

    /** 客户端标识格式：nv 加 32 位小写十六进制 */
    private static final java.util.regex.Pattern CLIENT_ID_PATTERN = java.util.regex.Pattern.compile("^nv[a-f0-9]{32}$");

    /** 允许出现在授权请求中的范围。openid 只表示允许登录，不签发身份令牌 */
    private static final Set<String> ALLOWED_SCOPES = Set.of("openid", "profile", "email");

    /** 单个客户端最多登记的回调地址数量 */
    private static final int MAX_REDIRECT_URIS = 10;

    /** 授权状态参数的最大长度 */
    private static final int MAX_STATE_LENGTH = 512;

    /**
     * 禁止实例化。
     */
    private OAuthServerProtocol() {
    }

    /**
     * 校验并整理授权范围。空范围使用 profile 与 email。
     *
     * @param rawScope String 原始范围，空格分隔
     * @return String 去重后的范围
     * @throws OAuthProtocolException 包含不支持的范围时抛出
     */
    public static String grantedScope(String rawScope) {
        if (!StringUtils.hasText(rawScope)) {
            return DEFAULT_SCOPE;
        }
        LinkedHashSet<String> granted = new LinkedHashSet<>();
        for (String part : rawScope.trim().split("\\s+")) {
            if (!ALLOWED_SCOPES.contains(part)) {
                throw new OAuthProtocolException("invalid_scope", HttpStatus.BAD_REQUEST, "Unsupported scope");
            }
            granted.add(part);
        }
        if (granted.isEmpty()) {
            throw new OAuthProtocolException("invalid_scope", HttpStatus.BAD_REQUEST, "Unsupported scope");
        }
        return String.join(" ", granted);
    }

    /**
     * 校验客户端标识格式。
     *
     * @param clientId String 客户端标识
     * @throws BusinessException 格式不合法时抛出
     */
    public static void requireClientId(String clientId) {
        if (!StringUtils.hasText(clientId) || !CLIENT_ID_PATTERN.matcher(clientId).matches()) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.oauthClientIdIsInvalid"));
        }
    }

    /**
     * 校验并去重回调地址，保留管理员提交的原文。
     *
     * @param redirectUris List<String> 回调地址
     * @return List<String> 规范化后的回调地址
     * @throws BusinessException 地址缺失、重复或不是绝对 HTTP(S) 地址时抛出
     */
    public static List<String> normalizeRedirectUris(List<String> redirectUris) {
        if (redirectUris == null || redirectUris.isEmpty()) {
            throw new BusinessException(ErrorCode.PARAM_MISSING, SystemMessage.of("business.oauthClientRedirectUriIsRequired"));
        }
        if (redirectUris.size() > MAX_REDIRECT_URIS) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.oauthClientTooManyRedirectUris"));
        }
        List<String> normalized = new ArrayList<>();
        for (String redirectUri : redirectUris) {
            String value = redirectUri == null ? "" : redirectUri.trim();
            if (!StringUtils.hasText(value)) {
                throw new BusinessException(ErrorCode.PARAM_MISSING, SystemMessage.of("business.oauthClientRedirectUriIsRequired"));
            }
            if (value.length() > 512) {
                throw new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.oauthClientRedirectUriIsTooLong"));
            }
            if (normalized.contains(value)) {
                throw new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.oauthClientRedirectUriDuplicated"));
            }
            requireAbsoluteHttpUri(value);
            normalized.add(value);
        }
        return List.copyOf(normalized);
    }

    /**
     * 判断回调地址是否与已登记地址全字匹配。
     *
     * @param registered List<String> 已登记地址
     * @param redirectUri String 请求中的回调地址
     * @return boolean 是否匹配
     */
    public static boolean redirectMatches(List<String> registered, String redirectUri) {
        return StringUtils.hasText(redirectUri) && registered != null && registered.contains(redirectUri);
    }

    /**
     * 校验授权状态参数长度。
     *
     * @param state String 授权状态
     * @throws OAuthProtocolException 超过长度时抛出
     */
    public static void requireStateLength(String state) {
        if (state != null && state.length() > MAX_STATE_LENGTH) {
            throw new OAuthProtocolException("invalid_request", HttpStatus.BAD_REQUEST, "State is too long");
        }
    }

    /**
     * 拼接授权成功回调。
     *
     * @param redirectUri String 已登记回调地址
     * @param code String 授权码
     * @param state String 授权状态，空则不带回
     * @return String 回调地址
     */
    public static String successCallback(String redirectUri, String code, String state) {
        UriComponentsBuilder builder = UriComponentsBuilder.fromUriString(redirectUri).queryParam("code", code);
        if (StringUtils.hasText(state)) {
            builder.queryParam("state", state);
        }
        return builder.build().encode().toUriString();
    }

    /**
     * 拼接授权失败回调。
     *
     * @param redirectUri String 已登记回调地址
     * @param error String OAuth 错误码
     * @param description String 错误说明
     * @param state String 授权状态，空则不带回
     * @return String 回调地址
     */
    public static String errorCallback(String redirectUri, String error, String description, String state) {
        UriComponentsBuilder builder = UriComponentsBuilder.fromUriString(redirectUri)
                .queryParam("error", error)
                .queryParam("error_description", description);
        if (StringUtils.hasText(state)) {
            builder.queryParam("state", state);
        }
        return builder.build().encode().toUriString();
    }

    /**
     * 解析令牌请求中的客户端凭据。请求头和请求体同时出现时必须一致。
     *
     * @param authorization String Authorization 请求头
     * @param bodyClientId String 请求体中的客户端标识
     * @param bodyClientSecret String 请求体中的客户端密钥
     * @return String[] 客户端标识和密钥
     * @throws OAuthProtocolException 凭据缺失或两种方式不一致时抛出
     */
    public static String[] clientCredentials(String authorization, String bodyClientId, String bodyClientSecret) {
        String[] basic = basicCredentials(authorization);
        String clientId = text(bodyClientId);
        String clientSecret = text(bodyClientSecret);
        if (basic != null && (StringUtils.hasText(clientId) || StringUtils.hasText(clientSecret))) {
            if (!constantEquals(basic[0], clientId) || !constantEquals(basic[1], clientSecret)) {
                throw invalidClient();
            }
        }
        if (basic != null) {
            return basic;
        }
        if (!StringUtils.hasText(clientId) || !StringUtils.hasText(clientSecret)) {
            throw invalidClient();
        }
        return new String[] {clientId, clientSecret};
    }

    /**
     * 比较两段密钥，避免按内容提前返回。
     *
     * @param left String 左侧文本
     * @param right String 右侧文本
     * @return boolean 是否相同
     */
    public static boolean constantEquals(String left, String right) {
        byte[] leftBytes = text(left).getBytes(StandardCharsets.UTF_8);
        byte[] rightBytes = text(right).getBytes(StandardCharsets.UTF_8);
        return MessageDigest.isEqual(leftBytes, rightBytes);
    }

    /**
     * 创建客户端认证失败错误。
     *
     * @return OAuthProtocolException 客户端认证失败
     */
    public static OAuthProtocolException invalidClient() {
        return new OAuthProtocolException("invalid_client", HttpStatus.UNAUTHORIZED, "Client authentication failed");
    }

    /**
     * 校验回调地址是绝对 HTTP(S) 地址，且没有用户信息或片段。
     *
     * @param redirectUri String 回调地址
     * @throws BusinessException 地址不合法时抛出
     */
    private static void requireAbsoluteHttpUri(String redirectUri) {
        if (redirectUri.chars().anyMatch(Character::isWhitespace)) {
            throw redirectUriInvalid();
        }
        try {
            URI uri = URI.create(redirectUri);
            String scheme = uri.getScheme();
            boolean http = "http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme);
            if (!http || !StringUtils.hasText(uri.getHost()) || StringUtils.hasText(uri.getRawUserInfo()) || StringUtils.hasText(uri.getRawFragment())) {
                throw redirectUriInvalid();
            }
        } catch (IllegalArgumentException exception) {
            throw redirectUriInvalid();
        }
    }

    /**
     * 从 Basic 认证头读取未经额外编码的客户端标识和密钥。
     *
     * @param authorization String Authorization 请求头
     * @return String[] 客户端凭据；不是 Basic 认证时为空
     * @throws OAuthProtocolException Basic 内容无法解析时抛出
     */
    private static String[] basicCredentials(String authorization) {
        if (!StringUtils.hasText(authorization)) {
            return null;
        }
        String value = authorization.trim();
        int space = value.indexOf(' ');
        if (space <= 0 || !"Basic".equalsIgnoreCase(value.substring(0, space))) {
            return null;
        }
        try {
            String pair = new String(Base64.getDecoder().decode(value.substring(space + 1).trim()), StandardCharsets.UTF_8);
            int separator = pair.indexOf(':');
            if (separator <= 0 || separator == pair.length() - 1) {
                throw invalidClient();
            }
            return new String[] {pair.substring(0, separator), pair.substring(separator + 1)};
        } catch (IllegalArgumentException exception) {
            throw invalidClient();
        }
    }

    /**
     * 创建回调地址错误。
     *
     * @return BusinessException 回调地址错误
     */
    private static BusinessException redirectUriInvalid() {
        return new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.oauthClientRedirectUriIsInvalid"));
    }

    /**
     * 把空文本收成空字符串。
     *
     * @param value String 原始文本
     * @return String 去除首尾空白后的文本
     */
    private static String text(String value) {
        return value == null ? "" : value.trim();
    }
}
