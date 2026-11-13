package com.novanovastudio.controller;

import com.novanovastudio.common.ApiResponse;
import com.novanovastudio.dto.ExternalLinkDtos;
import com.novanovastudio.security.RequireRole;
import com.novanovastudio.service.ExternalLinkService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

/**
 * 右上角展示外链配置接口。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-13 14:20
 */
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class PlatformExternalLinkController {

    /** 展示外链业务服务。 */
    private final ExternalLinkService service;

    /**
     * 公开读取展示外链配置。
     *
     * @return 标题、链接、说明与 logo 地址，未配置时 data 为空
     */
    @GetMapping("/platform/getExternalLinkConfig")
    public Mono<ApiResponse<ExternalLinkDtos.ExternalLinkConfig>> getExternalLinkConfig() {
        return service.getConfig()
                .map(ApiResponse::ok)
                .defaultIfEmpty(ApiResponse.<ExternalLinkDtos.ExternalLinkConfig>ok(null));
    }

    /**
     * 平台管理员保存展示外链配置。
     *
     * @param request 标题、链接、说明与 logo 地址，标题和链接同时为空表示移除入口
     * @return 保存结果
     */
    @PostMapping("/admin/platform/saveExternalLinkConfig")
    @RequireRole("admin")
    public Mono<ApiResponse<String>> saveExternalLinkConfig(@RequestBody ExternalLinkDtos.SaveExternalLinkConfigRequest request) {
        return service.saveConfig(request).thenReturn(ApiResponse.ok("ok"));
    }
}
