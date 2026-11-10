package com.novanovastudio.dto;

import jakarta.validation.constraints.NotBlank;
import java.util.List;

/**
 * 图片和视频生成技能接口数据结构。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-08-27 00:00
 */
public final class SkillDtos {

    private SkillDtos() {
    }

    /**
     * 用户侧技能选项。
     *
     * @param id 技能ID
     * @param name 技能名称
     * @param description 技能简介
     * @param targetType 适用生成类型：image、video或canvasSettingGraph
     * @param aspectRatio 默认生成比例
     * @param coverUrl 封面地址
     * @param workflowType 服务端识别的视频工作流类型
     * @param systemPrompt 技能流程提示词，画布设定图节点用于保存快照
     */
    public record SkillOption(Long id, String name, String description, String targetType, String coverUrl,
                              String workflowType, String systemPrompt, String aspectRatio) {
    }

    /**
     * 管理端技能条目。
     *
     * @param id 技能ID
     * @param name 技能名称
     * @param description 技能简介
     * @param targetType 适用生成类型：image、video或canvasSettingGraph
     * @param systemPrompt 技能流程系统提示词
     * @param aspectRatio 默认生成比例
     * @param coverUrl 封面地址
     * @param status 状态
     * @param sortOrder 排序值
     * @param createdAt 创建时间
     * @param updatedAt 更新时间
     */
    public record SkillItem(Long id, String name, String description, String targetType, String systemPrompt, String coverUrl,
                            String aspectRatio, Integer status, Integer sortOrder, String createdAt, String updatedAt,
                            String category, String subtitle, String audience, List<SkillUsageStep> usageSteps,
                            Long ownerUserId, String reviewStatus, String rejectReason, String authorName) {
    }

    /**
     * 管理端技能列表请求。
     *
     * @param keyword 关键词
     * @param targetType 适用生成类型：image、video或canvasSettingGraph
     * @param status 状态
     * @param page 页码
     * @param pageSize 每页数量
     */
    public record SkillListRequest(String keyword, String targetType, Integer status, int page, int pageSize, String reviewStatus) {
    }

    /**
     * 技能列表响应。
     *
     * @param skills 技能条目
     * @param total 总数
     */
    public record SkillListResponse(List<SkillItem> skills, long total) {
    }

    /**
     * 用户侧技能列表响应。
     *
     * @param skills 技能选项
     */
    public record SkillOptionListResponse(List<SkillOption> skills) {
    }

    /**
     * 创建技能请求。
     *
     * @param name 技能名称
     * @param description 技能简介
     * @param targetType 适用生成类型：image、video或canvasSettingGraph
     * @param systemPrompt 技能流程系统提示词
     * @param aspectRatio 默认生成比例
     * @param coverUrl 封面地址
     * @param status 状态
     * @param sortOrder 排序值
     */
    public record CreateSkillRequest(@NotBlank(message = "business.skillNameIsRequired") String name,
                                     String description,
                                     @NotBlank(message = "business.skillTypeIsRequired") String targetType,
                                     @NotBlank(message = "business.skillSystemPromptIsRequired") String systemPrompt,
                                     String aspectRatio, String coverUrl,
                                     Integer status, Integer sortOrder,
                                     String category, String subtitle, String audience, List<SkillUsageStep> usageSteps) {
    }

    /**
     * 更新技能请求。
     *
     * @param id 技能ID
     * @param name 技能名称
     * @param description 技能简介
     * @param targetType 适用生成类型
     * @param systemPrompt 技能流程系统提示词
     * @param aspectRatio 默认生成比例
     * @param coverUrl 封面地址
     * @param status 状态
     * @param sortOrder 排序值
     */
    public record UpdateSkillRequest(Long id,
                                     @NotBlank(message = "business.skillNameIsRequired") String name,
                                     String description,
                                     @NotBlank(message = "business.skillTypeIsRequired") String targetType,
                                     @NotBlank(message = "business.skillSystemPromptIsRequired") String systemPrompt,
                                     String aspectRatio, String coverUrl,
                                     Integer status, Integer sortOrder,
                                     String category, String subtitle, String audience, List<SkillUsageStep> usageSteps) {
    }

