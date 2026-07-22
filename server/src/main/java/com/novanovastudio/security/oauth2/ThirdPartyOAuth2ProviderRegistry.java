package com.novanovastudio.security.oauth2;

import java.util.List;
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
     * 查询指定且已启用的认证渠道。
     *
     * @param providerId String 渠道唯一标识
     * @return ThirdPartyOAuth2Provider 认证渠道实现
     * @throws OAuth2LoginException 渠道不存在或未启用时抛出
     */
    public ThirdPartyOAuth2Provider requireEnabled(String providerId) {
        return providers.stream()
                .filter(provider -> provider.enabled() && provider.providerId().equals(providerId))
                .findFirst()
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
