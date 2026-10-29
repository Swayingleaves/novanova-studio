package com.novanovastudio.controller;

import com.novanovastudio.common.ApiResponse;
import com.novanovastudio.dto.CommunityDtos;
import com.novanovastudio.security.RequireRole;
import com.novanovastudio.service.CommunityService;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

/**
 * 平台全局社群配置接口。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-29 15:30
 */
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class CommunityController {

    /** 社群配置业务服务。 */
    private final CommunityService service;

    /**
     * 公开读取平台社群配置。
     *
     * @return 按排序值排列的社群名称、图片地址与排序值
     */
    @GetMapping("/community/listCommunityConfigs")
    public Mono<ApiResponse<List<CommunityDtos.CommunityConfig>>> listCommunityConfigs() {
        return service.listConfigs().map(ApiResponse::ok);
    }

    /**
     * 平台管理员整批保存社群配置。
     *
     * @param request 整份社群配置，提交顺序即展示顺序
     * @return 保存结果
     */
    @PostMapping("/admin/community/saveCommunityConfigs")
    @RequireRole("admin")
    public Mono<ApiResponse<String>> saveCommunityConfigs(@RequestBody CommunityDtos.SaveCommunityConfigsRequest request) {
        return service.saveConfigs(request).thenReturn(ApiResponse.ok("ok"));
    }
}
