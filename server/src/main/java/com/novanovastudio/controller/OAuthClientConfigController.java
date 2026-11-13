package com.novanovastudio.controller;

import com.novanovastudio.common.ApiResponse;
import com.novanovastudio.dto.OAuthClientConfigDtos;
import com.novanovastudio.security.RequireRole;
import com.novanovastudio.service.OAuthClientConfigService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

/**
 * 管理后台对外 OAuth2 授权客户端配置接口。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-09 18:40
 */
@RestController
@RequestMapping("/api/v1/config/oauth")
@RequiredArgsConstructor
@RequireRole("admin")
public class OAuthClientConfigController {

    /** 对外授权客户端配置服务 */
    private final OAuthClientConfigService oauthClientConfigService;

    /**
     * 查询全部对外授权客户端。
     *
     * @return Mono<ApiResponse<ClientListResponse>> 客户端列表
     */
    @GetMapping("/listOAuthClients")
    public Mono<ApiResponse<OAuthClientConfigDtos.ClientListResponse>> listOAuthClients() {
        return oauthClientConfigService.listClients().map(ApiResponse::ok);
    }

    /**
     * 新增对外授权客户端。
     *
     * @param request CreateClientRequest 新增请求
     * @return Mono<ApiResponse<ClientInfo>> 新增后的客户端
     */
    @PostMapping("/createOAuthClient")
    public Mono<ApiResponse<OAuthClientConfigDtos.ClientInfo>> createOAuthClient(
            @Valid @RequestBody OAuthClientConfigDtos.CreateClientRequest request) {
        return oauthClientConfigService.createClient(request).map(ApiResponse::ok);
    }

    /**
     * 更新对外授权客户端。
     *
     * @param request UpdateClientRequest 更新请求
     * @return Mono<ApiResponse<ClientInfo>> 更新后的客户端
     */
    @PostMapping("/updateOAuthClient")
    public Mono<ApiResponse<OAuthClientConfigDtos.ClientInfo>> updateOAuthClient(
            @Valid @RequestBody OAuthClientConfigDtos.UpdateClientRequest request) {
        return oauthClientConfigService.updateClient(request).map(ApiResponse::ok);
    }

    /**
     * 重新生成对外授权客户端密钥。
     *
     * @param request ClientIdRequest 客户端标识
     * @return Mono<ApiResponse<ClientInfo>> 更新后的客户端
     */
    @PostMapping("/resetOAuthClientSecret")
    public Mono<ApiResponse<OAuthClientConfigDtos.ClientInfo>> resetOAuthClientSecret(
            @Valid @RequestBody OAuthClientConfigDtos.ClientIdRequest request) {
        return oauthClientConfigService.resetSecret(request.clientId()).map(ApiResponse::ok);
    }

    /**
     * 删除对外授权客户端。
     *
     * @param request ClientIdRequest 客户端标识
     * @return Mono<ApiResponse<Void>> 删除完成响应
     */
    @PostMapping("/deleteOAuthClient")
    public Mono<ApiResponse<Void>> deleteOAuthClient(@Valid @RequestBody OAuthClientConfigDtos.ClientIdRequest request) {
        return oauthClientConfigService.deleteClient(request.clientId()).thenReturn(ApiResponse.<Void>ok(null));
    }
}
