package com.novanovastudio.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * @title        UserDtos.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  用户相关DTO
 * @createTime   2026-06-24 11:02:00
 */
public final class UserDtos {

    /**
     * 禁止实例化
     */
    private UserDtos() {
    }

    /**
     * 发送邮箱验证码请求
     *
     * @param email String 邮箱
     */
    public record SendEmailCodeRequest(@NotBlank(message = "邮箱不能为空") String email) {
    }

    /**
     * 邮箱注册请求
     *
     * @param email String 邮箱
     * @param code String 验证码
     * @param password String 密码
     * @param nickname String 昵称
     */
    public record RegisterRequest(@NotBlank(message = "邮箱不能为空") String email,
                                  @NotBlank(message = "验证码不能为空") String code,
                                  @NotBlank(message = "密码不能为空") String password,
                                  String nickname) {
    }

    /**
     * 邮箱登录请求
     *
     * @param email String 邮箱
     * @param password String 密码
     */
    public record LoginRequest(@NotBlank(message = "邮箱不能为空") String email,
                               @NotBlank(message = "密码不能为空") String password) {
    }

    /**
     * 用户公开资料
     *
     * @param id Long 用户ID
     * @param email String 邮箱
     * @param username String 用户名
     * @param nickname String 昵称
     * @param avatar String 头像URL
     * @param role String 角色
     * @param status Integer 状态
     * @param creditBalance Integer 可用积分
     * @param createdAt String 创建时间
     * @param lastLoginAt String 最后登录时间
     * @param welcomeRead boolean 欢迎引导是否已读
     * @param passwordLockedUntil String 密码锁定截止时间，仅管理端列表使用
     */
    public record UserProfile(Long id, String email, String username, String nickname, String avatar, String role, Integer status, Integer creditBalance, String createdAt, String lastLoginAt, boolean welcomeRead, String passwordLockedUntil) {
    }

    /**
     * 更新当前用户基础资料请求。
     *
     * @param username String 用户名
     * @param nickname String 昵称
     * @param avatar String 头像URL
     */
    public record UpdateCurrentUserProfileRequest(@NotBlank(message = "用户名不能为空") @Size(max = 50, message = "用户名不能超过50个字符") String username,
                                                  @Size(max = 50, message = "昵称不能超过50个字符") String nickname,
                                                  @Size(max = 255, message = "头像地址不能超过255个字符") String avatar) {
    }

    /**
     * 修改当前用户密码请求。
     *
     * @param currentPassword String 原密码
     * @param newPassword String 新密码，至少8位
     */
    public record ChangeCurrentUserPasswordRequest(@NotBlank(message = "请输入原密码") String currentPassword,
                                                   @NotBlank(message = "请输入新密码") @Size(min = 8, message = "新密码至少8位") String newPassword) {
    }

    /**
     * 登录响应
     *
     * @param token String Bearer Token
     * @param tokenType String Token类型
     * @param expiresAt String 过期时间
     * @param user UserProfile 用户信息
     */
    public record AuthResponse(String token, String tokenType, String expiresAt, UserProfile user) {
    }

    /**
     * 用户列表响应
     *
     * @param users List<UserProfile> 用户列表
     * @param total long 总数
     */
    public record UserListResponse(List<UserProfile> users, long total) {
    }

    /**
     * 用户统计响应
     *
     * @param totalUsers long 总用户数
     * @param monthlyNewUsers long 本月新增用户数
     * @param dailyNewUsers long 今日新增用户数
     */
    public record UserStatisticsResponse(long totalUsers, long monthlyNewUsers, long dailyNewUsers) {
    }

    /**
     * 更新用户状态请求
     *
     * @param userId Long 用户ID
     * @param status Integer 用户状态
     */
    public record UpdateUserStatusRequest(@NotNull(message = "用户ID不能为空") Long userId,
                                          @NotNull(message = "用户状态不能为空") Integer status) {
    }

    /**
     * 更新用户角色请求
     *
     * @param userId Long 用户ID
     * @param role String 用户角色
     */
    public record UpdateUserRoleRequest(@NotNull(message = "用户ID不能为空") Long userId,
                                        @NotBlank(message = "用户角色不能为空") String role) {
    }

    /**
     * 管理员解除用户密码锁定请求。
     *
     * @param userId Long 用户ID
     */
    public record UnlockUserPasswordRequest(@NotNull(message = "用户ID不能为空") Long userId) {
    }

    /**
     * 管理员新增用户请求
     *
     * @param email String 邮箱
     * @param password String 密码
     * @param nickname String 昵称
     * @param role String 角色
     */
    public record AdminCreateUserRequest(@NotBlank(message = "邮箱不能为空") String email,
                                         @NotBlank(message = "密码不能为空") @Size(min = 8, message = "密码至少8位") String password,
                                         String nickname,
                                         String role) {
    }
}