    /**
     * 更新技能状态请求。
     *
     * @param id 技能ID
     * @param status 状态
     */
    public record UpdateSkillStatusRequest(Long id, Integer status) {
    }

    /**
     * 批量删除技能请求。
     *
     * @param ids 技能ID列表
     */
    public record DeleteSkillsRequest(List<Long> ids) {
    }

    /**
     * 使用步骤。
     *
     * @param title 步骤标题
     * @param detail 步骤说明
     */
    public record SkillUsageStep(String title, String detail) {
    }

    /**
     * 市场技能卡片。
     *
     * @param id 技能ID
     * @param name 技能名称
     * @param subtitle 一句话介绍
     * @param description 技能描述
     * @param category 市场分类
     * @param targetType 创作去向
     * @param coverUrl 封面地址
     * @param aspectRatio 默认生成比例
     * @param workflowType 视频工作流类型
     * @param authorName 作者名称，官方技能为空
     * @param official 是否官方技能
     * @param favorited 当前用户是否已收藏
     */
    public record SkillMarketCard(Long id, String name, String subtitle, String description, String category, String targetType,
                                  String coverUrl, String aspectRatio, String workflowType, String authorName,
                                  boolean official, boolean favorited) {
    }

    /**
     * 市场列表响应。
     *
     * @param skills 技能卡片
     * @param total 总数
     */
    public record SkillMarketListResponse(List<SkillMarketCard> skills, long total) {
    }

    /**
     * 技能详情。
     *
     * @param systemPrompt 流程提示词，仅作者可见
     * @param owned 是否当前用户创建
     * @param related 相关技能
     */
    public record SkillDetail(Long id, String name, String subtitle, String description, String category, String targetType,
                              String coverUrl, String aspectRatio, String workflowType, String audience, List<SkillUsageStep> usageSteps,
                              String authorName, boolean official, boolean favorited, Integer status, String reviewStatus,
                              String rejectReason, String systemPrompt, boolean owned, List<SkillMarketCard> related) {
    }

    /**
     * 我的技能卡片。
     */
    public record SkillMineCard(Long id, String name, String subtitle, String description, String category, String targetType,
                                String coverUrl, String aspectRatio, String workflowType, String authorName, boolean official,
                                boolean favorited, Integer status, String reviewStatus, String rejectReason, boolean owned) {
    }

    /**
     * 我的技能列表响应。
     *
     * @param skills 技能卡片
     * @param total 总数
     */
    public record SkillMineListResponse(List<SkillMineCard> skills, long total) {
    }

    /**
     * 用户保存技能请求。
     *
     * @param id 技能ID，创建时为空
     * @param name 技能名称
     * @param subtitle 一句话介绍
     * @param description 技能描述
     * @param category 市场分类
     * @param targetType 创作去向：image或video
     * @param systemPrompt 技能流程系统提示词
     * @param aspectRatio 默认生成比例
     * @param coverUrl 封面地址
     * @param audience 适合人群
     * @param usageSteps 使用步骤
     */
    public record SaveUserSkillRequest(Long id,
                                       @NotBlank(message = "business.skillNameIsRequired") String name,
                                       String subtitle,
                                       String description,
                                       @NotBlank(message = "business.skillCategoryIsRequired") String category,
                                       @NotBlank(message = "business.skillTypeIsRequired") String targetType,
                                       @NotBlank(message = "business.skillSystemPromptIsRequired") String systemPrompt,
                                       String aspectRatio, String coverUrl, String audience, List<SkillUsageStep> usageSteps) {
    }

    /**
     * 技能ID请求。
     *
     * @param id 技能ID
     */
    public record SkillIdRequest(Long id) {
    }

    /**
     * 审核技能请求。
     *
     * @param id 技能ID
     * @param approved 是否通过
     * @param reason 驳回原因
     */
    public record ReviewSkillRequest(Long id, Boolean approved, String reason) {
    }
}
