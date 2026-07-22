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
 * linux.do OpenID Connect认证渠道实现
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-15 00:00
 */
@Component
@RequiredArgsConstructor
public class LinuxDoOAuth2Provider implements ThirdPartyOAuth2Provider {

    /** 渠道唯一标识 */
    public static final String PROVIDER_ID = "linuxDo";

    /** OAuth2授权端点 */
    private static final String AUTHORIZATION_URI = "https://connect.linux.do/oauth2/authorize";

    /** OAuth2令牌端点 */
    private static final String TOKEN_URI = "https://connect.linux.do/oauth2/token";

    /** OpenID Connect用户信息端点 */
    private static final String USER_INFO_URI = "https://connect.linux.do/api/user";

    /** OpenID Connect签名密钥端点 */
    private static final String JWK_SET_URI = "https://connect.linux.do/.well-known/jwks.json";

    /** OpenID Connect签发者 */
    private static final String ISSUER_URI = "https://connect.linux.do/";

    /** OAuth2回调路径 */
    private static final String CALLBACK_PATH = "/api/v1/auth/oauth/callback/linuxDo";

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
     * @return String linuxDo
     */
    @Override
    public String providerId() {
        return PROVIDER_ID;
    }

    /**
     * 获取渠道展示名称。
     *
     * @return String LINUX DO
     */
    @Override
    public String displayName() {
        return "LINUX DO";
    }

    /**
     * 判断linux.do认证是否启用。
     *
     * @return boolean 是否启用
     */
    @Override
    public boolean enabled() {
        return properties.getOauth2().getLinuxDo().isEnabled();
    }

    /**
     * 创建linux.do OAuth2客户端注册信息。
     *
     * @return ClientRegistration linux.do客户端注册信息
     * @throws IllegalStateException 启用后缺少必要配置时抛出
     */
    @Override
    public ClientRegistration clientRegistration() {
        NovanovaProperties.OAuth2.LinuxDo configuration = properties.getOauth2().getLinuxDo();
        requireConfiguration(configuration.getClientId(), "OAUTH2_LINUX_DO_CLIENT_ID");
        requireConfiguration(configuration.getClientSecret(), "OAUTH2_LINUX_DO_CLIENT_SECRET");
        requireConfiguration(configuration.getRedirectUri(), "OAUTH2_LINUX_DO_REDIRECT_URI");
        String redirectUri = validatedRedirectUri(configuration.getRedirectUri());
        return ClientRegistration.withRegistrationId(PROVIDER_ID)
                .clientId(configuration.getClientId().trim())
                .clientSecret(configuration.getClientSecret().trim())
                .clientAuthenticationMethod(ClientAuthenticationMethod.CLIENT_SECRET_BASIC)
                .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
                .redirectUri(redirectUri)
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
     * 校验linux.do账号状态并转换为标准身份。
     *
     * @param user OidcUser linux.do OpenID Connect用户声明
     * @return ThirdPartyUserIdentity 标准化第三方用户身份
     * @throws OAuth2LoginException 账号无效、非活动状态或邮箱缺失时抛出
     */
    @Override
    public ThirdPartyUserIdentity resolveIdentity(OidcUser user) {
        // linux.do只允许active明确为true的正常账号登录，不限制trust_level和silenced。
        if (!Boolean.TRUE.equals(user.getClaim("active"))) {
            throw new OAuth2LoginException("accountInactive", "linux.do账号不是正常活动状态");
        }
        String providerUserId = requiredClaim(user, IdTokenClaimNames.SUB, "providerIdentityUnavailable", "linux.do用户标识缺失");
        String email = requiredClaim(user, "email", "emailUnavailable", "linux.do账号未返回邮箱").toLowerCase(Locale.ROOT);
        if (email.length() > MAX_EMAIL_LENGTH || !email.matches(EMAIL_PATTERN)) {
            throw new OAuth2LoginException("emailUnavailable", "linux.do账号返回的邮箱格式不正确");
        }
        String nickname = firstNonEmpty(claim(user, "name"), claim(user, "username"), claim(user, "login"), emailName(email));
        String avatar = claim(user, "avatar_url");
        requireMaximumLength(providerUserId, MAX_PROVIDER_USER_ID_LENGTH, "linux.do用户标识长度超过系统限制");
        requireMaximumLength(nickname, MAX_NICKNAME_LENGTH, "linux.do昵称长度超过系统限制");
        requireMaximumLength(avatar, MAX_AVATAR_LENGTH, "linux.do头像地址长度超过系统限制");
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
            throw new IllegalStateException("已启用linux.do登录，但未配置" + environmentName);
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
            throw new IllegalStateException("OAUTH2_LINUX_DO_REDIRECT_URI不是合法地址", exception);
        }
        boolean supportedScheme = "https".equalsIgnoreCase(redirectUri.getScheme()) || "http".equalsIgnoreCase(redirectUri.getScheme());
        if (!supportedScheme || !StringUtils.hasText(redirectUri.getHost()) || !CALLBACK_PATH.equals(redirectUri.getPath())
                || redirectUri.getQuery() != null || redirectUri.getFragment() != null) {
            throw new IllegalStateException("OAUTH2_LINUX_DO_REDIRECT_URI必须是绝对HTTP地址且路径为" + CALLBACK_PATH);
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
