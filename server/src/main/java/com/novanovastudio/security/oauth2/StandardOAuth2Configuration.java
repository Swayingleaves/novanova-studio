package com.novanovastudio.security.oauth2;

/**
 * 标准 OAuth2 登录渠道运行时配置。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-09 14:30
 *
 * @param providerId 渠道标识
 * @param displayName 渠道名称
 * @param enabled 是否启用
 * @param clientId 客户端 ID
 * @param clientSecret 客户端密钥明文
 * @param redirectUri 回调地址
 * @param authorizationUri 授权端点
 * @param tokenUri 令牌端点
 * @param userInfoUri 用户信息端点
 * @param scopes 授权范围，空格分隔
 * @param clientAuthenticationMethod 客户端认证方式
 * @param userNameAttribute 用户标识字段名
 * @param emailAttribute 邮箱字段名
 * @param nicknameAttribute 昵称字段名
 * @param avatarAttribute 头像字段名
 */
public record StandardOAuth2Configuration(String providerId, String displayName, boolean enabled, String clientId,
                                          String clientSecret, String redirectUri, String authorizationUri,
                                          String tokenUri, String userInfoUri, String scopes,
                                          String clientAuthenticationMethod, String userNameAttribute,
                                          String emailAttribute, String nicknameAttribute, String avatarAttribute) {
}
