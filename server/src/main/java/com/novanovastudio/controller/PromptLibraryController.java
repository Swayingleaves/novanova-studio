package com.novanovastudio.controller;

import com.novanovastudio.common.ApiResponse;
import com.novanovastudio.dto.PromptLibraryDtos;
import com.novanovastudio.security.AdminGuard;
import com.novanovastudio.security.RequireRole;
import com.novanovastudio.service.PromptLibraryService;
import jakarta.validation.Valid;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

/**
 * @title        PromptLibraryController.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  提示词库接口
 * @createTime   2026-06-29 22:35:00
 */
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class PromptLibraryController {

    /** 提示词库服务 */
    private final PromptLibraryService promptLibraryService;

    /** 管理员校验 */
    private final AdminGuard adminGuard;

    /**
     * 用户侧查询提示词列表。
     *
     * @param keyword String 关键词
     * @param tag List<String> 标签列表
     * @param category String 分类
     * @param page int 页码
     * @param pageSize int 每页数量
     * @return Mono<ApiResponse<PromptListResponse>> 提示词列表
     */
    @GetMapping("/prompt/listPrompts")
    public Mono<ApiResponse<PromptLibraryDtos.PromptListResponse>> listPrompts(@RequestParam(required = false) String keyword,
                                                                                @RequestParam(required = false) List<String> tag,
                                                                                @RequestParam(required = false) String category,
                                                                                @RequestParam(defaultValue = "1") int page,
                                                                                @RequestParam(defaultValue = "20") int pageSize) {
        return promptLibraryService.listUserPrompts(new PromptLibraryDtos.PromptListRequest(keyword, tag, category, null, page, pageSize))
                .map(ApiResponse::ok);
    }

    /**
     * 管理端查询提示词列表。
     *
     * @param keyword String 关键词
     * @param tag List<String> 标签列表
     * @param category String 分类
     * @param status Integer 状态
     * @param page int 页码
     * @param pageSize int 每页数量
     * @return Mono<ApiResponse<PromptListResponse>> 提示词列表
     */
    @GetMapping("/admin/prompt/listPrompts")
    @RequireRole("admin")
    public Mono<ApiResponse<PromptLibraryDtos.PromptListResponse>> listAdminPrompts(@RequestParam(required = false) String keyword,
                                                                                     @RequestParam(required = false) List<String> tag,
                                                                                     @RequestParam(required = false) String category,
                                                                                     @RequestParam(required = false) Integer status,
                                                                                     @RequestParam(defaultValue = "1") int page,
                                                                                     @RequestParam(defaultValue = "20") int pageSize) {
        return adminGuard.requireAdmin()
                .then(promptLibraryService.listAdminPrompts(new PromptLibraryDtos.PromptListRequest(keyword, tag, category, status, page, pageSize)))
                .map(ApiResponse::ok);
    }

    /**
     * 管理端创建提示词。
     *
     * @param request CreatePromptRequest 创建请求
     * @return Mono<ApiResponse<String>> 响应
     */
    @PostMapping("/admin/prompt/createPrompt")
    @RequireRole("admin")
    public Mono<ApiResponse<String>> createPrompt(@Valid @RequestBody PromptLibraryDtos.CreatePromptRequest request) {
        return adminGuard.requireAdmin()
                .then(promptLibraryService.createPrompt(request))
                .thenReturn(ApiResponse.ok("ok"));
    }

    /**
     * 管理端更新提示词。
     *
     * @param request UpdatePromptRequest 更新请求
     * @return Mono<ApiResponse<String>> 响应
     */
    @PostMapping("/admin/prompt/updatePrompt")
    @RequireRole("admin")
    public Mono<ApiResponse<String>> updatePrompt(@Valid @RequestBody PromptLibraryDtos.UpdatePromptRequest request) {
        return adminGuard.requireAdmin()
                .then(promptLibraryService.updatePrompt(request))
                .thenReturn(ApiResponse.ok("ok"));
    }

    /**
     * 管理端更新提示词状态。
     *
     * @param request UpdatePromptStatusRequest 状态请求
     * @return Mono<ApiResponse<String>> 响应
     */
    @PostMapping("/admin/prompt/updatePromptStatus")
    @RequireRole("admin")
    public Mono<ApiResponse<String>> updatePromptStatus(@Valid @RequestBody PromptLibraryDtos.UpdatePromptStatusRequest request) {
        return adminGuard.requireAdmin()
                .then(promptLibraryService.updatePromptStatus(request))
                .thenReturn(ApiResponse.ok("ok"));
    }

    /**
     * 管理端删除提示词。
     *
     * @param request DeletePromptsRequest 删除请求
     * @return Mono<ApiResponse<String>> 响应
     */
    @PostMapping("/admin/prompt/deletePrompts")
    @RequireRole("admin")
    public Mono<ApiResponse<String>> deletePrompts(@Valid @RequestBody PromptLibraryDtos.DeletePromptsRequest request) {
        return adminGuard.requireAdmin()
                .then(promptLibraryService.deletePrompts(request))
                .thenReturn(ApiResponse.ok("ok"));
    }
}
