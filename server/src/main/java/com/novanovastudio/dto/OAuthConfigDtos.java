package com.novanovastudio.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * 管理后台 OAuth2 登录渠道配置接口数据结构。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-09 12:00
 */
public final class OAuthConfigDtos {

    /**
     * 禁止实例化。
     */
    private OAuthConfigDtos() {
    }

    /**
     * OAuth2 登录渠道配置信息。
     *
     * @param provider 渠道标识
     * @param displayName 渠道展示名称
     * @param enabled 是否启用
     * @param clientId 客户端 ID
     * @param clientSecret 客户端密钥明文，仅管理员接口返回
     * @param redirectUri 回调地址
     * @param callbackPath 回调接口路径，用于提示管理员填写回调地址
     */
    public record ProviderInfo(String provider, String displayName, boolean enabled, String clientId, String clientSecret,
                               String redirectUri, String callbackPath) {
    }

    /**
     * OAuth2 登录渠道配置列表。
     *
     * @param providers 全部内置渠道配置
     */
    public record ProviderListResponse(List<ProviderInfo> providers) {
    }

    /**
     * 更新 OAuth2 登录渠道配置请求。
     *
     * @param provider 渠道标识
     * @param enabled 是否启用
     * @param clientId 客户端 ID
     * @param clientSecret 客户端密钥，留空表示清空已保存的密钥
     * @param redirectUri 回调地址
     */
    public record UpdateProviderRequest(@NotBlank(message = "business.oAuthProviderIsRequired") String provider,
                                        boolean enabled,
                                        @Size(max = 255, message = "business.oAuthClientIdIsTooLong") String clientId,
                                        @Size(max = 512, message = "business.oAuthClientSecretIsTooLong") String clientSecret,
                                        @Size(max = 512, message = "business.oAuthRedirectUriIsTooLong") String redirectUri) {
    }
}
