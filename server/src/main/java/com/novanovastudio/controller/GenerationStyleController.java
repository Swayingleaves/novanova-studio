package com.novanovastudio.controller;

import com.novanovastudio.common.ApiResponse;
import com.novanovastudio.dto.GenerationStyleDtos;
import com.novanovastudio.security.AdminGuard;
import com.novanovastudio.security.RequireRole;
import com.novanovastudio.service.GenerationStyleService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

/**
 * 图片和视频生成风格接口。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-31 00:00
 */
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class GenerationStyleController {

    /** 风格服务。 */
    private final GenerationStyleService generationStyleService;
    /** 管理员权限校验。 */
    private final AdminGuard adminGuard;

    /**
     * 查询用户侧启用风格。
     *
     * @param generationType 生成类型
     * @return 用户侧风格列表
     */
    @GetMapping("/style/listStyles")
    public Mono<ApiResponse<GenerationStyleDtos.StyleOptionListResponse>> listStyles(
            @RequestParam String generationType) {
        return generationStyleService.listUserStyles(generationType).map(ApiResponse::ok);
    }

    /**
     * 查询管理端风格。
     *
     * @param keyword 关键词
     * @param generationType 生成类型
     * @param status 状态
     * @param page 页码
     * @param pageSize 每页数量
     * @return 管理端风格列表
     */
    @GetMapping("/admin/style/listStyles")
    @RequireRole("admin")
    public Mono<ApiResponse<GenerationStyleDtos.StyleListResponse>> listAdminStyles(
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) String generationType,
            @RequestParam(required = false) Integer status,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize) {
        return adminGuard.requireAdmin()
                .then(generationStyleService.listAdminStyles(new GenerationStyleDtos.StyleListRequest(keyword, generationType, status, page, pageSize)))
                .map(ApiResponse::ok);
    }

    /** 创建风格。 */
    @PostMapping("/admin/style/createStyle")
    @RequireRole("admin")
    public Mono<ApiResponse<String>> createStyle(@Valid @RequestBody GenerationStyleDtos.CreateStyleRequest request) {
        return adminGuard.requireAdmin().then(generationStyleService.createStyle(request)).thenReturn(ApiResponse.ok("ok"));
    }

    /** 更新风格。 */
    @PostMapping("/admin/style/updateStyle")
    @RequireRole("admin")
    public Mono<ApiResponse<String>> updateStyle(@Valid @RequestBody GenerationStyleDtos.UpdateStyleRequest request) {
        return adminGuard.requireAdmin().then(generationStyleService.updateStyle(request)).thenReturn(ApiResponse.ok("ok"));
    }

    /** 更新风格启用状态。 */
    @PostMapping("/admin/style/updateStyleStatus")
    @RequireRole("admin")
    public Mono<ApiResponse<String>> updateStyleStatus(@Valid @RequestBody GenerationStyleDtos.UpdateStyleStatusRequest request) {
        return adminGuard.requireAdmin().then(generationStyleService.updateStyleStatus(request)).thenReturn(ApiResponse.ok("ok"));
    }

    /** 批量软删除风格。 */
    @PostMapping("/admin/style/deleteStyles")
    @RequireRole("admin")
    public Mono<ApiResponse<String>> deleteStyles(@Valid @RequestBody GenerationStyleDtos.DeleteStylesRequest request) {
        return adminGuard.requireAdmin().then(generationStyleService.deleteStyles(request)).thenReturn(ApiResponse.ok("ok"));
    }
}
