package com.novanovastudio.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * 管理后台对外 OAuth2 授权客户端配置接口数据结构。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-09 18:40
 */
public final class OAuthClientConfigDtos {

    /**
     * 禁止实例化。
     */
    private OAuthClientConfigDtos() {
    }

    /**
     * 对外授权客户端信息。
     *
     * @param clientId 客户端标识
     * @param displayName 应用名称
     * @param enabled 是否启用
     * @param clientSecret 客户端密钥明文，仅管理员接口返回
     * @param redirectUris 允许的回调地址
     */
    public record ClientInfo(String clientId, String displayName, boolean enabled, String clientSecret, List<String> redirectUris) {
    }

    /**
     * 对外授权客户端列表。
     *
     * @param clients 全部客户端
     */
    public record ClientListResponse(List<ClientInfo> clients) {
    }

    /**
     * 新增对外授权客户端请求。客户端标识和密钥由服务端生成。
     *
     * @param displayName 应用名称
     * @param enabled 是否启用
     * @param redirectUris 允许的回调地址
     */
    public record CreateClientRequest(@NotBlank(message = "business.oauthClientDisplayNameIsRequired")
                                      @Size(max = 50, message = "business.oauthClientDisplayNameIsTooLong") String displayName,
                                      boolean enabled,
                                      @NotEmpty(message = "business.oauthClientRedirectUriIsRequired")
                                      @Size(max = 10, message = "business.oauthClientTooManyRedirectUris")
                                      List<@NotBlank(message = "business.oauthClientRedirectUriIsRequired") @Size(max = 512, message = "business.oauthClientRedirectUriIsTooLong") String> redirectUris) {
    }

    /**
     * 更新对外授权客户端请求。不修改密钥。
     *
     * @param clientId 客户端标识
     * @param displayName 应用名称
     * @param enabled 是否启用
     * @param redirectUris 允许的回调地址
     */
    public record UpdateClientRequest(@NotBlank(message = "business.oauthClientIdIsInvalid")
                                      @Size(max = 64, message = "business.oauthClientIdIsInvalid") String clientId,
                                      @NotBlank(message = "business.oauthClientDisplayNameIsRequired")
                                      @Size(max = 50, message = "business.oauthClientDisplayNameIsTooLong") String displayName,
                                      boolean enabled,
                                      @NotEmpty(message = "business.oauthClientRedirectUriIsRequired")
                                      @Size(max = 10, message = "business.oauthClientTooManyRedirectUris")
                                      List<@NotBlank(message = "business.oauthClientRedirectUriIsRequired") @Size(max = 512, message = "business.oauthClientRedirectUriIsTooLong") String> redirectUris) {
    }

    /**
     * 按客户端标识操作的请求。
     *
     * @param clientId 客户端标识
     */
    public record ClientIdRequest(@NotBlank(message = "business.oauthClientIdIsInvalid")
                                  @Size(max = 64, message = "business.oauthClientIdIsInvalid") String clientId) {
    }
}
