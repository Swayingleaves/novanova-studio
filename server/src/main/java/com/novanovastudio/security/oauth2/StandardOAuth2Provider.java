package com.novanovastudio.security.oauth2;

import java.net.URI;
import java.util.Arrays;
import java.util.Locale;
import java.util.Map;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.ClientAuthenticationMethod;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.util.StringUtils;

/**
 * 标准 OAuth2 登录渠道实现。
 * <p>
 * 使用授权码流程和用户信息接口，不请求 openid 作用域，也不校验 id_token；用户资料字段由管理后台配置映射。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-09 14:30
 */
public class StandardOAuth2Provider implements ThirdPartyOAuth2Provider {

    /** 基础邮箱格式 */
    private static final String EMAIL_PATTERN = "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$";

    /** 第三方用户标识最大长度 */
    private static final int MAX_PROVIDER_USER_ID_LENGTH = 128;

    /** 邮箱最大长度 */
    private static final int MAX_EMAIL_LENGTH = 100;

    /** 昵称最大长度 */
    private static final int MAX_NICKNAME_LENGTH = 100;

    /** 头像地址最大长度 */
    private static final int MAX_AVATAR_LENGTH = 255;

    /** 渠道运行时配置 */
    private final StandardOAuth2Configuration configuration;

    /**
     * 创建标准 OAuth2 登录渠道实现。
     *
     * @param configuration StandardOAuth2Configuration 渠道运行时配置
     */
    public StandardOAuth2Provider(StandardOAuth2Configuration configuration) {
        this.configuration = configuration;
    }

    /**
     * 获取渠道唯一标识。
     *
     * @return String 渠道唯一标识
     */
    @Override
    public String providerId() {
        return configuration.providerId();
    }

    /**
     * 获取渠道展示名称。
     *
     * @return String 渠道展示名称
     */
    @Override
    public String displayName() {
        return StringUtils.hasText(configuration.displayName()) ? configuration.displayName().trim() : "标准 OAuth2";
    }

    /**
     * 判断渠道是否启用。
     *
     * @return boolean 是否启用
     */
    @Override
    public boolean enabled() {
        return configuration.enabled();
    }

    /**
     * 创建 Spring Security OAuth2 客户端注册信息。
     *
     * @return ClientRegistration OAuth2客户端注册信息
     * @throws IllegalStateException 启用后缺少必要配置或作用域包含 openid 时抛出
     */
    @Override
    public ClientRegistration clientRegistration() {
        requireConfiguration(configuration.clientId(), "Client ID");
        requireConfiguration(configuration.clientSecret(), "Client Secret");
        requireConfiguration(configuration.redirectUri(), "回调地址");
        requireConfiguration(configuration.authorizationUri(), "授权端点");
        requireConfiguration(configuration.tokenUri(), "令牌端点");
        requireConfiguration(configuration.userInfoUri(), "用户信息端点");
        requireConfiguration(configuration.scopes(), "授权范围");
        requireConfiguration(configuration.userNameAttribute(), "用户标识字段");
        return ClientRegistration.withRegistrationId(configuration.providerId())
                .clientId(configuration.clientId().trim())
                .clientSecret(configuration.clientSecret().trim())
                .clientAuthenticationMethod(clientAuthenticationMethod())
                .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
                .redirectUri(validatedRedirectUri(configuration.redirectUri()))
                .scope(scopeValues())
                .authorizationUri(configuration.authorizationUri().trim())
                .tokenUri(configuration.tokenUri().trim())
                .userInfoUri(configuration.userInfoUri().trim())
                .userNameAttributeName(configuration.userNameAttribute().trim())
                .clientName(displayName())
                .build();
    }

    /**
     * 校验并标准化第三方用户身份。
     *
     * @param user OAuth2User 用户信息接口返回的用户声明
     * @return ThirdPartyUserIdentity 标准化第三方用户身份
     * @throws OAuth2LoginException 用户标识、邮箱或资料不满足要求时抛出
     */
    @Override
    public ThirdPartyUserIdentity resolveIdentity(OAuth2User user) {
        Map<String, Object> attributes = user.getAttributes();
        String providerUserId = requiredAttribute(attributes, configuration.userNameAttribute(),
                "providerIdentityUnavailable", "标准 OAuth2 渠道未返回用户标识");
        String email = requiredAttribute(attributes, configuration.emailAttribute(),
                "emailUnavailable", "标准 OAuth2 渠道未返回邮箱").toLowerCase(Locale.ROOT);
        if (email.length() > MAX_EMAIL_LENGTH || !email.matches(EMAIL_PATTERN)) {
            throw new OAuth2LoginException("emailUnavailable", "标准 OAuth2 渠道返回的邮箱格式不正确");
        }
        String nickname = firstNonEmpty(attribute(attributes, configuration.nicknameAttribute()),
                attribute(attributes, "name"), attribute(attributes, "preferred_username"),
                attribute(attributes, "username"), emailName(email));
        String avatar = attribute(attributes, configuration.avatarAttribute());
        requireMaximumLength(providerUserId, MAX_PROVIDER_USER_ID_LENGTH, "标准 OAuth2 渠道的用户标识长度超过系统限制");
        requireMaximumLength(nickname, MAX_NICKNAME_LENGTH, "标准 OAuth2 渠道的昵称长度超过系统限制");
        requireMaximumLength(avatar, MAX_AVATAR_LENGTH, "标准 OAuth2 渠道的头像地址长度超过系统限制");
        return new ThirdPartyUserIdentity(configuration.providerId(), providerUserId, email, nickname, avatar);
    }

