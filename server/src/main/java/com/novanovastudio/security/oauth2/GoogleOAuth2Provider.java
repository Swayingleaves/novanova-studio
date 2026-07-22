package com.novanovastudio.security.oauth2;

import com.novanovastudio.config.NovanovaProperties;
import java.net.URI;
import java.util.Locale;
import lombok.RequiredArgsConstructor;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.ClientAuthenticationMethod;
import org.springframework.security.oauth2.core.oidc.IdTokenClaimNames;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

/**
 * Google OpenID Connect认证渠道实现
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-16 00:00
 */
@Component
@RequiredArgsConstructor
public class GoogleOAuth2Provider implements ThirdPartyOAuth2Provider {

    /** 渠道唯一标识 */
    public static final String PROVIDER_ID = "google";

    /** OAuth2授权端点 */
    private static final String AUTHORIZATION_URI = "https://accounts.google.com/o/oauth2/v2/auth";

    /** OAuth2令牌端点 */
    private static final String TOKEN_URI = "https://oauth2.googleapis.com/token";

    /** OpenID Connect用户信息端点 */
    private static final String USER_INFO_URI = "https://openidconnect.googleapis.com/v1/userinfo";

    /** OpenID Connect签名密钥端点 */
    private static final String JWK_SET_URI = "https://www.googleapis.com/oauth2/v3/certs";

    /** OpenID Connect签发者 */
    private static final String ISSUER_URI = "https://accounts.google.com";

    /** OAuth2回调路径 */
    private static final String CALLBACK_PATH = "/api/v1/auth/oauth/callback/google";

    /** 基础邮箱格式 */
    private static final String EMAIL_PATTERN = "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$";

    /** 第三方用户标识最大长度 */
    private static final int MAX_PROVIDER_USER_ID_LENGTH = 128;

    /** 邮箱最大长度 */
    private static final int MAX_EMAIL_LENGTH = 100;

    /** 本地昵称最大长度 */
    private static final int MAX_NICKNAME_LENGTH = 50;

    /** 头像地址最大长度 */
    private static final int MAX_AVATAR_LENGTH = 255;

    /** 服务配置 */
    private final NovanovaProperties properties;

    /**
     * 获取渠道唯一标识。
     *
     * @return String google
     */
    @Override
    public String providerId() {
        return PROVIDER_ID;
    }

    /**
     * 获取渠道展示名称。
     *
     * @return String Google
     */
    @Override
    public String displayName() {
        return "Google";
    }

    /**
     * 判断Google认证是否启用。
     *
     * @return boolean 是否启用
     */
    @Override
    public boolean enabled() {
        return properties.getOauth2().getGoogle().isEnabled();
    }

    /**
     * 创建Google OAuth2客户端注册信息。
     *
     * @return ClientRegistration Google客户端注册信息
     * @throws IllegalStateException 启用后缺少必要配置时抛出
     */
    @Override
    public ClientRegistration clientRegistration() {
        NovanovaProperties.OAuth2.Google configuration = properties.getOauth2().getGoogle();
        requireConfiguration(configuration.getClientId(), "OAUTH2_GOOGLE_CLIENT_ID");
        requireConfiguration(configuration.getClientSecret(), "OAUTH2_GOOGLE_CLIENT_SECRET");
        requireConfiguration(configuration.getRedirectUri(), "OAUTH2_GOOGLE_REDIRECT_URI");
        return ClientRegistration.withRegistrationId(PROVIDER_ID)
                .clientId(configuration.getClientId().trim())
                .clientSecret(configuration.getClientSecret().trim())
                .clientAuthenticationMethod(ClientAuthenticationMethod.CLIENT_SECRET_POST)
                .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
                .redirectUri(validatedRedirectUri(configuration.getRedirectUri()))
                .scope("openid", "profile", "email")
                .authorizationUri(AUTHORIZATION_URI)
                .tokenUri(TOKEN_URI)
                .userInfoUri(USER_INFO_URI)
                .userNameAttributeName(IdTokenClaimNames.SUB)
                .jwkSetUri(JWK_SET_URI)
                .issuerUri(ISSUER_URI)
                .clientName(displayName())
                .build();
    }

