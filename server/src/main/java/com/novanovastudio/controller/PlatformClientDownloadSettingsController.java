package com.novanovastudio.controller;

import com.novanovastudio.common.ApiResponse;
import com.novanovastudio.dto.ClientDownloadSettingsDtos;
import com.novanovastudio.security.RequireRole;
import com.novanovastudio.service.ClientDownloadSettingsService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

/**
 * 平台客户端下载链接配置接口。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-22 14:35:00
 */
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class PlatformClientDownloadSettingsController {

    /** 客户端下载链接配置业务服务。 */
    private final ClientDownloadSettingsService service;

    /**
     * 公开读取平台客户端下载链接配置。
     *
     * @return Mono<ApiResponse<ClientDownloadSettings>> 客户端下载链接配置
     */
    @GetMapping("/platform/getClientDownloadSettings")
    public Mono<ApiResponse<ClientDownloadSettingsDtos.ClientDownloadSettings>> getClientDownloadSettings() {
        return service.getSettings().map(ApiResponse::ok);
    }

    /**
     * 平台管理员保存客户端下载链接配置。
     *
     * @param request SaveClientDownloadSettingsRequest 保存请求
     * @return Mono<ApiResponse<ClientDownloadSettings>> 保存后的配置
     */
    @PostMapping("/admin/platform/saveClientDownloadSettings")
    @RequireRole("admin")
    public Mono<ApiResponse<ClientDownloadSettingsDtos.ClientDownloadSettings>> saveClientDownloadSettings(
            @RequestBody ClientDownloadSettingsDtos.SaveClientDownloadSettingsRequest request) {
        return service.saveSettings(request).map(ApiResponse::ok);
    }
}
