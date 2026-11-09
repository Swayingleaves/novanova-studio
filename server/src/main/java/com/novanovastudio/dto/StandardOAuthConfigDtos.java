package com.novanovastudio.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * 管理后台标准 OAuth2 登录渠道配置接口数据结构。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-09 14:30
 */
public final class StandardOAuthConfigDtos {

    /**
     * 禁止实例化。
     */
    private StandardOAuthConfigDtos() {
    }

    /**
     * 标准 OAuth2 登录渠道配置信息。
     *
     * @param provider 渠道标识
     * @param displayName 渠道名称
     * @param enabled 是否启用
     * @param clientId 客户端 ID
     * @param clientSecret 客户端密钥明文，仅管理员接口返回
     * @param redirectUri 回调地址
     * @param callbackPath 回调接口路径，用于提示管理员填写回调地址
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
    public record ProviderInfo(String provider, String displayName, boolean enabled, String clientId, String clientSecret,
                               String redirectUri, String callbackPath, String authorizationUri, String tokenUri,
                               String userInfoUri, String scopes, String clientAuthenticationMethod,
                               String userNameAttribute, String emailAttribute, String nicknameAttribute,
                               String avatarAttribute) {
    }

    /**
     * 标准 OAuth2 登录渠道配置列表。
     *
     * @param providers 全部标准渠道配置
     */
    public record ProviderListResponse(List<ProviderInfo> providers) {
    }

    /**
     * 新增或更新标准 OAuth2 登录渠道配置请求。
     *
     * @param provider 渠道标识，由前端创建时生成
     * @param displayName 渠道名称
     * @param enabled 是否启用
     * @param clientId 客户端 ID
     * @param clientSecret 客户端密钥，留空表示清空已保存的密钥
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
    public record ProviderRequest(@NotBlank(message = "business.standardOAuthProviderIdIsRequired")
                                  @Size(max = 30, message = "business.standardOAuthProviderIdIsTooLong") String provider,
                                  @NotBlank(message = "business.standardOAuthDisplayNameIsRequired")
                                  @Size(max = 50, message = "business.standardOAuthDisplayNameIsTooLong") String displayName,
                                  boolean enabled,
                                  @Size(max = 255, message = "business.oAuthClientIdIsTooLong") String clientId,
                                  @Size(max = 512, message = "business.oAuthClientSecretIsTooLong") String clientSecret,
                                  @Size(max = 512, message = "business.oAuthRedirectUriIsTooLong") String redirectUri,
                                  @Size(max = 512, message = "business.standardOAuthEndpointIsTooLong") String authorizationUri,
                                  @Size(max = 512, message = "business.standardOAuthEndpointIsTooLong") String tokenUri,
                                  @Size(max = 512, message = "business.standardOAuthEndpointIsTooLong") String userInfoUri,
                                  @Size(max = 255, message = "business.standardOAuthScopesAreTooLong") String scopes,
                                  @Size(max = 32, message = "business.standardOAuthClientAuthenticationMethodIsTooLong") String clientAuthenticationMethod,
                                  @Size(max = 64, message = "business.standardOAuthAttributeIsTooLong") String userNameAttribute,
                                  @Size(max = 64, message = "business.standardOAuthAttributeIsTooLong") String emailAttribute,
                                  @Size(max = 64, message = "business.standardOAuthAttributeIsTooLong") String nicknameAttribute,
                                  @Size(max = 64, message = "business.standardOAuthAttributeIsTooLong") String avatarAttribute) {
    }

    /**
     * 删除标准 OAuth2 登录渠道配置请求。
     *
     * @param provider 渠道标识
     */
    public record DeleteRequest(@NotBlank(message = "business.standardOAuthProviderIdIsRequired")
                                @Size(max = 30, message = "business.standardOAuthProviderIdIsTooLong") String provider) {
    }
}