    /**
     * 校验Google账号资料并转换为标准身份。
     *
     * @param user OidcUser Google OpenID Connect用户声明
     * @return ThirdPartyUserIdentity 标准化第三方用户身份
     * @throws OAuth2LoginException 用户标识、已验证邮箱或资料不满足要求时抛出
     */
    @Override
    public ThirdPartyUserIdentity resolveIdentity(OidcUser user) {
        if (!Boolean.TRUE.equals(user.getClaims().get("email_verified"))) {
            throw new OAuth2LoginException("emailUnverified", "Google账号邮箱尚未验证");
        }
        String providerUserId = requiredClaim(user, IdTokenClaimNames.SUB, "providerIdentityUnavailable", "Google用户标识缺失");
        String email = requiredClaim(user, "email", "emailUnavailable", "Google账号未返回邮箱").toLowerCase(Locale.ROOT);
        if (email.length() > MAX_EMAIL_LENGTH || !email.matches(EMAIL_PATTERN)) {
            throw new OAuth2LoginException("emailUnavailable", "Google账号返回的邮箱格式不正确");
        }
        String nickname = firstNonEmpty(claim(user, "name"), emailName(email));
        String avatar = claim(user, "picture");
        requireMaximumLength(providerUserId, MAX_PROVIDER_USER_ID_LENGTH, "Google用户标识长度超过系统限制");
        requireMaximumLength(nickname, MAX_NICKNAME_LENGTH, "Google昵称长度超过系统限制");
        requireMaximumLength(avatar, MAX_AVATAR_LENGTH, "Google头像地址长度超过系统限制");
        return new ThirdPartyUserIdentity(providerId(), providerUserId, email, nickname, avatar);
    }

    /**
     * 校验必要配置。
     *
     * @param value String 配置值
     * @param environmentName String 环境变量名称
     * @throws IllegalStateException 配置为空时抛出
     */
    private void requireConfiguration(String value, String environmentName) {
        if (!StringUtils.hasText(value)) {
            throw new IllegalStateException("已启用Google登录，但未配置" + environmentName);
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
            throw new IllegalStateException("OAUTH2_GOOGLE_REDIRECT_URI不是合法地址", exception);
        }
        boolean supportedScheme = "https".equalsIgnoreCase(redirectUri.getScheme()) || "http".equalsIgnoreCase(redirectUri.getScheme());
        if (!supportedScheme || !StringUtils.hasText(redirectUri.getHost()) || !CALLBACK_PATH.equals(redirectUri.getPath())
                || redirectUri.getQuery() != null || redirectUri.getFragment() != null) {
            throw new IllegalStateException("OAUTH2_GOOGLE_REDIRECT_URI必须是绝对HTTP地址且路径为" + CALLBACK_PATH);
        }
        return redirectUri.toString();
    }

    /**
     * 读取必填用户声明。
     *
     * @param user OidcUser OpenID Connect用户
     * @param claimName String 声明名称
     * @param errorCode String 固定错误码
     * @param errorMessage String 中文错误信息
     * @return String 去除首尾空白后的声明值
     * @throws OAuth2LoginException 声明缺失时抛出
     */
    private String requiredClaim(OidcUser user, String claimName, String errorCode, String errorMessage) {
        String value = claim(user, claimName);
        if (!StringUtils.hasText(value)) {
            throw new OAuth2LoginException(errorCode, errorMessage);
        }
        return value;
    }

    /**
     * 读取字符串用户声明。
     *
     * @param user OidcUser OpenID Connect用户
     * @param claimName String 声明名称
     * @return String 字符串声明，不存在时返回空字符串
     */
    private String claim(OidcUser user, String claimName) {
        Object value = user.getClaims().get(claimName);
        return value instanceof String stringValue ? stringValue.trim() : "";
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
