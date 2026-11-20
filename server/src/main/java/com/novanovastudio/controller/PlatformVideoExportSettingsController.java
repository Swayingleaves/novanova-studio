package com.novanovastudio.controller;

import com.novanovastudio.common.ApiResponse;
import com.novanovastudio.dto.VideoExportSettingsDtos;
import com.novanovastudio.security.RequireRole;
import com.novanovastudio.service.VideoExportSettingsService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

/**
 * 平台漫剧视觉分镜板导出视频开关配置接口。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-19 21:55:00
 */
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class PlatformVideoExportSettingsController {

    /** 导出视频开关配置业务服务。 */
    private final VideoExportSettingsService service;

    /**
     * 公开读取平台漫剧视觉分镜板导出视频开关配置。
     *
     * @return Mono<ApiResponse<VideoExportSettings>> 导出视频开关配置
     */
    @GetMapping("/platform/getVideoExportSettings")
    public Mono<ApiResponse<VideoExportSettingsDtos.VideoExportSettings>> getVideoExportSettings() {
        return service.getSettings().map(ApiResponse::ok);
    }

    /**
     * 平台管理员保存漫剧视觉分镜板导出视频开关配置。
     *
     * @param request SaveVideoExportSettingsRequest 保存请求
     * @return Mono<ApiResponse<VideoExportSettings>> 保存后的配置
     */
    @PostMapping("/admin/platform/saveVideoExportSettings")
    @RequireRole("admin")
    public Mono<ApiResponse<VideoExportSettingsDtos.VideoExportSettings>> saveVideoExportSettings(
            @Valid @RequestBody VideoExportSettingsDtos.SaveVideoExportSettingsRequest request) {
        return service.saveSettings(request).map(ApiResponse::ok);
    }
}
