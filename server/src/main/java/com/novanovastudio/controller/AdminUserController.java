package com.novanovastudio.controller;

import com.novanovastudio.common.ApiResponse;
import com.novanovastudio.dto.CreditDtos;
import com.novanovastudio.dto.UserDtos;
import com.novanovastudio.security.AdminGuard;
import com.novanovastudio.security.RequireRole;
import com.novanovastudio.service.UserService;
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
 * @title        AdminUserController.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  响应式管理员用户接口
 * @createTime   2026-06-24 18:45:00
 */
@RestController
@RequestMapping("/api/v1/admin/user")
@RequiredArgsConstructor
@RequireRole("admin")
public class AdminUserController {

    /** 用户服务 */
    private final UserService userService;

    /** 管理员校验 */
    private final AdminGuard adminGuard;

    /**
     * 查询用户列表（支持搜索和筛选）
     *
     * @param page int 页码
     * @param pageSize int 每页数量
     * @param keyword String 搜索关键字（模糊匹配昵称、用户名和邮箱）
     * @param userId Long 用户ID（精确匹配）
     * @param role String 角色筛选
     * @param status Integer 状态筛选
     * @param createdAfter String 创建时间起始
     * @param createdBefore String 创建时间截止
     * @return Mono<ApiResponse<UserListResponse>> 用户列表
     */
    @GetMapping("/listUsers")
    public Mono<ApiResponse<UserDtos.UserListResponse>> listUsers(@RequestParam(defaultValue = "1") int page,
                                                                   @RequestParam(defaultValue = "20") int pageSize,
                                                                   @RequestParam(required = false) String keyword,
                                                                   @RequestParam(required = false) Long userId,
                                                                   @RequestParam(required = false) String role,
                                                                   @RequestParam(required = false) Integer status,
                                                                   @RequestParam(required = false) String createdAfter,
                                                                   @RequestParam(required = false) String createdBefore) {
        return adminGuard.requireAdmin()
                .then(userService.listUsers(page, pageSize, keyword, userId, role, status, createdAfter, createdBefore))
                .map(ApiResponse::ok);
    }

    /**
     * 新增用户
     *
     * @param request AdminCreateUserRequest 请求
     * @return Mono<ApiResponse<String>> 响应
     */
    @PostMapping("/createUser")
    public Mono<ApiResponse<String>> createUser(@Valid @RequestBody UserDtos.AdminCreateUserRequest request) {
        return adminGuard.requireAdmin().then(userService.adminCreateUser(request)).thenReturn(ApiResponse.ok("ok"));
    }

    /**
     * 更新用户状态
     *
     * @param request UpdateUserStatusRequest 请求
     * @return Mono<ApiResponse<String>> 响应
     */
    @PostMapping("/updateUserStatus")
    public Mono<ApiResponse<String>> updateUserStatus(@Valid @RequestBody UserDtos.UpdateUserStatusRequest request) {
        return adminGuard.requireAdmin().then(userService.updateUserStatus(request)).thenReturn(ApiResponse.ok("ok"));
    }

    /**
     * 更新用户角色
     *
     * @param request UpdateUserRoleRequest 请求
     * @return Mono<ApiResponse<String>> 响应
     */
    @PostMapping("/updateUserRole")
    public Mono<ApiResponse<String>> updateUserRole(@Valid @RequestBody UserDtos.UpdateUserRoleRequest request) {
        return adminGuard.requireAdmin().then(userService.updateUserRole(request)).thenReturn(ApiResponse.ok("ok"));
    }

    /**
     * 管理员调整用户积分。
     *
     * @param request AdjustUserCreditsRequest 积分调整请求
     * @return Mono<ApiResponse<CreditBalanceResponse>> 调整后的积分余额
     */
    @PostMapping("/adjustUserCredits")
    public Mono<ApiResponse<CreditDtos.CreditBalanceResponse>> adjustUserCredits(@Valid @RequestBody CreditDtos.AdjustUserCreditsRequest request) {
        return adminGuard.requireAdmin().then(userService.adjustUserCredits(request)).map(ApiResponse::ok);
    }

    /**
     * 管理员解除用户密码锁定。
     *
     * @param request UnlockUserPasswordRequest 解锁请求
     * @return Mono<ApiResponse<String>> 操作结果
     */
    @PostMapping("/unlockUserPassword")
    public Mono<ApiResponse<String>> unlockUserPassword(@Valid @RequestBody UserDtos.UnlockUserPasswordRequest request) {
        return adminGuard.requireAdmin().then(userService.unlockUserPassword(request)).thenReturn(ApiResponse.ok("ok"));
    }
}
