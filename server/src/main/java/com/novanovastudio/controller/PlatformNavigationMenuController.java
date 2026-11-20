package com.novanovastudio.controller;

import com.novanovastudio.common.ApiResponse;
import com.novanovastudio.dto.NavigationMenuDtos;
import com.novanovastudio.security.RequireRole;
import com.novanovastudio.service.NavigationMenuService;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

/**
 * 平台全局左侧导航菜单配置接口。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-18 10:55:00
 */
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class PlatformNavigationMenuController {

    /** 导航菜单配置业务服务。 */
    private final NavigationMenuService service;

    /**
     * 公开读取平台全局左侧导航菜单配置。
     *
     * @return 按展示顺序排列的导航菜单开关与排序值列表
     */
    @GetMapping("/platform/listNavigationMenuConfigs")
    public Mono<ApiResponse<List<NavigationMenuDtos.NavigationMenuConfig>>> listNavigationMenuConfigs() {
        return service.listConfigs().map(ApiResponse::ok);
    }

    /**
     * 平台管理员整批保存导航菜单配置。
     *
     * @param request 全量导航菜单配置，数组顺序即展示顺序
     * @return 保存结果
     */
    @PostMapping("/admin/platform/saveNavigationMenuConfigs")
    @RequireRole("admin")
    public Mono<ApiResponse<String>> saveNavigationMenuConfigs(
            @RequestBody NavigationMenuDtos.SaveNavigationMenuConfigsRequest request) {
        return service.saveConfigs(request).thenReturn(ApiResponse.ok("ok"));
    }
}
