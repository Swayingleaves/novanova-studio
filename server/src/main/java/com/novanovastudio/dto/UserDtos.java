package com.novanovastudio.dto;

import com.alibaba.fastjson2.annotation.JSONField;
import com.novanovastudio.common.CreditAmountWriter;
import java.math.BigDecimal;

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
    public record SendEmailCodeRequest(@NotBlank(message = "business.emailIsRequired") String email) {
    }

    /**
     * 邮箱注册请求
     *
     * @param email String 邮箱
     * @param code String 验证码
     * @param password String 密码
     * @param nickname String 昵称
     * @param invitationCode String 可选邀请码
     */
    public record RegisterRequest(@NotBlank(message = "business.emailIsRequired") String email,
                                  @NotBlank(message = "business.verificationCodeIsRequired") String code,
                                  @NotBlank(message = "business.passwordIsRequired") String password,
                                  String nickname,
                                  @Size(max = 16, message = "business.invitationCodeMustNotExceed16Characters") String invitationCode) {
    }

    /**
     * 用户名或邮箱密码登录请求
     *
     * @param account String 用户名或邮箱
     * @param password String 密码
     */
    public record LoginRequest(@NotBlank(message = "business.accountIsRequired") String account,
                               @NotBlank(message = "business.passwordIsRequired") String password) {
    }

    /**
     * 请求重置密码邮件。
     *
     * @param email String 邮箱
     */
    public record RequestPasswordResetRequest(@NotBlank(message = "business.emailIsRequired") String email) {
    }

    /**
     * 使用重置链接设置新密码。
     *
     * @param token String 一次性重置令牌
     * @param newPassword String 新密码，至少8位
     */
    public record ResetPasswordRequest(@NotBlank(message = "business.resetLinkIsRequired") String token,
                                       @NotBlank(message = "business.enterANewPassword") @Size(min = 8, message = "business.newPasswordNeedsAtLeast8Characters") String newPassword) {
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
     * @param canResetPassword 当前管理入口是否可重置无邮箱账号密码
     */
    public record UserProfile(Long id, String email, String username, String nickname, String avatar, String role, Integer status, @jakarta.validation.constraints.Digits(integer = 18, fraction = 6) @JSONField(serializeUsing = CreditAmountWriter.class) BigDecimal creditBalance, String createdAt, String lastLoginAt, boolean welcomeRead, String passwordLockedUntil, boolean canResetPassword) {
    }

    /**
     * 更新当前用户基础资料请求。
     *
     * @param username String 用户名
     * @param nickname String 昵称
     * @param avatar String 头像URL
     */
    public record UpdateCurrentUserProfileRequest(@NotBlank(message = "business.usernameIsRequired") @Size(max = 50, message = "business.usernameMustNotExceed50Characters") String username,
                                                  @Size(max = 50, message = "business.displayNameMustNotExceed50Characters") String nickname,
                                                  @Size(max = 255, message = "business.avatarURLMustNotExceed255Characters") String avatar) {
    }

    /**
     * 修改当前用户密码请求。
     *
     * @param currentPassword String 原密码
     * @param newPassword String 新密码，至少8位
     */
    public record ChangeCurrentUserPasswordRequest(@NotBlank(message = "business.enterCurrentPassword") String currentPassword,
                                                   @NotBlank(message = "business.enterANewPassword") @Size(min = 8, message = "business.newPasswordNeedsAtLeast8Characters") String newPassword) {
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
     * 用户增长趋势单日数据
     *
     * @param date String 日期（yyyy-MM-dd，按统计时区）
     * @param newUsers long 当日新增用户数
     * @param totalUsers long 截至当日结束的累计用户数
     */
    public record UserTrendPoint(String date, long newUsers, long totalUsers) {
    }

    /**
     * 用户增长趋势响应
     *
     * @param startDate String 统计开始日期
     * @param endDate String 统计结束日期
     * @param totalUsers long 截至结束日期的累计用户数
     * @param newUsers long 统计区间内新增用户数
     * @param points List<UserTrendPoint> 每日用户数量与增量
     */
    public record UserTrendResponse(String startDate, String endDate, long totalUsers, long newUsers, List<UserTrendPoint> points) {
    }

    /**
     * 更新用户状态请求
     *
     * @param userId Long 用户ID
     * @param status Integer 用户状态
     */
    public record UpdateUserStatusRequest(@NotNull(message = "business.userIDIsRequired") Long userId,
                                          @NotNull(message = "business.userStatusIsRequired") Integer status) {
    }

    /**
     * 更新用户角色请求
     *
     * @param userId Long 用户ID
     * @param role String 用户角色
     */
    public record UpdateUserRoleRequest(@NotNull(message = "business.userIDIsRequired") Long userId,
                                        @NotBlank(message = "business.userRoleIsRequired") String role) {
    }

    /**
     * 管理员解除用户密码锁定请求。
     *
     * @param userId Long 用户ID
     */
    public record UnlockUserPasswordRequest(@NotNull(message = "business.userIDIsRequired") Long userId) {
    }

    /**
     * 管理员重置无邮箱账号密码请求。
     * @param userId 目标账号标识
     * @param newPassword 新密码，至少八位
     */
    public record AdminResetPasswordRequest(@NotNull Long userId,
                                            @NotBlank @Size(min = 8) String newPassword) { }

    /**
     * 管理员新增用户请求
     *
     * @param account String 用户名或邮箱
     * @param password String 密码
     * @param nickname String 昵称
     * @param role String 角色
     */
    public record AdminCreateUserRequest(@NotBlank(message = "business.accountIsRequired") String account,
                                         @NotBlank(message = "business.passwordIsRequired") @Size(min = 8, message = "business.passwordNeedsAtLeast8Characters") String password,
                                         @Size(max = 50, message = "business.displayNameMustNotExceed50Characters") String nickname,
                                         String role) {
    }
}
