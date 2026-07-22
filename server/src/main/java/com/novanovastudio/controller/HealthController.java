package com.novanovastudio.controller;

import com.novanovastudio.common.ApiResponse;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

/**
 * @title        HealthController.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  响应式健康检查接口
 * @createTime   2026-06-24 18:45:00
 */
@RestController
@RequestMapping("/api/v1")
public class HealthController {

    /**
     * 查询服务健康状态
     *
     * @return Mono<ApiResponse<String>> 健康状态
     */
    @GetMapping("/health")
    public Mono<ApiResponse<String>> health() {
        return Mono.just(ApiResponse.ok("ok"));
    }
}
