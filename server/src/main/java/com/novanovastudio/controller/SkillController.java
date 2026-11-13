package com.novanovastudio.controller;

import com.novanovastudio.common.ApiResponse;
import com.novanovastudio.dto.SkillDtos;
import com.novanovastudio.security.AdminGuard;
import com.novanovastudio.security.RequireRole;
import com.novanovastudio.service.SkillService;
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
 * 图片和视频生成技能接口。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-08-27 00:00
 */
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class SkillController {

    /** 技能服务。 */
    private final SkillService skillService;
    /** 管理员权限校验。 */
    private final AdminGuard adminGuard;

    /**
     * 查询用户侧启用技能。
     *
     * @param targetType 适用生成类型
     * @return 用户侧技能列表
     */
    @GetMapping("/skill/listSkills")
    public Mono<ApiResponse<SkillDtos.SkillOptionListResponse>> listSkills(
            @RequestParam String targetType) {
        return skillService.listUserSkills(targetType).map(ApiResponse::ok);
    }

    /**
     * 查询管理端技能。
     *
     * @param keyword 关键词
     * @param targetType 适用生成类型
     * @param status 状态
     * @param page 页码
     * @param pageSize 每页数量
     * @return 管理端技能列表
     */
    @GetMapping("/admin/skill/listSkills")
    @RequireRole("admin")
    public Mono<ApiResponse<SkillDtos.SkillListResponse>> listAdminSkills(
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) String targetType,
            @RequestParam(required = false) Integer status,
            @RequestParam(required = false) String reviewStatus,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize) {
        return adminGuard.requireAdmin()
                .then(skillService.listAdminSkills(new SkillDtos.SkillListRequest(keyword, targetType, status, page, pageSize, reviewStatus)))
                .map(ApiResponse::ok);
    }

    /** 创建技能。 */
    @PostMapping("/admin/skill/createSkill")
    @RequireRole("admin")
    public Mono<ApiResponse<String>> createSkill(@Valid @RequestBody SkillDtos.CreateSkillRequest request) {
        return adminGuard.requireAdmin().then(skillService.createSkill(request)).thenReturn(ApiResponse.ok("ok"));
    }

    /** 更新技能。 */
    @PostMapping("/admin/skill/updateSkill")
    @RequireRole("admin")
    public Mono<ApiResponse<String>> updateSkill(@Valid @RequestBody SkillDtos.UpdateSkillRequest request) {
        return adminGuard.requireAdmin().then(skillService.updateSkill(request)).thenReturn(ApiResponse.ok("ok"));
    }

    /** 更新技能启用状态。 */
    @PostMapping("/admin/skill/updateSkillStatus")
    @RequireRole("admin")
    public Mono<ApiResponse<String>> updateSkillStatus(@Valid @RequestBody SkillDtos.UpdateSkillStatusRequest request) {
        return adminGuard.requireAdmin().then(skillService.updateSkillStatus(request)).thenReturn(ApiResponse.ok("ok"));
    }

    /** 批量软删除技能。 */
    @PostMapping("/admin/skill/deleteSkills")
    @RequireRole("admin")
    public Mono<ApiResponse<String>> deleteSkills(@Valid @RequestBody SkillDtos.DeleteSkillsRequest request) {
        return adminGuard.requireAdmin().then(skillService.deleteSkills(request)).thenReturn(ApiResponse.ok("ok"));
    }

    /** 审核用户提交的技能。 */
    @PostMapping("/admin/skill/reviewSkill")
    @RequireRole("admin")
    public Mono<ApiResponse<String>> reviewSkill(@RequestBody SkillDtos.ReviewSkillRequest request) {
        return adminGuard.requireAdmin().then(skillService.reviewSkill(request)).thenReturn(ApiResponse.ok("ok"));
    }

    /** 查询技能市场。 */
    @GetMapping("/skill/listMarketSkills")
    public Mono<ApiResponse<SkillDtos.SkillMarketListResponse>> listMarketSkills(
            @RequestParam(required = false) String category,
            @RequestParam(required = false) String keyword,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize) {
        return skillService.listMarketSkills(category, keyword, page, pageSize).map(ApiResponse::ok);
    }

    /** 查询技能详情。 */
    @GetMapping("/skill/getSkillDetail")
    public Mono<ApiResponse<SkillDtos.SkillDetail>> getSkillDetail(@RequestParam Long id) {
        return skillService.getSkillDetail(id).map(ApiResponse::ok);
    }

    /** 查询我创建或收藏的技能。 */
    @GetMapping("/skill/listMySkills")
    public Mono<ApiResponse<SkillDtos.SkillMineListResponse>> listMySkills(
            @RequestParam String tab,
            @RequestParam(required = false) String keyword,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize) {
        return skillService.listMySkills(tab, keyword, page, pageSize).map(ApiResponse::ok);
    }

    /** 用户创建技能。 */
    @PostMapping("/skill/createSkill")
    public Mono<ApiResponse<String>> createUserSkill(@Valid @RequestBody SkillDtos.SaveUserSkillRequest request) {
        return skillService.createUserSkill(request).thenReturn(ApiResponse.ok("ok"));
    }

    /** 用户更新自己的技能。 */
    @PostMapping("/skill/updateSkill")
    public Mono<ApiResponse<String>> updateUserSkill(@Valid @RequestBody SkillDtos.SaveUserSkillRequest request) {
        return skillService.updateUserSkill(request).thenReturn(ApiResponse.ok("ok"));
    }

    /** 用户删除自己的技能。 */
    @PostMapping("/skill/deleteSkill")
    public Mono<ApiResponse<String>> deleteUserSkill(@RequestBody SkillDtos.SkillIdRequest request) {
        return skillService.deleteUserSkill(request.id()).thenReturn(ApiResponse.ok("ok"));
    }

    /** 提交技能审核。 */
    @PostMapping("/skill/submitSkillReview")
    public Mono<ApiResponse<String>> submitSkillReview(@RequestBody SkillDtos.SkillIdRequest request) {
        return skillService.submitSkillReview(request.id()).thenReturn(ApiResponse.ok("ok"));
    }

    /** 撤回技能。 */
    @PostMapping("/skill/withdrawSkill")
    public Mono<ApiResponse<String>> withdrawSkill(@RequestBody SkillDtos.SkillIdRequest request) {
        return skillService.withdrawSkill(request.id()).thenReturn(ApiResponse.ok("ok"));
    }

    /** 收藏技能。 */
    @PostMapping("/skill/favoriteSkill")
    public Mono<ApiResponse<String>> favoriteSkill(@RequestBody SkillDtos.SkillIdRequest request) {
        return skillService.favoriteSkill(request.id()).thenReturn(ApiResponse.ok("ok"));
    }

    /** 取消收藏技能。 */
    @PostMapping("/skill/unfavoriteSkill")
    public Mono<ApiResponse<String>> unfavoriteSkill(@RequestBody SkillDtos.SkillIdRequest request) {
        return skillService.unfavoriteSkill(request.id()).thenReturn(ApiResponse.ok("ok"));
    }
}
