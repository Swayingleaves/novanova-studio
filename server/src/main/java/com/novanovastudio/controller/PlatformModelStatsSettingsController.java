package com.novanovastudio.controller;

import com.novanovastudio.common.ApiResponse;
import com.novanovastudio.dto.ModelStatsDtos;
import com.novanovastudio.security.RequireRole;
import com.novanovastudio.service.ModelSuccessRateService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

/**
 * 平台模型调用成功率统计配置接口。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-24 09:25:00
 */
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class PlatformModelStatsSettingsController {

    /** 模型成功率统计与配置服务。 */
    private final ModelSuccessRateService service;

    /**
     * 平台管理员读取模型成功率统计天数配置。
     *
     * @return Mono<ApiResponse<ModelStatsSettings>> 统计配置
     */
    @GetMapping("/admin/platform/getModelStatsSettings")
    @RequireRole("admin")
    public Mono<ApiResponse<ModelStatsDtos.ModelStatsSettings>> getModelStatsSettings() {
        return service.getAdminSettings().map(ApiResponse::ok);
    }

    /**
     * 平台管理员保存模型成功率统计天数配置。
     *
     * @param request SaveModelStatsSettingsRequest 保存请求
     * @return Mono<ApiResponse<ModelStatsSettings>> 保存后的统计配置
     */
    @PostMapping("/admin/platform/saveModelStatsSettings")
    @RequireRole("admin")
    public Mono<ApiResponse<ModelStatsDtos.ModelStatsSettings>> saveModelStatsSettings(
            @Valid @RequestBody ModelStatsDtos.SaveModelStatsSettingsRequest request) {
        return service.saveSettings(request).map(ApiResponse::ok);
    }
}
