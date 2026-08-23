package com.novanovastudio.controller;

import com.novanovastudio.common.ApiResponse;
import com.novanovastudio.dto.ApiAccessLogDtos;
import com.novanovastudio.security.AdminGuard;
import com.novanovastudio.security.RequireRole;
import com.novanovastudio.service.ApiAccessLogService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

/**
 * @title        AdminApiLogController.java
 * @description  响应式管理员接口访问日志接口
 * @createTime   2026-08-23
 */
@RestController
@RequestMapping("/api/v1/admin/apiLog")
@RequiredArgsConstructor
@RequireRole("admin")
public class AdminApiLogController {

    /** 接口访问日志服务 */
    private final ApiAccessLogService apiAccessLogService;

    /** 管理员校验 */
    private final AdminGuard adminGuard;

    /**
     * 查询接口访问日志列表（支持关键字与结果筛选）。
     *
     * @param page     int 页码
     * @param pageSize int 每页数量
     * @param keyword  String 关键字（匹配 IP / 路径 / 用户 ID）
     * @param result   String 结果筛选 success / error
     * @return Mono<ApiResponse<ApiAccessLogListResponse>> 日志列表
     */
    @GetMapping("/listApiLogs")
    public Mono<ApiResponse<ApiAccessLogDtos.ApiAccessLogListResponse>> listApiLogs(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize,
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) String result) {
        return adminGuard.requireAdmin()
                .then(apiAccessLogService.listLogs(page, pageSize, keyword, result))
                .map(ApiResponse::ok);
    }
}
