package com.novanovastudio.security.oauth2;

/**
 * 第三方 OAuth2 登录渠道运行时配置。
 * <p>
 * 由管理后台保存的渠道配置解密后缓存得到，供登录渠道实现构建 Spring Security 客户端注册信息。
 *
 * @param providerId String 渠道标识
 * @param enabled boolean 是否启用
 * @param clientId String 第三方应用客户端 ID
 * @param clientSecret String 解密后的第三方应用客户端密钥
 * @param redirectUri String 第三方登录回调地址
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-09 12:00
 */
public record ThirdPartyOAuth2Configuration(String providerId, boolean enabled, String clientId, String clientSecret, String redirectUri) {
}
