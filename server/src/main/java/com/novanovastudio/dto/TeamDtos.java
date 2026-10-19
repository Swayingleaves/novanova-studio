package com.novanovastudio.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * 团队管理请求，身份与目标团队均由服务端重新校验。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-18 10:00
 */
public final class TeamDtos {
    /** 禁止实例化。 */
    private TeamDtos() { }

    /**
     * 创建团队并新建主管理员或邀请已有账号。
     * @param name 团队名称，最多50字
     * @param teamSlug 唯一访问标识
     * @param memberLimit 子账号上限
     * @param account 管理员用户名或邮箱
     * @param password 新账号密码，邀请已有账号时为空
     * @param nickname 新账号昵称
     */
    public record CreateTeamRequest(@NotBlank @Size(max = 50, message = "business.teamNameMustNotExceed50Characters") String name,
                                    @NotBlank @Pattern(regexp = "[a-z0-9][a-z0-9-]{2,63}") String teamSlug,
                                    @NotNull @Min(0) Integer memberLimit,
                                    @NotBlank String account, String password, @Size(max = 50) String nickname) { }

    /**
     * 修改团队基本资料。
     * @param name 团队名称，最多50字
     * @param introduction 团队介绍，最多200字，可为空字符串
     * @param logoUrl 团队标志地址，空表示使用平台品牌
     */
    public record UpdateTeamRequest(@NotBlank @Size(max = 50, message = "business.teamNameMustNotExceed50Characters") String name,
                                    @NotNull @Size(max = 200, message = "business.teamIntroductionMustNotExceed200Characters") String introduction,
                                    @NotNull @Size(max = 2000) String logoUrl) { }

    /**
     * 修改团队开关或人数限制。
     * @param teamId 目标团队
     * @param enabled 是否启用
     * @param memberLimit 子账号上限
     */
    public record UpdateTeamSettingsRequest(@NotNull @Min(1) Long teamId, @NotNull Boolean enabled,
                                            @NotNull @Min(0) Integer memberLimit) { }

    /**
     * 新建团队子账号。
     * @param account 用户名或邮箱
     * @param password 密码
     * @param nickname 昵称
     */
    public record CreateMemberRequest(@NotBlank String account, @NotBlank @Size(min = 8, max = 100) String password,
                                      @Size(max = 50) String nickname) { }

    /**
     * 邀请已有用户名或邮箱加入团队。
     * @param account 受邀用户名或邮箱
     */
    public record InviteMemberRequest(@NotBlank String account) { }

    /**
     * 接受或撤销邀请。
     * @param invitationId 邀请标识
     */
    public record InvitationRequest(@NotNull java.util.UUID invitationId) { }

    /**
     * 成员操作。
     * @param userId 目标成员
     * @param enabled 是否启用，仅状态操作使用
     */
    public record MemberRequest(@NotNull Long userId, Boolean enabled) { }

    /**
     * 授予当前团队身份，不修改全局账号角色。
     * @param userId 目标成员标识
     * @param memberRole administrator团队管理员或member普通成员
     */
    public record UpdateMemberRoleRequest(@NotNull @Min(1) Long userId,
                                          @NotBlank @Pattern(regexp = "administrator|member") String memberRole) { }

    /**
     * 显式替换平台资源授权。
     * @param teamId 目标团队
     * @param modelIds 允许使用的平台模型
     * @param objectStorageIds 允许使用的平台对象存储
     */
    public record ResourceGrantsRequest(@NotNull @Min(1) Long teamId, @NotNull List<String> modelIds,
                                        @NotNull List<String> objectStorageIds) { }

    /**
     * 内容模块继承设置。
     * @param moduleName 模块名称
     * @param inheritGlobal 是否实时继承全局
     */
    public record ConfigurationModeRequest(@NotBlank @Pattern(regexp = "prompts|notifications|styles|skills|homepage") String moduleName,
                                            @NotNull Boolean inheritGlobal) { }

    /**
     * 团队可用资源设置。
     * @param resourceType 资源类型
     * @param resourceId 资源标识
     * @param enabled 是否供成员使用
     * @param defaultResource 是否设置为默认
     */
    public record ResourcePreferenceRequest(@NotBlank @Pattern(regexp = "model|objectStorage") String resourceType,
                                            @NotBlank String resourceId, @NotNull Boolean enabled,
                                            @NotNull Boolean defaultResource) { }
}
