package com.novanovastudio.controller;

import com.novanovastudio.common.ApiResponse;
import com.novanovastudio.dto.OAuth2Dtos;
import com.novanovastudio.dto.UserDtos;
import com.novanovastudio.security.oauth2.ThirdPartyOAuth2Provider;
import com.novanovastudio.security.oauth2.ThirdPartyOAuth2ProviderRegistry;
import com.novanovastudio.service.OAuth2LoginCodeService;
import com.novanovastudio.service.UserService;
import jakarta.validation.Valid;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

/**
 * OAuth2第三方认证接口
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-15 00:00
 */
@RestController
@RequestMapping("/api/v1/auth/oauth")
@RequiredArgsConstructor
public class OAuth2Controller {

    /** 第三方认证渠道注册表 */
    private final ThirdPartyOAuth2ProviderRegistry providerRegistry;

    /** OAuth2一次性登录码服务 */
    private final OAuth2LoginCodeService loginCodeService;

    /** 用户服务 */
    private final UserService userService;

    /**
     * 查询当前启用的第三方登录渠道。
     *
     * @return ApiResponse<ProviderListResponse> 第三方登录渠道列表
     */
    @GetMapping("/listProviders")
    public ApiResponse<OAuth2Dtos.ProviderListResponse> listProviders() {
        List<OAuth2Dtos.ProviderInfo> providers = providerRegistry.enabledProviders().stream()
                .map(this::providerInfo)
                .toList();
        return ApiResponse.ok(new OAuth2Dtos.ProviderListResponse(providers));
    }

    /**
     * 使用一次性登录码兑换本地登录态。
     *
     * @param request ExchangeLoginCodeRequest 一次性登录码请求
     * @return Mono<ApiResponse<AuthResponse>> 本地登录响应
     */
    @PostMapping("/exchangeLoginCode")
    public Mono<ApiResponse<UserDtos.AuthResponse>> exchangeLoginCode(@Valid @RequestBody OAuth2Dtos.ExchangeLoginCodeRequest request) {
        return loginCodeService.consume(request.loginCode())
                .flatMap(userService::loginByUserId)
                .map(ApiResponse::ok);
    }

    /**
     * 转换第三方登录渠道公开信息。
     *
     * @param provider ThirdPartyOAuth2Provider 第三方登录渠道
     * @return ProviderInfo 第三方登录渠道公开信息
     */
    private OAuth2Dtos.ProviderInfo providerInfo(ThirdPartyOAuth2Provider provider) {
        String authorizationPath = "/api/v1/auth/oauth/authorize/" + provider.providerId();
        return new OAuth2Dtos.ProviderInfo(provider.providerId(), provider.displayName(), authorizationPath);
    }
}
