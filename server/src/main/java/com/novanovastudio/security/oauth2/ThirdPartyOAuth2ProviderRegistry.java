package com.novanovastudio.security.oauth2;

import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 第三方OAuth2认证渠道注册表
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-15 00:00
 */
@Component
@RequiredArgsConstructor
public class ThirdPartyOAuth2ProviderRegistry {

    /** 已注册的第三方认证渠道 */
    private final List<ThirdPartyOAuth2Provider> providers;

    /**
     * 按渠道标识查询认证渠道实现。
     *
     * @param providerId String 渠道唯一标识
     * @return Optional<ThirdPartyOAuth2Provider> 认证渠道实现，不存在时为空
     */
    public Optional<ThirdPartyOAuth2Provider> find(String providerId) {
        return providers.stream().filter(provider -> provider.providerId().equals(providerId)).findFirst();
    }

    /**
     * 查询指定且已启用的认证渠道。
     *
     * @param providerId String 渠道唯一标识
     * @return ThirdPartyOAuth2Provider 认证渠道实现
     * @throws OAuth2LoginException 渠道不存在或未启用时抛出
     */
    public ThirdPartyOAuth2Provider requireEnabled(String providerId) {
        return find(providerId)
                .filter(ThirdPartyOAuth2Provider::enabled)
                .orElseThrow(() -> new OAuth2LoginException("providerUnavailable", "第三方登录渠道未启用"));
    }

    /**
     * 查询全部已启用认证渠道。
     *
     * @return List<ThirdPartyOAuth2Provider> 已启用认证渠道
     */
    public List<ThirdPartyOAuth2Provider> enabledProviders() {
        return providers.stream().filter(ThirdPartyOAuth2Provider::enabled).toList();
    }
}
