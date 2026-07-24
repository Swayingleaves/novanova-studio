package com.novanovastudio.controller;

import com.novanovastudio.common.ApiResponse;
import com.novanovastudio.dto.UserDtos;
import com.novanovastudio.security.AuthenticationRateLimitService;
import com.novanovastudio.service.UserService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.http.server.reactive.ServerHttpRequest;
import reactor.core.publisher.Mono;

/**
 * @title        AuthController.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  响应式认证接口
 * @createTime   2026-06-24 18:45:00
 */
@RestController
@RequestMapping("/api/v1/auth")
@RequiredArgsConstructor
public class AuthController {

    /** 用户服务 */
    private final UserService userService;

    /** 认证接口限流服务 */
    private final AuthenticationRateLimitService authenticationRateLimitService;

    /**
     * 发送邮箱验证码
     *
     * @param request SendEmailCodeRequest 请求
     * @param httpRequest ServerHttpRequest HTTP请求
     * @return Mono<ApiResponse<String>> 响应
     */
    @PostMapping("/sendEmailCode")
    public Mono<ApiResponse<String>> sendEmailCode(@Valid @RequestBody UserDtos.SendEmailCodeRequest request, ServerHttpRequest httpRequest) {
        return authenticationRateLimitService.checkEmailCode(httpRequest, request.email())
                .then(userService.sendEmailCode(request))
                .thenReturn(ApiResponse.ok("ok"));
    }

    /**
     * 邮箱注册
     *
     * @param request RegisterRequest 注册请求
     * @return Mono<ApiResponse<AuthResponse>> 登录响应
     */
    @PostMapping("/register")
    public Mono<ApiResponse<UserDtos.AuthResponse>> register(@Valid @RequestBody UserDtos.RegisterRequest request) {
        return userService.register(request).map(ApiResponse::ok);
    }

    /**
     * 邮箱登录
     *
     * @param request LoginRequest 登录请求
     * @param httpRequest ServerHttpRequest HTTP请求
     * @return Mono<ApiResponse<AuthResponse>> 登录响应
     */
    @PostMapping("/login")
    public Mono<ApiResponse<UserDtos.AuthResponse>> login(@Valid @RequestBody UserDtos.LoginRequest request, ServerHttpRequest httpRequest) {
        return authenticationRateLimitService.checkLogin(httpRequest)
                .then(userService.login(request))
                .map(ApiResponse::ok);
    }

    /**
     * 退出登录
     *
     * @return Mono<ApiResponse<String>> 响应
     */
    @PostMapping("/logout")
    public Mono<ApiResponse<String>> logout() {
        return Mono.just(ApiResponse.ok("ok"));
    }

    /**
     * 标记当前用户已阅读欢迎引导。
     *
     * @return Mono<ApiResponse<String>> 操作响应
     */
    @PostMapping("/acknowledgeWelcome")
    public Mono<ApiResponse<String>> acknowledgeWelcome() {
        return userService.acknowledgeWelcome().thenReturn(ApiResponse.ok("ok"));
    }

    /**
     * 查询当前用户信息
     *
     * @return Mono<ApiResponse<UserProfile>> 当前用户
     */
    @GetMapping("/userInfo")
    public Mono<ApiResponse<UserDtos.UserProfile>> userInfo() {
        return userService.userInfo().map(ApiResponse::ok);
    }

    /**
     * 更新当前用户基础资料。
     *
     * @param request UpdateCurrentUserProfileRequest 用户资料请求
     * @return Mono<ApiResponse<UserProfile>> 更新后的用户资料
     */
    @PostMapping("/updateUserProfile")
    public Mono<ApiResponse<UserDtos.UserProfile>> updateUserProfile(@Valid @RequestBody UserDtos.UpdateCurrentUserProfileRequest request) {
        return userService.updateCurrentUserProfile(request).map(ApiResponse::ok);
    }

    /**
     * 修改当前用户密码。
     *
     * @param request ChangeCurrentUserPasswordRequest 修改密码请求
     * @return Mono<ApiResponse<String>> 操作响应
     */
    @PostMapping("/changePassword")
    public Mono<ApiResponse<String>> changePassword(@Valid @RequestBody UserDtos.ChangeCurrentUserPasswordRequest request) {
        return userService.changeCurrentUserPassword(request).thenReturn(ApiResponse.ok("ok"));
    }
}
