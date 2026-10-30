package com.novanovastudio.controller;

import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.common.ApiResponse;
import com.novanovastudio.dto.TeamDtos;
import com.novanovastudio.dto.UserDtos;
import com.novanovastudio.security.RequireRole;
import com.novanovastudio.service.TeamService;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;
import reactor.core.publisher.Mono;

/**
 * 团队管理与成员自助接受邀请接口。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-18 10:00
 */
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class TeamController {
    /** 团队业务服务。 */
    private final TeamService service;

    /** 当前作用域管理员权限。 */
    private final com.novanovastudio.security.AdminGuard adminGuard;

    /** @return 当前管理员可见的无密钥资源目录 */
    @GetMapping("/team/listAvailableResources")
    public Mono<ApiResponse<List<JSONObject>>> listAvailableResources() {
        return adminGuard.requireAdmin().then(service.listAvailableResources()).map(ApiResponse::ok);
    }

    /** @return 当前团队积分变动与资源收入归属明细 */
    @GetMapping("/team/listCreditTransactions")
    public Mono<ApiResponse<List<JSONObject>>> listCreditTransactions() { return service.listCreditTransactions().map(ApiResponse::ok); }

    /**
     * 团队列表。
     * @return 团队列表结果
     */
    @GetMapping("/admin/team/listTeams")
    @RequireRole("admin")
    public Mono<ApiResponse<List<JSONObject>>> listTeams() {
        return service.listTeams().map(ApiResponse::ok);
    }

    /**
     * 创建团队。
     * @param request 请求参数
     * @return 创建团队结果
     */
    @PostMapping("/admin/team/createTeam")
    @RequireRole("admin")
    public Mono<ApiResponse<JSONObject>> createTeam(@Valid @RequestBody TeamDtos.CreateTeamRequest request) {
        return service.createTeam(request).map(ApiResponse::ok);
    }

    /**
     * 设置团队状态与人数。
     * @param request 请求参数
     * @return 设置团队状态与人数结果
     */
    @PostMapping("/admin/team/updateTeamSettings")
    @RequireRole("admin")
    public Mono<ApiResponse<String>> updateTeamSettings(@Valid @RequestBody TeamDtos.UpdateTeamSettingsRequest request) {
        return service.updateSettings(request).thenReturn("ok").map(ApiResponse::ok);
    }

    /**
     * 资源授权列表。
     * @param teamId 查询条件
     * @return 资源授权列表结果
     */
    @GetMapping("/admin/team/listResourceGrants")
    @RequireRole("admin")
    public Mono<ApiResponse<List<JSONObject>>> listResourceGrants(@RequestParam long teamId) {
        return service.listGrants(teamId).map(ApiResponse::ok);
    }

    /**
     * 替换资源授权。
     * @param request 请求参数
     * @return 替换资源授权结果
     */
    @PostMapping("/admin/team/updateResourceGrants")
    @RequireRole("admin")
    public Mono<ApiResponse<String>> updateResourceGrants(@Valid @RequestBody TeamDtos.ResourceGrantsRequest request) {
        return service.updateGrants(request).thenReturn("ok").map(ApiResponse::ok);
    }

    /**
     * 公开团队品牌。
     * @param teamSlug 查询条件
     * @return 公开团队品牌结果
     */
    @GetMapping("/team/getPublicTeam")
    public Mono<ApiResponse<JSONObject>> getPublicTeam(@RequestParam String teamSlug) {
        return service.getPublicTeam(teamSlug).map(ApiResponse::ok);
    }

    /**
     * 本人已加入团队。
     * @return 本人已加入团队结果
     */
    @GetMapping("/team/listMyTeams")
    public Mono<ApiResponse<List<JSONObject>>> listMyTeams() {
        return service.listMyTeams().map(ApiResponse::ok);
    }

    /**
     * 本人待接受邀请。
     * @return 本人待接受邀请结果
     */
    @GetMapping("/team/listMyInvitations")
    public Mono<ApiResponse<List<JSONObject>>> listMyInvitations() {
        return service.listMyInvitations().map(ApiResponse::ok);
    }

    /**
     * 接受本人邀请。
     * @param request 请求参数
     * @return 接受本人邀请结果
     */
    @PostMapping("/team/acceptInvitation")
    public Mono<ApiResponse<JSONObject>> acceptInvitation(@Valid @RequestBody TeamDtos.InvitationRequest request) {
        return service.acceptInvitation(request).map(ApiResponse::ok);
    }

    /**
     * 当前团队概况。
     * @return 当前团队概况结果
     */
    @GetMapping("/team/getTeam")
    public Mono<ApiResponse<JSONObject>> getTeam() {
        return service.getTeam().map(ApiResponse::ok);
    }

    /**
     * 保存团队品牌。
     * @param request 请求参数
     * @return 保存团队品牌结果
     */
    @PostMapping("/team/updateTeam")
    public Mono<ApiResponse<String>> updateTeam(@Valid @RequestBody TeamDtos.UpdateTeamRequest request) {
        return service.updateTeam(request).thenReturn("ok").map(ApiResponse::ok);
    }

    /**
     * 成员及消费汇总。
     * @return 成员及消费汇总结果
     */
    @GetMapping("/team/listMembers")
    public Mono<ApiResponse<List<JSONObject>>> listMembers() {
        return service.listMembers().map(ApiResponse::ok);
    }

    /**
     * 创建团队子账号。
     * @param request 请求参数
     * @return 创建团队子账号结果
     */
    @PostMapping("/team/createMember")
    public Mono<ApiResponse<String>> createMember(@Valid @RequestBody TeamDtos.CreateMemberRequest request) {
        return service.createMember(request).thenReturn("ok").map(ApiResponse::ok);
    }

    /**
     * 邀请用户名或邮箱入团。
     * @param request 请求参数
     * @return 邀请账号入团结果
     */
    @PostMapping("/team/inviteMember")
    public Mono<ApiResponse<UUID>> inviteMember(@Valid @RequestBody TeamDtos.InviteMemberRequest request) {
        return service.inviteMember(request).map(ApiResponse::ok);
    }

    /**
     * 按原目标重新发送团队邀请。
     * @param request 原邀请标识
     * @return 新邀请标识
     */
    @PostMapping("/team/resendInvitation")
    public Mono<ApiResponse<UUID>> resendInvitation(@Valid @RequestBody TeamDtos.InvitationRequest request) {
        return service.resendInvitation(request).map(ApiResponse::ok);
    }

    /**
     * 创建团队重置仍属于本团队的无邮箱普通成员密码。
     * @param request 目标成员与新密码
     * @return 重置完成响应
     */
    @PostMapping("/team/resetMemberPassword")
    public Mono<ApiResponse<String>> resetMemberPassword(@Valid @RequestBody UserDtos.AdminResetPasswordRequest request) {
        return service.resetMemberPassword(request).thenReturn(ApiResponse.ok("ok"));
    }

    /**
     * 当前团队邀请记录。
     * @return 当前团队邀请记录结果
     */
    @GetMapping("/team/listInvitations")
    public Mono<ApiResponse<List<JSONObject>>> listInvitations() {
        return service.listInvitations().map(ApiResponse::ok);
    }

    /**
     * 撤销邀请。
     * @param request 请求参数
     * @return 撤销邀请结果
     */
    @PostMapping("/team/revokeInvitation")
    public Mono<ApiResponse<String>> revokeInvitation(@Valid @RequestBody TeamDtos.InvitationRequest request) {
        return service.revokeInvitation(request).thenReturn("ok").map(ApiResponse::ok);
    }

    /**
     * 更新成员状态。
     * @param request 请求参数
     * @return 更新成员状态结果
     */
    @PostMapping("/team/updateMemberStatus")
    public Mono<ApiResponse<String>> updateMemberStatus(@Valid @RequestBody TeamDtos.MemberRequest request) {
        return service.updateMemberStatus(request).thenReturn("ok").map(ApiResponse::ok);
    }

    /**
     * 修改当前团队成员身份。
     * @param request 目标成员与新身份
     * @return 授权完成响应
     */
    @PostMapping("/team/updateMemberRole")
    public Mono<ApiResponse<String>> updateMemberRole(@Valid @RequestBody TeamDtos.UpdateMemberRoleRequest request) {
        return service.updateMemberRole(request).thenReturn(ApiResponse.ok("ok"));
    }

    /**
     * 移除成员并清理内容。
     * @param request 请求参数
     * @return 移除成员并清理内容结果
     */
    @PostMapping("/team/removeMember")
    public Mono<ApiResponse<String>> removeMember(@Valid @RequestBody TeamDtos.MemberRequest request) {
        return service.removeMember(request).thenReturn("ok").map(ApiResponse::ok);
    }

    /**
     * 内容继承模式。
     * @return 内容继承模式结果
     */
    @GetMapping("/team/listConfigurationModes")
    public Mono<ApiResponse<List<JSONObject>>> listConfigurationModes() {
        return service.listConfigurationModes().map(ApiResponse::ok);
    }

    /**
     * 保存内容继承模式。
     * @param request 请求参数
     * @return 保存内容继承模式结果
     */
    @PostMapping("/team/updateConfigurationMode")
    public Mono<ApiResponse<String>> updateConfigurationMode(@Valid @RequestBody TeamDtos.ConfigurationModeRequest request) {
        return service.updateConfigurationMode(request).thenReturn("ok").map(ApiResponse::ok);
    }

    /**
     * 资源启用与默认设置。
     * @return 资源启用与默认设置结果
     */
    @GetMapping("/team/listResourcePreferences")
    public Mono<ApiResponse<List<JSONObject>>> listResourcePreferences() {
        return service.listResourcePreferences().map(ApiResponse::ok);
    }

    /**
     * 保存资源偏好。
     * @param request 请求参数
     * @return 保存资源偏好结果
     */
    @PostMapping("/team/saveResourcePreference")
    public Mono<ApiResponse<String>> saveResourcePreference(@Valid @RequestBody TeamDtos.ResourcePreferenceRequest request) {
        return service.saveResourcePreference(request).thenReturn("ok").map(ApiResponse::ok);
    }
}