    /**
     * 获取客户端认证方式。
     *
     * @return ClientAuthenticationMethod 客户端认证方式
     */
    private ClientAuthenticationMethod clientAuthenticationMethod() {
        return "client_secret_post".equalsIgnoreCase(configuration.clientAuthenticationMethod())
                ? ClientAuthenticationMethod.CLIENT_SECRET_POST
                : ClientAuthenticationMethod.CLIENT_SECRET_BASIC;
    }

    /**
     * 拆分并校验授权范围。
     *
     * @return String[] 授权范围
     * @throws IllegalStateException 作用域为空或包含 openid 时抛出
     */
    private String[] scopeValues() {
        String[] scopes = Arrays.stream(configuration.scopes().split("\\s+"))
                .filter(StringUtils::hasText)
                .toArray(String[]::new);
        if (scopes.length == 0) {
            throw new IllegalStateException("标准 OAuth2 登录未配置授权范围");
        }
        if (Arrays.stream(scopes).anyMatch("openid"::equalsIgnoreCase)) {
            throw new IllegalStateException("标准 OAuth2 登录不支持 openid 作用域");
        }
        return scopes;
    }

    /**
     * 校验必要配置。
     *
     * @param value String 配置值
     * @param fieldName String 配置项名称
     * @throws IllegalStateException 配置为空时抛出
     */
    private void requireConfiguration(String value, String fieldName) {
        if (!StringUtils.hasText(value)) {
            throw new IllegalStateException("标准 OAuth2 登录已启用，但管理后台未配置" + fieldName);
        }
    }

    /**
     * 校验OAuth2回调地址格式和固定路径。
     *
     * @param value String OAuth2回调地址
     * @return String 校验通过的OAuth2回调地址
     * @throws IllegalStateException 回调地址不是合法同域入口时抛出
     */
    private String validatedRedirectUri(String value) {
        URI redirectUri;
        try {
            redirectUri = URI.create(value.trim());
        } catch (IllegalArgumentException exception) {
            throw new IllegalStateException("标准 OAuth2 登录回调地址不是合法地址", exception);
        }
        String callbackPath = OAuth2ProviderCatalog.callbackPath(configuration.providerId());
        boolean supportedScheme = "https".equalsIgnoreCase(redirectUri.getScheme()) || "http".equalsIgnoreCase(redirectUri.getScheme());
        if (!supportedScheme || !StringUtils.hasText(redirectUri.getHost()) || !callbackPath.equals(redirectUri.getPath())
                || redirectUri.getQuery() != null || redirectUri.getFragment() != null) {
            throw new IllegalStateException("标准 OAuth2 登录回调地址必须是绝对 HTTP 地址且路径为" + callbackPath);
        }
        return redirectUri.toString();
    }

    /**
     * 读取必填用户属性。
     *
     * @param attributes Map<String, Object> 用户属性
     * @param attributeName String 属性名称
     * @param errorCode String 固定错误码
     * @param errorMessage String 中文错误信息
     * @return String 去除首尾空白后的属性值
     * @throws OAuth2LoginException 属性缺失时抛出
     */
    private String requiredAttribute(Map<String, Object> attributes, String attributeName, String errorCode, String errorMessage) {
        String value = attribute(attributes, attributeName);
        if (!StringUtils.hasText(value)) {
            throw new OAuth2LoginException(errorCode, errorMessage);
        }
        return value;
    }

    /**
     * 读取字符串用户属性。
     *
     * @param attributes Map<String, Object> 用户属性
     * @param attributeName String 属性名称
     * @return String 字符串属性，不存在时返回空字符串
     */
    private String attribute(Map<String, Object> attributes, String attributeName) {
        if (!StringUtils.hasText(attributeName)) {
            return "";
        }
        Object value = attributes.get(attributeName);
        if (value instanceof String stringValue) {
            return stringValue.trim();
        }
        if (value instanceof Number || value instanceof Boolean) {
            return String.valueOf(value);
        }
        return "";
    }

    /**
     * 校验第三方资料字段最大长度。
     *
     * @param value String 字段值
     * @param maximumLength int 最大长度
     * @param errorMessage String 中文错误信息
     * @throws OAuth2LoginException 字段超过数据库限制时抛出
     */
    private void requireMaximumLength(String value, int maximumLength, String errorMessage) {
        if (value.length() > maximumLength) {
            throw new OAuth2LoginException("providerProfileInvalid", errorMessage);
        }
    }

    /**
     * 获取邮箱名称部分。
     *
     * @param email String 邮箱
     * @return String 邮箱名称部分
     */
    private String emailName(String email) {
        int separatorIndex = email.indexOf('@');
        return separatorIndex > 0 ? email.substring(0, separatorIndex) : email;
    }

    /**
     * 返回第一个非空字符串。
     *
     * @param values String[] 候选字符串
     * @return String 第一个非空字符串
     */
    private String firstNonEmpty(String... values) {
        for (String value : values) {
            if (StringUtils.hasText(value)) {
                return value.trim();
            }
        }
        return "";
    }
}
