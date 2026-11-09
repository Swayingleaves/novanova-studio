package com.novanovastudio.controller;

import com.novanovastudio.common.ApiResponse;
import com.novanovastudio.dto.StandardOAuthConfigDtos;
import com.novanovastudio.security.RequireRole;
import com.novanovastudio.service.StandardOAuthProviderService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

/**
 * 管理后台标准 OAuth2 登录渠道配置接口。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-09 14:30
 */
@RestController
@RequestMapping("/api/v1/config/oauth")
@RequiredArgsConstructor
@RequireRole("admin")
public class StandardOAuthConfigController {

    /** 标准 OAuth2 登录渠道配置服务 */
    private final StandardOAuthProviderService standardOAuthProviderService;

    /**
     * 查询全部标准 OAuth2 登录渠道配置。
     *
     * @return Mono<ApiResponse<ProviderListResponse>> 渠道配置列表
     */
    @GetMapping("/listStandardOAuthProviders")
    public Mono<ApiResponse<StandardOAuthConfigDtos.ProviderListResponse>> listStandardOAuthProviders() {
        return standardOAuthProviderService.listProviders().map(ApiResponse::ok);
    }

    /**
     * 新增标准 OAuth2 登录渠道配置。
     *
     * @param request ProviderRequest 新增请求
     * @return Mono<ApiResponse<ProviderInfo>> 新增后的渠道配置
     */
    @PostMapping("/createStandardOAuthProvider")
    public Mono<ApiResponse<StandardOAuthConfigDtos.ProviderInfo>> createStandardOAuthProvider(
            @Valid @RequestBody StandardOAuthConfigDtos.ProviderRequest request) {
        return standardOAuthProviderService.createProvider(request).map(ApiResponse::ok);
    }

    /**
     * 更新标准 OAuth2 登录渠道配置。
     *
     * @param request ProviderRequest 更新请求
     * @return Mono<ApiResponse<ProviderInfo>> 更新后的渠道配置
     */
    @PostMapping("/updateStandardOAuthProvider")
    public Mono<ApiResponse<StandardOAuthConfigDtos.ProviderInfo>> updateStandardOAuthProvider(
            @Valid @RequestBody StandardOAuthConfigDtos.ProviderRequest request) {
        return standardOAuthProviderService.updateProvider(request).map(ApiResponse::ok);
    }

    /**
     * 删除标准 OAuth2 登录渠道配置。
     *
     * @param request DeleteRequest 删除请求
     * @return Mono<ApiResponse<Void>> 删除完成响应
     */
    @PostMapping("/deleteStandardOAuthProvider")
    public Mono<ApiResponse<Void>> deleteStandardOAuthProvider(
            @Valid @RequestBody StandardOAuthConfigDtos.DeleteRequest request) {
        return standardOAuthProviderService.deleteProvider(request.provider()).thenReturn(ApiResponse.<Void>ok(null));
    }
}
