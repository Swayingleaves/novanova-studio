package com.novanovastudio.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * OAuth2认证接口数据结构
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-15 00:00
 */
public final class OAuth2Dtos {

    /**
     * 禁止实例化。
     */
    private OAuth2Dtos() {
    }

    /**
     * 第三方登录渠道信息。
     *
     * @param providerId 渠道唯一标识
     * @param displayName 渠道展示名称
     * @param authorizationPath 授权入口路径
     */
    public record ProviderInfo(String providerId, String displayName, String authorizationPath) {
    }

    /**
     * 第三方登录渠道列表。
     *
     * @param providers 已启用渠道
     */
    public record ProviderListResponse(List<ProviderInfo> providers) {
    }

    /**
     * OAuth2授权准备请求。
     *
     * @param providerId 渠道唯一标识
     * @param invitationCode 可选邀请码
     */
    public record PrepareAuthorizationRequest(@NotBlank(message = "第三方登录渠道不能为空") String providerId,
                                              @Size(max = 16, message = "邀请码不能超过16个字符") String invitationCode) {
    }

    /**
     * OAuth2授权准备响应。
     *
     * @param authorizationPath 已验证的授权入口路径
     */
    public record PrepareAuthorizationResponse(String authorizationPath) {
    }

    /**
     * 一次性登录码兑换请求。
     *
     * @param loginCode 一次性登录码
     */
    public record ExchangeLoginCodeRequest(@NotBlank(message = "一次性登录码不能为空") String loginCode) {
    }
}
