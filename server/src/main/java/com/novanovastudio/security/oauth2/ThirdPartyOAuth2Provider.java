package com.novanovastudio.security.oauth2;

import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;

/**
 * 第三方OAuth2认证渠道扩展接口
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-15 00:00
 */
public interface ThirdPartyOAuth2Provider {

    /**
     * 获取渠道唯一标识。
     *
     * @return String 渠道唯一标识
     */
    String providerId();

    /**
     * 获取渠道展示名称。
     *
     * @return String 渠道展示名称
     */
    String displayName();

    /**
     * 判断渠道是否启用。
     *
     * @return boolean 是否启用
     */
    boolean enabled();

    /**
     * 创建Spring Security OAuth2客户端注册信息。
     *
     * @return ClientRegistration OAuth2客户端注册信息
     */
    ClientRegistration clientRegistration();

    /**
     * 校验并标准化第三方用户身份。
     *
     * @param user OidcUser OpenID Connect用户声明
     * @return ThirdPartyUserIdentity 标准化第三方用户身份
     * @throws OAuth2LoginException 第三方账号不满足登录条件时抛出
     */
    ThirdPartyUserIdentity resolveIdentity(OidcUser user);
}
