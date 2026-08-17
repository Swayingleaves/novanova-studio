package com.novanovastudio.controller;

import com.novanovastudio.common.ApiResponse;
import com.novanovastudio.dto.RuntimeConfigDtos;
import com.novanovastudio.service.RuntimeConfigService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

/**
 * 服务端运行时配置接口。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-08-13 12:00:00
 */
@RestController
@RequestMapping("/api/v1/config")
@RequiredArgsConstructor
public class RuntimeConfigController {

    /** 运行时配置服务。 */
    private final RuntimeConfigService runtimeConfigService;

    /**
     * 查询用户端任务状态轮询配置。
     *
     * @return Mono<ApiResponse<RuntimeConfigDtos.RuntimeConfigResponse>> 运行时配置响应
     */
    @GetMapping("/getRuntimeConfig")
    public Mono<ApiResponse<RuntimeConfigDtos.RuntimeConfigResponse>> getRuntimeConfig() {
        return Mono.fromSupplier(runtimeConfigService::getRuntimeConfig).map(ApiResponse::ok);
    }
}
