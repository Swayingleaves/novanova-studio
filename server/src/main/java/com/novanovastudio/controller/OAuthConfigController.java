package com.novanovastudio.controller;

import com.novanovastudio.common.ApiResponse;
import com.novanovastudio.dto.OAuthConfigDtos;
import com.novanovastudio.security.RequireRole;
import com.novanovastudio.service.OAuthProviderConfigService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

/**
 * 管理后台 OAuth2 第三方登录渠道配置接口。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-09 12:00
 */
@RestController
@RequestMapping("/api/v1/config/oauth")
@RequiredArgsConstructor
@RequireRole("admin")
public class OAuthConfigController {

    /** OAuth2登录渠道配置服务 */
    private final OAuthProviderConfigService oauthProviderConfigService;

    /**
     * 查询内置的 OAuth2 登录渠道配置。
     *
     * @return Mono<ApiResponse<ProviderListResponse>> 渠道配置列表
     */
    @GetMapping("/listOAuthProviders")
    public Mono<ApiResponse<OAuthConfigDtos.ProviderListResponse>> listOAuthProviders() {
        return oauthProviderConfigService.listProviders().map(ApiResponse::ok);
    }

    /**
     * 更新指定 OAuth2 登录渠道配置。
     *
     * @param request UpdateProviderRequest 更新请求
     * @return Mono<ApiResponse<ProviderInfo>> 更新后的渠道配置
     */
    @PostMapping("/updateOAuthProvider")
    public Mono<ApiResponse<OAuthConfigDtos.ProviderInfo>> updateOAuthProvider(@Valid @RequestBody OAuthConfigDtos.UpdateProviderRequest request) {
        return oauthProviderConfigService.updateProvider(request).map(ApiResponse::ok);
    }
}
